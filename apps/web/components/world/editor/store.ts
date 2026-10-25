// Editor state: the committed document with undo/redo, selection, tool and view toggles.
// Drag previews never go through here (they live in the canvas), so a drag is one history entry.
import type { FloorKind, WorldDoc } from "../../../lib/world/types";

export type Tool = "select" | "floor" | "wall" | "door" | "room" | "hand";

export type Selection =
  | { kind: "none" }
  | { kind: "items"; ids: string[] }
  | { kind: "room"; id: string }
  | { kind: "spawn" };

/** Something being placed from the library (dragged, or click-to-stamp). */
export type PlacingTarget = { kind: "asset"; asset: string } | { kind: "preset"; preset: string } | { kind: "person"; ref: string };
export type Placing =
  | (PlacingTarget & {
      /** "drag": released over the canvas to place; "click": stays armed until the canvas is clicked. */
      via: "drag" | "click";
    })
  | null;

export type EditorState = {
  doc: WorldDoc;
  past: WorldDoc[];
  future: WorldDoc[];
  sel: Selection;
  tool: Tool;
  floorKind: FloorKind;
  grid: boolean;
  snap: boolean;
  overlay: boolean;
  placing: Placing;
  /** Bumped on every committed change; autosave watches it. */
  revision: number;
  clipboard: WorldDoc["objects"] | null;
};

export type Action =
  | { type: "commit"; doc: WorldDoc; sel?: Selection }
  | { type: "replace"; doc: WorldDoc }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; sel: Selection }
  | { type: "tool"; tool: Tool }
  | { type: "floorKind"; kind: FloorKind }
  | { type: "toggle"; key: "grid" | "snap" | "overlay" }
  | { type: "placing"; placing: Placing }
  | { type: "clipboard"; objects: WorldDoc["objects"] };

const HISTORY = 100;

export function initState(doc: WorldDoc): EditorState {
  return {
    doc,
    past: [],
    future: [],
    sel: { kind: "none" },
    tool: "select",
    floorKind: "oak",
    grid: true,
    snap: true,
    overlay: false,
    placing: null,
    revision: 0,
    clipboard: null,
  };
}

/** Drop selected ids that no longer exist (after undo, delete...). */
function prune(sel: Selection, doc: WorldDoc): Selection {
  if (sel.kind === "items") {
    const ids = sel.ids.filter((id) => doc.objects.some((o) => o.id === id) || doc.people.some((p) => p.id === id));
    return ids.length ? { kind: "items", ids } : { kind: "none" };
  }
  if (sel.kind === "room") return doc.rooms.some((r) => r.id === sel.id) ? sel : { kind: "none" };
  return sel;
}

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case "commit":
      if (a.doc === s.doc) return a.sel ? { ...s, sel: a.sel } : s;
      return {
        ...s,
        doc: a.doc,
        past: [...s.past.slice(-(HISTORY - 1)), s.doc],
        future: [],
        sel: prune(a.sel ?? s.sel, a.doc),
        revision: s.revision + 1,
      };
    case "replace":
      // A document loaded from the server: not undoable, doesn't trigger autosave.
      return { ...s, doc: a.doc, past: [], future: [], sel: prune(s.sel, a.doc) };
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], sel: prune(s.sel, prev), revision: s.revision + 1 };
    }
    case "redo": {
      const next = s.future[0];
      if (!next) return s;
      return { ...s, doc: next, past: [...s.past, s.doc], future: s.future.slice(1), sel: prune(s.sel, next), revision: s.revision + 1 };
    }
    case "select":
      return { ...s, sel: a.sel };
    case "tool":
      return { ...s, tool: a.tool, placing: null };
    case "floorKind":
      return { ...s, floorKind: a.kind, tool: "floor", placing: null };
    case "toggle":
      return { ...s, [a.key]: !s[a.key] };
    case "placing":
      return { ...s, placing: a.placing, tool: a.placing ? "select" : s.tool };
    case "clipboard":
      return { ...s, clipboard: a.objects };
  }
}

export const selectedIds = (sel: Selection): Set<string> => new Set(sel.kind === "items" ? sel.ids : []);
