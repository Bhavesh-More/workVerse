// Can this go here? Used for live drag feedback (green/red footprint) and again on drop, so an
// invalid placement is shown before release instead of failing after it.
import { faceGrid } from "./compile.ts";
import { floorAt, footprint, inBounds } from "./doc.ts";
import type { RoomPreset } from "./presets.ts";
import type { Asset, Kit, WorldDoc } from "./types.ts";

export type Verdict = { ok: true } | { ok: false; reason: string };
const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** Everything placement checks need, computed once per drag (minus the items being moved). */
export type PlacementContext = {
  doc: WorldDoc;
  kit: Kit;
  /** Cells covered by solid furniture (excluding ignored ids). */
  solid: Uint8Array;
  /** Cells someone stands on (excluding ignored ids). */
  occupied: Set<string>;
  faces: ReturnType<typeof faceGrid>;
  interactiveTaken: Set<string>;
};

export function placementContext(doc: WorldDoc, kit: Kit, ignore: Set<string> = new Set()): PlacementContext {
  const solid = new Uint8Array(doc.width * doc.height);
  const interactiveTaken = new Set<string>();
  for (const o of doc.objects) {
    if (ignore.has(o.id)) continue;
    const a = kit.byId.get(o.asset);
    if (!a) continue;
    if (a.interactive) interactiveTaken.add(a.interactive);
    if (a.mount !== "floor" || !a.solid) continue;
    const fp = footprint(a, o);
    for (let y = fp.y; y < fp.y + fp.h; y++)
      for (let x = fp.x; x < fp.x + fp.w; x++) if (inBounds(doc, x, y)) solid[y * doc.width + x] = 1;
  }
  const occupied = new Set(doc.people.filter((p) => !ignore.has(p.id)).map((p) => `${p.x},${p.y}`));
  return { doc, kit, solid, occupied, faces: faceGrid(doc), interactiveTaken };
}

export function canPlaceAsset(ctx: PlacementContext, a: Asset, x: number, y: number, ox = 0, oy = 0, isNew = false): Verdict {
  const { doc } = ctx;
  if (isNew && a.interactive && ctx.interactiveTaken.has(a.interactive)) return no(`There's already a ${a.label} — the scenario uses one.`);
  if (a.mount === "wall") {
    for (let cx = x; cx < x + a.w; cx++) {
      if (!inBounds(doc, cx, y) || ctx.faces[y]![cx]!.row !== 0) return no("Wall pieces hang on a wall face, just above a room.");
    }
    return OK;
  }
  const fp = footprint(a, { x, y, ox, oy });
  if (fp.x < 0 || fp.y < 0 || fp.x + fp.w > doc.width || fp.y + fp.h > doc.height) return no("That's outside the world.");
  for (let cy = fp.y; cy < fp.y + fp.h; cy++) {
    for (let cx = fp.x; cx < fp.x + fp.w; cx++) {
      if (!floorAt(doc, cx, cy)) return no("Furniture needs floor under it.");
      if (a.solid && ctx.solid[cy * doc.width + cx]) return no("Something is already there.");
      if (a.solid && ctx.occupied.has(`${cx},${cy}`)) return no("Someone is standing there.");
    }
  }
  return OK;
}

export function canPlacePerson(ctx: PlacementContext, x: number, y: number): Verdict {
  if (!inBounds(ctx.doc, x, y) || !floorAt(ctx.doc, x, y)) return no("People stand on floor.");
  if (ctx.solid[y * ctx.doc.width + x]) return no("That tile has furniture on it.");
  if (ctx.occupied.has(`${x},${y}`)) return no("Someone is already standing there.");
  return OK;
}

/** A preset needs its floor plus a wall margin (2 rows above for its wall face) to be empty. */
export function canPlacePreset(doc: WorldDoc, p: Pick<RoomPreset, "w" | "h">, x: number, y: number): Verdict {
  if (x < 1 || y < 3 || x + p.w > doc.width - 1 || y + p.h > doc.height - 1)
    return no("Not enough space here — leave a wall's width around the room, or enlarge the world.");
  for (let cy = y - 2; cy < y + p.h + 1; cy++)
    for (let cx = x - 1; cx < x + p.w + 1; cx++) if (floorAt(doc, cx, cy)) return no("This overlaps an existing room. Leave a wall between rooms.");
  return OK;
}

/** Turn a px position into a tile plus an even px offset in [0, 30] (free placement). */
export function freeCell(px: number, py: number) {
  const ex = Math.round(px / 2) * 2;
  const ey = Math.round(py / 2) * 2;
  const x = Math.floor(ex / 32);
  const y = Math.floor(ey / 32);
  return { x, y, ox: ex - x * 32, oy: ey - y * 32 };
}
