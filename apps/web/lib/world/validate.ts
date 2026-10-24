// World checks run live in the editor and before publishing. Errors block publishing (the world
// would break in the game); warnings are things a company can knowingly accept.
import { PEOPLE_PREFIX, anchorFor, compileWorld } from "./compile.ts";
import { floorAt, footprint, inBounds, rectsOverlap, roomRect } from "./doc.ts";
import type { CompiledWorld, Kit, Member, WorldDoc } from "./types.ts";

export type IssueTarget = { kind: "object" | "person" | "room" | "spawn"; id?: string; x: number; y: number };
export type Issue = { level: "error" | "warning"; code: string; message: string; fix: string; target?: IssueTarget };

export const JUDGE_SLOTS = ["manager", "teammate", "qa", "client_pm", "coworker"] as const;
export const JUDGE_HOME: Record<string, string> = {
  manager: "manager_office",
  teammate: "engineering_workspace",
  qa: "collaboration_area",
  client_pm: "meeting_room",
  coworker: "break_area",
};
/** Interactive objects the incident scenario's actions point at. */
export const REQUIRED_OBJECTS = ["incident_dashboard", "log_viewer", "metrics_panel", "deploy_console", "runbook", "migration_notes"];

/** Flood fill over walkable cells from (x, y). */
export function reachable(cw: CompiledWorld, from: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(cw.width * cw.height);
  if (!inBounds(cw, from.x, from.y) || cw.collision[from.y]![from.x]) return seen;
  const stack = [from.y * cw.width + from.x];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % cw.width;
    const y = (i - x) / cw.width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!inBounds(cw, nx, ny) || cw.collision[ny]![nx]) continue;
      const j = ny * cw.width + nx;
      if (!seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}

export function validateWorld(doc: WorldDoc, kit: Kit, members: Member[] = []): Issue[] {
  const issues: Issue[] = [];
  const cw = compileWorld(doc, kit, members);
  const err = (code: string, message: string, fix: string, target?: IssueTarget) => issues.push({ level: "error", code, message, fix, target });
  const warn = (code: string, message: string, fix: string, target?: IssueTarget) => issues.push({ level: "warning", code, message, fix, target });

  // ---- spawn
  const spawnOk = inBounds(doc, doc.spawn.x, doc.spawn.y) && !cw.collision[doc.spawn.y]![doc.spawn.x];
  if (!spawnOk) err("spawn_blocked", "The candidate's start point isn't on open floor.", "Drag the start marker onto a free floor tile.", { kind: "spawn", ...doc.spawn });
  const reach = spawnOk ? reachable(cw, doc.spawn) : new Uint8Array(doc.width * doc.height);
  const canReach = (x: number, y: number) => inBounds(doc, x, y) && reach[y * doc.width + x] === 1;

  // ---- objects
  const solids: { id: string; label: string; r: ReturnType<typeof footprint> }[] = [];
  const singletons = new Map<string, string>();
  for (const o of doc.objects) {
    const a = kit.byId.get(o.asset);
    const at = { kind: "object" as const, id: o.id, x: o.x, y: o.y };
    if (!a) {
      err("unknown_asset", `An object uses an asset that no longer exists (${o.asset}).`, "Delete it and place a replacement.", at);
      continue;
    }
    const fp = footprint(a, o);
    if (fp.x < 0 || fp.y < 0 || fp.x + fp.w > doc.width || fp.y + fp.h > doc.height) {
      err("out_of_bounds", `${a.label} is outside the world.`, "Move it back inside, or make the world bigger in World settings.", at);
      continue;
    }
    if (a.mount === "wall") {
      let ok = true;
      for (let x = o.x; x < o.x + a.w; x++) if (cw.faces[o.y]![x]!.row !== 0) ok = false;
      if (!ok) err("wall_mount", `${a.label} must hang on a wall.`, "Move it onto a wall face, directly above a room's floor.", at);
    } else {
      let onFloor = true;
      for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) if (!floorAt(doc, x, y)) onFloor = false;
      if (!onFloor) err("off_floor", `${a.label} is standing in a wall.`, "Move it onto the floor.", at);
      if (a.solid) {
        const hit = solids.find((s) => rectsOverlap(s.r, fp));
        if (hit) warn("overlap", `${a.label} overlaps ${hit.label}.`, "Nudge one of them so they don't share tiles.", at);
        solids.push({ id: o.id, label: a.label, r: fp });
      }
    }
    if (a.interactive) {
      if (singletons.has(a.interactive)) {
        err("duplicate_interactive", `There are two ${a.label}s. The scenario uses one.`, "Delete the extra one.", at);
      } else {
        singletons.set(a.interactive, o.id);
        const anc = anchorFor(a, o.x, o.y);
        const tx = Math.floor(anc.x);
        const ty = Math.floor(anc.y);
        if (spawnOk && !canReach(tx, ty))
          err("unreachable_object", `Candidates can't reach the front of the ${a.label}.`, "Clear the floor tile in front of it, or connect its room with a doorway.", at);
      }
    }
  }

  // ---- people
  const judgesPlaced = new Set<string>();
  const memberIds = new Set(members.map((m) => m.id));
  const taken = new Map<string, string>();
  for (const p of doc.people) {
    const at = { kind: "person" as const, id: p.id, x: p.x, y: p.y };
    let label = p.ref;
    if (p.ref.startsWith(PEOPLE_PREFIX.judge)) {
      const slot = p.ref.slice(PEOPLE_PREFIX.judge.length);
      label = `The ${slot.replace("_", " ")} judge`;
      if (!(JUDGE_SLOTS as readonly string[]).includes(slot)) {
        err("unknown_person", `A placed judge (${slot}) doesn't exist.`, "Remove it.", at);
        continue;
      }
      if (judgesPlaced.has(slot)) err("duplicate_person", `${label} is placed twice.`, "Remove one of the two placements.", at);
      judgesPlaced.add(slot);
    } else if (p.ref.startsWith(PEOPLE_PREFIX.member)) {
      if (!memberIds.has(p.ref.slice(PEOPLE_PREFIX.member.length))) {
        err("unknown_person", "A placed team member was removed from your participants.", "Remove the placement or add the member back.", at);
        continue;
      }
      label = members.find((m) => `member:${m.id}` === p.ref)?.name ?? "A team member";
    } else if (!p.ref.startsWith(PEOPLE_PREFIX.pet)) {
      err("unknown_person", "A placed character has an unknown type.", "Remove it.", at);
      continue;
    } else label = "A pet";
    if (!inBounds(doc, p.x, p.y) || cw.collision[p.y]![p.x]) {
      err("person_blocked", `${label} is standing on a wall or furniture.`, "Move them onto open floor.", at);
      continue;
    }
    const key = `${p.x},${p.y}`;
    if (taken.has(key)) warn("person_overlap", `${label} shares a tile with ${taken.get(key)}.`, "Move one of them over.", at);
    taken.set(key, label);
    if (spawnOk && !canReach(p.x, p.y)) err("unreachable_person", `Candidates can't walk to ${label}.`, "Connect their room with a doorway or clear a path.", at);
  }

  // ---- rooms
  const purposes = new Map<string, string>();
  for (const r of doc.rooms) {
    const at = { kind: "room" as const, id: r.id, x: r.x, y: r.y };
    if (r.x < 0 || r.y < 0 || r.x + r.w > doc.width || r.y + r.h > doc.height) {
      err("room_bounds", `${r.name} goes past the edge of the world.`, "Move or resize it, or enlarge the world.", at);
      continue;
    }
    let floor = 0;
    let reached = 0;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!floorAt(doc, x, y)) continue;
        floor++;
        if (canReach(x, y)) reached++;
      }
    if (!floor) warn("room_empty", `${r.name} has no floor.`, "Paint floor inside it or delete the room.", at);
    else if (spawnOk && !reached)
      warn("room_unreachable", `${r.name} isn't connected to the rest of the office.`, "Use the Doorway tool on the wall between it and a corridor.", at);
    if (r.purpose !== "other") {
      if (purposes.has(r.purpose))
        warn("purpose_twice", `${r.name} and ${purposes.get(r.purpose)} are both marked as ${r.purpose.replace("_", " ")}.`, "The scenario uses the first one; change the other's purpose to Other.", at);
      else purposes.set(r.purpose, r.name);
    }
  }
  for (let i = 0; i < doc.rooms.length; i++)
    for (let j = i + 1; j < doc.rooms.length; j++)
      if (rectsOverlap(roomRect(doc.rooms[i]!), roomRect(doc.rooms[j]!)))
        warn("room_overlap", `${doc.rooms[i]!.name} overlaps ${doc.rooms[j]!.name}.`, "Move one so their floors don't share tiles.", { kind: "room", id: doc.rooms[j]!.id, x: doc.rooms[j]!.x, y: doc.rooms[j]!.y });

  // ---- scenario coverage (the game falls back gracefully, so these are warnings)
  const missing = REQUIRED_OBJECTS.filter((id) => !singletons.has(id));
  if (missing.length)
    warn("missing_objects", `${missing.length} scenario tool${missing.length > 1 ? "s are" : " is"} missing: ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}.`, "Drag them in from Interactive, or candidates will see a marker in the team workspace instead.");
  const unplaced = JUDGE_SLOTS.filter((s) => !judgesPlaced.has(s));
  if (unplaced.length)
    warn("judges_unplaced", `${unplaced.length} judge${unplaced.length > 1 ? "s aren't" : " isn't"} placed: ${unplaced.map((s) => s.replace("_", " ")).join(", ")}.`, "Drag them in from People; otherwise they stand in the middle of their room.");
  if (!doc.rooms.length) warn("no_rooms", "This world has no rooms yet.", "Add a room preset from the library.");
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");
