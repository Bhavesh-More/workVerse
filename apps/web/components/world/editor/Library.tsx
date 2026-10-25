"use client";

// Asset library: everything that can go into the world, grouped the way people think about an
// office. Cards are drag sources (drag onto the canvas) and also click-to-place for precision and
// keyboard users (Enter places at the centre of the view).
import { useMemo, useState, type Dispatch } from "react";
import Link from "next/link";
import { KIT } from "../../../lib/world/kit";
import { PRESETS } from "../../../lib/world/presets";
import { REQUIRED_OBJECTS } from "../../../lib/world/validate";
import type { AssetCategory, FloorKind, Member, WorldJudge } from "../../../lib/world/types";
import { AssetThumb, CharThumb, PresetThumb } from "../Thumbs";
import { FLOOR_SWATCH, sheetFor } from "./EditorCanvas";
import type { Action, EditorState, Placing, PlacingTarget } from "./store";

type Tab = "rooms" | "build" | "furniture" | "wall" | "interactive" | "people";

const TABS: { id: Tab; label: string }[] = [
  { id: "rooms", label: "Rooms" },
  { id: "build", label: "Build" },
  { id: "furniture", label: "Furniture" },
  { id: "wall", label: "Walls" },
  { id: "interactive", label: "Tools" },
  { id: "people", label: "People" },
];

const FURNITURE: { id: AssetCategory; label: string }[] = [
  { id: "desks", label: "Desks" },
  { id: "seating", label: "Seating" },
  { id: "tables", label: "Tables" },
  { id: "storage", label: "Storage" },
  { id: "kitchen", label: "Kitchen" },
  { id: "tech", label: "Tech & equipment" },
  { id: "plants", label: "Plants & decor" },
  { id: "imocha", label: "iMocha partner kit" },
];

type Props = {
  state: EditorState;
  dispatch: Dispatch<Action>;
  members: Member[];
  judges: WorldJudge[];
  /** Legacy companies: names are drawn per candidate. */
  judgesVary?: boolean;
  onPlaceAtCenter: (p: NonNullable<Placing>) => void;
};

export function Library({ state, dispatch, members, judges, judgesVary, onPlaceAtCenter }: Props) {
  const [tab, setTab] = useState<Tab>("rooms");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const placedInteractive = useMemo(() => {
    const s = new Set<string>();
    for (const o of state.doc.objects) {
      const a = KIT.byId.get(o.asset);
      if (a?.interactive) s.add(a.interactive);
    }
    return s;
  }, [state.doc.objects]);
  const placedPeople = useMemo(() => new Set(state.doc.people.map((p) => p.ref)), [state.doc.people]);

  /** Pointer down starts a drag once the pointer moves; a plain click arms click-to-place. */
  const source = (placing: PlacingTarget) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let started = false;
      const move = (ev: PointerEvent) => {
        if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
          started = true;
          dispatch({ type: "placing", placing: { ...placing, via: "drag" } as NonNullable<Placing> });
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (!started) dispatch({ type: "placing", placing: { ...placing, via: "click" } as NonNullable<Placing> });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPlaceAtCenter({ ...placing, via: "click" } as NonNullable<Placing>);
      }
    },
    role: "button" as const,
    tabIndex: 0,
    "aria-pressed": isArmed(state.placing, placing),
  });

  const searching = q.length > 0;
  const matches = searching ? KIT.catalog.assets.filter((a) => `${a.label} ${a.category} ${(a.tags ?? []).join(" ")}`.toLowerCase().includes(q)) : [];

  return (
    <aside className="we-library" aria-label="Library">
      <div className="we-library__search">
        <input className="input" type="search" placeholder="Search assets…" aria-label="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!searching && (
        <div className="we-tabs" role="tablist" aria-label="Library sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="we-library__body">
        {state.placing && (
          <div className="we-armed" role="status">
            {state.placing.via === "click" ? "Click the map to place · Shift-click to keep placing · Esc to cancel" : "Drop it on the map"}
          </div>
        )}
        {searching ? (
          <AssetGrid assets={matches} source={source} placedInteractive={placedInteractive} empty="No assets match." />
        ) : tab === "rooms" ? (
          <div className="we-list">
            <p className="we-hint">Drag a room onto empty space. Everything in it stays editable.</p>
            {PRESETS.map((p) => (
              <div key={p.id} className="we-preset" {...source({ kind: "preset", preset: p.id })} aria-label={`Room preset: ${p.name}`} data-testid={`lib-preset-${p.id}`}>
                <PresetThumb preset={p} width={236} />
                <div className="we-preset__meta">
                  <strong>{p.name}</strong>
                  <span className="mono xsmall muted">
                    {p.w}×{p.h} · {p.capacity}
                  </span>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn--ghost btn--small" onClick={() => dispatch({ type: "tool", tool: "room" })}>
              + Draw an empty room (R)
            </button>
          </div>
        ) : tab === "build" ? (
          <div className="we-list">
            <h3 className="we-h">Floor brush</h3>
            <p className="we-hint">Pick a floor, then drag on the map to paint it. Floor anywhere becomes walkable; walls form around it.</p>
            <div className="we-swatches">
              {KIT.catalog.floors.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="we-swatch"
                  aria-pressed={state.tool === "floor" && state.floorKind === f.id}
                  onClick={() => dispatch({ type: "floorKind", kind: f.id as FloorKind })}
                  data-testid={`lib-floor-${f.id}`}
                >
                  <i style={{ background: FLOOR_SWATCH[f.id] }} />
                  {f.label}
                </button>
              ))}
            </div>
            <h3 className="we-h">Walls & openings</h3>
            <div className="we-tools">
              <button type="button" aria-pressed={state.tool === "wall"} onClick={() => dispatch({ type: "tool", tool: "wall" })}>
                <strong>Wall brush</strong>
                <span>Drag to turn floor back into wall — partitions, corridors, private offices. (W)</span>
              </button>
              <button type="button" aria-pressed={state.tool === "door"} onClick={() => dispatch({ type: "tool", tool: "door" })} data-testid="tool-door-lib">
                <strong>Doorway</strong>
                <span>Click a wall between two rooms to open a 2-tile doorway through it. (D)</span>
              </button>
              <button type="button" aria-pressed={state.tool === "room"} onClick={() => dispatch({ type: "tool", tool: "room" })}>
                <strong>Empty room</strong>
                <span>Drag out a new room with the selected floor. (R)</span>
              </button>
            </div>
          </div>
        ) : tab === "furniture" ? (
          FURNITURE.map((c) => (
            <section key={c.id}>
              <h3 className="we-h">{c.label}</h3>
              <AssetGrid assets={KIT.catalog.assets.filter((a) => a.category === c.id)} source={source} placedInteractive={placedInteractive} />
            </section>
          ))
        ) : tab === "wall" ? (
          <>
            <p className="we-hint">Wall pieces hang on the painted wall face just above a room.</p>
            <AssetGrid assets={KIT.catalog.assets.filter((a) => a.category === "wall")} source={source} placedInteractive={placedInteractive} />
          </>
        ) : tab === "interactive" ? (
          <>
            <p className="we-hint">
              The scenario&apos;s tools. Candidates walk up to them to investigate. One of each per world; <b>required</b> ones are used by the incident.
            </p>
            <AssetGrid assets={KIT.catalog.assets.filter((a) => a.category === "interactive")} source={source} placedInteractive={placedInteractive} />
          </>
        ) : (
          <div className="we-list">
            <h3 className="we-h">AI judges</h3>
            <p className="we-hint">Simulated colleagues who talk to candidates and shape their score. Placing sets where they start.</p>
            {judges.map((j) => {
              const ref = `judge:${j.id}`;
              return (
                <div key={j.id} className="we-person" {...source({ kind: "person", ref })} data-testid={`lib-person-${j.id}`}>
                  <CharThumb sheet={j.sheet} />
                  <span>
                    <strong>{j.name}</strong>
                    <span className="xsmall muted">{judgesVary ? "AI judge · name varies per candidate" : `${j.title} · AI judge`}</span>
                  </span>
                  <span className={`badge${placedPeople.has(ref) ? " badge--ok" : ""}`}>{placedPeople.has(ref) ? "Placed" : "Not placed"}</span>
                </div>
              );
            })}
            <h3 className="we-h">Team members</h3>
            <p className="we-hint">People shown in your office for atmosphere. Display only — not logins, not judges.</p>
            {members.length === 0 && <p className="small muted">No team members yet.</p>}
            {members.map((m) => {
              const ref = `member:${m.id}`;
              return (
                <div key={m.id} className="we-person" {...source({ kind: "person", ref })} data-testid={`lib-member-${m.id}`}>
                  <CharThumb sheet={m.look} />
                  <span>
                    <strong>{m.name}</strong>
                    <span className="xsmall muted">{m.title || "Team member"}</span>
                  </span>
                  <span className={`badge${placedPeople.has(ref) ? " badge--ok" : ""}`}>{placedPeople.has(ref) ? "Placed" : "Not placed"}</span>
                </div>
              );
            })}
            <Link className="text-link small" href="/company/workplace/setup?step=people">
              Edit team members →
            </Link>
            <h3 className="we-h">Office pets</h3>
            {["cat_white", "cat_brown", "cat_brown2"].map((pet) => {
              const ref = `pet:${pet}`;
              return (
                <div key={pet} className="we-person" {...source({ kind: "person", ref })}>
                  <CharThumb sheet={pet} />
                  <span>
                    <strong>{pet === "cat_white" ? "Snow" : pet === "cat_brown" ? "Biscuit" : "Mocha"}</strong>
                    <span className="xsmall muted">Wanders its room</span>
                  </span>
                  <span className={`badge${placedPeople.has(ref) ? " badge--ok" : ""}`}>{placedPeople.has(ref) ? "Placed" : "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function AssetGrid({
  assets,
  source,
  placedInteractive,
  empty,
}: {
  assets: typeof KIT.catalog.assets;
  source: (p: PlacingTarget) => object;
  placedInteractive: Set<string>;
  empty?: string;
}) {
  if (!assets.length) return <p className="small muted">{empty ?? "Nothing here."}</p>;
  return (
    <div className="we-grid">
      {assets.map((a) => {
        const placed = a.interactive && placedInteractive.has(a.interactive);
        return (
          <div
            key={a.id}
            className={`we-card${placed ? " is-placed" : ""}`}
            title={`${a.label} · ${a.w}×${a.h}${a.solid ? " · blocks movement" : ""}`}
            {...source({ kind: "asset", asset: a.id })}
            aria-label={`${a.label}${placed ? " (already placed)" : ""}`}
            data-testid={`lib-asset-${a.id}`}
          >
            <AssetThumb frame={a.frame} box={52} />
            <span className="we-card__label">{a.label}</span>
            {a.interactive && REQUIRED_OBJECTS.includes(a.interactive) && <span className="we-card__tag">{placed ? "✓ placed" : "required"}</span>}
            {a.interactive && !REQUIRED_OBJECTS.includes(a.interactive) && placed && <span className="we-card__tag">✓ placed</span>}
          </div>
        );
      })}
    </div>
  );
}

function isArmed(cur: Placing, p: PlacingTarget): boolean {
  if (!cur || cur.kind !== p.kind) return false;
  if (cur.kind === "asset" && p.kind === "asset") return cur.asset === p.asset;
  if (cur.kind === "preset" && p.kind === "preset") return cur.preset === p.preset;
  if (cur.kind === "person" && p.kind === "person") return cur.ref === p.ref;
  return false;
}
