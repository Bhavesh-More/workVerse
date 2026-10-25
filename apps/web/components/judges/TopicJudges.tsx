"use client";

// A topic's judges, for companies with their own roster: every configured judge is listed, the
// company picks who takes part in this scenario, and can tune each one's behaviour for it.
import { useState } from "react";
import type { JudgeCatalog, JudgeConfig, JudgeMap, RosterJudge } from "../../lib/company";
import { avatarOf } from "./JudgeRoster";

const STRICT_LABEL = ["", "Helpful", "Easy", "Balanced", "Tough", "Very tough"];

export function TopicJudges({
  catalog,
  roster,
  selected,
  tuning,
  onChange,
}: {
  catalog: JudgeCatalog;
  roster: RosterJudge[];
  /** null = everyone. */
  selected: string[] | null;
  tuning: JudgeMap;
  onChange: (next: { judge_ids: string[] | null; judges: JudgeMap }) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const on = new Set(selected ?? roster.map((j) => j.id));
  const team = roster.filter((j) => on.has(j.id));
  const roleLabel = (r: string) => catalog.roles.find((x) => x.id === r)?.label ?? r;
  const missing = catalog.roles.filter((r) => !team.some((j) => j.role === r.id));

  const toggle = (id: string) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = roster.map((j) => j.id).filter((x) => next.has(x));
    onChange({ judge_ids: ids.length === roster.length ? null : ids, judges: tuning });
  };
  const tune = (id: string, patch: Partial<JudgeConfig>) => {
    const cur: JudgeConfig = { ...(tuning[id] ?? {}), ...patch };
    for (const k of Object.keys(cur) as (keyof JudgeConfig)[]) if (cur[k] === "" || cur[k] === undefined) delete cur[k];
    const next = { ...tuning, [id]: cur };
    if (!Object.keys(cur).length) delete next[id];
    onChange({ judge_ids: selected, judges: next });
  };

  return (
    <div className="stack">
      <div className="tj-summary" data-testid="topic-judge-summary">
        <strong>{team.length} of {roster.length} judges</strong> in this scenario.
        {team.length === 0 ? (
          <span className="jr-err"> Pick at least one judge.</span>
        ) : (
          missing.length > 0 && (
            <span className="muted">
              {" "}Nobody plays {missing.map((r) => r.label.toLowerCase()).join(", ")} — {team[0]!.name} will also know what they know, so the incident stays solvable.
            </span>
          )
        )}
      </div>
      <ul className="list-reset tj-list">
        {roster.map((j) => {
          const av = avatarOf(catalog, j.avatar);
          const t = tuning[j.id] ?? {};
          const eff = { ...j, ...t };
          const tuned = Object.keys(t).length > 0;
          const isOn = on.has(j.id);
          const id = (f: string) => `tj-${j.id}-${f}`;
          return (
            <li key={j.id} className={`tj-card${isOn ? " is-on" : ""}`} data-testid={`topic-judge-${j.id}`}>
              <div className="tj-card__head">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {av && <img src={av.portrait} alt="" width={48} height={48} />}
                <span className="tj-card__who">
                  <strong>{j.name}</strong>
                  <span className="xsmall muted">{roleLabel(j.role)} · {catalog.voices.find((v) => v.id === j.voice)?.label.split(" - ")[0]} voice</span>
                </span>
                {tuned && isOn && <span className="badge badge--active">Tuned</span>}
                <label className="tj-switch">
                  <input type="checkbox" checked={isOn} onChange={() => toggle(j.id)} aria-label={`${j.name} takes part in this scenario`} data-testid={`topic-judge-toggle-${j.id}`} />
                  <span aria-hidden="true" />
                  <span className="xsmall">{isOn ? "In scenario" : "Not included"}</span>
                </label>
              </div>
              {isOn && (
                <button type="button" className="text-link xsmall tj-more" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)} data-testid={`topic-judge-tune-${j.id}`}>
                  {open === j.id ? "Hide behaviour" : "Tune behaviour for this topic"}
                </button>
              )}
              {isOn && open === j.id && (
                <div className="tj-tune">
                  <div className="jr-grid">
                    <div className="field">
                      <label htmlFor={id("tone")}>Tone</label>
                      <select id={id("tone")} className="select" value={eff.tone} onChange={(e) => tune(j.id, { tone: e.target.value === j.tone ? undefined : e.target.value })}>
                        {catalog.tones.map((x) => (
                          <option key={x.id} value={x.id}>{x.id[0]!.toUpperCase() + x.id.slice(1)} — {x.description}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={id("strict")}>How demanding · {eff.strictness}/5 · {STRICT_LABEL[Number(eff.strictness)]}</label>
                      <input id={id("strict")} type="range" min={1} max={5} value={Number(eff.strictness)} onChange={(e) => tune(j.id, { strictness: Number(e.target.value) === j.strictness ? undefined : Number(e.target.value) })} />
                    </div>
                  </div>
                  {(
                    [
                      ["personality", "Personality", 3, 600],
                      ["focus", "What they probe for", 2, 400],
                      ["greeting", "Opening line", 2, 300],
                    ] as const
                  ).map(([key, label, rows, max]) => (
                    <div className="field" key={key}>
                      <label htmlFor={id(key)}>{label}</label>
                      <textarea id={id(key)} className="textarea" rows={rows} maxLength={max} placeholder={j[key]} value={t[key] ?? ""} onChange={(e) => tune(j.id, { [key]: e.target.value })} data-testid={`topic-judge-${key}-${j.id}`} />
                    </div>
                  ))}
                  <p className="xsmall muted" style={{ margin: 0 }}>
                    Empty fields keep {j.name}&apos;s settings from AI judges (shown in grey).
                    {tuned && (
                      <>
                        {" "}
                        <button type="button" className="text-link xsmall" onClick={() => onChange({ judge_ids: selected, judges: Object.fromEntries(Object.entries(tuning).filter(([k]) => k !== j.id)) })}>
                          Reset to AI judges settings
                        </button>
                      </>
                    )}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
