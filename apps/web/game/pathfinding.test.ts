// Run with: node --test game/pathfinding.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildNavGrid,
  findPath,
  goalTilesAround,
  isWalkable,
  lineOfSight,
  smoothPath,
  toWorldPoints,
  type NavGrid,
  type Tile,
} from "./pathfinding.ts";

const TILE = 32;

function openGrid(width: number, height: number, blocked: Tile[] = []): NavGrid {
  const collision = Array.from({ length: height }, () => Array.from({ length: width }, () => 0));
  for (const b of blocked) collision[b.y]![b.x] = 1;
  return buildNavGrid(collision);
}

type RealMap = {
  width: number;
  height: number;
  spawn: Tile;
  npc_slots: Record<string, Tile>;
  object_slots: Record<string, { ax: number; ay: number }>;
  collision: number[][];
};

function readRealMap(): RealMap {
  const raw = readFileSync(new URL("../public/assets/game/map/map.json", import.meta.url), "utf8");
  return JSON.parse(raw) as RealMap;
}

function loadRealMap(): NavGrid {
  return buildNavGrid(readRealMap().collision);
}

function pathStaysWalkable(grid: NavGrid, path: Tile[]): boolean {
  return path.every((t) => isWalkable(grid, t.x, t.y));
}

test("finds a route between two connected walkable tiles", () => {
  const grid = openGrid(10, 10);
  const path = findPath(grid, { x: 0, y: 0 }, [{ x: 9, y: 9 }]);
  assert.ok(path && path.length > 0);
  assert.deepEqual(path[0], { x: 0, y: 0 });
  assert.deepEqual(path[path.length - 1], { x: 9, y: 9 });
});

test("route never crosses blocked tiles", () => {
  const grid = openGrid(20, 20, [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }]);
  const path = findPath(grid, { x: 0, y: 5 }, [{ x: 10, y: 5 }]);
  assert.ok(path);
  assert.ok(pathStaysWalkable(grid, path));
  assert.ok(!path.some((t) => t.x === 5 && t.y >= 5 && t.y <= 7));
});

test("routes around a wall with a gap", () => {
  const wall: Tile[] = [];
  for (let y = 0; y < 9; y++) wall.push({ x: 10, y });
  const grid = openGrid(20, 10, wall);
  const path = findPath(grid, { x: 5, y: 5 }, [{ x: 15, y: 5 }]);
  assert.ok(path, "path should sneak through the gap at y=9");
  assert.ok(pathStaysWalkable(grid, path));
  assert.ok(path.some((t) => t.y === 9));
});

test("reports unreachable targets", () => {
  const grid = openGrid(10, 10, [
    { x: 5, y: 0 },
    { x: 5, y: 1 },
    { x: 5, y: 2 },
    { x: 5, y: 3 },
    { x: 5, y: 4 },
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 5, y: 7 },
    { x: 5, y: 8 },
    { x: 5, y: 9 },
  ]);
  const path = findPath(grid, { x: 0, y: 5 }, [{ x: 9, y: 5 }]);
  assert.equal(path, null);
});

test("start maps to nearest walkable tile without teleporting through walls", () => {
  const grid = openGrid(10, 10, [{ x: 3, y: 3 }]);
  const path = findPath(grid, { x: 3, y: 3 }, [{ x: 9, y: 9 }]);
  assert.ok(path);
  assert.ok(pathStaysWalkable(grid, path));
  assert.ok(Math.abs(path[0]!.x - 3) <= 1 && Math.abs(path[0]!.y - 3) <= 1);
});

test("ends on one of the acceptable goal tiles", () => {
  const grid = openGrid(15, 15);
  const goals = goalTilesAround(grid, { x: 7 * TILE + 16, y: 7 * TILE + 16 }, TILE, 64);
  assert.ok(goals.length > 0);
  const path = findPath(grid, { x: 0, y: 0 }, goals);
  assert.ok(path);
  const end = path[path.length - 1]!;
  assert.ok(goals.some((g) => g.x === end.x && g.y === end.y));
});

test("smoothing keeps the route traversable and never cuts corners", () => {
  const grid = openGrid(20, 20, [
    { x: 8, y: 8 },
    { x: 9, y: 8 },
    { x: 10, y: 8 },
  ]);
  const path = findPath(grid, { x: 5, y: 5 }, [{ x: 12, y: 12 }]);
  assert.ok(path);
  const smoothed = smoothPath(grid, path);
  assert.ok(smoothed.length <= path.length);
  for (let i = 0; i < smoothed.length - 1; i++) {
    assert.ok(
      lineOfSight(grid, smoothed[i]!, smoothed[i + 1]!),
      "each smoothed segment must be a clear, walkable straight line",
    );
  }
});

test("handles edge-of-map coordinates", () => {
  const grid = openGrid(8, 8);
  const path = findPath(grid, { x: 0, y: 0 }, [{ x: 7, y: 0 }]);
  assert.ok(path);
  assert.deepEqual(path[path.length - 1], { x: 7, y: 0 });
  assert.equal(findPath(grid, { x: -3, y: -3 }, [{ x: 99, y: 99 }]), null);
});

test("every colleague and object in the real office is reachable from spawn, quickly", () => {
  const map = readRealMap();
  const grid = loadRealMap();
  assert.equal(grid.width, map.width);
  assert.equal(grid.height, map.height);
  assert.ok(isWalkable(grid, map.spawn.x, map.spawn.y), "spawn must be walkable");

  const targets: [string, { x: number; y: number }][] = [
    ...Object.entries(map.npc_slots).map(
      ([id, t]) => [id, { x: t.x * TILE + 16, y: t.y * TILE + 16 }] as [string, { x: number; y: number }],
    ),
    ...Object.entries(map.object_slots).map(
      ([id, o]) => [id, { x: o.ax, y: o.ay }] as [string, { x: number; y: number }],
    ),
  ];
  assert.ok(targets.length >= 15);
  const startedAt = Date.now();
  for (const [id, anchor] of targets) {
    const goals = goalTilesAround(grid, anchor, TILE, 64);
    assert.ok(goals.length > 0, `${id} needs walkable floor within reach`);
    const path = findPath(grid, map.spawn, goals);
    assert.ok(path, `route to ${id} should exist`);
    const smoothed = smoothPath(grid, path!);
    assert.ok(pathStaysWalkable(grid, smoothed));
    const points = toWorldPoints(smoothed, TILE);
    assert.ok(points.length > 0);
  }
  assert.ok(Date.now() - startedAt < 2000, "pathfinding should stay well under the frame budget");
});
