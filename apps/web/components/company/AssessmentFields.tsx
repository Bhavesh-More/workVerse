"use client";

// Form pieces shared by the new-assessment wizard and the edit dialog: the assessment's brief
// (what candidates read), the skills it emphasises, and the deadline with its timezone.
import { useMemo } from "react";
import type { AssessmentFields } from "../../lib/company";
import { COMMON_ZONES, formatWhen, isoToZoned, localZone, zoneAbbr, zonedToIso } from "../../lib/time";

export const SKILL_OPTIONS = [
  { id: "diagnosis", name: "Problem solving", description: "Gathers facts and evidence before acting; asks targeted questions." },
  { id: "risk_decision", name: "Judgement under risk", description: "Checks what could go wrong before making a change; picks a safe option." },
  { id: "communication", name: "Communication", description: "Keeps people informed clearly: impact, what's known, next steps and timing." },
  { id: "ownership", name: "Ownership & teamwork", description: "Takes responsibility, involves the right people and follows up." },
  { id: "adaptation", name: "Adaptability", description: "Changes course when new information appears and confirms the result." },
];

export function BriefFields({ value, onChange, idPrefix = "af" }: { value: AssessmentFields; onChange: (patch: Partial<AssessmentFields>) => void; idPrefix?: string }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={id("description")}>Short description</label>
        <textarea id={id("description")} className="textarea" rows={3} maxLength={2000} value={value.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="What this assessment is and why you're asking candidates to take it." data-testid="field-description" />
      </div>
      <div className="field">
        <label htmlFor={id("expectations")}>What you want candidates to demonstrate</label>
        <textarea id={id("expectations")} className="textarea" rows={3} maxLength={2000} value={value.expectations} onChange={(e) => onChange({ expectations: e.target.value })} placeholder="e.g. Stay calm, gather facts from the team before acting, and give a clear status update." data-testid="field-expectations" />
        <span className="field__hint xsmall muted">Shown prominently on the candidate&apos;s briefing as &ldquo;What we&apos;re looking for&rdquo;.</span>
      </div>
      <SkillPicker value={value.skills} onChange={(skills) => onChange({ skills })} />
      <div className="field">
        <label htmlFor={id("instructions")}>Instructions (optional)</label>
        <textarea id={id("instructions")} className="textarea" rows={3} maxLength={3000} value={value.instructions} onChange={(e) => onChange({ instructions: e.target.value })} placeholder="Anything to know before starting: use a quiet place, headphones help for voice calls…" data-testid="field-instructions" />
      </div>
    </div>
  );
}

export function SkillPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const on = new Set(value);
  return (
    <fieldset className="af-skills">
      <legend>Skills to emphasise</legend>
      <span className="xsmall muted">All five are always scored. Pick the ones that matter most for this role; candidates see them as the focus.</span>
      <div className="af-skills__grid">
        {SKILL_OPTIONS.map((s) => (
          <label key={s.id} className={on.has(s.id) ? "is-on" : ""} data-testid={`skill-${s.id}`}>
            <input type="checkbox" checked={on.has(s.id)} onChange={() => onChange(on.has(s.id) ? value.filter((x) => x !== s.id) : [...value, s.id])} />
            <span>
              <strong>{s.name}</strong>
              <span className="xsmall muted">{s.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Deadline as a wall-clock time in a chosen zone, stored as an absolute instant. */
export function DeadlineField({ dueAt, timezone, onChange, idPrefix = "af" }: { dueAt: string | null; timezone: string | null; onChange: (v: { due_at: string | null; timezone: string | null }) => void; idPrefix?: string }) {
  const tz = timezone || localZone();
  const zones = useMemo(() => Array.from(new Set([localZone(), tz, ...COMMON_ZONES])), [tz]);
  const local = dueAt ? isoToZoned(dueAt, tz) : "";
  const past = dueAt ? new Date(dueAt).getTime() <= Date.now() : false;
  const setLocal = (v: string) => onChange({ due_at: v ? zonedToIso(v, tz) : null, timezone: tz });
  const setZone = (z: string) => onChange({ due_at: local ? zonedToIso(local, z) : null, timezone: z });
  const quick = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    const ymd = isoToZoned(d.toISOString(), tz).slice(0, 10);
    setLocal(`${ymd}T17:00`);
  };
  return (
    <fieldset className="af-deadline">
      <legend>Deadline</legend>
      <label className="we-check" style={{ marginTop: 0 }}>
        <input type="checkbox" checked={!dueAt} onChange={(e) => (e.target.checked ? onChange({ due_at: null, timezone: tz }) : quick(7))} data-testid="no-deadline" />
        No deadline
      </label>
      {dueAt !== null && (
        <>
          <div className="af-deadline__row">
            <div className="field">
              <label htmlFor={`${idPrefix}-due`}>Due (date and time)</label>
              <input id={`${idPrefix}-due`} type="datetime-local" className="input" value={local} onChange={(e) => setLocal(e.target.value)} data-testid="field-due" />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-tz`}>Timezone</label>
              <select id={`${idPrefix}-tz`} className="select" value={tz} onChange={(e) => setZone(e.target.value)} data-testid="field-tz">
                {zones.map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, " ")}{z === localZone() ? " (yours)" : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {[3, 7, 14].map((d) => (
              <button key={d} type="button" className="btn btn--ghost btn--small" onClick={() => quick(d)}>In {d} days</button>
            ))}
          </div>
          {dueAt && (
            <p className={`xsmall${past ? " jr-err" : " muted"}`} style={{ margin: 0 }} data-testid="due-summary">
              {past ? "That time has already passed. " : ""}One deadline for everyone: {formatWhen(dueAt, tz, true)} {zoneAbbr(dueAt, tz)}. Each candidate sees it in their own time.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
