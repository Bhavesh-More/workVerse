// Canvas 2D drawing for compiled worlds. The editor draws through these with a zoom transform;
// the game draws the ground and wall layers once into textures at 1:1. One code path keeps the
// two pixel-identical.
import { capMask } from "./compile.ts";
import { TILE, type Atlas, type CompiledWorld, type TilesMeta } from "./types.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Img = CanvasImageSource;

const SHADOW = "30,20,44";
const OUT = "43,34,50";

function shade(ctx: Ctx, x: number, y: number, w: number, h: number, rgb: string, a: number) {
  ctx.fillStyle = `rgba(${rgb},${a / 255})`;
  ctx.fillRect(x, y, w, h);
}

/** Floors plus the soft ambient occlusion along walls (light from the top-left, as in the art). */
export function drawGround(ctx: Ctx, cw: CompiledWorld, tilesImg: Img, tiles: TilesMeta) {
  const p = tiles.patch;
  for (let y = 0; y < cw.height; y++) {
    for (let x = 0; x < cw.width; x++) {
      const kind = cw.floors[y]![x];
      if (!kind) continue;
      const o = tiles.floors[kind];
      ctx.drawImage(tilesImg, o.x + (x % p) * TILE, o.y + (y % p) * TILE, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
    }
  }
  for (let y = 0; y < cw.height; y++) {
    for (let x = 0; x < cw.width; x++) {
      if (!cw.floors[y]![x]) continue;
      const px = x * TILE;
      const py = y * TILE;
      if (y > 0 && cw.faces[y - 1]![x]!.row === 1) {
        [70, 44, 26, 12].forEach((a, i) => shade(ctx, px, py + i * 2, TILE, 2, SHADOW, a));
      }
      const wallLeft = x > 0 && !cw.floors[y]![x - 1] && cw.faces[y]![x - 1]!.row < 0;
      const wallRight = x < cw.width - 1 && !cw.floors[y]![x + 1] && cw.faces[y]![x + 1]!.row < 0;
      if (wallLeft) [60, 30, 12].forEach((a, i) => shade(ctx, px + i * 2, py, 2, TILE, SHADOW, a));
      if (wallRight) shade(ctx, px + TILE - 2, py, 2, TILE, SHADOW, 22);
    }
  }
}

/** Wall caps and painted wall faces (with darker edges where a face run starts and ends). */
export function drawWalls(ctx: Ctx, cw: CompiledWorld, tilesImg: Img, tiles: TilesMeta) {
  for (let y = 0; y < cw.height; y++) {
    for (let x = 0; x < cw.width; x++) {
      if (cw.floors[y]![x]) continue;
      const face = cw.faces[y]![x]!;
      if (face.row === 0) {
        const o = tiles.faces[face.paint];
        ctx.drawImage(tilesImg, o.x, o.y, TILE, TILE * 2, x * TILE, y * TILE, TILE, TILE * 2);
        const same = (nx: number) => nx >= 0 && nx < cw.width && cw.faces[y]![nx]!.row === 0 && cw.faces[y]![nx]!.paint === face.paint;
        if (!same(x - 1)) shade(ctx, x * TILE, y * TILE + 4, 2, TILE * 2 - 4, OUT, 90);
        if (!same(x + 1)) shade(ctx, x * TILE + TILE - 2, y * TILE + 4, 2, TILE * 2 - 4, OUT, 60);
      } else if (face.row < 0) {
        const o = tiles.caps[String(capMask(cw, x, y))]!;
        ctx.drawImage(tilesImg, o.x, o.y, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
      }
    }
  }
}

export function drawFrame(ctx: Ctx, atlasImg: Img, atlas: Atlas, frame: string, x: number, y: number) {
  const f = atlas.frames[frame]?.frame;
  if (!f) return;
  ctx.drawImage(atlasImg, f.x, f.y, f.w, f.h, Math.round(x), Math.round(y), f.w, f.h);
}

/** Paint a whole compiled world into one canvas (thumbnails, previews). */
export function drawWorld(
  ctx: Ctx,
  cw: CompiledWorld,
  imgs: { tiles: Img; props: Img },
  tiles: TilesMeta,
  atlas: Atlas,
) {
  drawGround(ctx, cw, imgs.tiles, tiles);
  drawWalls(ctx, cw, imgs.tiles, tiles);
  for (const m of cw.mounted) drawFrame(ctx, imgs.props, atlas, m.f, m.x, m.y);
  for (const p of cw.props) drawFrame(ctx, imgs.props, atlas, p.f, p.x, p.y);
}
