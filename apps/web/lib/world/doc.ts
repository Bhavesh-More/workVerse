// Pure operations on a WorldDoc. Every function returns a new document (or a derived value) and
// never mutates its input, so the editor's undo history can keep old documents as-is.
import {
  CODE_FLOORS,
  FLOOR_CODES,
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  WORLD_VERSION,
  type Asset,
  type FloorKind,
  type Kit,
  type PersonPlacement,
  type PlacedObject,
  type Room,
  type WorldDoc,
} from "./types.ts";

export type Rect = { x: number; y: number; w: number; h: number };

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export function emptyWorld(width = 40, height = 28, name = "Our office"): WorldDoc {
  return {
    version: WORLD_VERSION,
    name,
    width,
    height,
    floor: Array.from({ length: height }, () => ".".repeat(width)),
    rooms: [],
    objects: [],
    people: [],
    spawn: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
  };
}

export function inBounds(doc: Pick<WorldDoc, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

export function floorAt(doc: WorldDoc, x: number, y: number): FloorKind | null {
  if (!inBounds(doc, x, y)) return null;
  return CODE_FLOORS[doc.floor[y]![x]!] ?? null;
}

/** Paint (or clear, with null) every cell of a rect, clipped to the world. */
export function paintFloor(doc: WorldDoc, rect: Rect, kind: FloorKind | null): WorldDoc {
  const code = kind ? FLOOR_CODES[kind] : ".";
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(doc.width - 1, rect.x + rect.w - 1);
  const y1 = Math.min(doc.height - 1, rect.y + rect.h - 1);
  if (x1 < x0 || y1 < y0) return doc;
  const floor = doc.floor.slice();
  for (let y = y0; y <= y1; y++) {
    const row = floor[y]!;
    floor[y] = row.slice(0, x0) + code.repeat(x1 - x0 + 1) + row.slice(x1 + 1);
  }
  return { ...doc, floor };
}

/** Paint a list of cells (brush strokes). */
export function paintCells(doc: WorldDoc, cells: { x: number; y: number }[], kind: FloorKind | null): WorldDoc {
  if (!cells.length) return doc;
  const code = kind ? FLOOR_CODES[kind] : ".";
  const rows = doc.floor.map((r) => r.split(""));
  for (const c of cells) if (inBounds(doc, c.x, c.y)) rows[c.y]![c.x] = code;
  return { ...doc, floor: rows.map((r) => r.join("")) };
}

/** Grow or shrink the world from its right and bottom edges (or shift everything, for top/left). */
export function resizeWorld(doc: WorldDoc, width: number, height: number, shift = { x: 0, y: 0 }): WorldDoc {
  const w = clamp(Math.round(width), MIN_W, MAX_W);
  const h = clamp(Math.round(height), MIN_H, MAX_H);
  const floor: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const sx = x - shift.x;
      const sy = y - shift.y;
      row += inBounds(doc, sx, sy) ? doc.floor[sy]![sx]! : ".";
    }
    floor.push(row);
  }
  const mv = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: o.x + shift.x, y: o.y + shift.y });
  return {
    ...doc,
    width: w,
    height: h,
    floor,
    rooms: doc.rooms.map(mv),
    objects: doc.objects.map(mv),
    people: doc.people.map(mv),
    spawn: mv(doc.spawn),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------------- objects
export function footprint(asset: Asset, o: Pick<PlacedObject, "x" | "y" | "ox" | "oy">): Rect {
  // A nudge can push the art into the next cell; collision covers every cell it touches.
  const ox = o.ox ?? 0;
  const oy = o.oy ?? 0;
  const x0 = Math.floor((o.x * 32 + ox) / 32);
  const x1 = Math.floor((o.x * 32 + ox + asset.w * 32 - 1) / 32);
  const y0 = Math.floor((o.y * 32 + oy) / 32);
  const y1 = Math.floor((o.y * 32 + oy + asset.h * 32 - 1) / 32);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function roomRect(r: Room): Rect {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/** The room whose floor contains a cell (rooms listed later win, like the canvas draws them). */
export function roomAt(doc: WorldDoc, x: number, y: number): Room | null {
  for (let i = doc.rooms.length - 1; i >= 0; i--) {
    const r = doc.rooms[i]!;
    if (rectContains(roomRect(r), x, y)) return r;
  }
  return null;
}

export function objectRoom(doc: WorldDoc, kit: Kit, o: PlacedObject): Room | null {
  const a = kit.byId.get(o.asset);
  if (!a) return null;
  const fp = footprint(a, o);
  const cx = fp.x + Math.floor(fp.w / 2);
  // Wall pieces hang on the face above a room: look just below them.
  const cy = a.mount === "wall" ? fp.y + 2 : fp.y + Math.floor(fp.h / 2);
  return roomAt(doc, cx, cy);
}

export function addObject(doc: WorldDoc, o: Omit<PlacedObject, "id"> & { id?: string }): { doc: WorldDoc; id: string } {
  const id = o.id ?? uid("obj");
  return { doc: { ...doc, objects: [...doc.objects, { ...o, id }] }, id };
}

export function updateObjects(doc: WorldDoc, ids: Set<string>, fn: (o: PlacedObject) => PlacedObject): WorldDoc {
  return { ...doc, objects: doc.objects.map((o) => (ids.has(o.id) ? fn(o) : o)) };
}

export function updatePeople(doc: WorldDoc, ids: Set<string>, fn: (p: PersonPlacement) => PersonPlacement): WorldDoc {
  return { ...doc, people: doc.people.map((p) => (ids.has(p.id) ? fn(p) : p)) };
}

export function removeIds(doc: WorldDoc, ids: Set<string>): WorldDoc {
  return {
    ...doc,
    objects: doc.objects.filter((o) => !ids.has(o.id)),
    people: doc.people.filter((p) => !ids.has(p.id)),
    rooms: doc.rooms.filter((r) => !ids.has(r.id)),
  };
}

// ---------------------------------------------------------------------------------- rooms
/** Everything that sits inside a room: objects whose footprint centre is in it, and people. */
export function roomContents(doc: WorldDoc, kit: Kit, room: Room): { objects: Set<string>; people: Set<string> } {
  const objects = new Set<string>();
  const people = new Set<string>();
  for (const o of doc.objects) if (objectRoom(doc, kit, o)?.id === room.id) objects.add(o.id);
  for (const p of doc.people) if (rectContains(roomRect(room), p.x, p.y)) people.add(p.id);
  return { objects, people };
}

/** Move a room with its floor, furniture and people. Cells it leaves become wall. */
export function moveRoom(doc: WorldDoc, kit: Kit, roomId: string, dx: number, dy: number): WorldDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || (dx === 0 && dy === 0)) return doc;
  const { objects, people } = roomContents(doc, kit, room);
  // Capture the room's floor cells, clear them, then stamp them at the new place.
  const cells: { x: number; y: number; code: string }[] = [];
  for (let y = room.y; y < room.y + room.h; y++)
    for (let x = room.x; x < room.x + room.w; x++)
      if (inBounds(doc, x, y)) cells.push({ x, y, code: doc.floor[y]![x]! });
  const rows = doc.floor.map((r) => r.split(""));
  for (const c of cells) rows[c.y]![c.x] = ".";
  for (const c of cells) if (inBounds(doc, c.x + dx, c.y + dy)) rows[c.y + dy]![c.x + dx] = c.code;
  let next: WorldDoc = {
    ...doc,
    floor: rows.map((r) => r.join("")),
    rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, x: r.x + dx, y: r.y + dy } : r)),
  };
  next = updateObjects(next, objects, (o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
  next = updatePeople(next, people, (p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  if (rectContains(roomRect(room), doc.spawn.x, doc.spawn.y)) next.spawn = { x: doc.spawn.x + dx, y: doc.spawn.y + dy };
  return next;
}

/** Resize a room: new area gets the room's floor, area it gives up becomes wall. */
export function resizeRoom(doc: WorldDoc, roomId: string, rect: Rect): WorldDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room) return doc;
  const next = { x: rect.x, y: rect.y, w: Math.max(2, rect.w), h: Math.max(2, rect.h) };
  const rows = doc.floor.map((r) => r.split(""));
  const old = roomRect(room);
  for (let y = Math.min(old.y, next.y); y < Math.max(old.y + old.h, next.y + next.h); y++) {
    for (let x = Math.min(old.x, next.x); x < Math.max(old.x + old.w, next.x + next.w); x++) {
      if (!inBounds(doc, x, y)) continue;
      const inOld = rectContains(old, x, y);
      const inNew = rectContains(next, x, y);
      if (inNew && !inOld) rows[y]![x] = FLOOR_CODES[room.floor];
      else if (inOld && !inNew) rows[y]![x] = ".";
    }
  }
  return {
    ...doc,
    floor: rows.map((r) => r.join("")),
    rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, ...next } : r)),
  };
}

/** Change a room's floor kind: repaints its floor cells (doorways cut into walls are kept). */
export function setRoomFloor(doc: WorldDoc, roomId: string, kind: FloorKind): WorldDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room) return doc;
  const rows = doc.floor.map((r) => r.split(""));
  for (let y = room.y; y < room.y + room.h; y++)
    for (let x = room.x; x < room.x + room.w; x++)
      if (inBounds(doc, x, y) && rows[y]![x] !== ".") rows[y]![x] = FLOOR_CODES[kind];
  return {
    ...doc,
    floor: rows.map((r) => r.join("")),
    rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, floor: kind } : r)),
  };
}

/** Delete a room together with its floor and contents. */
export function deleteRoom(doc: WorldDoc, kit: Kit, roomId: string): WorldDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room) return doc;
  const { objects, people } = roomContents(doc, kit, room);
  const cleared = paintFloor(doc, roomRect(room), null);
  return removeIds(cleared, new Set([roomId, ...objects, ...people]));
}

/**
 * Carve a doorway through the wall at (x, y): looks for floor on both sides (vertically, then
 * horizontally) within a few cells and paints the gap, `width` cells wide, with the floor found.
 * Returns null when there's no room on both sides to connect.
 */
export function carveDoor(doc: WorldDoc, x: number, y: number, width = 2): WorldDoc | null {
  if (floorAt(doc, x, y)) return null;
  const tryAxis = (vertical: boolean): WorldDoc | null => {
    const step = (i: number) => (vertical ? { x, y: y + i } : { x: x + i, y });
    let a = 0;
    while (a < 5 && !floorAt(doc, step(-a - 1).x, step(-a - 1).y)) a++;
    let b = 0;
    while (b < 5 && !floorAt(doc, step(b + 1).x, step(b + 1).y)) b++;
    if (a >= 5 || b >= 5) return null;
    const near = step(b + 1);
    const kind = floorAt(doc, near.x, near.y)!;
    const cells: { x: number; y: number }[] = [];
    for (let i = -a; i <= b; i++) {
      for (let k = 0; k < width; k++) {
        const c = step(i);
        cells.push(vertical ? { x: c.x + k, y: c.y } : { x: c.x, y: c.y + k });
      }
    }
    return paintCells(doc, cells, kind);
  };
  return tryAxis(true) ?? tryAxis(false);
}

export function stats(doc: WorldDoc) {
  let floor = 0;
  for (const row of doc.floor) for (const c of row) if (c !== ".") floor++;
  return { floor, rooms: doc.rooms.length, objects: doc.objects.length, people: doc.people.length };
}
