"use client";

// The editing canvas: draws the real world (same tiles, atlas and compiler as the game) under a
// pan/zoom camera, with a grid locked to world tiles, and handles every pointer interaction.
// Drag previews live in refs and are drawn per frame; only a finished gesture dispatches a commit.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Dispatch } from "react";
import { compileWorld } from "../../../lib/world/compile";
import { carveDoor, footprint, moveRoom, paintFloor, resizeRoom, roomAt, uid, type Rect } from "../../../lib/world/doc";
import type { KitImages } from "../../../lib/world/kit";
import { canPlaceAsset, canPlacePerson, canPlacePreset, freeCell, placementContext, type PlacementContext } from "../../../lib/world/placement";
import { presetById } from "../../../lib/world/presets";
import { drawFrame, drawGround, drawWalls } from "../../../lib/world/render";
import { reachable, type Issue } from "../../../lib/world/validate";
import { TILE, type Kit, type Member, type Room, type WorldDoc, type WorldJudge } from "../../../lib/world/types";
import { moveItems, place, placementOrigin } from "./ops";
import { selectedIds, type Action, type EditorState } from "./store";

export type CanvasApi = {
  zoomBy: (f: number) => void;
  fit: () => void;
  centerOn: (x: number, y: number) => void;
  getZoom: () => number;
  /** Tile under the middle of the viewport. */
  viewCenterTile: () => { x: number; y: number };
};

type Props = {
  state: EditorState;
  dispatch: Dispatch<Action>;
  kit: Kit;
  imgs: KitImages | null;
  members: Member[];
  judges: WorldJudge[];
  issues: Issue[];
  onToast: (msg: string) => void;
  onZoom: (z: number) => void;
};

type Drag =
  | { type: "pan"; sx: number; sy: number; px: number; py: number }
  | { type: "move"; ids: Set<string>; wx: number; wy: number; dx: number; dy: number; ctx: PlacementContext; moved: boolean }
  | { type: "marquee"; wx: number; wy: number; ex: number; ey: number; additive: boolean }
  | { type: "rect"; tool: "floor" | "wall" | "room"; tx: number; ty: number; ex: number; ey: number }
  | { type: "room-move"; id: string; tx: number; ty: number; dx: number; dy: number; moved: boolean }
  | { type: "resize"; id: string; handle: string; start: Rect; rect: Rect }
  | { type: "spawn"; x: number; y: number }
  | { type: "place" };

type Hit = { id: string; kind: "object" | "person" | "spawn"; x: number; y: number; w: number; h: number; d: number };

const MIN_Z = 0.25;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const MAX_Z = 4;
const SEL = "#fecc33";
const OK_FILL = "rgba(48,168,29,0.28)";
const OK_LINE = "rgba(118,226,132,0.95)";
const BAD_FILL = "rgba(208,59,59,0.32)";
const BAD_LINE = "rgba(244,90,90,0.95)";

const FLOOR_SWATCH: Record<string, string> = {
  stone: "#d8d2c6",
  oak: "#c58f5a",
  walnut: "#74503a",
  concrete: "#b9b2a6",
  carpet: "#4f5874",
  checker: "#dfe3cf",
};

export const EditorCanvas = forwardRef<CanvasApi, Props>(function EditorCanvas(props, ref) {
  const { state, dispatch, kit, imgs, members, judges, issues, onToast, onZoom } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 1, panX: 40, panY: 40, w: 800, h: 600, dpr: 1 });
  const hover = useRef<{ sx: number; sy: number; inside: boolean }>({ sx: 0, sy: 0, inside: false });
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const hits = useRef<Hit[]>([]);
  const tagRects = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const handleRects = useRef<{ handle: string; x: number; y: number; s: number }[]>([]);
  const cache = useRef<{ key: string; ground: HTMLCanvasElement | null; walls: HTMLCanvasElement | null }>({ key: "", ground: null, walls: null });
  const raf = useRef(0);
  const latest = useRef(props);
  latest.current = props;

  const doc = state.doc;
  const cw = useMemo(() => compileWorld(doc, kit, members), [doc, kit, members]);
  const reach = useMemo(() => (state.overlay ? reachable(cw, doc.spawn) : null), [cw, doc.spawn, state.overlay]);
  const cwRef = useRef(cw);
  cwRef.current = cw;
  const reachRef = useRef(reach);
  reachRef.current = reach;

  // ------------------------------------------------------------------ camera helpers
  const toWorld = (sx: number, sy: number) => {
    const v = view.current;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  };
  const toTile = (sx: number, sy: number) => {
    const w = toWorld(sx, sy);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  };
  const invalidate = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      draw();
    });
    // draw is stable enough: it reads everything from refs/latest props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAt = (factor: number, sx: number, sy: number) => {
    const v = view.current;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, v.zoom * factor));
    // Keep the world point under the cursor fixed.
    const wx = (sx - v.panX) / v.zoom;
    const wy = (sy - v.panY) / v.zoom;
    v.zoom = z;
    v.panX = sx - wx * z;
    v.panY = sy - wy * z;
    onZoom(z);
    invalidate();
  };

  const fit = useCallback(() => {
    const v = view.current;
    const d = latest.current.state.doc;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((v.w - 48) / (d.width * TILE), (v.h - 48) / (d.height * TILE))));
    // Prefer whole/half steps so pixel art stays crisp.
    const snapped = z >= 1 ? Math.floor(z * 2) / 2 : z;
    v.zoom = snapped;
    v.panX = (v.w - d.width * TILE * snapped) / 2;
    v.panY = (v.h - d.height * TILE * snapped) / 2;
    onZoom(snapped);
    invalidate();
  }, [invalidate, onZoom]);

  useImperativeHandle(ref, () => ({
    // Buttons step through zoom levels that keep pixel art even (wheel/pinch stay continuous).
    zoomBy: (f) => {
      const z = view.current.zoom;
      const next = f > 1 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
      zoomAt((next ?? z) / z, view.current.w / 2, view.current.h / 2);
    },
    fit,
    centerOn: (x, y) => {
      const v = view.current;
      v.panX = v.w / 2 - (x + 0.5) * TILE * v.zoom;
      v.panY = v.h / 2 - (y + 0.5) * TILE * v.zoom;
      invalidate();
    },
    getZoom: () => view.current.zoom,
    viewCenterTile: () => toTile(view.current.w / 2, view.current.h / 2),
  }));

  // ------------------------------------------------------------------ sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      Object.assign(view.current, { w: r.width, h: r.height, dpr });
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (first) {
        first = false;
        fit();
      }
      invalidate();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, invalidate]);

  useEffect(invalidate, [state, imgs, issues, cw, reach, invalidate]);

  // ------------------------------------------------------------------ drawing
  function layerCanvases() {
    const d = latest.current.state.doc;
    const key = `${d.width}x${d.height}|${d.floor.join("")}|${d.rooms.map((r) => `${r.x},${r.y},${r.w},${r.h},${r.paint}`).join(";")}`;
    const c = cache.current;
    const im = latest.current.imgs;
    if (c.key === key && c.ground) return c;
    if (!im) return c;
    const mk = () => {
      const el = document.createElement("canvas");
      el.width = d.width * TILE;
      el.height = d.height * TILE;
      const ctx = el.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      return { el, ctx };
    };
    const g = mk();
    const w = mk();
    const compiled = compileWorld(d, kit, latest.current.members);
    drawGround(g.ctx, compiled, im.tiles, kit.tiles);
    drawWalls(w.ctx, compiled, im.tiles, kit.tiles);
    cache.current = { key, ground: g.el, walls: w.el };
    return cache.current;
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { state: st, imgs: im, judges: jud, members: mem, issues: iss } = latest.current;
    const d = st.doc;
    const v = view.current;
    const z = v.zoom;
    const compiled = cwRef.current;

    // Camera state on the element: lets tests (and assistive tooling) map tiles to screen points.
    canvas.dataset.zoom = String(z);
    canvas.dataset.panX = String(v.panX);
    canvas.dataset.panY = String(v.panY);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#16141d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(v.dpr * z, 0, 0, v.dpr * z, v.dpr * v.panX, v.dpr * v.panY);
    ctx.imageSmoothingEnabled = false;

    // World backdrop (void/wall area outside rooms reads as the building's body).
    ctx.fillStyle = "#211d2b";
    ctx.fillRect(0, 0, d.width * TILE, d.height * TILE);
    const layers = layerCanvases();
    const dr = drag.current;
    const roomShift = dr?.type === "room-move" && dr.moved ? dr : null;
    if (layers.ground) ctx.drawImage(layers.ground, 0, 0);
    if (layers.walls) ctx.drawImage(layers.walls, 0, 0);

    // Objects and people, y-sorted, as the game does. Items being dragged draw at the preview spot.
    const moving = dr?.type === "move" && dr.moved ? dr : null;
    const shiftRoom = roomShift ? roomContentsIds(d, roomShift.id) : null;
    const offsetOf = (id: string) => {
      if (moving?.ids.has(id)) return { x: moving.dx, y: moving.dy };
      if (shiftRoom?.has(id)) return { x: roomShift!.dx * TILE, y: roomShift!.dy * TILE };
      return { x: 0, y: 0 };
    };
    const items: { d: number; draw: () => void; hit?: Hit }[] = [];
    if (im) {
      for (const o of d.objects) {
        const a = kit.byId.get(o.asset);
        if (!a) continue;
        const off = offsetOf(o.id);
        const px = o.x * TILE + (o.ox ?? 0) + a.ox + off.x;
        const py = o.y * TILE + (o.oy ?? 0) + a.oy + off.y;
        const depth = a.mount === "wall" ? -1 : (o.y + a.h) * TILE + (o.oy ?? 0) + off.y;
        items.push({
          d: depth,
          draw: () => drawFrame(ctx, im.props, kit.atlas, a.frame, px, py),
          hit: { id: o.id, kind: "object", x: px, y: py, w: a.img_w, h: a.img_h, d: depth },
        });
      }
      for (const p of d.people) {
        const off = offsetOf(p.id);
        const fx = p.x * TILE + TILE / 2 + off.x;
        const fy = p.y * TILE + TILE - 2 + off.y;
        const sheet = sheetFor(p.ref, mem, jud);
        const img = im.chars[sheet];
        const pet = sheet.startsWith("cat");
        items.push({
          d: fy,
          draw: () => {
            if (!img) return;
            if (pet) ctx.drawImage(img, 0, 0, 32, 32, fx - 16, fy - 30, 32, 32);
            else ctx.drawImage(img, 0, (ROW[p.face] ?? 0) * 64, 64, 64, fx - 32, fy - 64, 64, 64);
          },
          hit: { id: p.id, kind: "person", x: fx - 16, y: fy - (pet ? 28 : 50), w: 32, h: pet ? 28 : 50, d: fy },
        });
      }
      // Candidate start marker.
      const sp = dr?.type === "spawn" ? dr : d.spawn;
      const sx = sp.x * TILE + TILE / 2;
      const sy = sp.y * TILE + TILE - 2;
      items.push({
        d: sy,
        draw: () => {
          ctx.globalAlpha = 0.9;
          if (im.chars.player) ctx.drawImage(im.chars.player, 0, 0, 64, 64, sx - 32, sy - 64, 64, 64);
          ctx.globalAlpha = 1;
        },
        hit: { id: "spawn", kind: "spawn", x: sx - 16, y: sy - 50, w: 32, h: 50, d: sy },
      });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.draw();
    hits.current = items.filter((i) => i.hit).map((i) => i.hit!).sort((a, b) => b.d - a.d);

    // Walkability / reachability overlay: furniture-blocked floor in red, unreachable floor in amber.
    const rch = reachRef.current;
    if (st.overlay && rch) {
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          if (!compiled.floors[y]![x]) continue;
          if (compiled.collision[y]![x]) {
            ctx.fillStyle = "rgba(208,59,59,0.30)";
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          } else if (!rch[y * d.width + x]) {
            ctx.fillStyle = "rgba(250,178,25,0.35)";
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
    }

    // Grid: one line per world tile, drawn in world space so it can never drift from positions.
    if (st.grid && z >= 0.35) {
      const lw = 1 / z;
      ctx.lineWidth = lw;
      const x0 = Math.max(0, Math.floor(-v.panX / z / TILE));
      const y0 = Math.max(0, Math.floor(-v.panY / z / TILE));
      const x1 = Math.min(d.width, Math.ceil((v.w - v.panX) / z / TILE));
      const y1 = Math.min(d.height, Math.ceil((v.h - v.panY) / z / TILE));
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        ctx.moveTo(x * TILE, y0 * TILE);
        ctx.lineTo(x * TILE, y1 * TILE);
      }
      for (let y = y0; y <= y1; y++) {
        ctx.moveTo(x0 * TILE, y * TILE);
        ctx.lineTo(x1 * TILE, y * TILE);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.stroke();
      ctx.beginPath();
      for (let x = Math.ceil(x0 / 8) * 8; x <= x1; x += 8) {
        ctx.moveTo(x * TILE, y0 * TILE);
        ctx.lineTo(x * TILE, y1 * TILE);
      }
      for (let y = Math.ceil(y0 / 8) * 8; y <= y1; y += 8) {
        ctx.moveTo(x0 * TILE, y * TILE);
        ctx.lineTo(x1 * TILE, y * TILE);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.stroke();
    }
    // World edge
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(0, 0, d.width * TILE, d.height * TILE);

    // Rooms: outline, and a moving room's ghost.
    for (const r of d.rooms) {
      const selected = st.sel.kind === "room" && st.sel.id === r.id;
      const shift = roomShift?.id === r.id ? roomShift : null;
      const rx = (r.x + (shift?.dx ?? 0)) * TILE;
      const ry = (r.y + (shift?.dy ?? 0)) * TILE;
      ctx.setLineDash(selected ? [] : [6 / z, 4 / z]);
      ctx.lineWidth = (selected ? 2 : 1) / z;
      ctx.strokeStyle = selected ? SEL : "rgba(255,255,255,0.28)";
      ctx.strokeRect(rx, ry, r.w * TILE, r.h * TILE);
      ctx.setLineDash([]);
      if (shift) {
        const ok = r.x + shift.dx >= 0 && r.y + shift.dy >= 0 && r.x + shift.dx + r.w <= d.width && r.y + shift.dy + r.h <= d.height;
        ctx.fillStyle = ok ? OK_FILL : BAD_FILL;
        ctx.fillRect(rx, ry, r.w * TILE, r.h * TILE);
      }
    }

    // Selection outlines.
    const sel = selectedIds(st.sel);
    ctx.lineWidth = 2 / z;
    for (const o of d.objects) {
      if (!sel.has(o.id)) continue;
      const a = kit.byId.get(o.asset);
      if (!a) continue;
      const off = offsetOf(o.id);
      const fp = a.mount === "wall" ? { x: o.x, y: o.y, w: a.w, h: 2 } : footprint(a, o);
      ctx.strokeStyle = SEL;
      ctx.fillStyle = "rgba(254,204,51,0.14)";
      ctx.fillRect(fp.x * TILE + off.x, fp.y * TILE + off.y, fp.w * TILE, fp.h * TILE);
      ctx.strokeRect(fp.x * TILE + off.x, fp.y * TILE + off.y, fp.w * TILE, fp.h * TILE);
    }
    for (const p of d.people) {
      if (!sel.has(p.id)) continue;
      const off = offsetOf(p.id);
      ctx.strokeStyle = SEL;
      ctx.strokeRect(p.x * TILE + off.x, p.y * TILE + off.y, TILE, TILE);
    }
    if (st.sel.kind === "spawn") {
      const sp = dr?.type === "spawn" ? dr : d.spawn;
      ctx.strokeStyle = SEL;
      ctx.strokeRect(sp.x * TILE, sp.y * TILE, TILE, TILE);
    }

    // Move validity: tint each moved footprint green/red at its preview position.
    if (moving) {
      const tilesMode = !st.snap;
      for (const o of d.objects) {
        if (!moving.ids.has(o.id)) continue;
        const a = kit.byId.get(o.asset);
        if (!a) continue;
        const target = movedPos(o, a, moving.dx, moving.dy, tilesMode);
        const ok = canPlaceAsset(moving.ctx, a, target.x, target.y, target.ox, target.oy).ok;
        const fp = a.mount === "wall" ? { x: target.x, y: target.y, w: a.w, h: 2 } : footprint(a, target);
        ctx.fillStyle = ok ? OK_FILL : BAD_FILL;
        ctx.fillRect(fp.x * TILE, fp.y * TILE, fp.w * TILE, fp.h * TILE);
      }
      for (const p of d.people) {
        if (!moving.ids.has(p.id)) continue;
        const nx = p.x + Math.round(moving.dx / TILE);
        const ny = p.y + Math.round(moving.dy / TILE);
        ctx.fillStyle = canPlacePerson(moving.ctx, nx, ny).ok ? OK_FILL : BAD_FILL;
        ctx.fillRect(nx * TILE, ny * TILE, TILE, TILE);
      }
    }

    // Rect tools preview.
    if (dr?.type === "rect") {
      const r = normRect(dr.tx, dr.ty, dr.ex, dr.ey);
      ctx.fillStyle = dr.tool === "wall" ? "rgba(40,34,52,0.7)" : `${FLOOR_SWATCH[st.floorKind]}aa`;
      ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      ctx.strokeStyle = SEL;
      ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    }
    if (dr?.type === "resize") {
      const r = dr.rect;
      ctx.fillStyle = "rgba(254,204,51,0.16)";
      ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      ctx.strokeStyle = SEL;
      ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    }

    // Library placement ghost.
    if (st.placing && hover.current.inside && im) {
      const t = toTile(hover.current.sx, hover.current.sy);
      const o = placementOrigin(d, kit, st.placing, t.x, t.y);
      ctx.globalAlpha = 0.78;
      if (st.placing.kind === "asset") {
        const a = kit.byId.get(st.placing.asset);
        if (a) {
          const free = !st.snap && a.mount === "floor" ? freeAt(hover.current.sx, hover.current.sy, a) : null;
          const ox = free?.ox ?? 0;
          const oy = free?.oy ?? 0;
          const gx = free ? free.x : o.x;
          const gy = free ? free.y : o.y;
          drawFrame(ctx, im.props, kit.atlas, a.frame, gx * TILE + ox + a.ox, gy * TILE + oy + a.oy);
          ctx.globalAlpha = 1;
          const ok = canPlaceAsset(placementContext(d, kit), a, gx, gy, ox, oy, true).ok;
          const fp = a.mount === "wall" ? { x: gx, y: gy, w: a.w, h: 2 } : footprint(a, { x: gx, y: gy, ox, oy });
          outlineFill(ctx, fp, ok, z);
        }
      } else if (st.placing.kind === "person") {
        const img = im.chars[sheetFor(st.placing.ref, mem, jud)];
        if (img) {
          const pet = sheetFor(st.placing.ref, mem, jud).startsWith("cat");
          if (pet) ctx.drawImage(img, 0, 0, 32, 32, o.x * TILE, o.y * TILE, 32, 32);
          else ctx.drawImage(img, 0, 0, 64, 64, o.x * TILE - 16, o.y * TILE - 34, 64, 64);
        }
        ctx.globalAlpha = 1;
        const existing = d.people.find((p) => p.ref === (st.placing as { ref: string }).ref);
        const ok = canPlacePerson(placementContext(d, kit, new Set(existing ? [existing.id] : [])), o.x, o.y).ok;
        outlineFill(ctx, { x: o.x, y: o.y, w: 1, h: 1 }, ok, z);
      } else {
        const p = presetById(st.placing.preset);
        ctx.globalAlpha = 1;
        if (p) {
          ctx.fillStyle = `${FLOOR_SWATCH[p.floor]}99`;
          ctx.fillRect(o.x * TILE, o.y * TILE, p.w * TILE, p.h * TILE);
          for (const ob of p.objects) {
            const a = kit.byId.get(ob.asset);
            if (a) drawFrame(ctx, im.props, kit.atlas, a.frame, (o.x + ob.x) * TILE + a.ox, (o.y + ob.y) * TILE + a.oy);
          }
          outlineFill(ctx, { x: o.x, y: o.y, w: p.w, h: p.h }, canPlacePreset(d, p, o.x, o.y).ok, z);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Marquee (screen-aligned in world space).
    if (dr?.type === "marquee") {
      const x = Math.min(dr.wx, dr.ex);
      const y = Math.min(dr.wy, dr.ey);
      ctx.fillStyle = "rgba(254,204,51,0.10)";
      ctx.fillRect(x, y, Math.abs(dr.ex - dr.wx), Math.abs(dr.ey - dr.wy));
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 1 / z;
      ctx.strokeRect(x, y, Math.abs(dr.ex - dr.wx), Math.abs(dr.ey - dr.wy));
    }

    // Issue markers.
    for (const issue of iss) {
      if (!issue.target) continue;
      ctx.beginPath();
      ctx.arc(issue.target.x * TILE + TILE - 4, issue.target.y * TILE + 4, 6 / Math.max(z, 0.6), 0, Math.PI * 2);
      ctx.fillStyle = issue.level === "error" ? "#d03b3b" : "#fab219";
      ctx.fill();
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = "#16141d";
      ctx.stroke();
    }

    // ---- screen-space labels
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.font = "11px var(--font-mono), ui-monospace, monospace";
    ctx.textBaseline = "middle";
    tagRects.current = [];
    for (const r of d.rooms) {
      const shift = roomShift?.id === r.id ? roomShift : null;
      const sx = v.panX + (r.x + (shift?.dx ?? 0)) * TILE * z;
      const sy = v.panY + (r.y + (shift?.dy ?? 0)) * TILE * z;
      const label = r.name.toUpperCase();
      const w = ctx.measureText(label).width + 16;
      const selected = st.sel.kind === "room" && st.sel.id === r.id;
      ctx.fillStyle = selected ? SEL : "rgba(22,20,29,0.82)";
      roundRect(ctx, sx + 4, sy + 4, w, 20, 5);
      ctx.fill();
      ctx.fillStyle = selected ? "#141414" : "#f4f1ea";
      ctx.fillText(label, sx + 12, sy + 14.5);
      tagRects.current.push({ id: r.id, x: sx + 4, y: sy + 4, w, h: 20 });
    }
    if (z >= 0.6) {
      for (const p of d.people) {
        const off = offsetOf(p.id);
        const label = personLabel(p.ref, jud, mem);
        const sx = v.panX + (p.x * TILE + TILE / 2 + off.x) * z;
        const sy = v.panY + (p.y * TILE - 22 + off.y) * z;
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = p.ref.startsWith("judge:") ? "rgba(29,26,38,0.88)" : "rgba(33,147,91,0.9)";
        roundRect(ctx, sx - w / 2, sy - 9, w, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, sx - w / 2 + 5, sy + 0.5);
      }
      const sp = dr?.type === "spawn" ? dr : d.spawn;
      const sx = v.panX + (sp.x * TILE + TILE / 2) * z;
      const sy = v.panY + (sp.y * TILE - 22) * z;
      ctx.fillStyle = "#fecc33";
      roundRect(ctx, sx - 27, sy - 9, 54, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#141414";
      ctx.fillText("START", sx - 18, sy + 0.5);
    }
    // Resize handles for the selected room.
    handleRects.current = [];
    if (st.sel.kind === "room" && !roomShift) {
      const r = (dr?.type === "resize" ? dr.rect : d.rooms.find((x) => x.id === (st.sel as { id: string }).id)) as Rect | undefined;
      if (r) {
        const x0 = v.panX + r.x * TILE * z;
        const y0 = v.panY + r.y * TILE * z;
        const x1 = v.panX + (r.x + r.w) * TILE * z;
        const y1 = v.panY + (r.y + r.h) * TILE * z;
        const pts: [string, number, number][] = [
          ["nw", x0, y0], ["n", (x0 + x1) / 2, y0], ["ne", x1, y0], ["e", x1, (y0 + y1) / 2],
          ["se", x1, y1], ["s", (x0 + x1) / 2, y1], ["sw", x0, y1], ["w", x0, (y0 + y1) / 2],
        ];
        for (const [h, x, y] of pts) {
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#141414";
          ctx.lineWidth = 1.5;
          ctx.fillRect(x - 5, y - 5, 10, 10);
          ctx.strokeRect(x - 5, y - 5, 10, 10);
          handleRects.current.push({ handle: h, x: x - 7, y: y - 7, s: 14 });
        }
      }
    }
    drawMinimap(layers);

    // Snap-off hint.
    if (!st.snap && drag.current?.type === "move") {
      ctx.fillStyle = "rgba(22,20,29,0.85)";
      roundRect(ctx, 12, v.h - 36, 230, 24, 6);
      ctx.fill();
      ctx.fillStyle = "#fecc33";
      ctx.fillText("FREE PLACEMENT · PEOPLE & WALL PIECES SNAP", 22, v.h - 24);
    }
  }

  /** Overview of the whole world with the visible area outlined; hidden when everything fits. */
  function drawMinimap(layers: { ground: HTMLCanvasElement | null; walls: HTMLCanvasElement | null }) {
    const mini = miniRef.current;
    if (!mini) return;
    const d = latest.current.state.doc;
    const v = view.current;
    const ww = d.width * TILE;
    const wh = d.height * TILE;
    const x0 = -v.panX / v.zoom;
    const y0 = -v.panY / v.zoom;
    const vw = v.w / v.zoom;
    const vh = v.h / v.zoom;
    const fits = x0 <= 0 && y0 <= 0 && x0 + vw >= ww && y0 + vh >= wh;
    mini.style.display = fits || !layers.ground ? "none" : "block";
    if (fits || !layers.ground) return;
    const k = Math.min(180 / ww, 130 / wh);
    const w = Math.round(ww * k);
    const h = Math.round(wh * k);
    const dpr = v.dpr;
    if (mini.width !== Math.round(w * dpr)) {
      mini.width = Math.round(w * dpr);
      mini.height = Math.round(h * dpr);
      mini.style.width = `${w}px`;
      mini.style.height = `${h}px`;
    }
    const m = mini.getContext("2d")!;
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.imageSmoothingEnabled = true;
    m.fillStyle = "#211d2b";
    m.fillRect(0, 0, w, h);
    m.drawImage(layers.ground, 0, 0, w, h);
    if (layers.walls) m.drawImage(layers.walls, 0, 0, w, h);
    m.strokeStyle = SEL;
    m.lineWidth = 1.5;
    m.strokeRect(Math.max(0, x0 * k) + 0.5, Math.max(0, y0 * k) + 0.5, Math.min(w, vw * k) - 1, Math.min(h, vh * k) - 1);
    mini.dataset.k = String(k);
  }

  // ------------------------------------------------------------------ geometry helpers
  function freeAt(sx: number, sy: number, a: { w: number; h: number }) {
    const w = toWorld(sx, sy);
    return freeCell(w.x - (a.w * TILE) / 2, w.y - (a.h * TILE) / 2);
  }
  function roomContentsIds(d: WorldDoc, roomId: string): Set<string> {
    const r = d.rooms.find((x) => x.id === roomId);
    const out = new Set<string>();
    if (!r) return out;
    for (const o of d.objects) {
      const a = kit.byId.get(o.asset);
      if (!a) continue;
      const fp = a.mount === "wall" ? { x: o.x, y: o.y + 2, w: a.w, h: 1 } : footprint(a, o);
      const cx = fp.x + Math.floor(fp.w / 2);
      const cy = a.mount === "wall" ? fp.y : fp.y + Math.floor(fp.h / 2);
      if (roomAt(d, cx, cy)?.id === r.id) out.add(o.id);
    }
    for (const p of d.people) if (p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h) out.add(p.id);
    return out;
  }

  // ------------------------------------------------------------------ pointer handling
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const hitAt = (sx: number, sy: number): Hit | null => {
    const w = toWorld(sx, sy);
    for (const h of hits.current) if (w.x >= h.x && w.x < h.x + h.w && w.y >= h.y && w.y < h.y + h.h) return h;
    return null;
  };

  function commitPlacement(sx: number, sy: number) {
    const { state: st } = latest.current;
    if (!st.placing) return;
    const t = toTile(sx, sy);
    const o = placementOrigin(st.doc, kit, st.placing, t.x, t.y);
    let res;
    if (st.placing.kind === "asset" && !st.snap) {
      const a = kit.byId.get(st.placing.asset);
      if (a && a.mount === "floor") {
        const f = freeAt(sx, sy, a);
        res = place(st.doc, kit, st.placing, f.x, f.y, { ox: f.ox, oy: f.oy });
      }
    }
    res ??= place(st.doc, kit, st.placing, o.x, o.y);
    if ("error" in res) onToast(res.error);
    else dispatch({ type: "commit", doc: res.doc, sel: res.sel });
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    canvas.focus();
    const { sx, sy } = local(e);
    const st = latest.current.state;
    const w = toWorld(sx, sy);
    const t = toTile(sx, sy);
    if (e.button === 1 || e.button === 2 || space.current || st.tool === "hand") {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drag.current = { type: "pan", sx, sy, px: view.current.panX, py: view.current.panY };
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    if (st.placing) {
      drag.current = { type: "place" };
      return;
    }
    if (st.tool === "floor" || st.tool === "wall" || st.tool === "room") {
      drag.current = { type: "rect", tool: st.tool, tx: t.x, ty: t.y, ex: t.x, ey: t.y };
      invalidate();
      return;
    }
    if (st.tool === "door") {
      const next = carveDoor(st.doc, t.x, t.y, 2);
      if (next) dispatch({ type: "commit", doc: next });
      else onToast("Click a wall between two rooms (up to 5 tiles thick) to open a doorway.");
      return;
    }
    // Select tool
    const handle = handleRects.current.find((h) => sx >= h.x && sx < h.x + h.s && sy >= h.y && sy < h.y + h.s);
    if (handle && st.sel.kind === "room") {
      const r = st.doc.rooms.find((x) => x.id === (st.sel as { id: string }).id)!;
      drag.current = { type: "resize", id: r.id, handle: handle.handle, start: { x: r.x, y: r.y, w: r.w, h: r.h }, rect: { x: r.x, y: r.y, w: r.w, h: r.h } };
      return;
    }
    const tag = tagRects.current.find((r) => sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h);
    if (tag) {
      dispatch({ type: "select", sel: { kind: "room", id: tag.id } });
      drag.current = { type: "room-move", id: tag.id, tx: t.x, ty: t.y, dx: 0, dy: 0, moved: false };
      return;
    }
    const hit = hitAt(sx, sy);
    if (hit?.kind === "spawn") {
      dispatch({ type: "select", sel: { kind: "spawn" } });
      drag.current = { type: "spawn", x: st.doc.spawn.x, y: st.doc.spawn.y };
      return;
    }
    if (hit) {
      const cur = selectedIds(st.sel);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const next = new Set(cur);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        dispatch({ type: "select", sel: next.size ? { kind: "items", ids: [...next] } : { kind: "none" } });
        return;
      }
      const ids = cur.has(hit.id) ? cur : new Set([hit.id]);
      if (!cur.has(hit.id)) dispatch({ type: "select", sel: { kind: "items", ids: [hit.id] } });
      drag.current = { type: "move", ids, wx: w.x, wy: w.y, dx: 0, dy: 0, ctx: placementContext(st.doc, kit, ids), moved: false };
      return;
    }
    // Empty spot: drag a selected room by its floor, otherwise marquee.
    if (st.sel.kind === "room") {
      const r = st.doc.rooms.find((x) => x.id === (st.sel as { id: string }).id);
      if (r && t.x >= r.x && t.y >= r.y && t.x < r.x + r.w && t.y < r.y + r.h) {
        drag.current = { type: "room-move", id: r.id, tx: t.x, ty: t.y, dx: 0, dy: 0, moved: false };
        return;
      }
    }
    drag.current = { type: "marquee", wx: w.x, wy: w.y, ex: w.x, ey: w.y, additive: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy } = local(e);
    hover.current = { sx, sy, inside: true };
    const dr = drag.current;
    const st = latest.current.state;
    const canvas = canvasRef.current!;
    // Cursor feedback
    if (!dr) {
      const overHandle = handleRects.current.find((h) => sx >= h.x && sx < h.x + h.s && sy >= h.y && sy < h.y + h.s);
      const overTag = tagRects.current.some((r) => sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h);
      canvas.style.cursor = st.tool === "hand" || space.current ? "grab" : st.placing ? "copy" : overHandle ? `${overHandle.handle}-resize` : overTag ? "move" : st.tool === "select" ? (hitAt(sx, sy) ? "pointer" : "default") : "crosshair";
    }
    if (!dr) {
      if (st.placing) invalidate();
      return;
    }
    const w = toWorld(sx, sy);
    const t = toTile(sx, sy);
    switch (dr.type) {
      case "pan":
        canvas.style.cursor = "grabbing";
        view.current.panX = dr.px + (sx - dr.sx);
        view.current.panY = dr.py + (sy - dr.sy);
        break;
      case "move": {
        const rawX = w.x - dr.wx;
        const rawY = w.y - dr.wy;
        if (!st.snap) {
          dr.dx = Math.round(rawX / 2) * 2;
          dr.dy = Math.round(rawY / 2) * 2;
        } else {
          dr.dx = Math.round(rawX / TILE) * TILE;
          dr.dy = Math.round(rawY / TILE) * TILE;
        }
        dr.moved = dr.moved || Math.abs(rawX) > 3 || Math.abs(rawY) > 3;
        break;
      }
      case "marquee":
        dr.ex = w.x;
        dr.ey = w.y;
        break;
      case "rect":
        dr.ex = t.x;
        dr.ey = t.y;
        break;
      case "room-move":
        dr.dx = t.x - dr.tx;
        dr.dy = t.y - dr.ty;
        dr.moved = dr.moved || dr.dx !== 0 || dr.dy !== 0;
        break;
      case "resize": {
        const s = dr.start;
        let { x, y, w: rw, h: rh } = s;
        if (dr.handle.includes("e")) rw = Math.max(2, t.x - s.x + 1);
        if (dr.handle.includes("s")) rh = Math.max(2, t.y - s.y + 1);
        if (dr.handle.includes("w")) {
          x = Math.min(t.x, s.x + s.w - 2);
          rw = s.x + s.w - x;
        }
        if (dr.handle.includes("n")) {
          y = Math.min(t.y, s.y + s.h - 2);
          rh = s.y + s.h - y;
        }
        dr.rect = { x, y, w: rw, h: rh };
        break;
      }
      case "spawn":
        dr.x = t.x;
        dr.y = t.y;
        break;
    }
    invalidate();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const dr = drag.current;
    drag.current = null;
    const { sx, sy } = local(e);
    const st = latest.current.state;
    const d = st.doc;
    if (!dr) return;
    switch (dr.type) {
      case "place":
        commitPlacement(sx, sy);
        if (st.placing?.via === "click" && !e.shiftKey) dispatch({ type: "placing", placing: null });
        break;
      case "move": {
        if (!dr.moved || (dr.dx === 0 && dr.dy === 0)) break;
        // Snap on: the delta is whole tiles. Snap off: art pixels (people and wall pieces still snap).
        const res = st.snap ? moveItems(d, kit, dr.ids, dr.dx / TILE, dr.dy / TILE) : moveItems(d, kit, dr.ids, dr.dx, dr.dy, true);
        if ("error" in res) onToast(`Can't move there — ${res.error}`);
        else dispatch({ type: "commit", doc: res.doc, sel: res.sel });
        break;
      }
      case "marquee": {
        const x0 = Math.min(dr.wx, dr.ex);
        const y0 = Math.min(dr.wy, dr.ey);
        const x1 = Math.max(dr.wx, dr.ex);
        const y1 = Math.max(dr.wy, dr.ey);
        if (x1 - x0 < 4 && y1 - y0 < 4) {
          // A click on empty floor selects the room there.
          const t = toTile(sx, sy);
          const r = roomAt(d, t.x, t.y);
          dispatch({ type: "select", sel: r ? { kind: "room", id: r.id } : { kind: "none" } });
          break;
        }
        const ids = new Set(dr.additive ? [...selectedIds(st.sel)] : []);
        for (const h of hits.current) {
          if (h.kind === "spawn") continue;
          if (h.x < x1 && h.x + h.w > x0 && h.y < y1 && h.y + h.h > y0) ids.add(h.id);
        }
        dispatch({ type: "select", sel: ids.size ? { kind: "items", ids: [...ids] } : { kind: "none" } });
        break;
      }
      case "rect": {
        const r = normRect(dr.tx, dr.ty, dr.ex, dr.ey);
        if (dr.tool === "floor") dispatch({ type: "commit", doc: paintFloor(d, r, st.floorKind) });
        else if (dr.tool === "wall") dispatch({ type: "commit", doc: paintFloor(d, r, null) });
        else {
          if (r.w < 2 || r.h < 2) {
            onToast("Drag out a room at least 2×2 tiles.");
            break;
          }
          const room: Room = {
            id: uid("room"),
            name: `Room ${d.rooms.length + 1}`,
            purpose: "other",
            ...r,
            paint: "corridor",
            floor: st.floorKind,
          };
          const next = paintFloor({ ...d, rooms: [...d.rooms, room] }, r, st.floorKind);
          dispatch({ type: "commit", doc: next, sel: { kind: "room", id: room.id } });
          dispatch({ type: "tool", tool: "select" });
        }
        break;
      }
      case "room-move": {
        if (!dr.moved) break;
        const r = d.rooms.find((x) => x.id === dr.id)!;
        if (r.x + dr.dx < 0 || r.y + dr.dy < 0 || r.x + r.w + dr.dx > d.width || r.y + r.h + dr.dy > d.height) {
          onToast("Rooms must stay inside the world. Enlarge it in World settings.");
          break;
        }
        dispatch({ type: "commit", doc: moveRoom(d, kit, dr.id, dr.dx, dr.dy) });
        break;
      }
      case "resize": {
        const r = dr.rect;
        if (r.x < 0 || r.y < 0 || r.x + r.w > d.width || r.y + r.h > d.height) {
          onToast("Rooms must stay inside the world.");
          break;
        }
        dispatch({ type: "commit", doc: resizeRoom(d, dr.id, r) });
        break;
      }
      case "spawn": {
        if (dr.x === d.spawn.x && dr.y === d.spawn.y) break;
        const v = canPlacePerson(placementContext(d, kit), dr.x, dr.y);
        if (!v.ok) onToast(`Start point: ${v.reason}`);
        else dispatch({ type: "commit", doc: { ...d, spawn: { x: dr.x, y: dr.y } } });
        break;
      }
    }
    invalidate();
  };

  // Library drags arrive as window events (the pointer starts outside the canvas).
  useEffect(() => {
    if (!state.placing) return;
    const move = (e: PointerEvent) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      hover.current = { sx: e.clientX - r.left, sy: e.clientY - r.top, inside };
      invalidate();
    };
    const up = (e: PointerEvent) => {
      const st = latest.current.state;
      if (st.placing?.via !== "drag") return;
      const r = canvasRef.current?.getBoundingClientRect();
      if (r && e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) {
        commitPlacement(e.clientX - r.left, e.clientY - r.top);
      }
      dispatch({ type: "placing", placing: null });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // commitPlacement reads from refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.placing, invalidate, dispatch]);

  // Wheel: trackpad scroll pans, pinch / ctrl+wheel zooms at the cursor.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = local(e);
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
      else if (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !e.shiftKey) {
        view.current.panX -= e.deltaX;
        view.current.panY -= e.deltaY;
        invalidate();
      } else zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, sx, sy);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
        space.current = true;
        if (document.activeElement === canvas) e.preventDefault();
      }
      if (e.key === "Escape") {
        drag.current = null;
        invalidate();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
    // zoomAt/local read refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidate]);

  return (
    <div ref={wrapRef} className="we-canvas" onPointerLeave={() => { hover.current.inside = false; invalidate(); }}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="World editor canvas. Drag items from the library onto it; select with click; move with drag or arrow keys."
        data-testid="world-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas
        ref={miniRef}
        className="we-minimap"
        aria-label="Minimap: click to jump there"
        data-testid="minimap"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = Number(e.currentTarget.dataset.k || 1);
          const v = view.current;
          const wx = (e.clientX - r.left) / k;
          const wy = (e.clientY - r.top) / k;
          v.panX = v.w / 2 - wx * v.zoom;
          v.panY = v.h / 2 - wy * v.zoom;
          invalidate();
        }}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------------- helpers
const ROW: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };

export function sheetFor(ref: string, members: Member[], judges: WorldJudge[]): string {
  if (ref.startsWith("judge:")) return judges.find((j) => `judge:${j.id}` === ref)?.sheet ?? "m1";
  if (ref.startsWith("member:")) return members.find((m) => `member:${m.id}` === ref)?.look ?? "m3";
  if (ref.startsWith("pet:")) return ref.slice(4);
  return "m1";
}

export function personLabel(ref: string, judges: WorldJudge[], members: Member[]): string {
  if (ref.startsWith("judge:")) return judges.find((j) => `judge:${j.id}` === ref)?.name ?? "Removed judge";
  if (ref.startsWith("member:")) return members.find((m) => `member:${m.id}` === ref)?.name ?? "Member";
  return "Cat";
}

function movedPos(o: WorldDoc["objects"][number], a: { mount: string }, dx: number, dy: number, freeMode: boolean) {
  if (freeMode && a.mount === "floor") {
    const tx = o.x * TILE + (o.ox ?? 0) + dx;
    const ty = o.y * TILE + (o.oy ?? 0) + dy;
    const x = Math.floor(tx / TILE);
    const y = Math.floor(ty / TILE);
    return { x, y, ox: tx - x * TILE, oy: ty - y * TILE };
  }
  return { x: o.x + Math.round(dx / TILE), y: o.y + Math.round(dy / TILE), ox: o.ox ?? 0, oy: o.oy ?? 0 };
}

function normRect(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
}

function outlineFill(ctx: CanvasRenderingContext2D, r: Rect, ok: boolean, z: number) {
  ctx.fillStyle = ok ? OK_FILL : BAD_FILL;
  ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
  ctx.lineWidth = 2 / z;
  ctx.strokeStyle = ok ? OK_LINE : BAD_LINE;
  ctx.strokeRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { FLOOR_SWATCH };
