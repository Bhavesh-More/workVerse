// Run with: node --test lib/world/world.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileWorld, capMask } from "./compile.ts";
import { carveDoor, emptyWorld, floorAt, moveRoom, paintFloor, resizeRoom, resizeWorld, deleteRoom, footprint } from "./doc.ts";
import { PRESETS, addPresetAuto, connectRoom, duplicateRoom, generateLayout, stampPreset } from "./presets.ts";
import { hasErrors, validateWorld } from "./validate.ts";
import { makeKit, type Catalog, type TilesMeta, type Atlas } from "./types.ts";

const read = (p: string) => JSON.parse(fs.readFileSync(new URL(`../../public/assets/game/kit/${p}`, import.meta.url), "utf8"));
const kit = makeKit(read("catalog.json") as Catalog, read("tiles.json") as TilesMeta, read("props.json") as Atlas);
const ALL = PRESETS.map((p) => p.id);
const members = [{ id: "m1", name: "Ana", title: "Designer", look: "f2" }];

test("every preset references real assets and fits inside its own floor", () => {
  for (const p of PRESETS) {
    for (const o of p.objects) {
      const a = kit.byId.get(o.asset);
      assert.ok(a, `${p.id}: unknown asset ${o.asset}`);
      if (a.mount === "wall") assert.equal(o.y, -2, `${p.id}: ${o.asset} must sit on the face row`);
      else assert.ok(o.x >= 0 && o.y >= 0 && o.x + a.w <= p.w && o.y + a.h <= p.h, `${p.id}: ${o.asset} outside room`);
    }
  }
});

test("a generated layout with all six presets is valid: no errors, everything reachable", () => {
  const doc = generateLayout(kit, ALL, { members });
  const issues = validateWorld(doc, kit, members);
  assert.equal(hasErrors(issues), false, JSON.stringify(issues.filter((i) => i.level === "error"), null, 1));
  // Every judge and the member got a placement; every scenario tool exists once.
  assert.equal(doc.people.filter((p) => p.ref.startsWith("judge:")).length, 5);
  assert.ok(doc.people.some((p) => p.ref === "member:m1"));
  const cw = compileWorld(doc, kit, members);
  for (const id of ["incident_dashboard", "log_viewer", "metrics_panel", "deploy_console", "runbook", "migration_notes", "reception_desk", "coffee_machine"])
    assert.ok(cw.object_slots[id], `missing ${id}`);
  assert.ok(cw.rooms.some((r) => r.id === "engineering_workspace"));
  assert.ok(cw.rooms.some((r) => r.id === "corridor_main"));
  assert.equal(cw.npc_slots.manager !== undefined, true);
});

test("layouts work for a single preset and for two", () => {
  for (const ids of [["meeting"], ["reception", "lounge"], ["ops_lab", "open_plan"]]) {
    const doc = generateLayout(kit, ids);
    assert.equal(hasErrors(validateWorld(doc, kit)), false, ids.join(","));
  }
});

test("walls are derived from floors: faces sit two rows above a room, caps elsewhere", () => {
  const doc = paintFloor(emptyWorld(20, 14), { x: 3, y: 4, w: 6, h: 5 }, "oak");
  const cw = compileWorld(doc, kit);
  assert.equal(cw.faces[3]![4]!.row, 1);
  assert.equal(cw.faces[2]![4]!.row, 0);
  assert.equal(cw.faces[1]![4]!.row, -1);
  assert.equal(cw.collision[5]![5], 0);
  assert.equal(cw.collision[0]![0], 1);
  // A lone wall cell in open space has no wall neighbours to the sides once floor surrounds it.
  assert.equal(typeof capMask(cw, 0, 0), "number");
});

test("solid furniture blocks movement; wall pieces don't", () => {
  let doc = paintFloor(emptyWorld(20, 14), { x: 3, y: 4, w: 8, h: 6 }, "oak");
  doc = { ...doc, objects: [{ id: "a", asset: "meeting_table_4", x: 4, y: 6 }, { id: "b", asset: "window_2", x: 4, y: 2 }] };
  const cw = compileWorld(doc, kit);
  assert.equal(cw.collision[6]![4], 1);
  assert.equal(cw.collision[7]![7], 1);
  assert.equal(cw.collision[8]![4], 0);
  assert.equal(cw.mounted.length, 1);
  assert.equal(footprint(kit.byId.get("meeting_table_4")!, { x: 4, y: 6, ox: 2 }).w, 5, "a nudge spills into the next column");
});

test("validation catches the real problems", () => {
  let doc = generateLayout(kit, ["reception", "ops_lab"]);
  const lab = doc.rooms.find((r) => r.purpose === "engineering_workspace")!;
  // Wall piece in the middle of a floor, two dashboards, a person in a wall, spawn on furniture.
  doc = {
    ...doc,
    objects: [
      ...doc.objects,
      { id: "w1", asset: "clock", x: lab.x + 3, y: lab.y + 4 },
      { id: "dup", asset: "obj_incident_dashboard", x: lab.x + 9, y: lab.y - 2 },
      { id: "ghost", asset: "no_such_asset", x: 1, y: 1 },
    ],
    people: [...doc.people, { id: "p1", ref: "judge:manager", x: 0, y: 0, face: "down" }],
  };
  const codes = validateWorld(doc, kit).map((i) => i.code);
  for (const c of ["wall_mount", "duplicate_interactive", "unknown_asset", "person_blocked", "duplicate_person"]) assert.ok(codes.includes(c), c);
});

test("an unconnected room is flagged and Connect room fixes it", () => {
  let doc = generateLayout(kit, ["reception"]);
  doc = resizeWorld(doc, doc.width + 20, doc.height + 14);
  const res = stampPreset(doc, kit, PRESETS.find((p) => p.id === "meeting")!, doc.width - 14, doc.height - 10);
  doc = res.doc;
  assert.ok(validateWorld(doc, kit).some((i) => i.code === "room_unreachable"));
  // Bring it next to the corridor, then connect.
  const room = doc.rooms.find((r) => r.id === res.roomId)!;
  const corridor = doc.rooms.find((r) => r.purpose === "corridor_main")!;
  doc = moveRoom(doc, kit, room.id, 1 - room.x, corridor.y + corridor.h + 3 - room.y);
  const connected = connectRoom(doc, room.id);
  assert.ok(connected);
  assert.ok(!validateWorld(connected!, kit).some((i) => i.code === "room_unreachable"));
});

test("room operations keep contents together", () => {
  let doc = generateLayout(kit, ["meeting"]);
  const room = doc.rooms.find((r) => r.purpose === "meeting_room")!;
  const before = doc.objects.filter((o) => o.x >= room.x && o.x < room.x + room.w && o.y >= room.y - 2 && o.y < room.y + room.h).length;
  doc = resizeWorld(doc, doc.width + 10, doc.height);
  const moved = moveRoom(doc, kit, room.id, 5, 0);
  const r2 = moved.rooms.find((r) => r.id === room.id)!;
  assert.equal(r2.x, room.x + 5);
  assert.equal(floorAt(moved, r2.x + 1, r2.y + 1), "oak");
  const after = moved.objects.filter((o) => o.x >= r2.x && o.x < r2.x + r2.w && o.y >= r2.y - 2 && o.y < r2.y + r2.h).length;
  assert.equal(after, before);
  const grown = resizeRoom(moved, room.id, { x: r2.x, y: r2.y, w: r2.w + 2, h: r2.h });
  assert.equal(floorAt(grown, r2.x + r2.w + 1, r2.y), "oak");
  const gone = deleteRoom(grown, kit, room.id);
  assert.equal(gone.rooms.some((r) => r.id === room.id), false);
  assert.equal(floorAt(gone, r2.x + 1, r2.y + 1), null);
});

test("carveDoor opens a wall between two floors, and refuses solid rock", () => {
  let doc = emptyWorld(20, 20);
  doc = paintFloor(doc, { x: 2, y: 2, w: 6, h: 4 }, "oak");
  doc = paintFloor(doc, { x: 2, y: 9, w: 6, h: 4 }, "stone");
  const door = carveDoor(doc, 4, 7);
  assert.ok(door);
  assert.ok(floorAt(door!, 4, 6) && floorAt(door!, 5, 8));
  assert.equal(carveDoor(doc, 15, 15), null);
});

test("adding presets grows the world when there's no room", () => {
  let doc = emptyWorld(18, 12);
  for (const p of PRESETS) doc = addPresetAuto(doc, kit, p).doc;
  assert.equal(doc.rooms.length, 6);
  assert.ok(doc.width > 18 || doc.height > 12);
  assert.equal(doc.rooms.filter((r) => r.purpose === "engineering_workspace").length, 1);
});

test("auto-layout doorways never remove preset furniture, in either row", () => {
  for (const p of PRESETS) {
    for (const raw of [[p.id], ["reception", p.id], [p.id, "reception", "lounge"]]) {
      const ids = [...new Set(raw)];
      const doc = generateLayout(kit, ids);
      const unique = new Set(ids);
      const expected = [...unique].reduce((n, id) => n + PRESETS.find((x) => x.id === id)!.objects.length, 0) + 2; // + corridor plants
      assert.equal(doc.objects.length, expected, `${ids.join(",")}: a doorway cleared furniture`);
    }
  }
});

test("duplicating a room copies its floor and furniture into free space, not its people or tools", () => {
  const doc = generateLayout(kit, ["ops_lab", "meeting"]);
  const lab = doc.rooms.find((r) => r.purpose === "engineering_workspace")!;
  const res = duplicateRoom(doc, kit, lab.id)!;
  assert.ok(res);
  const copy = res.doc.rooms.find((r) => r.id === res.roomId)!;
  assert.equal(copy.purpose, "other");
  assert.equal(floorAt(res.doc, copy.x + 1, copy.y + 1), "carpet");
  const inCopy = res.doc.objects.filter((o) => o.x >= copy.x && o.x < copy.x + copy.w && o.y >= copy.y - 2 && o.y < copy.y + copy.h);
  assert.ok(inCopy.length > 10);
  assert.ok(inCopy.every((o) => !kit.byId.get(o.asset)!.interactive), "scenario tools are one of a kind");
  assert.equal(res.doc.people.length, doc.people.length);
  assert.equal(hasErrors(validateWorld(res.doc, kit)), false);
});
