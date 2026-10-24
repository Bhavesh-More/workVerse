// WorldDoc -> CompiledWorld: the runtime map the game and the editor canvas both draw.
// Walls are derived from floors exactly like scripts/build_office_map.py: every non-floor cell is
// wall; the two wall cells directly above a floor cell show a painted face, the rest show a cap.
import { floorAt, footprint, inBounds, roomAt } from "./doc.ts";
import { CODE_FLOORS, TILE, type CompiledWorld, type Kit, type Member, type Paint, type WorldDoc } from "./types.ts";

export const PEOPLE_PREFIX = { judge: "judge:", member: "member:", pet: "pet:" } as const;

/** Approach point (tile units, fractional) in front of an interactive object. */
export function anchorFor(asset: { w: number; h: number; mount: "floor" | "wall" }, x: number, y: number) {
  return asset.mount === "wall" ? { x: x + asset.w / 2, y: y + 2.6 } : { x: x + asset.w / 2, y: y + asset.h + 0.6 };
}

export function faceGrid(doc: WorldDoc): { row: number; paint: Paint }[][] {
  const faces = Array.from({ length: doc.height }, () =>
    Array.from({ length: doc.width }, () => ({ row: -1, paint: "corridor" as Paint })),
  );
  for (let y = 2; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      if (!floorAt(doc, x, y) || floorAt(doc, x, y - 1) || floorAt(doc, x, y - 2)) continue;
      const paint = roomAt(doc, x, y)?.paint ?? "corridor";
      faces[y - 1]![x] = { row: 1, paint };
      faces[y - 2]![x] = { row: 0, paint };
    }
  }
  return faces;
}

export function compileWorld(doc: WorldDoc, kit: Kit, members: Member[] = []): CompiledWorld {
  const floors = doc.floor.map((row) => row.split("").map((c) => CODE_FLOORS[c] ?? null));
  const collision = floors.map((row) => row.map((k) => (k ? 0 : 1)));
  const faces = faceGrid(doc);

  const props: CompiledWorld["props"] = [];
  const mounted: CompiledWorld["mounted"] = [];
  const object_slots: CompiledWorld["object_slots"] = {};
  for (const o of doc.objects) {
    const a = kit.byId.get(o.asset);
    if (!a) continue;
    const ox = o.ox ?? 0;
    const oy = o.oy ?? 0;
    const px = o.x * TILE + ox + a.ox;
    const py = o.y * TILE + oy + a.oy;
    const d = (o.y + a.h) * TILE + oy;
    if (a.mount === "wall") mounted.push({ id: o.id, f: a.frame, x: px, y: py, d });
    else props.push({ id: o.id, f: a.frame, x: px, y: py, d });
    if (a.solid && a.mount === "floor") {
      const fp = footprint(a, o);
      for (let y = fp.y; y < fp.y + fp.h; y++)
        for (let x = fp.x; x < fp.x + fp.w; x++) if (inBounds(doc, x, y)) collision[y]![x] = 1;
    }
    if (a.interactive && !object_slots[a.interactive]) {
      const anc = anchorFor(a, o.x + ox / TILE, o.y + oy / TILE);
      object_slots[a.interactive] = {
        x: Math.floor(anc.x),
        y: Math.floor(anc.y),
        ax: Math.round(anc.x * TILE),
        ay: Math.round(anc.y * TILE),
        frame: a.frame,
        px,
        py,
        d,
        mounted: a.mount === "wall",
      };
    }
  }
  props.sort((p, q) => p.d - q.d);

  // Scenario locations are matched by room purpose: the first room of each purpose gets that id.
  const seen = new Set<string>();
  const rooms = doc.rooms.map((r) => {
    const id = r.purpose !== "other" && !seen.has(r.purpose) ? r.purpose : r.id;
    seen.add(r.purpose);
    return { id, name: r.name, x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1, paint: r.paint };
  });
  const roomIdAt = (x: number, y: number) => {
    const r = roomAt(doc, x, y);
    return r ? rooms[doc.rooms.indexOf(r)]!.id : null;
  };

  const npc_slots: CompiledWorld["npc_slots"] = {};
  const memberById = new Map(members.map((m) => [m.id, m]));
  const people: CompiledWorld["members"] = [];
  const pets: CompiledWorld["pets"] = [];
  for (const p of doc.people) {
    if (p.ref.startsWith(PEOPLE_PREFIX.judge)) {
      npc_slots[p.ref.slice(PEOPLE_PREFIX.judge.length)] = { x: p.x, y: p.y, face: p.face };
    } else if (p.ref.startsWith(PEOPLE_PREFIX.member)) {
      const m = memberById.get(p.ref.slice(PEOPLE_PREFIX.member.length));
      if (m) people.push({ id: m.id, name: m.name, title: m.title, look: m.look, x: p.x, y: p.y, face: p.face });
    } else if (p.ref.startsWith(PEOPLE_PREFIX.pet)) {
      const room = roomIdAt(p.x, p.y);
      if (room) pets.push({ sprite: p.ref.slice(PEOPLE_PREFIX.pet.length), x: p.x, y: p.y, room });
    }
  }

  return {
    kind: "custom",
    width: doc.width,
    height: doc.height,
    floors,
    faces,
    collision,
    spawn: doc.spawn,
    rooms,
    props,
    mounted,
    npc_slots,
    object_slots,
    members: people,
    pets,
  };
}

/** Cap frame for a wall cell: bit set when that neighbour is also plain wall (not floor, not face). */
export function capMask(cw: CompiledWorld, x: number, y: number): number {
  const wall = (nx: number, ny: number) =>
    nx < 0 || ny < 0 || nx >= cw.width || ny >= cw.height || (!cw.floors[ny]![nx] && cw.faces[ny]![nx]!.row < 0);
  return (wall(x, y - 1) ? 1 : 0) | (wall(x, y + 1) ? 2 : 0) | (wall(x - 1, y) ? 4 : 0) | (wall(x + 1, y) ? 8 : 0);
}
