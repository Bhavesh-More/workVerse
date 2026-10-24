"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { api } from "../../../lib/api";
import { LEVELS, toggle } from "../../../lib/practice";
import type { ContextSource, ContextView, DocumentKind, Profile } from "../../../lib/types";
import { AuthShell, FormError } from "../../../components/AuthShell";
import { RoleSelect, toolsFor } from "../../../components/RoleSelect";
import { ContextSummary, DocumentUpload, SITUATION_EXAMPLES, SourceStatus } from "../../../components/ContextBuilder";

const GOALS = [
  "production debugging",
  "incident response",
  "stakeholder communication",
  "risk management",
  "code review",
  "system design",
];
const STEP_TITLES = [
  "Where you're headed",
  "What you want to practise",
  "Your background",
  "A situation to experience",
  "Building your scenarios",
];
const LAST_INPUT_STEP = 3;
const BUILD_STEPS = [
  "Saving your profile",
  "Reading your GitHub, LinkedIn and website",
  "Building your learner context",
  "Picking your scenarios",
];

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
  const [github, setGithub] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [situation, setSituation] = useState("");
  const [docs, setDocs] = useState<Partial<Record<DocumentKind, ContextSource>>>({});
  const [buildStep, setBuildStep] = useState(-1);
  const [view, setView] = useState<ContextView | null>(null);
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
    setStep((s) => Math.min(LAST_INPUT_STEP, Math.max(0, s + delta)));
  }

  // A CV usually lists the learner's GitHub / LinkedIn / website: pre-fill any empty link field.
  function onDocument(kind: DocumentKind, source: ContextSource | null) {
    setDocs((d) => ({ ...d, [kind]: source ?? undefined }));
    const links = source?.links ?? {};
    if (links.github) setGithub((v) => v || links.github!);
    if (links.linkedin) setLinkedin((v) => v || links.linkedin!);
    if (links.portfolio) setPortfolio((v) => v || links.portfolio!);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    setDirection(1);
    setStep(LAST_INPUT_STEP + 1);
    try {
      setBuildStep(0);
      await api.updateMe({
        display_name: displayName || undefined,
        target_role: targetRole,
        experience_level: level as Profile["experience_level"],
        career_goals: goals,
        preferred_stack: stack,
        education_summary: education || undefined,
        experience_summary: experience || undefined,
        github_url: github.trim() || null,
        linkedin_url: linkedin.trim() || null,
        portfolio_url: portfolio.trim() || null,
        custom_situation: situation.trim() || null,
      });
      setBuildStep(1);
      setView(await api.refreshSources());
      setBuildStep(2);
      // One build call makes both the context and the plan; move the label on partway through.
      const later = setTimeout(() => setBuildStep(3), 6000);
      try {
        setView(await api.buildContext());
      } finally {
        clearTimeout(later);
      }
      setBuildStep(BUILD_STEPS.length);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Your profile is saved — you can rebuild your scenarios from your profile page.`
          : "Could not build your scenarios.",
      );
    } finally {
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
      <p className="xsmall muted">
        We read these to build your learner context — what you know, what you&apos;ve built and what to
        train next. All optional; from files we keep only the extracted text.
      </p>
      <DocumentUpload kind="cv" label="CV / résumé" hint="PDF, Word or text, up to 5 MB." source={docs.cv} onChange={(s) => onDocument("cv", s)} />
      <div className="field">
        <label htmlFor="gh">GitHub</label>
        <input id="gh" className="input" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="github.com/your-username" autoComplete="url" />
      </div>
      <div className="field">
        <label htmlFor="li">LinkedIn</label>
        <input id="li" className="input" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/your-name" autoComplete="url" />
        <span className="field__hint">LinkedIn often blocks automated reading — add its PDF below for the best result.</span>
      </div>
      <DocumentUpload
        kind="linkedin_pdf"
        label="LinkedIn PDF (optional)"
        hint="On your LinkedIn profile: More → Save to PDF."
        source={docs.linkedin_pdf}
        onChange={(s) => onDocument("linkedin_pdf", s)}
      />
      <div className="field">
        <label htmlFor="pf">Portfolio or personal website</label>
        <input id="pf" className="input" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="https://you.dev" autoComplete="url" />
      </div>
      <div className="field">
        <label htmlFor="ed">Education (optional)</label>
        <textarea id="ed" className="textarea" value={education} onChange={(e) => setEducation(e.target.value)} placeholder="Second-year Computer Science student…" />
      </div>
      <div className="field">
        <label htmlFor="ex">Projects or experience (optional)</label>
        <textarea id="ex" className="textarea" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="Hackathon API, a course project with Postgres, an internship…" />
      </div>
    </div>,
    <div key="s3" className="stack">
      <div className="field">
        <label htmlFor="sit">Is there a situation you want to experience? (optional)</label>
        <textarea
          id="sit"
          className="textarea"
          value={situation}
          maxLength={1000}
          onChange={(e) => setSituation(e.target.value)}
          placeholder="Describe a moment at work you'd like to rehearse…"
        />
        <span className="field__hint">
          We always cover the major situations of your role. This adds one scenario built around your moment.
        </span>
      </div>
      <div className="chip-row" role="group" aria-label="Examples">
        {SITUATION_EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" aria-pressed={situation === ex} onClick={() => setSituation(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </div>,
    <div key="s4" className="stack" aria-live="polite">
      <ol className="list-reset stack stack--sm ctx-steps">
        {BUILD_STEPS.map((label, i) => (
          <li key={label} data-state={buildStep > i ? "done" : buildStep === i ? "active" : "pending"} className="small">
            <span aria-hidden="true">{buildStep > i ? "✓" : buildStep === i && busy ? "•" : "○"}</span>
            {buildStep === i && busy ? <span className="busy-dots">{label}</span> : label}
          </li>
        ))}
      </ol>
      {view && view.sources.length > 0 && (
        <ul className="list-reset stack stack--sm">
          {view.sources.map((s) => (
            <SourceStatus key={s.kind} source={s} />
          ))}
        </ul>
      )}
      {view?.context && !busy && (
        <div className="card card--flat stack stack--sm">
          <ContextSummary view={view} />
          <p className="xsmall muted">{view.scenarios.length} personalised scenarios are waiting on your Practice page.</p>
        </div>
      )}
    </div>,
  ];

  const building = step > LAST_INPUT_STEP;
  const shownStep = Math.min(step, LAST_INPUT_STEP) + 1;

  return (
    <AuthShell wide>
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="eyebrow" style={{ margin: 0 }}>
          {building ? STEP_TITLES[step] : `Step ${shownStep} of ${LAST_INPUT_STEP + 1} · ${STEP_TITLES[step]}`}
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
          animate={{ width: `${(shownStep / (LAST_INPUT_STEP + 1)) * 100}%` }}
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
        {building ? (
          <>
            <button className="btn btn--ghost" onClick={() => setStep(LAST_INPUT_STEP)} disabled={busy}>
              Back
            </button>
            <button className="btn" onClick={() => router.push(view?.scenarios.length ? "/scenarios" : "/dashboard")} disabled={busy}>
              {busy ? <span className="busy-dots">Building</span> : <>Enter WorkVerse <span className="arrow" aria-hidden="true">→</span></>}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn--ghost" onClick={() => go(-1)} disabled={step === 0}>
              Back
            </button>
            {step < LAST_INPUT_STEP ? (
              <button className="btn" onClick={() => go(1)} disabled={step === 0 && !targetRole.trim()}>
                Next <span className="arrow" aria-hidden="true">→</span>
              </button>
            ) : (
              <button className="btn" onClick={finish} disabled={busy}>
                Build my scenarios <span className="arrow" aria-hidden="true">→</span>
              </button>
            )}
          </>
        )}
      </div>
    </AuthShell>
  );
}
