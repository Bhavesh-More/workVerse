"use client";

// Properties of whatever is selected; edits here go through the same ops as the canvas.
import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import { KIT, JUDGE_TITLES } from "../../../lib/world/kit";
import { deleteRoom, objectRoom, resizeRoom, resizeWorld, roomContents, roomRect, setRoomFloor, stats } from "../../../lib/world/doc";
import { autoPlacePeople, connectRoom } from "../../../lib/world/presets";
import { MAX_H, MAX_W, MIN_H, MIN_W, PURPOSES, type Dir, type FloorKind, type Member, type Paint, type RoomPurpose } from "../../../lib/world/types";
import { AssetThumb, CharThumb } from "../Thumbs";
import { personLabel, sheetFor } from "./EditorCanvas";
import { deleteSelection, duplicateObjects, moveItems, nudge, selectedObjects } from "./ops";
import type { Action, EditorState } from "./store";

type Props = {
  state: EditorState;
  dispatch: Dispatch<Action>;
  members: Member[];
  judgeNames: Record<string, string>;
  onToast: (msg: string) => void;
  onFocus: (x: number, y: number) => void;
};

export function Inspector({ state, dispatch, members, judgeNames, onToast }: Props) {
  const { doc, sel } = state;
  const apply = (res: { doc: typeof doc; sel: typeof sel } | { error: string }) => {
    if ("error" in res) onToast(res.error);
    else dispatch({ type: "commit", doc: res.doc, sel: res.sel });
  };

  if (sel.kind === "items") {
    const objects = selectedObjects(doc, sel);
    const people = doc.people.filter((p) => sel.ids.includes(p.id));
    if (objects.length + people.length > 1) {
      return (
        <Panel title={`${objects.length + people.length} selected`}>
          <p className="small muted">
            {objects.length} object{objects.length === 1 ? "" : "s"}
            {people.length ? `, ${people.length} ${people.length === 1 ? "person" : "people"}` : ""}. Drag any of them, or use the arrow keys, to move them together.
          </p>
          <Actions>
            {objects.length > 0 && (
              <button className="btn btn--ghost btn--small" onClick={() => apply(duplicateObjects(doc, KIT, objects))}>
                Duplicate (⌘D)
              </button>
            )}
            <button className="btn btn--ghost btn--small we-danger" onClick={() => apply(deleteSelection(doc, sel))}>
              Delete (⌫)
            </button>
          </Actions>
        </Panel>
      );
    }
    const o = objects[0];
    if (o) {
      const a = KIT.byId.get(o.asset);
      if (!a) return <Panel title="Unknown object">This object uses a missing asset. Delete it.</Panel>;
      const room = objectRoom(doc, KIT, o);
      return (
        <Panel title={a.label} subtitle={categoryLabel(a.category)}>
          <div className="we-insp-hero">
            <AssetThumb frame={a.frame} box={72} />
            <dl className="we-dl">
              <dt>Size</dt>
              <dd>
                {a.w}×{a.h} tiles
              </dd>
              <dt>Room</dt>
              <dd>{room?.name ?? "—"}</dd>
              <dt>Movement</dt>
              <dd>{a.mount === "wall" ? "On the wall" : a.solid ? "Blocks walking" : "Walk over it"}</dd>
              {a.interactive && (
                <>
                  <dt>Scenario</dt>
                  <dd>Interactive · {a.interactive.replace(/_/g, " ")}</dd>
                </>
              )}
            </dl>
          </div>
          <Position
            x={o.x}
            y={o.y}
            onChange={(x, y) => apply(moveItems(doc, KIT, new Set([o.id]), x - o.x, y - o.y))}
            testid="insp-pos"
          />
          {(o.ox || o.oy) && a.mount === "floor" ? (
            <p className="xsmall muted">
              Free offset {o.ox ?? 0}px, {o.oy ?? 0}px.{" "}
              <button className="text-link xsmall we-linkbtn" onClick={() => dispatch({ type: "commit", doc: { ...doc, objects: doc.objects.map((x) => (x.id === o.id ? { ...x, ox: undefined, oy: undefined } : x)) } })}>
                Snap to grid
              </button>
            </p>
          ) : null}
          <Actions>
            <button className="btn btn--ghost btn--small" onClick={() => apply(duplicateObjects(doc, KIT, [o]))} disabled={!!a.interactive} title={a.interactive ? "One of a kind" : undefined} data-testid="insp-duplicate">
              Duplicate
            </button>
            <button className="btn btn--ghost btn--small we-danger" onClick={() => apply(deleteSelection(doc, sel))} data-testid="insp-delete">
              Delete
            </button>
          </Actions>
        </Panel>
      );
    }
    const p = people[0];
    if (p) {
      const kind = p.ref.startsWith("judge:") ? "AI judge" : p.ref.startsWith("member:") ? "Team member · display only" : "Office pet";
      const title = p.ref.startsWith("judge:") ? JUDGE_TITLES[p.ref.slice(6)] : p.ref.startsWith("member:") ? members.find((m) => `member:${m.id}` === p.ref)?.title : "Wanders its room";
      return (
        <Panel title={personLabel(p.ref, judgeNames, members)} subtitle={kind}>
          <div className="we-insp-hero">
            <CharThumb sheet={sheetFor(p.ref, members)} box={64} />
            <dl className="we-dl">
              <dt>Role</dt>
              <dd>{title || "—"}</dd>
              <dt>Room</dt>
              <dd>{doc.rooms.find((r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h)?.name ?? "—"}</dd>
            </dl>
          </div>
          <p className="xsmall muted">
            This sets where they <b>start</b>. Their identity{p.ref.startsWith("judge:") ? " and personality live in AI judges" : p.ref.startsWith("member:") ? " lives in your team list" : ""} and isn&apos;t changed by moving them.
          </p>
          <Position x={p.x} y={p.y} onChange={(x, y) => apply(moveItems(doc, KIT, new Set([p.id]), x - p.x, y - p.y))} testid="insp-pos" />
          <label className="field">
            <span className="field__label">Facing</span>
            <select
              className="select"
              value={p.face}
              onChange={(e) => dispatch({ type: "commit", doc: { ...doc, people: doc.people.map((x) => (x.id === p.id ? { ...x, face: e.target.value as Dir } : x)) } })}
            >
              <option value="down">Down</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="up">Up</option>
            </select>
          </label>
          <Actions>
            <button className="btn btn--ghost btn--small we-danger" onClick={() => apply(deleteSelection(doc, sel))}>
              Remove from world
            </button>
          </Actions>
        </Panel>
      );
    }
  }

  if (sel.kind === "room") {
    const r = doc.rooms.find((x) => x.id === sel.id);
    if (r) return <RoomPanel key={r.id} state={state} dispatch={dispatch} onToast={onToast} roomId={r.id} />;
  }

  if (sel.kind === "spawn") {
    return (
      <Panel title="Candidate start" subtitle="Where every candidate appears">
        <Position x={doc.spawn.x} y={doc.spawn.y} onChange={(x, y) => apply(nudge(doc, KIT, sel, x - doc.spawn.x, y - doc.spawn.y))} testid="insp-pos" />
        <p className="xsmall muted">Put it near the entrance. Everyone they need to talk to must be reachable from here.</p>
      </Panel>
    );
  }

  return <WorldPanel state={state} dispatch={dispatch} members={members} onToast={onToast} />;
}

function RoomPanel({ state, dispatch, onToast, roomId }: { state: EditorState; dispatch: Dispatch<Action>; onToast: (m: string) => void; roomId: string }) {
  const { doc } = state;
  const r = doc.rooms.find((x) => x.id === roomId)!;
  const [name, setName] = useState(r.name);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setName(r.name), [r.name]);
  const contents = roomContents(doc, KIT, r);
  const setRoom = (patch: Partial<typeof r>) => dispatch({ type: "commit", doc: { ...doc, rooms: doc.rooms.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) } });
  return (
    <Panel title={r.name} subtitle="Room">
      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          data-testid="insp-room-name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== r.name && setRoom({ name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <label className="field">
        <span className="field__label">Used for</span>
        <select className="select" value={r.purpose} onChange={(e) => setRoom({ purpose: e.target.value as RoomPurpose })}>
          {PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="field__hint xsmall muted">The scenario sends people to rooms by what they&apos;re used for.</span>
      </label>
      <div className="we-two">
        <label className="field">
          <span className="field__label">Floor</span>
          <select className="select" value={r.floor} onChange={(e) => dispatch({ type: "commit", doc: setRoomFloor(doc, r.id, e.target.value as FloorKind) })}>
            {KIT.catalog.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Walls</span>
          <select className="select" value={r.paint} onChange={(e) => setRoom({ paint: e.target.value as Paint })}>
            {KIT.catalog.paints.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="we-four">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k} className="field">
            <span className="field__label">{k === "w" ? "Width" : k === "h" ? "Height" : k.toUpperCase()}</span>
            <input
              className="input"
              type="number"
              value={r[k]}
              min={k === "w" || k === "h" ? 2 : 0}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (!Number.isFinite(v)) return;
                const rect = { ...roomRect(r), [k]: v };
                if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > doc.width || rect.y + rect.h > doc.height || rect.w < 2 || rect.h < 2) return onToast("That doesn't fit inside the world.");
                if (k === "x" || k === "y") dispatch({ type: "commit", doc: nudgeRoom(doc, r.id, rect.x - r.x, rect.y - r.y) });
                else dispatch({ type: "commit", doc: resizeRoom(doc, r.id, rect) });
              }}
            />
          </label>
        ))}
      </div>
      <p className="xsmall muted">
        {contents.objects.size} objects · {contents.people.size} people · drag the room&apos;s label or floor to move it with everything in it.
      </p>
      <Actions>
        <button
          className="btn btn--ghost btn--small"
          data-testid="insp-connect"
          onClick={() => {
            const next = connectRoom(doc, r.id);
            if (next) dispatch({ type: "commit", doc: next });
            else onToast("No other room within 5 tiles to connect to. Move it closer or use the Doorway tool.");
          }}
        >
          Add doorway to nearest room
        </button>
        {confirm ? (
          <span className="we-confirm">
            Delete {r.name} and its {contents.objects.size} objects?
            <button className="btn btn--small we-danger-fill" onClick={() => dispatch({ type: "commit", doc: deleteRoom(doc, KIT, r.id), sel: { kind: "none" } })}>
              Delete
            </button>
            <button className="btn btn--ghost btn--small" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="btn btn--ghost btn--small we-danger" onClick={() => setConfirm(true)}>
            Delete room
          </button>
        )}
      </Actions>
    </Panel>
  );
}

function nudgeRoom(doc: EditorState["doc"], id: string, dx: number, dy: number) {
  const res = nudge(doc, KIT, { kind: "room", id }, dx, dy);
  return "error" in res ? doc : res.doc;
}

function WorldPanel({ state, dispatch, members, onToast }: { state: EditorState; dispatch: Dispatch<Action>; members: Member[]; onToast: (m: string) => void }) {
  const { doc } = state;
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [name, setName] = useState(doc.name);
  useEffect(() => {
    setW(doc.width);
    setH(doc.height);
    setName(doc.name);
  }, [doc.width, doc.height, doc.name]);
  const s = stats(doc);
  const shrinking = w < doc.width || h < doc.height;
  return (
    <Panel title="World settings" subtitle="Nothing selected">
      <label className="field">
        <span className="field__label">World name</span>
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== doc.name && dispatch({ type: "commit", doc: { ...doc, name: name.trim() } })} />
      </label>
      <div className="we-two">
        <label className="field">
          <span className="field__label">Width (tiles)</span>
          <input className="input" type="number" min={MIN_W} max={MAX_W} value={w} onChange={(e) => setW(Number(e.target.value))} data-testid="world-width" />
        </label>
        <label className="field">
          <span className="field__label">Height (tiles)</span>
          <input className="input" type="number" min={MIN_H} max={MAX_H} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
      </div>
      {(w !== doc.width || h !== doc.height) && (
        <Actions>
          <button
            className="btn btn--small"
            data-testid="world-resize"
            onClick={() => {
              if (w < MIN_W || h < MIN_H || w > MAX_W || h > MAX_H) return onToast(`Worlds are ${MIN_W}–${MAX_W} by ${MIN_H}–${MAX_H} tiles.`);
              dispatch({ type: "commit", doc: resizeWorld(doc, w, h) });
            }}
          >
            {shrinking ? "Shrink world (cuts the right/bottom edge)" : "Enlarge world"}
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => { setW(doc.width); setH(doc.height); }}>
            Cancel
          </button>
        </Actions>
      )}
      <dl className="we-dl we-dl--stats">
        <dt>Rooms</dt>
        <dd>{s.rooms}</dd>
        <dt>Objects</dt>
        <dd>{s.objects}</dd>
        <dt>People</dt>
        <dd>{s.people}</dd>
        <dt>Floor tiles</dt>
        <dd>{s.floor}</dd>
      </dl>
      <Actions>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => {
            const next = autoPlacePeople(doc, KIT, members);
            if (next.people.length === doc.people.length) onToast("Everyone already has a place.");
            else dispatch({ type: "commit", doc: next });
          }}
        >
          Place everyone who isn&apos;t placed
        </button>
      </Actions>
      <div className="we-shortcuts">
        <h3 className="we-h">Shortcuts</h3>
        <ul className="list-reset xsmall">
          <li><kbd>V</kbd> select · <kbd>B</kbd> floor · <kbd>W</kbd> wall · <kbd>D</kbd> doorway · <kbd>R</kbd> room · <kbd>H</kbd> / hold <kbd>Space</kbd> pan</li>
          <li><kbd>⌘Z</kbd> undo · <kbd>⇧⌘Z</kbd> redo · <kbd>⌘D</kbd> duplicate · <kbd>⌘C</kbd>/<kbd>⌘V</kbd> copy/paste</li>
          <li><kbd>⌫</kbd> delete · arrows move (<kbd>⇧</kbd> ×4) · <kbd>G</kbd> grid · <kbd>S</kbd> snap · <kbd>0</kbd> fit · <kbd>Esc</kbd> cancel</li>
        </ul>
      </div>
    </Panel>
  );
}

function Position({ x, y, onChange, testid }: { x: number; y: number; onChange: (x: number, y: number) => void; testid?: string }) {
  return (
    <div className="we-two" data-testid={testid}>
      <label className="field">
        <span className="field__label">X</span>
        <input className="input" type="number" value={x} onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange(Math.round(Number(e.target.value)), y)} data-testid={testid ? `${testid}-x` : undefined} />
      </label>
      <label className="field">
        <span className="field__label">Y</span>
        <input className="input" type="number" value={y} onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange(x, Math.round(Number(e.target.value)))} data-testid={testid ? `${testid}-y` : undefined} />
      </label>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="we-panel" aria-label="Properties">
      {subtitle && <span className="eyebrow" style={{ marginBottom: 6 }}>{subtitle}</span>}
      <h2 className="we-panel__title" data-testid="insp-title">{title}</h2>
      <div className="we-panel__body">{children}</div>
    </section>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="we-actions">{children}</div>;
}

function categoryLabel(c: string) {
  return { desks: "Desk", seating: "Seating", tables: "Table", storage: "Storage", kitchen: "Kitchen", tech: "Equipment", plants: "Plant & decor", wall: "Wall piece", interactive: "Scenario tool" }[c] ?? c;
}
