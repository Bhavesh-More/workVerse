"use client";

// The world editor: toolbar, library, canvas, inspector, issues, publish review and play preview.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { PhaserGame } from "../../../game/PhaserGame";
import { ApiError } from "../../../lib/api";
import { workplaceApi } from "../../../lib/workplace";
import { compileWorld } from "../../../lib/world/compile";
import { KIT, JUDGE_TITLES } from "../../../lib/world/kit";
import { hasErrors, JUDGE_HOME, validateWorld, type Issue } from "../../../lib/world/validate";
import type { WorldCharacter, WorldView } from "../../../lib/types";
import type { Member, WorldDoc } from "../../../lib/world/types";
import { useKitImages } from "../Thumbs";
import { EditorCanvas, type CanvasApi } from "./EditorCanvas";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { deleteSelection, duplicateObjects, nudge, place, placementOrigin, selectedObjects } from "./ops";
import { initState, reducer, type Placing, type Tool } from "./store";
import { useAutosave, type SaveStatus } from "./useAutosave";

type Props = {
  initial: WorldDoc;
  version: number;
  members: Member[];
  judgeNames: Record<string, string>;
  publishedVersion: number | null;
  mode: "default" | "custom" | null;
};

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Select & move", key: "V", icon: "M5 3l13 8-6 1.5L9 19z" },
  { id: "floor", label: "Floor brush", key: "B", icon: "M4 20h16M6 16l8-8 4 4-8 8H6z" },
  { id: "wall", label: "Wall brush", key: "W", icon: "M3 6h18v4H3zM3 14h18v4H3zM9 6v4M15 14v4" },
  { id: "door", label: "Doorway", key: "D", icon: "M6 20V4h9v16M15 4l3 2v14M12 12h.01" },
  { id: "room", label: "Draw room", key: "R", icon: "M4 4h16v16H4zM4 9h16" },
  { id: "hand", label: "Pan", key: "H", icon: "M8 13V5a1.5 1.5 0 013 0v6M11 11V4a1.5 1.5 0 013 0v7M14 11V6a1.5 1.5 0 013 0v8a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.5-1.5L8 13" },
];

export function WorldEditor({ initial, version, members, judgeNames, publishedVersion, mode }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const imgs = useKitImages();
  const canvas = useRef<CanvasApi>(null);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pubVersion, setPubVersion] = useState(publishedVersion);
  const [currentMode, setCurrentMode] = useState(mode);
  const save = useAutosave(state.doc, state.revision, version);
  const issues = useMemo(() => validateWorld(state.doc, KIT, members), [state.doc, members]);
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;

  const say = useCallback((text: string, tone: "info" | "error" = "error") => {
    setToast({ text, tone });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const placeAtCenter = useCallback(
    (p: NonNullable<Placing>) => {
      const c = canvas.current?.viewCenterTile() ?? { x: Math.floor(state.doc.width / 2), y: Math.floor(state.doc.height / 2) };
      const o = placementOrigin(state.doc, KIT, p, c.x, c.y);
      const res = place(state.doc, KIT, p, o.x, o.y);
      if ("error" in res) say(`${res.error} Drag it onto the map instead.`);
      else dispatch({ type: "commit", doc: res.doc, sel: res.sel });
    },
    [state.doc, say],
  );

  const focusIssue = (i: Issue) => {
    if (!i.target) return;
    canvas.current?.centerOn(i.target.x, i.target.y);
    const t = i.target;
    if (t.kind === "room" && t.id) dispatch({ type: "select", sel: { kind: "room", id: t.id } });
    else if (t.kind === "spawn") dispatch({ type: "select", sel: { kind: "spawn" } });
    else if (t.id) dispatch({ type: "select", sel: { kind: "items", ids: [t.id] } });
  };

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (previewOpen || publishOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const apply = (res: ReturnType<typeof nudge>) => {
        if ("error" in res) say(res.error);
        else dispatch({ type: "commit", doc: res.doc, sel: res.sel });
      };
      if (mod && k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (mod && k === "d") {
        e.preventDefault();
        const objs = selectedObjects(state.doc, state.sel);
        if (objs.length) apply(duplicateObjects(state.doc, KIT, objs));
      } else if (mod && k === "c") {
        const objs = selectedObjects(state.doc, state.sel);
        if (objs.length) {
          dispatch({ type: "clipboard", objects: objs });
          say(`Copied ${objs.length} object${objs.length > 1 ? "s" : ""}.`, "info");
        }
      } else if (mod && k === "v") {
        if (state.clipboard?.length) {
          e.preventDefault();
          const c = canvas.current?.viewCenterTile();
          const minX = Math.min(...state.clipboard.map((o) => o.x));
          const minY = Math.min(...state.clipboard.map((o) => o.y));
          apply(duplicateObjects(state.doc, KIT, state.clipboard, c ? c.x - minX : 1, c ? c.y - minY : 1));
        }
      } else if (k === "delete" || k === "backspace") {
        if (state.sel.kind === "items") {
          e.preventDefault();
          apply(deleteSelection(state.doc, state.sel));
        }
      } else if (k.startsWith("arrow")) {
        if (state.sel.kind === "none") return;
        e.preventDefault();
        const step = e.shiftKey ? 4 : 1;
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k] as [number, number];
        apply(nudge(state.doc, KIT, state.sel, d[0], d[1]));
      } else if (k === "escape") {
        if (state.placing) dispatch({ type: "placing", placing: null });
        else dispatch({ type: "select", sel: { kind: "none" } });
      } else if (!mod) {
        const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
        if (tool) dispatch({ type: "tool", tool: tool.id });
        else if (k === "g") dispatch({ type: "toggle", key: "grid" });
        else if (k === "s") dispatch({ type: "toggle", key: "snap" });
        else if (k === "o") dispatch({ type: "toggle", key: "overlay" });
        else if (k === "0") canvas.current?.fit();
        else if (k === "=" || k === "+") canvas.current?.zoomBy(1.25);
        else if (k === "-") canvas.current?.zoomBy(0.8);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, previewOpen, publishOpen, say]);

  // ------------------------------------------------------------------ conflict recovery
  const reloadLatest = async () => {
    try {
      const wp = await workplaceApi.get();
      if (!wp.world) return;
      dispatch({ type: "replace", doc: wp.world.draft });
      save.resolve(wp.world.draft_version, false);
      say("Loaded the latest saved version.", "info");
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not reload.");
    }
  };
  const overwrite = async () => {
    try {
      const wp = await workplaceApi.get();
      if (wp.world) save.resolve(wp.world.draft_version, true);
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not save.");
    }
  };

  return (
    <div className="we-root">
      <header className="we-bar">
        <div className="we-bar__left">
          <Link href="/company/workplace" className="we-back" aria-label="Back to workplace">
            ←
          </Link>
          <div className="we-title">
            <strong>{state.doc.name}</strong>
            <SaveBadge status={save.status} savedAt={save.savedAt} onRetry={save.retry} />
          </div>
        </div>
        <div className="we-bar__tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className="we-icon" aria-pressed={state.tool === t.id && !state.placing} title={`${t.label} (${t.key})`} aria-label={t.label} onClick={() => dispatch({ type: "tool", tool: t.id })} data-testid={`tool-${t.id}`}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
                <path d={t.icon} />
              </svg>
            </button>
          ))}
          <span className="we-sep" />
          <button type="button" className="we-icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })} data-testid="undo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg>
          </button>
          <button type="button" className="we-icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })} data-testid="redo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></svg>
          </button>
          <span className="we-sep" />
          <button type="button" className="we-icon" aria-label="Zoom out" title="Zoom out (−)" onClick={() => canvas.current?.zoomBy(0.8)} data-testid="zoom-out">−</button>
          <button type="button" className="we-zoom" title="Fit world (0)" onClick={() => canvas.current?.fit()} data-testid="zoom-level">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="we-icon" aria-label="Zoom in" title="Zoom in (+)" onClick={() => canvas.current?.zoomBy(1.25)} data-testid="zoom-in">+</button>
          <span className="we-sep" />
          <Toggle on={state.grid} label="Grid" hint="G" onClick={() => dispatch({ type: "toggle", key: "grid" })} testid="toggle-grid" />
          <Toggle on={state.snap} label="Snap" hint="S" onClick={() => dispatch({ type: "toggle", key: "snap" })} testid="toggle-snap" />
          <Toggle on={state.overlay} label="Walkable" hint="O" onClick={() => dispatch({ type: "toggle", key: "overlay" })} testid="toggle-overlay" />
        </div>
        <div className="we-bar__right">
          <button type="button" className={`we-issues-btn${errors ? " has-errors" : warnings ? " has-warnings" : ""}`} onClick={() => setIssuesOpen((v) => !v)} aria-expanded={issuesOpen} data-testid="issues-btn">
            {errors ? `${errors} error${errors > 1 ? "s" : ""}` : warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "✓ No issues"}
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setPreviewOpen(true)} data-testid="preview-btn">
            ▶ Play test
          </button>
          <button type="button" className="btn btn--small" onClick={() => setPublishOpen(true)} data-testid="publish-btn">
            Publish
          </button>
        </div>
      </header>

      {save.status === "conflict" && (
        <div className="we-conflict" role="alert" data-testid="conflict-banner">
          <span>{save.error} Your changes here aren&apos;t saved.</span>
          <button className="btn btn--small" onClick={reloadLatest}>Load latest</button>
          <button className="btn btn--ghost btn--small" onClick={overwrite}>Keep mine (overwrite)</button>
        </div>
      )}

      <div className="we-main">
        <Library state={state} dispatch={dispatch} members={members} judgeNames={judgeNames} onPlaceAtCenter={placeAtCenter} />
        <div className="we-stage">
          <EditorCanvas
            ref={canvas}
            state={state}
            dispatch={dispatch}
            kit={KIT}
            imgs={imgs}
            members={members}
            judgeNames={judgeNames}
            issues={issues}
            onToast={(t) => say(t)}
            onZoom={setZoom}
          />
          {!imgs && <div className="we-loading">Loading tiles…</div>}
          <AnimatePresence>
            {issuesOpen && (
              <m.section className="we-issues" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} aria-label="World issues" data-testid="issues-panel">
                <div className="we-issues__head">
                  <strong>World check</strong>
                  <span className="xsmall muted">
                    {errors} error{errors === 1 ? "" : "s"} block publishing · {warnings} warning{warnings === 1 ? "" : "s"} you can accept
                  </span>
                  <button className="we-x" aria-label="Close" onClick={() => setIssuesOpen(false)}>✕</button>
                </div>
                <IssueList issues={issues} onPick={focusIssue} />
              </m.section>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {toast && (
              <m.div className={`we-toast${toast.tone === "error" ? " is-error" : ""}`} role="status" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} data-testid="toast">
                {toast.text}
              </m.div>
            )}
          </AnimatePresence>
        </div>
        <aside className="we-inspector">
          <Inspector state={state} dispatch={dispatch} members={members} judgeNames={judgeNames} onToast={(t) => say(t)} onFocus={(x, y) => canvas.current?.centerOn(x, y)} />
        </aside>
      </div>

      {publishOpen && (
        <PublishDialog
          issues={issues}
          mode={currentMode}
          publishedVersion={pubVersion}
          onClose={() => setPublishOpen(false)}
          onPick={(i) => {
            setPublishOpen(false);
            focusIssue(i);
          }}
          onPublish={async (activate) => {
            if (!(await save.flush())) throw new Error(save.error ?? "Save your changes first.");
            try {
              const wp = await workplaceApi.publish(save.version(), activate);
              setPubVersion(wp.world?.published_version ?? null);
              setCurrentMode(wp.mode);
              say(activate ? "Published. New candidates now walk into this office." : "Published. Switch to it any time from Workplace.", "info");
              setPublishOpen(false);
            } catch (e) {
              if (e instanceof ApiError && e.code === "world_has_errors") {
                const list = ((e.details as { issues?: { message: string }[] })?.issues ?? []).map((x) => x.message).join(" ");
                throw new Error(`The server found problems: ${list}`);
              }
              throw e;
            }
          }}
          onLeave={() => router.push("/company/workplace")}
        />
      )}
      {previewOpen && <PreviewModal doc={state.doc} members={members} judgeNames={judgeNames} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function SaveBadge({ status, savedAt, onRetry }: { status: SaveStatus; savedAt: Date | null; onRetry: () => void }) {
  const text = {
    saved: savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "All changes saved",
    pending: "Unsaved changes",
    saving: "Saving…",
    error: "Couldn't save",
    conflict: "Not saved — conflict",
  }[status];
  return (
    <span className={`we-save is-${status}`} data-testid="save-status" data-status={status}>
      <i aria-hidden="true" />
      {text}
      {status === "error" && (
        <button type="button" className="we-linkbtn" onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  );
}

function Toggle({ on, label, hint, onClick, testid }: { on: boolean; label: string; hint: string; onClick: () => void; testid: string }) {
  return (
    <button type="button" className="we-toggle" aria-pressed={on} onClick={onClick} title={`${label} (${hint})`} data-testid={testid}>
      <i aria-hidden="true" />
      {label}
    </button>
  );
}

function IssueList({ issues, onPick }: { issues: Issue[]; onPick: (i: Issue) => void }) {
  if (!issues.length) return <p className="small" style={{ padding: "8px 12px" }}>✓ Everything checks out. Candidates can reach everyone and every tool.</p>;
  return (
    <ul className="list-reset we-issue-list">
      {issues.map((i, n) => (
        <li key={n}>
          <button type="button" onClick={() => onPick(i)} disabled={!i.target} className={`we-issue is-${i.level}`} data-testid="issue">
            <span className="we-issue__dot" aria-hidden="true" />
            <span>
              <strong>{i.message}</strong>
              <span className="xsmall muted">{i.fix}</span>
            </span>
            {i.target && <span className="xsmall mono">Show →</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PublishDialog({
  issues,
  mode,
  publishedVersion,
  onClose,
  onPick,
  onPublish,
  onLeave,
}: {
  issues: Issue[];
  mode: string | null;
  publishedVersion: number | null;
  onClose: () => void;
  onPick: (i: Issue) => void;
  onPublish: (activate: boolean) => Promise<void>;
  onLeave: () => void;
}) {
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = hasErrors(issues);
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="we-modal" role="dialog" aria-modal="true" aria-label="Publish world">
      <div className="we-modal__card">
        <h2 className="section-title">Publish this world</h2>
        <p className="small muted" style={{ margin: "6px 0 14px" }}>
          Publishing makes a snapshot candidates will play. Keep editing the draft afterwards — nothing changes for candidates until you publish again.
          {publishedVersion ? " A previous version is already published." : ""}
        </p>
        {blocked ? (
          <>
            <div className="banner banner--error">Fix these first — they would break the office in the game.</div>
            <IssueList issues={issues.filter((i) => i.level === "error")} onPick={onPick} />
          </>
        ) : (
          <>
            {warnings.length > 0 && (
              <>
                <p className="small" style={{ margin: "4px 0" }}>
                  <strong>{warnings.length} warning{warnings.length > 1 ? "s" : ""}</strong> — fine to publish if that&apos;s what you want:
                </p>
                <IssueList issues={warnings} onPick={onPick} />
              </>
            )}
            <label className="we-check">
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} data-testid="publish-activate" />
              Use this world for new candidates{mode === "custom" ? " (already your active world)" : " instead of the default office"}
            </label>
          </>
        )}
        {error && <div className="banner banner--error" role="alert">{error}</div>}
        <div className="we-actions" style={{ marginTop: 16 }}>
          <button className="btn btn--ghost btn--small" onClick={onClose}>
            {blocked ? "Back to editor" : "Cancel"}
          </button>
          {!blocked && (
            <button
              className="btn btn--small"
              disabled={busy}
              data-testid="publish-confirm"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onPublish(activate);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Publishing failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <span className="busy-dots">Publishing</span> : "Publish"}
            </button>
          )}
          {!blocked && (
            <button className="btn btn--ghost btn--small" onClick={onLeave}>
              Back to workplace
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Walk the draft in the real game engine with the judges and tools where you put them. */
function PreviewModal({ doc, members, judgeNames, onClose }: { doc: WorldDoc; members: Member[]; judgeNames: Record<string, string>; onClose: () => void }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const map = useMemo(() => compileWorld(doc, KIT, members), [doc, members]);
  const world = useMemo<WorldView>(() => {
    const characters = doc.people
      .filter((p) => p.ref.startsWith("judge:"))
      .map((p) => {
        const slot = p.ref.slice(6);
        const name = judgeNames[slot] ?? JUDGE_TITLES[slot] ?? slot;
        return {
          id: slot,
          name,
          role: JUDGE_TITLES[slot] ?? slot,
          sprite: ["manager", "qa", "coworker"].includes(slot) ? "blue_haired_woman" : "blonde_man",
          location_id: JUDGE_HOME[slot] ?? "corridor_main",
          greeting: "",
          profile: null,
          questions: [],
        } as unknown as WorldCharacter;
      });
    const objects = Object.keys(map.object_slots).map((id) => ({ id, label: KIT.catalog.assets.find((a) => a.interactive === id)?.label ?? id, location_id: "engineering_workspace", marker: "misc" }));
    return { locations: [], characters, objects, actions: [] } as unknown as WorldView;
  }, [doc, judgeNames, map]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="we-modal we-modal--play" role="dialog" aria-modal="true" aria-label="Play test">
      <div className="we-play">
        <div className="we-play__bar">
          <strong>Play test · {doc.name}</strong>
          <span className="mono xsmall">{prompt ? `E · ${prompt}` : "WASD / arrows to walk · Shift to hurry · draft, not published"}</span>
          <button className="btn btn--ghost btn--small" onClick={onClose} data-testid="preview-close">
            Close (Esc)
          </button>
        </div>
        <div className="we-play__game" data-testid="preview-game">
          <PhaserGame
            world={world}
            map={map}
            sessionId="world-preview"
            playerTexture="player"
            onPrompt={setPrompt}
            onNearCharacter={() => {}}
            onInteractCharacter={() => {}}
            onVoiceCharacter={() => {}}
            onInteractObject={() => {}}
            onLocationChange={() => {}}
            onReady={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
