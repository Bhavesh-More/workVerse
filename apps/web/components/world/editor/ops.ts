// Editor operations that produce a new document (and selection). The canvas, keyboard shortcuts
// and inspector all go through these, so every path applies the same placement rules.
import { faceGrid } from "../../../lib/world/compile";
import { addObject, footprint, inBounds, moveRoom, removeIds, uid, updateObjects, updatePeople } from "../../../lib/world/doc";
import { canPlaceAsset, canPlacePerson, canPlacePreset, placementContext } from "../../../lib/world/placement";
import { presetById, stampPreset } from "../../../lib/world/presets";
import type { Kit, WorldDoc } from "../../../lib/world/types";
import type { Placing, Selection } from "./store";

export type OpResult = { doc: WorldDoc; sel: Selection } | { error: string };

/** Where a placement lands for a hovered tile: footprints centre on the cursor; wall pieces
 * snap to the wall face nearest the cursor row. */
export function placementOrigin(doc: WorldDoc, kit: Kit, placing: NonNullable<Placing>, tx: number, ty: number) {
  if (placing.kind === "preset") {
    const p = presetById(placing.preset);
    return p ? { x: tx - Math.floor(p.w / 2), y: ty - Math.floor(p.h / 2) } : { x: tx, y: ty };
  }
  if (placing.kind === "person") return { x: tx, y: ty };
  const a = kit.byId.get(placing.asset);
  if (!a) return { x: tx, y: ty };
  const x = tx - Math.floor((a.w - 1) / 2);
  if (a.mount === "wall") {
    const faces = faceGrid(doc);
    for (const dy of [0, -1, 1, -2]) {
      const y = ty + dy;
      if (inBounds(doc, x, y) && faces[y]![x]!.row === 0) return { x, y };
    }
    return { x, y: ty };
  }
  return { x, y: ty - Math.floor((a.h - 1) / 2) };
}

export function place(doc: WorldDoc, kit: Kit, placing: NonNullable<Placing>, x: number, y: number, free?: { ox: number; oy: number }): OpResult {
  if (placing.kind === "preset") {
    const p = presetById(placing.preset);
    if (!p) return { error: "Unknown preset." };
    const v = canPlacePreset(doc, p, x, y);
    if (!v.ok) return { error: v.reason };
    const purposeTaken = doc.rooms.some((r) => r.purpose === p.purpose);
    const res = stampPreset(doc, kit, p, x, y, { purpose: purposeTaken ? "other" : p.purpose });
    return { doc: res.doc, sel: { kind: "room", id: res.roomId } };
  }
  if (placing.kind === "person") {
    const existing = doc.people.find((p) => p.ref === placing.ref);
    const ctx = placementContext(doc, kit, new Set(existing ? [existing.id] : []));
    const v = canPlacePerson(ctx, x, y);
    if (!v.ok) return { error: v.reason };
    if (existing) {
      // Identity is unique: placing again moves their start position.
      return { doc: updatePeople(doc, new Set([existing.id]), (p) => ({ ...p, x, y })), sel: { kind: "items", ids: [existing.id] } };
    }
    const id = uid("person");
    return { doc: { ...doc, people: [...doc.people, { id, ref: placing.ref, x, y, face: "down" }] }, sel: { kind: "items", ids: [id] } };
  }
  const a = kit.byId.get(placing.asset);
  if (!a) return { error: "Unknown asset." };
  const ox = a.mount === "floor" ? (free?.ox ?? 0) : 0;
  const oy = a.mount === "floor" ? (free?.oy ?? 0) : 0;
  const v = canPlaceAsset(placementContext(doc, kit), a, x, y, ox, oy, true);
  if (!v.ok) return { error: v.reason };
  const res = addObject(doc, { asset: a.id, x, y, ...(ox ? { ox } : {}), ...(oy ? { oy } : {}) });
  return { doc: res.doc, sel: { kind: "items", ids: [res.id] } };
}

/**
 * Move objects/people by a delta. Tiles when `px` is false; with px (snap off) floor furniture
 * moves by whole art pixels and keeps a sub-tile offset, while people and wall pieces still snap.
 */
export function moveItems(doc: WorldDoc, kit: Kit, ids: Set<string>, dx: number, dy: number, px = false): OpResult {
  const ctx = placementContext(doc, kit, ids);
  const tiles = (v: number) => (px ? Math.round(v / 32) : v);
  let objects = doc.objects;
  for (const o of doc.objects) {
    if (!ids.has(o.id)) continue;
    const a = kit.byId.get(o.asset);
    if (!a) continue;
    let nx: number;
    let ny: number;
    let ox = 0;
    let oy = 0;
    if (px && a.mount === "floor") {
      const tx = o.x * 32 + (o.ox ?? 0) + Math.round(dx / 2) * 2;
      const ty = o.y * 32 + (o.oy ?? 0) + Math.round(dy / 2) * 2;
      nx = Math.floor(tx / 32);
      ny = Math.floor(ty / 32);
      ox = tx - nx * 32;
      oy = ty - ny * 32;
    } else {
      nx = o.x + tiles(dx);
      ny = o.y + tiles(dy);
      ox = o.ox ?? 0;
      oy = o.oy ?? 0;
    }
    const v = canPlaceAsset(ctx, a, nx, ny, ox, oy);
    if (!v.ok) return { error: `${a.label}: ${v.reason}` };
    objects = objects.map((x) => (x.id === o.id ? { ...x, x: nx, y: ny, ox: ox || undefined, oy: oy || undefined } : x));
    // Later items in the same move must not land on this one.
    if (a.solid && a.mount === "floor") {
      const fp = footprint(a, { x: nx, y: ny, ox, oy });
      for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) ctx.solid[y * doc.width + x] = 1;
    }
  }
  let people = doc.people;
  for (const p of doc.people) {
    if (!ids.has(p.id)) continue;
    const nx = p.x + tiles(dx);
    const ny = p.y + tiles(dy);
    const v = canPlacePerson(ctx, nx, ny);
    if (!v.ok) return { error: v.reason };
    ctx.occupied.add(`${nx},${ny}`);
    people = people.map((x) => (x.id === p.id ? { ...x, x: nx, y: ny } : x));
  }
  return { doc: { ...doc, objects, people }, sel: { kind: "items", ids: [...ids] } };
}

/** Copies of objects offset by (dx, dy); people aren't duplicated (identities are unique). */
export function duplicateObjects(doc: WorldDoc, kit: Kit, source: WorldDoc["objects"], dx = 1, dy = 1): OpResult {
  const copies = source.map((o) => ({ ...o, id: uid("obj"), x: o.x + dx, y: o.y + dy }));
  const ctx = placementContext(doc, kit);
  for (const c of copies) {
    const a = kit.byId.get(c.asset);
    if (!a) continue;
    if (a.interactive) return { error: `${a.label} is one of a kind — the scenario uses a single one.` };
    const v = canPlaceAsset(ctx, a, c.x, c.y, c.ox, c.oy);
    if (!v.ok) {
      // Try the other side before giving up.
      if (dx !== -1) return duplicateObjects(doc, kit, source, -1, dy);
      return { error: `No room for a copy of ${a.label} next to it.` };
    }
  }
  return { doc: { ...doc, objects: [...doc.objects, ...copies] }, sel: { kind: "items", ids: copies.map((c) => c.id) } };
}

export function deleteSelection(doc: WorldDoc, sel: Selection): OpResult {
  if (sel.kind === "items") return { doc: removeIds(doc, new Set(sel.ids)), sel: { kind: "none" } };
  return { error: "Nothing to delete." };
}

export function nudge(doc: WorldDoc, kit: Kit, sel: Selection, dx: number, dy: number): OpResult {
  if (sel.kind === "items") return moveItems(doc, kit, new Set(sel.ids), dx, dy);
  if (sel.kind === "room") {
    const r = doc.rooms.find((x) => x.id === sel.id);
    if (!r) return { error: "Room not found." };
    if (r.x + dx < 0 || r.y + dy < 0 || r.x + r.w + dx > doc.width || r.y + r.h + dy > doc.height) return { error: "That would push the room out of the world." };
    return { doc: moveRoom(doc, kit, r.id, dx, dy), sel };
  }
  if (sel.kind === "spawn") {
    const ctx = placementContext(doc, kit);
    const nx = doc.spawn.x + dx;
    const ny = doc.spawn.y + dy;
    const v = canPlacePerson(ctx, nx, ny);
    if (!v.ok) return { error: v.reason };
    return { doc: { ...doc, spawn: { x: nx, y: ny } }, sel };
  }
  return { error: "Select something first." };
}

export function selectedObjects(doc: WorldDoc, sel: Selection) {
  return sel.kind === "items" ? doc.objects.filter((o) => sel.ids.includes(o.id)) : [];
}

export { updateObjects };
