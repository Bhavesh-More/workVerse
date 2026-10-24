// Room presets: editable starting points, not images. Stamping a preset paints its floor, creates
// a room and places every piece of furniture as its own object, so each can be moved or removed.
// Coordinates are relative to the room's top-left floor tile; wall pieces use y = -2 (the face
// row directly above the room).
import { carveDoor, clamp, emptyWorld, floorAt, footprint, paintCells, paintFloor, resizeWorld, uid, type Rect } from "./doc.ts";
import { compileWorld } from "./compile.ts";
import { JUDGE_HOME, JUDGE_SLOTS } from "./validate.ts";
import type { Dir, FloorKind, Kit, Member, Paint, PlacedObject, Room, RoomPurpose, WorldDoc } from "./types.ts";

export type PresetObject = { asset: string; x: number; y: number };
export type RoomPreset = {
  id: string;
  name: string;
  description: string;
  useFor: string;
  purpose: RoomPurpose;
  paint: Paint;
  floor: FloorKind;
  w: number;
  h: number;
  capacity: string;
  objects: PresetObject[];
  /** Interior wall cells (cleared floor), e.g. partitions between private offices. */
  walls?: { x: number; y: number }[];
  /** Door positions along the room's corridor-facing side (x offsets); default: centred. */
  doors?: number[];
};

const o = (asset: string, x: number, y: number): PresetObject => ({ asset, x, y });

function pod(x: number, y: number, front = "desk_s_code"): PresetObject[] {
  // Two back-to-back pairs: chairs north face south, chairs south face north.
  return [
    o("chair_s", x, y), o("chair_s", x + 2, y),
    o("desk_n", x, y + 1), o("desk_n2", x + 2, y + 1),
    o(front, x, y + 2), o("desk_s_logs", x + 2, y + 2),
    o("chair_n", x, y + 3), o("chair_n", x + 2, y + 3),
  ];
}

export const PRESETS: RoomPreset[] = [
  {
    id: "open_plan",
    name: "Open-plan office",
    description: "Two desk pods with walkways, storage along the wall and plants in the corners.",
    useFor: "Engineering, design, product and general teams.",
    purpose: "other",
    paint: "engineering",
    floor: "carpet",
    w: 14,
    h: 10,
    capacity: "8 desks",
    objects: [
      o("window_2", 1, -2), o("window_2", 8, -2), o("clock", 10, -2), o("bulletin", 11, -2),
      o("plant_tall", 0, 0), o("bookshelf", 3, 0), o("bookshelf_b", 8, 0), o("plant_tall_b", 13, 0),
      ...pod(2, 3), ...pod(8, 3),
      o("printer", 13, 4), o("cabinet", 13, 5),
      o("plant_tall", 0, 9), o("trash", 6, 9), o("plant_small", 13, 9),
    ],
  },
  {
    id: "meeting",
    name: "Meeting & conference room",
    description: "A six-seat table facing a presentation screen, with room to walk around it.",
    useFor: "Meetings, reviews and client calls.",
    purpose: "meeting_room",
    paint: "meeting",
    floor: "oak",
    w: 12,
    h: 8,
    capacity: "8 seats",
    objects: [
      o("art_hills", 1, -2), o("presentation", 4, -2), o("window_2", 9, -2),
      o("plant_tall", 0, 0), o("plant_tall_b", 11, 0),
      o("meeting_table_6", 3, 3),
      o("chair_s_teal", 4, 2), o("chair_s_teal", 6, 2), o("chair_s_teal", 8, 2),
      o("chair_n_teal", 3, 5), o("chair_n_teal", 5, 5), o("chair_n_teal", 7, 5),
      o("chair_e", 2, 3), o("chair_w", 9, 3),
      o("plant_small", 0, 7), o("cabinet", 11, 7),
    ],
  },
  {
    id: "reception",
    name: "Reception & lobby",
    description: "A welcome desk under the company sign, a waiting corner and clear paths in.",
    useFor: "The main entrance where candidates arrive.",
    purpose: "reception",
    paint: "reception",
    floor: "stone",
    w: 12,
    h: 8,
    capacity: "Desk + 2 guests",
    objects: [
      o("window_2", 0, -2), o("logo_sign", 4, -2), o("window_2", 8, -2), o("clock", 11, -2),
      o("coat_rack", 0, 0), o("plant_snake", 10, 0), o("plant_tall", 11, 0),
      o("obj_reception_desk", 4, 3),
      o("water_cooler", 0, 4),
      o("armchair_coral", 8, 6), o("round_table", 9, 6), o("armchair_navy", 10, 6),
      o("trash", 0, 7), o("plant_small", 11, 7),
    ],
  },
  {
    id: "executive",
    name: "Executive & private offices",
    description: "Two private offices side by side, each with a desk, visitor chairs and its own door.",
    useFor: "Leadership, managers and focused one-to-ones.",
    purpose: "manager_office",
    paint: "manager",
    floor: "walnut",
    w: 17,
    h: 9,
    capacity: "2 offices",
    walls: Array.from({ length: 9 }, (_, y) => ({ x: 8, y })),
    doors: [3, 12],
    objects: [
      o("window_2", 1, -2), o("art_city", 5, -2), o("window_2", 10, -2), o("art_hills", 14, -2),
      o("bookshelf", 0, 0), o("plant_tall", 7, 0), o("exec_desk", 2, 3), o("chair_s", 2, 2),
      o("armchair_mustard_n", 2, 5), o("armchair_navy_n", 4, 5), o("cabinet", 0, 8), o("plant_snake", 7, 8),
      o("plant_tall_b", 9, 0), o("bookshelf_b", 15, 0), o("exec_desk", 11, 3), o("chair_s", 11, 2),
      o("armchair_navy_n", 11, 5), o("armchair_mustard_n", 13, 5), o("cabinet_teal", 16, 8), o("plant_small", 9, 8),
    ],
  },
  {
    id: "ops_lab",
    name: "Engineering & operations lab",
    description: "The incident tools — dashboard, log, metrics and deploy consoles, runbook — plus a desk pod and servers.",
    useFor: "Technical and operations teams. Holds the scenario's investigation tools.",
    purpose: "engineering_workspace",
    paint: "engineering",
    floor: "carpet",
    w: 16,
    h: 10,
    capacity: "6 desks + tools",
    objects: [
      o("obj_incident_dashboard", 1, -2), o("obj_migration_notes", 6, -2), o("window_2", 9, -2), o("clock", 12, -2),
      o("obj_log_viewer", 1, 1), o("obj_metrics_panel", 4, 1), o("obj_deploy_console", 7, 1), o("plant_tall_b", 15, 0),
      o("obj_runbook", 13, 2),
      ...pod(2, 5, "desk_s_code"),
      o("desk_s_code", 8, 6), o("desk_s_logs", 10, 6), o("chair_n", 8, 7), o("chair_n", 10, 7),
      o("printer", 15, 5),
      o("plant_tall", 0, 9), o("server_rack", 11, 9), o("server_rack_b", 12, 9), o("server_rack", 13, 9), o("cabinet", 14, 9),
    ],
  },
  {
    id: "lounge",
    name: "Breakout & collaboration lounge",
    description: "Kitchen and coffee along the wall, café tables, a sofa corner and beanbags.",
    useFor: "Breaks, informal chats and team socials.",
    purpose: "break_area",
    paint: "break",
    floor: "checker",
    w: 12,
    h: 9,
    capacity: "10 seats",
    objects: [
      o("upper_cabinets", 1, -2), o("art_sunset", 4, -2), o("window_2", 10, -2),
      o("fridge", 0, 0), o("counter_sink", 1, 0), o("counter", 2, 0), o("counter_fruit", 3, 0),
      o("obj_coffee_machine", 5, 0), o("water_cooler", 10, 0), o("vending", 11, 0),
      o("stool", 2, 4), o("round_table", 3, 4), o("stool_teal", 4, 4),
      o("stool", 7, 4), o("round_table", 8, 4), o("stool_teal", 9, 4),
      o("armchair_coral", 2, 7), o("low_table3", 3, 7), o("armchair_mustard", 6, 7),
      o("beanbag_teal", 9, 7), o("cat_bed", 10, 8),
      o("plant_tall", 0, 8), o("plant_tall_b", 11, 8), o("trash", 0, 4),
    ],
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Default participants' placement purposes for members (anywhere people work). */
const MEMBER_PURPOSES: RoomPurpose[] = ["other", "engineering_workspace", "collaboration_area", "break_area", "reception"];

// ---------------------------------------------------------------------------------- stamping
export type StampOptions = { name?: string; purpose?: RoomPurpose; skipInteractive?: Set<string> };

/** Paint a preset's floor at (x, y), create its room and place its objects. */
export function stampPreset(doc: WorldDoc, kit: Kit, preset: RoomPreset, x: number, y: number, opts: StampOptions = {}): { doc: WorldDoc; roomId: string } {
  const room: Room = {
    id: uid("room"),
    name: opts.name ?? preset.name,
    purpose: opts.purpose ?? preset.purpose,
    x,
    y,
    w: preset.w,
    h: preset.h,
    paint: preset.paint,
    floor: preset.floor,
  };
  let next = paintFloor(doc, { x, y, w: preset.w, h: preset.h }, preset.floor);
  if (preset.walls) next = paintCells(next, preset.walls.map((c) => ({ x: x + c.x, y: y + c.y })), null);
  const taken = new Set(opts.skipInteractive ?? []);
  for (const ob of next.objects) {
    const a = kit.byId.get(ob.asset);
    if (a?.interactive) taken.add(a.interactive);
  }
  const objects: PlacedObject[] = [];
  for (const p of preset.objects) {
    const a = kit.byId.get(p.asset);
    if (!a) continue;
    if (a.interactive) {
      if (taken.has(a.interactive)) continue; // one of each scenario tool per world
      taken.add(a.interactive);
    }
    objects.push({ id: uid("obj"), asset: p.asset, x: x + p.x, y: y + p.y });
  }
  next = { ...next, rooms: [...next.rooms, room], objects: [...next.objects, ...objects] };
  return { doc: next, roomId: room.id };
}

/** Find the first spot (scanning rows) where a w x h room plus its wall margin is all empty. */
export function findFreeSpot(doc: WorldDoc, w: number, h: number): { x: number; y: number } | null {
  const free = (x0: number, y0: number) => {
    for (let y = y0 - 3; y < y0 + h + 1; y++)
      for (let x = x0 - 1; x < x0 + w + 1; x++) if (floorAt(doc, x, y)) return false;
    return true;
  };
  for (let y = 3; y + h + 1 <= doc.height; y++) for (let x = 1; x + w + 1 <= doc.width; x++) if (free(x, y)) return { x, y };
  return null;
}

/** Add a preset somewhere sensible, growing the world to the right or bottom if needed. */
export function addPresetAuto(doc: WorldDoc, kit: Kit, preset: RoomPreset): { doc: WorldDoc; roomId: string } {
  let spot = findFreeSpot(doc, preset.w, preset.h);
  let next = doc;
  if (!spot) {
    const growRight = doc.width + preset.w + 2 <= 96;
    next = growRight ? resizeWorld(doc, doc.width + preset.w + 2, Math.max(doc.height, preset.h + 5)) : resizeWorld(doc, Math.max(doc.width, preset.w + 3), doc.height + preset.h + 4);
    spot = findFreeSpot(next, preset.w, preset.h) ?? { x: 1, y: 3 };
  }
  const purposeTaken = next.rooms.some((r) => r.purpose === preset.purpose);
  return stampPreset(next, kit, preset, spot.x, spot.y, { purpose: purposeTaken ? "other" : preset.purpose });
}

/** Open the nearest wall of a room onto other floor (used by "Connect room"). */
export function connectRoom(doc: WorldDoc, roomId: string): WorldDoc | null {
  const r = doc.rooms.find((x) => x.id === roomId);
  if (!r) return null;
  const mid = { x: r.x + Math.floor(r.w / 2) - 1, y: r.y + Math.floor(r.h / 2) };
  const tries = [
    { x: mid.x, y: r.y + r.h }, // below
    { x: mid.x, y: r.y - 1 }, // above
    { x: r.x - 1, y: mid.y }, // left
    { x: r.x + r.w, y: mid.y }, // right
  ];
  for (const t of tries) {
    const carved = carveDoor(doc, t.x, t.y, 2);
    if (carved) return carved;
  }
  return null;
}

// ---------------------------------------------------------------------------------- layouts
/**
 * Lay out rooms like the default office: a top row and a bottom row of rooms either side of a
 * long corridor, every room with a doorway onto it. Rows are balanced by width.
 */
export function generateLayout(kit: Kit, presetIds: string[], opts: { name?: string; members?: Member[] } = {}): WorldDoc {
  const presets = presetIds.map(presetById).filter((p): p is RoomPreset => !!p);
  const rows: [RoomPreset[], RoomPreset[]] = [[], []];
  const widths = [0, 0];
  // Reception first (it's the entrance), then widest first into the narrower row.
  const ordered = [...presets].sort((a, b) => (a.id === "reception" ? -1 : b.id === "reception" ? 1 : b.w - a.w));
  for (const p of ordered) {
    const i = widths[0]! <= widths[1]! ? 0 : 1;
    rows[i]!.push(p);
    widths[i]! += p.w + 1;
  }
  const topH = Math.max(0, ...rows[0].map((p) => p.h));
  const botH = Math.max(0, ...rows[1].map((p) => p.h));
  const width = clamp(Math.max(widths[0]!, widths[1]!, 18) + 1, 18, 96);
  const topY = 3;
  const corridorY = rows[0].length ? topY + topH + 3 : 3;
  const botY = corridorY + 3 + 3;
  const height = clamp(rows[1].length ? botY + botH + 1 : corridorY + 4, 12, 72);
  let doc = emptyWorld(width, height, opts.name ?? "Our office");

  // Corridor
  doc = stampCorridor(doc, { x: 1, y: corridorY, w: width - 2, h: 3 });
  const purposes = new Set<string>(["corridor_main"]);
  const placeRow = (row: RoomPreset[], y: number, top: boolean) => {
    let x = 1;
    for (const p of row) {
      const purpose = purposes.has(p.purpose) && p.purpose !== "other" ? "other" : p.purpose;
      purposes.add(purpose);
      const res = stampPreset(doc, kit, p, x, y, { purpose });
      doc = res.doc;
      // Doorways straight through the wall band between the room and the corridor.
      for (const dx of p.doors ?? [doorOffset(kit, p, top)]) {
        const cells: { x: number; y: number }[] = [];
        const y0 = top ? y + p.h : corridorY + 3;
        const y1 = top ? corridorY - 1 : y - 1;
        for (let yy = y0; yy <= y1; yy++) cells.push({ x: x + dx, y: yy }, { x: x + dx + 1, y: yy });
        // The tile just inside the door must stay walkable too.
        const inside = top ? y + p.h - 1 : y;
        doc = clearCells(paintCells(doc, cells, "concrete"), kit, [...cells, { x: x + dx, y: inside }, { x: x + dx + 1, y: inside }]);
      }
      x += p.w + 1;
    }
  };
  placeRow(rows[0], topY, true);
  placeRow(rows[1], botY, false);

  // Candidates arrive in the corridor outside reception (or at the corridor's left end).
  const reception = doc.rooms.find((r) => r.purpose === "reception");
  doc.spawn = reception
    ? { x: reception.x + Math.floor(reception.w / 2), y: reception.y + reception.h - 1 }
    : { x: 3, y: corridorY + 1 };
  return autoPlacePeople(doc, kit, opts.members ?? []);
}

/**
 * Where to put a room's doorway (x offset of a 2-wide gap): the free spot nearest the centre of
 * the corridor-facing side, not under furniture on the room's edge row and, for doors through
 * the room's own top wall, not through a wall piece.
 */
export function doorOffset(kit: Kit, p: RoomPreset, doorAtBottom: boolean): number {
  const edgeRow = doorAtBottom ? p.h - 1 : 0;
  const blocked = new Set<number>();
  for (const ob of p.objects) {
    const a = kit.byId.get(ob.asset);
    if (!a) continue;
    if (a.mount === "wall") {
      if (!doorAtBottom) for (let x = ob.x; x < ob.x + a.w; x++) blocked.add(x);
    } else if (a.solid && ob.y <= edgeRow && ob.y + a.h > edgeRow) {
      for (let x = ob.x; x < ob.x + a.w; x++) blocked.add(x);
    } else if (a.solid && !doorAtBottom && ob.y === 1) {
      // keep the tile just inside the door clear too
      for (let x = ob.x; x < ob.x + a.w; x++) blocked.add(x);
    }
  }
  for (const w of p.walls ?? []) if (w.y === edgeRow) blocked.add(w.x);
  const centre = Math.floor(p.w / 2) - 1;
  const order = Array.from({ length: p.w - 1 }, (_, i) => i).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
  return order.find((x) => !blocked.has(x) && !blocked.has(x + 1)) ?? centre;
}

/** Remove furniture standing on, and wall pieces hanging over, any of these cells. */
export function clearCells(doc: WorldDoc, kit: Kit, cells: { x: number; y: number }[]): WorldDoc {
  const hit = (r: Rect) => cells.some((c) => c.x >= r.x && c.y >= r.y && c.x < r.x + r.w && c.y < r.y + r.h);
  return {
    ...doc,
    objects: doc.objects.filter((ob) => {
      const a = kit.byId.get(ob.asset);
      if (!a) return true;
      const r = a.mount === "wall" ? { x: ob.x, y: ob.y, w: a.w, h: 2 } : footprint(a, ob);
      return a.mount === "floor" && !a.solid ? true : !hit(r);
    }),
  };
}

function stampCorridor(doc: WorldDoc, rect: Rect): WorldDoc {
  const next = paintFloor(doc, rect, "concrete");
  const room: Room = { id: uid("room"), name: "Corridor", purpose: "corridor_main", ...rect, paint: "corridor", floor: "concrete" };
  return {
    ...next,
    rooms: [...next.rooms, room],
    objects: [
      ...next.objects,
      { id: uid("obj"), asset: "plant_tall", x: rect.x, y: rect.y },
      { id: uid("obj"), asset: "plant_tall_b", x: rect.x + rect.w - 1, y: rect.y },
    ],
  };
}

/**
 * Put each judge on a free, reachable tile in their home room (falling back to any reachable
 * tile), and members into workspaces. Existing placements are kept.
 */
export function autoPlacePeople(doc: WorldDoc, kit: Kit, members: Member[]): WorldDoc {
  const cw = compileWorld(doc, kit, members);
  const used = new Set(doc.people.map((p) => `${p.x},${p.y}`));
  const placed = new Set(doc.people.map((p) => p.ref));
  const people = [...doc.people];
  // Tiles reachable from spawn, and not right in front of an interactive object.
  const blockedFront = new Set(Object.values(cw.object_slots).map((s) => `${s.x},${s.y}`));
  const reach = new Set<string>();
  const stack = [doc.spawn];
  if (!cw.collision[doc.spawn.y]?.[doc.spawn.x]) reach.add(`${doc.spawn.x},${doc.spawn.y}`);
  while (stack.length) {
    const c = stack.pop()!;
    for (const [nx, ny] of [[c.x + 1, c.y], [c.x - 1, c.y], [c.x, c.y + 1], [c.x, c.y - 1]] as const) {
      const k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= cw.width || ny >= cw.height || cw.collision[ny]![nx] || reach.has(k)) continue;
      reach.add(k);
      stack.push({ x: nx, y: ny });
    }
  }
  const spotIn = (rooms: Room[]): { x: number; y: number } | null => {
    for (const r of rooms) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const cells: { x: number; y: number; d: number }[] = [];
      for (let y = r.y + 1; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
      cells.sort((a, b) => a.d - b.d);
      for (const c of cells) {
        const k = `${c.x},${c.y}`;
        if (reach.has(k) && !used.has(k) && !blockedFront.has(k) && !used.has(`${c.x - 1},${c.y}`) && !used.has(`${c.x + 1},${c.y}`)) return c;
      }
    }
    return null;
  };
  const anyRoom = doc.rooms;
  const add = (ref: string, rooms: Room[], face: Dir) => {
    if (placed.has(ref)) return;
    const s = spotIn(rooms) ?? spotIn(anyRoom);
    if (!s) return;
    used.add(`${s.x},${s.y}`);
    placed.add(ref);
    people.push({ id: uid("person"), ref, x: s.x, y: s.y, face });
  };
  for (const slot of JUDGE_SLOTS) add(`judge:${slot}`, doc.rooms.filter((r) => r.purpose === JUDGE_HOME[slot]), "down");
  for (const m of members) add(`member:${m.id}`, doc.rooms.filter((r) => MEMBER_PURPOSES.includes(r.purpose)), "down");
  return { ...doc, people };
}
