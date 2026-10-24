"use client";

// Thumbnails drawn from the real kit: atlas frames for assets (CSS sprite, no canvas), and full
// compiled renders for room presets and whole worlds, so previews match what gets placed.
import { useEffect, useRef, useState } from "react";
import { compileWorld } from "../../lib/world/compile";
import { emptyWorld } from "../../lib/world/doc";
import { KIT, KIT_PATHS, loadKitImages, type KitImages } from "../../lib/world/kit";
import { stampPreset, type RoomPreset } from "../../lib/world/presets";
import { drawWorld } from "../../lib/world/render";
import { TILE, type Member, type WorldDoc } from "../../lib/world/types";

export function useKitImages(): KitImages | null {
  const [imgs, setImgs] = useState<KitImages | null>(null);
  useEffect(() => {
    let live = true;
    loadKitImages().then((i) => live && setImgs(i), () => {});
    return () => {
      live = false;
    };
  }, []);
  return imgs;
}

/** An atlas frame scaled to fit a box, crisp (nearest-neighbour). */
export function AssetThumb({ frame, box = 56 }: { frame: string; box?: number }) {
  const f = KIT.atlas.frames[frame]?.frame;
  if (!f) return <span style={{ width: box, height: box, display: "inline-block" }} />;
  const k = Math.min(1, box / Math.max(f.w, f.h));
  return (
    <span className="we-thumb" style={{ width: box, height: box }}>
      <span
        style={{
          width: f.w,
          height: f.h,
          backgroundImage: `url(${KIT_PATHS.props})`,
          backgroundPosition: `-${f.x}px -${f.y}px`,
          transform: `translate(-50%, -50%) scale(${k})`,
        }}
      />
    </span>
  );
}

/** A character's idle-down frame, cropped to the figure (humans 64x64 sheets, cats 32x32). */
export function CharThumb({ sheet, box = 40 }: { sheet: string; box?: number }) {
  const pet = sheet.startsWith("cat");
  const crop = pet ? { x: 4, y: 6, w: 24, h: 24 } : { x: 14, y: 10, w: 36, h: 52 };
  const k = box / Math.max(crop.w, crop.h);
  return (
    <span className="we-thumb" style={{ width: box, height: box }}>
      <span
        style={{
          width: crop.w,
          height: crop.h,
          backgroundImage: `url(${KIT_PATHS.char(sheet)})`,
          backgroundPosition: `-${crop.x}px -${crop.y}px`,
          transform: `translate(-50%, -50%) scale(${k})`,
        }}
      />
    </span>
  );
}

/** Render a whole world (or part of it) to a canvas that fits `width` css px. */
export function WorldThumb({ doc, members = [], width, maxHeight, className, label }: { doc: WorldDoc; members?: Member[]; width: number; maxHeight?: number; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const imgs = useKitImages();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !imgs) return;
    const full = document.createElement("canvas");
    full.width = doc.width * TILE;
    full.height = doc.height * TILE;
    const fctx = full.getContext("2d")!;
    fctx.imageSmoothingEnabled = false;
    fctx.fillStyle = "#211d2b";
    fctx.fillRect(0, 0, full.width, full.height);
    drawWorld(fctx, compileWorld(doc, KIT, members), imgs, KIT.tiles, KIT.atlas);
    const dpr = window.devicePixelRatio || 1;
    let k = width / full.width;
    if (maxHeight) k = Math.min(k, maxHeight / full.height);
    canvas.width = Math.round(full.width * k * dpr);
    canvas.height = Math.round(full.height * k * dpr);
    canvas.style.width = `${Math.round(full.width * k)}px`;
    canvas.style.height = `${Math.round(full.height * k)}px`;
    const ctx = canvas.getContext("2d")!;
    // Downscaling: smoothing reads better than dropped pixels at thumbnail sizes.
    ctx.imageSmoothingEnabled = k < 1;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }, [doc, imgs, members, width, maxHeight]);
  return <canvas ref={ref} className={className} role="img" aria-label={label ?? `Map of ${doc.name}`} />;
}

const presetDocs = new Map<string, WorldDoc>();

/** A preset stamped into a tiny world of its own, with the wall band around it. */
export function presetDoc(p: RoomPreset): WorldDoc {
  let d = presetDocs.get(p.id);
  if (!d) {
    const base = emptyWorld(Math.max(16, p.w + 2), Math.max(12, p.h + 4), p.name);
    d = stampPreset(base, KIT, p, 1, 3).doc;
    d = { ...d, width: p.w + 2, height: p.h + 4, floor: d.floor.slice(0, p.h + 4).map((r) => r.slice(0, p.w + 2)) };
    presetDocs.set(p.id, d);
  }
  return d;
}

export function PresetThumb({ preset, width }: { preset: RoomPreset; width: number }) {
  return <WorldThumb doc={presetDoc(preset)} width={width} label={`Layout of ${preset.name}`} />;
}
