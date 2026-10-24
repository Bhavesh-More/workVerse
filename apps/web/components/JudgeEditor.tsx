"use client";

// Edits the five AI judges' personalities on top of a template. Names are picked from the
// existing cast (each has a portrait and a matching voice), never typed.
import type { JudgeCatalog, JudgeConfig, JudgeMap } from "../lib/company";

const SLOT_TITLES: Record<string, string> = {
  manager: "Manager",
  teammate: "Senior teammate",
  qa: "QA / reviewer",
  client_pm: "Client stakeholder",
  coworker: "Friendly coworker",
};

export function JudgeEditor({
  catalog,
  track,
  value,
  onChange,
  base,
  baseLabel = "company default",
}: {
  catalog: JudgeCatalog;
  track: string;
  value: JudgeMap;
  onChange: (next: JudgeMap) => void;
  /** Layer under `value` (company defaults when editing a topic). */
  base?: JudgeMap;
  baseLabel?: string;
}) {
  const set = (slot: string, patch: Partial<JudgeConfig>) => {
    const cur = { ...(value[slot] ?? {}), ...patch };
    for (const k of Object.keys(cur) as (keyof JudgeConfig)[]) if (cur[k] === "" || cur[k] === undefined) delete cur[k];
    const next = { ...value, [slot]: cur };
    if (!Object.keys(cur).length) delete next[slot];
    onChange(next);
  };
  const reset = (slot: string) => {
    const next = { ...value };
    delete next[slot];
    onChange(next);
  };

  return (
    <div className="judge-grid">
      {catalog.slots.map((slot) => {
        const tmpl = slot.defaults[track] ?? slot.defaults.backend!;
        const inherited = { ...tmpl, ...(base?.[slot.id] ?? {}) };
        const own = value[slot.id] ?? {};
        const eff = { ...inherited, ...own };
        // No name picked anywhere = each candidate meets a random member of the cast for this role.
        const chosen = own.name ?? base?.[slot.id]?.name ?? "";
        const portrait = (slot.names.find((n) => n.name === chosen) ?? slot.names[0])?.portrait;
        const customised = Object.keys(own).length > 0;
        const strict = Number(eff.strictness ?? 3);
        const id = (f: string) => `judge-${slot.id}-${f}`;
        return (
          <section key={slot.id} className="card judge-card" data-testid={`judge-${slot.id}`}>
            <div className="judge-card__head">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={portrait} alt="" width={56} height={56} />
              <div>
                <span className="eyebrow" style={{ marginBottom: 6 }}>{SLOT_TITLES[slot.id] ?? slot.id}</span>
                <div className="section-title">{chosen || "Random cast member"}</div>
                <div className="judge-card__role">{tmpl.role} · knows: {tmpl.knows}</div>
              </div>
              <span className={`badge${customised ? " badge--active" : ""}`}>
                {customised ? "Custom" : base?.[slot.id] ? baseLabel : "Default"}
              </span>
            </div>

            <div className="field">
              <label htmlFor={id("name")}>Name</label>
              <select id={id("name")} className="select" value={chosen} onChange={(e) => set(slot.id, { name: e.target.value })}>
                <option value="">Random — varies per candidate</option>
                {slot.names.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name} ({n.gender})
                  </option>
                ))}
              </select>
              <span className="field__hint xsmall muted">Names come from the existing cast so the portrait and voice match.</span>
            </div>

            <div className="field">
              <label htmlFor={id("tone")}>Tone</label>
              <select id={id("tone")} className="select" value={eff.tone} onChange={(e) => set(slot.id, { tone: e.target.value })}>
                {catalog.tones.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id[0]!.toUpperCase() + t.id.slice(1)} — {t.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor={id("strictness")}>How demanding · {strict}/5</label>
              <div className="judge-strict">
                <input
                  id={id("strictness")}
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={strict}
                  onChange={(e) => set(slot.id, { strictness: Number(e.target.value) })}
                />
                <span className="mono xsmall">{["", "Helpful", "Easy", "Balanced", "Tough", "Very tough"][strict]}</span>
              </div>
              <span className="field__hint xsmall muted">
                {catalog.strictness.find((s) => s.level === strict)?.description}
              </span>
            </div>

            <div className="field">
              <label htmlFor={id("personality")}>Personality</label>
              <textarea
                id={id("personality")}
                className="textarea"
                rows={3}
                placeholder={inherited.personality}
                value={own.personality ?? ""}
                onChange={(e) => set(slot.id, { personality: e.target.value })}
              />
              <span className="field__hint xsmall muted">Leave empty to keep the {base?.[slot.id]?.personality ? baseLabel : "default"} shown in grey.</span>
            </div>

            <div className="field">
              <label htmlFor={id("focus")}>What they probe for</label>
              <textarea
                id={id("focus")}
                className="textarea"
                rows={2}
                placeholder={inherited.focus || "e.g. Pushes for an ETA and asks how sure the candidate is."}
                value={own.focus ?? ""}
                onChange={(e) => set(slot.id, { focus: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor={id("greeting")}>Opening line</label>
              <input
                id={id("greeting")}
                className="input"
                placeholder={inherited.greeting}
                value={own.greeting ?? ""}
                onChange={(e) => set(slot.id, { greeting: e.target.value })}
              />
            </div>

            {customised && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => reset(slot.id)}>
                Reset to {base?.[slot.id] ? baseLabel : "default"}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
