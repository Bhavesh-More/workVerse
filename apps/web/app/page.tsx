"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, m } from "framer-motion";
import { Snap, Sprite } from "../components/Snap";

const GOALS = [
  "my first production incident",
  "telling my manager bad news",
  "a rollback under pressure",
  "a clear status update",
  "asking the right questions",
];

const STEPS = [
  {
    t: "Tell us where you're headed",
    d: "Pick a target role and what you want to get better at. No résumé, no test — it only tunes the scenario.",
  },
  {
    t: "Walk into the office",
    d: "A fresh, validated variation of a real workplace moment. Same rubric every time, so retries are fair.",
  },
  {
    t: "Work it like it's real",
    d: "Talk to colleagues by text or voice, check the logs, make the call. Unsafe moves get blocked — like production would.",
  },
  {
    t: "Read the receipts",
    d: "Your debrief quotes your own words and actions for every judgement. Disagree? The evidence is right there.",
  },
];

const FEATURES = [
  {
    t: "A real office, not a quiz",
    d: "Move around a pixel-art floor, drop into the manager's office, pull up the deploy console. Finding things out is part of the job.",
  },
  {
    t: "Colleagues who know different things",
    d: "Your manager knows the deadline. Your teammate knows what shipped. Nobody hands you the answer — you have to ask.",
  },
  {
    t: "Consequences, minus the pager",
    d: "Decisions are checked against scenario rules on the server. Get it wrong and you'll see why — nobody gets woken up.",
  },
  {
    t: "Feedback that shows its working",
    d: "Every score cites your transcript and flags anything it couldn't verify. Formative practice, not a hiring verdict.",
  },
];

const SKILLS = [
  "Information gathering",
  "Risk-aware decisions",
  "Stakeholder communication",
  "Ownership & follow-up",
];

const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };

function RotatingGoal() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % GOALS.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ position: "relative", display: "block", overflow: "hidden" }}>
      <AnimatePresence mode="wait" initial={false}>
        <m.span
          key={i}
          className="pill-cta__goal"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {GOALS[i]}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

export default function HomePage() {
  return (
    <div>
      <header className="topbar">
        <Link href="/" className="topbar__brand">
          WorkVerse
        </Link>
        <nav className="topbar__links" aria-label="Site">
          <a className="ghost-link hide-sm" href="#how">
            How it works
          </a>
          <a className="ghost-link hide-sm" href="#assess">
            What we assess
          </a>
          <Link className="ghost-link" href="/login">
            Log-in
          </Link>
          <Link className="btn btn--small" href="/signup">
            <span className="dot dot--live" aria-hidden="true" />
            Sign-up
          </Link>
        </nav>
      </header>

      {/* Above the fold animates with CSS so it paints before any JS hydrates (better LCP). */}
      <section className="hero">
        <h1 className="display rise">WorkVerse</h1>
        <div className="hero__tagline rise" style={{ ["--d" as string]: "80ms" }}>
          <p className="lede">
            <strong>Your first incident shouldn&apos;t be your first incident.</strong>
          </p>
          <p className="lede">
            Practise on-call, status updates and tricky conversations with AI colleagues in a
            pixel-art office.
          </p>
          <p className="hero__qualifier mono muted">
            <span className="dot" aria-hidden="true" />
            For students &amp; early-career engineers
          </p>
        </div>
      </section>

      <div className="board">
        <div className="rise" style={{ ["--d" as string]: "270ms" }}>
          <Snap room="reception" note="09:02" />
        </div>
        <div className="rise" style={{ ["--d" as string]: "340ms" }}>
          <Snap room="engineering" note="Sev-2 open" />
        </div>
        <div className="rise" style={{ ["--d" as string]: "410ms" }}>
          <Snap room="manager" note="Door's open" />
        </div>
        <div className="rise" style={{ ["--d" as string]: "480ms" }}>
          <figure className="snap">
            <div className="snap__img" style={{ display: "grid", placeItems: "center", aspectRatio: "1", background: "var(--color-canvas)" }}>
              <Sprite name="blonde_man" size={84} label="Your character" />
            </div>
            <figcaption>
              <span>You</span>
              <span className="muted">Day 1</span>
            </figcaption>
          </figure>
        </div>
        <div className="rise board__cta" style={{ ["--d" as string]: "550ms" }}>
          <Link href="/signup" className="pill-cta" aria-label="Start practising — create a free account">
            <span className="pill-cta__text">
              <span className="pill-cta__label">I want to practise</span>
              <RotatingGoal />
            </span>
            <span className="btn">
              Start <span className="arrow" aria-hidden="true">→</span>
            </span>
          </Link>
        </div>
        <div className="rise" style={{ ["--d" as string]: "620ms" }}>
          <figure className="snap">
            <div className="snap__img" style={{ display: "grid", placeItems: "center", aspectRatio: "1", background: "var(--color-canvas)" }}>
              <Sprite name="blue_haired_woman" size={84} label="An AI teammate" />
            </div>
            <figcaption>
              <span>Teammate</span>
              <span className="muted">AI</span>
            </figcaption>
          </figure>
        </div>
      </div>

      <m.section
        id="how"
        className="section"
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
      >
        <m.div className="section__head" variants={rise}>
          <span className="eyebrow">How it works</span>
          <h2 className="page-title">
            Brief. Attempt. <span className="hl">Debrief.</span> Retry.
          </h2>
        </m.div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <m.div key={s.t} className="card card--lift step" variants={rise}>
              <span className="step__num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.t}</h3>
              <p className="small muted">{s.d}</p>
            </m.div>
          ))}
        </div>
      </m.section>

      <m.section
        className="section"
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
      >
        <m.div className="section__head" variants={rise}>
          <span className="eyebrow">Why it&apos;s different</span>
          <h2 className="page-title">
            A safe place to get it <span className="hl">wrong</span> first.
          </h2>
        </m.div>
        <div className="grid-2">
          {FEATURES.map((f) => (
            <m.div key={f.t} className="card card--lift" variants={rise}>
              <h3 className="section-title" style={{ marginBottom: 8 }}>
                {f.t}
              </h3>
              <p className="small muted">{f.d}</p>
            </m.div>
          ))}
        </div>
      </m.section>

      <m.section
        id="assess"
        className="section"
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
      >
        <m.div className="section__head" variants={rise}>
          <span className="eyebrow">What we assess</span>
          <h2 className="page-title">The skills nobody grades you on in class.</h2>
        </m.div>
        <m.div className="chip-row" variants={rise}>
          {SKILLS.map((s) => (
            <span key={s} className="chip chip--static" style={{ padding: "12px 18px", fontSize: 13 }}>
              {s}
            </span>
          ))}
        </m.div>
        <m.p className="small muted" style={{ marginTop: 24, maxWidth: 640 }} variants={rise}>
          Reports are formative practice feedback — not a validated predictor of job performance or
          hiring success. We show the evidence behind every judgement so you can push back on it.
        </m.p>
      </m.section>

      <m.section
        className="section"
        variants={rise}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.5 }}
      >
        <div className="row between" style={{ alignItems: "flex-end", gap: 24 }}>
          <h2 className="display" style={{ fontSize: "clamp(48px, 8vw, 96px)" }}>
            Ready for <span className="hl">day one</span>?
          </h2>
          <div className="row">
            <Link className="ghost-link" href="/login">
              I have an account
            </Link>
            <Link className="btn" href="/signup">
              Start practising <span className="arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </m.section>

      <footer className="footer mono muted">
        <span>WorkVerse — practice for your first job in tech</span>
        <span>Formative feedback, not a hiring score</span>
      </footer>
    </div>
  );
}
