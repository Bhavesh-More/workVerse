// Grid pathfinding over the office's authoritative collision map.
//
// Pure, dependency-free and deterministic so it can be unit-tested without Phaser.
// The walkable grid is derived directly from `map.json`'s collision layer, which is
// the same data the physics collider is built from — there is no second map.

export type NavGrid = {
  width: number;
  height: number;
  /** 1 = walkable, 0 = blocked. Row-major, indexed y * width + x. */
  walkable: Uint8Array;
};

export type Tile = { x: number; y: number };
export type WorldPoint = { x: number; y: number };

const SQRT2 = Math.SQRT2;
const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Build a walkable grid from the collision rows used by Phaser's static collider. */
export function buildNavGrid(collision: number[][]): NavGrid {
  const height = collision.length;
  const width = collision[0]?.length ?? 0;
  const walkable = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      walkable[y * width + x] = (collision[y]?.[x] ?? 1) === 1 ? 0 : 1;
    }
  }
  return { width, height, walkable };
}

export function isWalkable(grid: NavGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
  return grid.walkable[y * grid.width + x] === 1;
}

/** Return the closest walkable tile to `tile`, or null if none exists. */
export function nearestWalkable(grid: NavGrid, tile: Tile): Tile | null {
  if (isWalkable(grid, tile.x, tile.y)) return { x: tile.x, y: tile.y };
  const max = Math.max(grid.width, grid.height);
  for (let r = 1; r <= max; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (isWalkable(grid, x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Walkable tiles whose center lies within `radius` world px of `anchor`, nearest first. */
export function goalTilesAround(
  grid: NavGrid,
  anchor: WorldPoint,
  tileSize: number,
  radius: number,
): Tile[] {
  const cx = Math.floor(anchor.x / tileSize);
  const cy = Math.floor(anchor.y / tileSize);
  const span = Math.ceil(radius / tileSize) + 1;
  const candidates: { tile: Tile; d: number }[] = [];
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!isWalkable(grid, x, y)) continue;
      const wx = x * tileSize + tileSize / 2;
      const wy = y * tileSize + tileSize / 2;
      const d = Math.hypot(wx - anchor.x, wy - anchor.y);
      if (d <= radius) candidates.push({ tile: { x, y }, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates.map((c) => c.tile);
}

class MinHeap {
  private items: { key: number; priority: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, priority: number): void {
    this.items.push({ key, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.priority <= this.items[i]!.priority) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }

  pop(): number | undefined {
    const top = this.items[0];
    if (top === undefined) return undefined;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.items[l]!.priority < this.items[smallest]!.priority) {
          smallest = l;
        }
        if (r < this.items.length && this.items[r]!.priority < this.items[smallest]!.priority) {
          smallest = r;
        }
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i]!, this.items[smallest]!];
        i = smallest;
      }
    }
    return top.key;
  }
}

/**
 * A* over the walkable grid with 8-directional movement and no corner cutting.
 * `goals` may contain several acceptable destination tiles (e.g. an interaction ring).
 * Returns the tile path start→goal inclusive, or null when unreachable.
 */
export function findPath(grid: NavGrid, start: Tile, goals: Tile[]): Tile[] | null {
  const startTile = nearestWalkable(grid, start);
  if (startTile === null) return null;

  const goalKeys = new Set<number>();
  for (const g of goals) {
    if (isWalkable(grid, g.x, g.y)) goalKeys.add(g.y * grid.width + g.x);
  }
  if (goalKeys.size === 0) return null;

  const startKey = startTile.y * grid.width + startTile.x;
  if (goalKeys.has(startKey)) return [startTile];

  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new MinHeap();
  heap.push(startKey, 0);

  const heuristic = (x: number, y: number): number => {
    // Octile distance to the best matching goal, approximated by scanning goals.
    let best = Infinity;
    for (const key of goalKeys) {
      const gx = key % grid.width;
      const gy = Math.floor(key / grid.width);
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      const h = dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
      if (h < best) best = h;
    }
    return best;
  };

  let reached: number | null = null;
  while (heap.size > 0) {
    const currentKey = heap.pop()!;
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    if (goalKeys.has(currentKey)) {
      reached = currentKey;
      break;
    }
    const cx = currentKey % grid.width;
    const cy = Math.floor(currentKey / grid.width);
    const currentCost = gScore.get(currentKey) ?? Infinity;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(grid, cx + dx, cy) || !isWalkable(grid, cx, cy + dy))) {
        continue;
      }
      const nKey = ny * grid.width + nx;
      if (closed.has(nKey)) continue;
      const tentative = currentCost + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentative);
        cameFrom.set(nKey, currentKey);
        heap.push(nKey, tentative + heuristic(nx, ny));
      }
    }
  }

  if (reached === null) return null;
  const path: Tile[] = [];
  let key: number | undefined = reached;
  while (key !== undefined) {
    path.push({ x: key % grid.width, y: Math.floor(key / grid.width) });
    key = cameFrom.get(key);
  }
  path.reverse();
  return path;
}

/** True when a straight tile line between a and b stays on walkable tiles (no corner cut). */
export function lineOfSight(grid: NavGrid, a: Tile, b: Tile): boolean {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard <= dx + dy + 1; guard++) {
    if (!isWalkable(grid, x, y)) return false;
    if (x === b.x && y === b.y) return true;
    const px = x;
    const py = y;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x !== px && y !== py && (!isWalkable(grid, x, py) || !isWalkable(grid, px, y))) {
      return false;
    }
  }
  return false;
}

/** String-pull a path so long as every shortcut stays traversable. Never cuts corners. */
export function smoothPath(grid: NavGrid, path: Tile[]): Tile[] {
  if (path.length <= 2) return path;
  const out: Tile[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    for (; j > i + 1; j--) {
      if (lineOfSight(grid, path[i]!, path[j]!)) break;
    }
    out.push(path[j]!);
    i = j;
  }
  return out;
}

/** Convert a tile path to world-space points at tile centers. */
export function toWorldPoints(path: Tile[], tileSize: number): WorldPoint[] {
  return path.map((t) => ({ x: t.x * tileSize + tileSize / 2, y: t.y * tileSize + tileSize / 2 }));
}
