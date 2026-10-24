"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { api } from "../../../lib/api";
import { LEVELS, toggle } from "../../../lib/practice";
import type { Profile } from "../../../lib/types";
import { AuthShell, FormError } from "../../../components/AuthShell";
import { RoleSelect, toolsFor } from "../../../components/RoleSelect";

const GOALS = [
  "production debugging",
  "incident response",
  "stakeholder communication",
  "risk management",
  "code review",
  "system design",
];
const STEP_TITLES = ["Where you're headed", "What you want to practise", "A little background"];

function ChipToggle({ value, on, onClick }: { value: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      <span className="chip__check" aria-hidden="true">
        ✓
      </span>
      {value}
    </button>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [targetRole, setTargetRole] = useState("Junior Backend Engineer");
  const [level, setLevel] = useState("early_career");
  const [goals, setGoals] = useState<string[]>(["production debugging"]);
  const [stack, setStack] = useState<string[]>(["Python", "FastAPI"]);
  const [education, setEducation] = useState("");
  const [experience, setExperience] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMe()
      .then((p) => {
        if (p.target_role) router.replace("/dashboard");
        else if (p.display_name) setDisplayName(p.display_name);
      })
      .catch(() => {});
  }, [router]);

  function go(delta: number) {
    setDirection(delta);
    setStep((s) => Math.min(2, Math.max(0, s + delta)));
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({
        display_name: displayName || undefined,
        target_role: targetRole,
        experience_level: level as Profile["experience_level"],
        career_goals: goals,
        preferred_stack: stack,
        education_summary: education || undefined,
        experience_summary: experience || undefined,
      });
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
      setBusy(false);
    }
  }

  const steps = [
    <div key="s0" className="stack">
      <div className="field">
        <label htmlFor="dn">What should colleagues call you?</label>
        <input id="dn" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" autoComplete="nickname" />
      </div>
      <div className="field">
        <label htmlFor="tr">Target role</label>
        <RoleSelect
          id="tr"
          value={targetRole}
          onChange={(role) => {
            setTargetRole(role);
            // Keep only picked tools that still apply to the new role.
            setStack((prev) => prev.filter((t) => toolsFor(role).includes(t)));
          }}
        />
        <span className="field__hint">The job you&apos;re aiming for — your first one counts.</span>
      </div>
      <div className="field">
        <label htmlFor="lvl">Experience level</label>
        <select id="lvl" className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
    </div>,
    <div key="s1" className="stack stack--lg">
      <div className="field">
        <span className="field__label" id="goals-label">
          What do you want to practise?
        </span>
        <div className="chip-row" role="group" aria-labelledby="goals-label">
          {GOALS.map((g) => (
            <ChipToggle key={g} value={g} on={goals.includes(g)} onClick={() => setGoals(toggle(goals, g))} />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field__label" id="stack-label">
          Tools you know (or are learning)
        </span>
        <span className="field__hint">Picked for {targetRole.trim() || "your role"}.</span>
        <div className="chip-row" role="group" aria-labelledby="stack-label">
          {toolsFor(targetRole).map((s) => (
            <ChipToggle key={s} value={s} on={stack.includes(s)} onClick={() => setStack(toggle(stack, s))} />
          ))}
        </div>
      </div>
    </div>,
    <div key="s2" className="stack">
      <div className="field">
        <label htmlFor="ed">Education (optional)</label>
        <textarea id="ed" className="textarea" value={education} onChange={(e) => setEducation(e.target.value)} placeholder="Second-year Computer Science student…" />
      </div>
      <div className="field">
        <label htmlFor="ex">Projects or experience (optional)</label>
        <textarea id="ex" className="textarea" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="Hackathon API, a course project with Postgres, an internship…" />
      </div>
    </div>,
  ];

  return (
    <AuthShell wide>
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="eyebrow" style={{ margin: 0 }}>
          Step {step + 1} of 3 · {STEP_TITLES[step]}
        </span>
      </div>
      <h1 className="page-title">
        Let&apos;s set up your <span className="hl">practice</span>
      </h1>
      <p className="muted small" style={{ marginTop: 12 }}>
        This only tunes which scenarios you get and how hard they are. It&apos;s never treated as
        proof of skill.
      </p>
      <div className="track" style={{ margin: "24px 0 28px" }} aria-hidden="true">
        <m.span
          initial={false}
          animate={{ width: `${((step + 1) / 3) * 100}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        />
      </div>
      <FormError message={error} />
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <m.div
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: 24 * direction }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 * direction }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginTop: error ? 16 : 0 }}
        >
          {steps[step]}
        </m.div>
      </AnimatePresence>
      <div className="row between" style={{ marginTop: 32 }}>
        <button className="btn btn--ghost" onClick={() => go(-1)} disabled={step === 0}>
          Back
        </button>
        {step < 2 ? (
          <button className="btn" onClick={() => go(1)} disabled={step === 0 && !targetRole.trim()}>
            Next <span className="arrow" aria-hidden="true">→</span>
          </button>
        ) : (
          <button className="btn" onClick={finish} disabled={busy}>
            {busy ? <span className="busy-dots">Saving</span> : <>Enter WorkVerse <span className="arrow" aria-hidden="true">→</span></>}
          </button>
        )}
      </div>
    </AuthShell>
  );
}
