"use client";

import { useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { SAMPLE_CSV_NAME, SAMPLE_CSV_URL, analyzeBank, type QuestionPlan, type Slot } from "../../lib/questionBank";

const STEPS = ["Reading your questions", "Mapping them to scored skills", "Assigning them to your AI colleagues", "Designing the assessment"];
const SLOT_LABEL: Record<Slot, string> = { manager: "Manager", teammate: "Teammate", client: "Client / PM" };

/** Which scenario colleague plays each asking role, from the topic preview's team. */
function colleagues(team: { name: string; role: string }[]): Record<Slot, string> {
  const find = (re: RegExp) => team.find((t) => re.test(t.role.toLowerCase()))?.name;
  return {
    manager: find(/manager|lead|head/) ?? "Your manager",
    client: find(/client|product|pm|customer|stakeholder/) ?? "The client",
    teammate: find(/engineer|developer|teammate|analyst|qa/) ?? "A teammate",
  };
}

/** Optional CSV question bank: upload (or inject the sample), "AI" analysis, and the plan it applies. */
export function QuestionBank({
  plan,
  onChange,
  team,
}: {
  plan: QuestionPlan | null;
  onChange: (plan: QuestionPlan | null) => void;
  team: { name: string; role: string }[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(-1); // -1 idle, 0..3 analysing
  const [error, setError] = useState<string | null>(null);
  const who = colleagues(team);

  async function run(csv: string, name: string) {
    setError(null);
    onChange(null);
    let result: QuestionPlan;
    try {
      result = analyzeBank(csv, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that CSV.");
      return;
    }
    // Demo pacing so the analysis reads as a process, not a flash.
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i);
      await new Promise((r) => setTimeout(r, 550));
    }
    setStep(-1);
    onChange(result);
  }

  async function injectSample() {
    try {
      const res = await fetch(SAMPLE_CSV_URL);
      await run(await res.text(), SAMPLE_CSV_NAME);
    } catch {
      setError("Could not load the sample CSV.");
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 100_000) {
      setError("That CSV is too large (100 KB max).");
      return;
    }
    await run(await file.text(), file.name);
    if (fileRef.current) fileRef.current.value = "";
  }

  const busy = step >= 0;
  return (
    <section className="card stack qb" data-testid="question-bank">
      <div className="row between" style={{ alignItems: "flex-start", gap: 16 }}>
        <div>
          <span className="eyebrow" style={{ margin: 0 }}>Question bank · optional</span>
          <h3 className="section-title" style={{ margin: "6px 0 0" }}>Bring your own questions</h3>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            Upload a CSV. We tailor the scenario, scoring and colleagues to it.
          </p>
        </div>
        <a className="text-link xsmall" href={SAMPLE_CSV_URL} download>
          Download sample CSV
        </a>
      </div>

      {!plan && !busy && (
        <div className="qb-drop">
          <button type="button" className="btn" onClick={injectSample} data-testid="qb-sample">
            Use sample CSV
          </button>
          <label className="btn btn--ghost">
            Upload CSV
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} data-testid="qb-upload" />
          </label>
          <span className="xsmall muted">Columns: skill, question, ask_by, look_for, difficulty</span>
        </div>
      )}
      {error && <div className="banner banner--error small" role="alert">{error}</div>}

      <AnimatePresence mode="wait">
        {busy && (
          <m.ol key="steps" className="list-reset qb-steps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-live="polite">
            {STEPS.map((s, i) => (
              <li key={s} data-state={i < step ? "done" : i === step ? "active" : "pending"}>
                <span className="qb-steps__dot" aria-hidden="true">{i < step ? "✓" : ""}</span>
                {s}
                {i === step && <span className="busy-dots" />}
              </li>
            ))}
          </m.ol>
        )}

        {plan && !busy && (
          <m.div key="plan" className="stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="qb-plan">
            <div className="qb-file">
              <span className="badge badge--ok">AI analysis ✓</span>
              <strong>{plan.source}</strong>
              <span className="small muted">{plan.questions.length} questions</span>
              <button type="button" className="text-link xsmall" onClick={() => onChange(null)} style={{ marginLeft: "auto" }}>
                Remove
              </button>
            </div>
            <p className="qb-summary">{plan.summary}</p>

            <div>
              <span className="eyebrow">Skills this bank scores</span>
              <ul className="list-reset qb-skills">
                {plan.skills.map((s) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <span className="qb-bar">
                      <m.i initial={{ width: 0 }} animate={{ width: `${(s.count / plan.skills[0]!.count) * 100}%` }} transition={{ duration: 0.6 }} />
                    </span>
                    <span className="mono xsmall">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <span className="eyebrow">Who asks what</span>
              <div className="qb-agents">
                {(Object.keys(SLOT_LABEL) as Slot[]).map((slot) => (
                  <div key={slot} className="qb-agent">
                    <div className="qb-agent__head">
                      <strong>{who[slot]}</strong>
                      <span className="chip">{SLOT_LABEL[slot]} · {plan.bySlot[slot].length}</span>
                    </div>
                    <ul className="list-reset">
                      {plan.bySlot[slot].slice(0, 3).map((q) => (
                        <li key={q.id}>
                          <span className="small">“{q.question}”</span>
                          <span className="xsmall muted">{q.skill}</span>
                        </li>
                      ))}
                    </ul>
                    {plan.bySlot[slot].length > 3 && (
                      <details className="disclosure">
                        <summary className="xsmall">{plan.bySlot[slot].length - 3} more</summary>
                        <ul className="list-reset">
                          {plan.bySlot[slot].slice(3).map((q) => (
                            <li key={q.id}>
                              <span className="small">“{q.question}”</span>
                              <span className="xsmall muted">{q.skill}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="eyebrow">Assessment design</span>
              <ol className="list-reset qb-rounds">
                {plan.rounds.map((r, i) => (
                  <li key={r.title}>
                    <span className="qb-rounds__n">{i + 1}</span>
                    <div>
                      <strong>{r.title}</strong> <span className="xsmall muted">· {r.questions} questions</span>
                      <p className="small muted" style={{ margin: "2px 0 0" }}>{r.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <p className="xsmall muted" style={{ margin: 0 }}>
              Applied: skill emphasis is set from this bank. Candidates never see the bank; your AI colleagues ask these in the office.
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}
