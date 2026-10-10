"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const FEATURES = [
  {
    title: "A real office, not a form",
    body: "Walk an open-plan floor, drop into the manager's office, and use workstations and consoles to investigate a live incident.",
  },
  {
    title: "AI colleagues with scoped knowledge",
    body: "Managers, teammates and clients each know different things. Ask the right questions to uncover what matters.",
  },
  {
    title: "Server-authoritative consequences",
    body: "Every decision is validated against scenario rules. Unsafe actions are blocked — just like production.",
  },
  {
    title: "Evidence-grounded feedback",
    body: "Your debrief cites your own words and actions with exact quotes, and flags anything it can't verify.",
  },
];

const STEPS = [
  { n: "01", t: "Build your profile", d: "Tell us your target role and goals so practice stays relevant. No résumé required." },
  { n: "02", t: "Enter a scenario", d: "We generate a validated variation of a workplace challenge with a fixed rubric." },
  { n: "03", t: "Work the problem", d: "Talk to people, inspect evidence, and make decisions that have real consequences." },
  { n: "04", t: "Get a debrief", d: "See criterion-level feedback with transcript citations, then retry a fresh variant." },
];

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0 },
};

export default function HomePage() {
  return (
    <div className="grid-canvas landing">
      <div className="landing__topbar">
        <span className="landing__brand">WorkVerse AI</span>
        <div className="row">
          <Link className="btn btn--ghost btn--small" href="/login">
            Sign in
          </Link>
          <Link className="btn btn--small" href="/signup">
            Create account
          </Link>
        </div>
      </div>

      <section className="landing__hero">
        <motion.p
          className="landing__eyebrow"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ duration: 0.4 }}
        >
          Practise the work
        </motion.p>
        <motion.h1
          className="landing__title"
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          WorkVerse
        </motion.h1>
        <motion.p
          className="landing__lede"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          An AI-powered 2D workplace simulator. Step into a virtual office, work a realistic
          scenario with AI managers and teammates, and get an evidence-grounded debrief that shows
          exactly what you did well and what to improve.
        </motion.p>
        <motion.div
          className="landing__cta"
          initial="hidden"
          animate="show"
          variants={fadeUp}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          <Link className="btn" href="/signup">
            Start practising
          </Link>
          <Link className="btn btn--ghost" href="/login">
            I have an account
          </Link>
        </motion.div>
      </section>

      <motion.section
        className="landing__section"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={fadeUp}
        transition={{ duration: 0.45 }}
      >
        <p className="landing__kicker">What you get</p>
        <div className="grid-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </motion.section>

      <motion.section
        className="landing__section"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
        variants={fadeUp}
        transition={{ duration: 0.45 }}
      >
        <p className="landing__kicker">How it works</p>
        {STEPS.map((s) => (
          <div key={s.n} className="step">
            <span className="step__num">{s.n}</span>
            <div>
              <h3>{s.t}</h3>
              <p className="muted small" style={{ maxWidth: 620 }}>
                {s.d}
              </p>
            </div>
          </div>
        ))}
      </motion.section>

      <motion.section
        className="landing__section"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={fadeUp}
        transition={{ duration: 0.45 }}
      >
        <p className="landing__kicker">What we assess</p>
        <div className="grid-3">
          {["Information gathering", "Risk-aware decisions", "Stakeholder communication", "Ownership & follow-up"].map(
            (c) => (
              <div key={c} className="panel">
                <span className="small">{c}</span>
              </div>
            ),
          )}
        </div>
        <p className="muted small" style={{ marginTop: 18, maxWidth: 720 }}>
          Reports are formative practice feedback, not a validated predictor of job performance or
          hiring success. We show the evidence behind every judgement so you can disagree with it.
        </p>
      </motion.section>

      <footer className="landing__foot">
        <span>WorkVerse AI — a practice simulator</span>
        <span>Built with Next.js, FastAPI, Phaser and hosted Ollama Cloud.</span>
      </footer>
    </div>
  );
}
