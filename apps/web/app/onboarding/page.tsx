"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../../lib/api";

const GOALS = [
  "production debugging",
  "incident response",
  "stakeholder communication",
  "risk management",
  "code review",
  "system design",
];
const STACK = ["Python", "FastAPI", "PostgreSQL", "Docker", "TypeScript", "React", "Git", "AWS"];
const LEVELS = ["beginner", "early_career", "intermediate", "experienced", "unspecified"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
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

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({
        display_name: displayName || undefined,
        target_role: targetRole,
        experience_level: level as never,
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
        <label htmlFor="dn">Display name</label>
        <input id="dn" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" />
      </div>
      <div className="field">
        <label htmlFor="tr">Target role</label>
        <input id="tr" className="input" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="lvl">Experience level</label>
        <select id="lvl" className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
    </div>,
    <div key="s1" className="stack">
      <div className="field">
        <label>What do you want to practise?</label>
        <div className="chip-row">
          {GOALS.map((g) => (
            <button key={g} type="button" className={`chip${goals.includes(g) ? " is-on" : ""}`} onClick={() => toggle(goals, setGoals, g)}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Preferred stack</label>
        <div className="chip-row">
          {STACK.map((s) => (
            <button key={s} type="button" className={`chip${stack.includes(s) ? " is-on" : ""}`} onClick={() => toggle(stack, setStack, s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>,
    <div key="s2" className="stack">
      <div className="field">
        <label htmlFor="ed">Education summary</label>
        <textarea id="ed" className="textarea" value={education} onChange={(e) => setEducation(e.target.value)} placeholder="Computer Science student…" />
      </div>
      <div className="field">
        <label htmlFor="ex">Experience summary</label>
        <textarea id="ex" className="textarea" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="Academic and personal projects…" />
      </div>
    </div>,
  ];

  return (
    <div className="grid-canvas">
      <div className="onboard">
        <div className="onboard__card">
          <p className="eyebrow">Welcome · step {step + 1} of 3</p>
          <h1 className="page-title">Let&apos;s set up your practice</h1>
          <p className="muted small" style={{ marginTop: 8 }}>
            This personalises scenario relevance and difficulty. It is never treated as proof of skill.
          </p>
          <div className="onboard__progress">
            <motion.span
              animate={{ width: `${((step + 1) / 3) * 100}%` }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            />
          </div>
          {error && <div className="banner banner--error" style={{ marginBottom: 16 }}>{error}</div>}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
            >
              {steps[step]}
            </motion.div>
          </AnimatePresence>
          <div className="row between" style={{ marginTop: 26 }}>
            <button className="btn btn--ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </button>
            {step < 2 ? (
              <button className="btn" onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            ) : (
              <button className="btn" onClick={finish} disabled={busy}>
                {busy ? "Saving…" : "Enter WorkVerse"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
