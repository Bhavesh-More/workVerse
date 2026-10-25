"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Playfair_Display, Poppins, Press_Start_2P } from "next/font/google";
import { PixelLogo } from "./PixelLogo";

const pixelTitle = Press_Start_2P({ weight: "400", subsets: ["latin"], display: "swap" });
const serif = Playfair_Display({ weight: ["400", "500"], subsets: ["latin"], display: "swap", variable: "--hub-serif" });
const sans = Poppins({ weight: ["400", "500", "600"], subsets: ["latin"], display: "swap", variable: "--hub-sans" });

export const IMOCHA_URL = "https://www.imocha.io/";
const DEMO_URL = "https://www.imocha.io/schedule-a-demo";
const SLIDE_MS = 6500;

type Slide = { id: string; label: string; render: () => React.ReactNode };

// Plain-language deck for non-technical stakeholders; copy follows docs/iMocha.md.
const SLIDES: Slide[] = [
  {
    id: "hero",
    label: "Intro",
    render: () => (
      <div className="hub-s hub-s--hero">
        <span className="hub-eyebrow">Skills and Work Intelligence</span>
        <h2 className="hub-h1">
          The <span className="hub-grad">Context Layer</span> for Skills &amp; Work Intelligence
        </h2>
        <p className="hub-lead">Turn scattered talent data into one clear picture of what your people can do.</p>
        <a className="hub-cta" href={DEMO_URL} target="_blank" rel="noopener noreferrer">
          Talk to an Expert
        </a>
        <p className="hub-trust">Trusted by 300+ enterprises to power skills-first workforce strategy</p>
      </div>
    ),
  },
  {
    id: "proof",
    label: "Proof",
    render: () => (
      <div className="hub-s">
        <span className="hub-eyebrow">By the numbers</span>
        <h2 className="hub-h2">Look Beyond the Label</h2>
        <ul className="hub-stats list-reset">
          {[
            ["300+", "enterprises trust iMocha"],
            ["10,000+", "real-world skill evaluations"],
            ["50+", "languages supported"],
          ].map(([n, l], i) => (
            <m.li key={n} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.12 }}>
              <strong className="hub-grad">{n}</strong>
              <span>{l}</span>
            </m.li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "two",
    label: "Platform",
    render: () => (
      <div className="hub-s">
        <span className="hub-eyebrow">One platform</span>
        <h2 className="hub-h2">Two Intelligences, One Defensible View of the Workforce</h2>
        <div className="hub-duo">
          <div className="hub-panel hub-panel--skills">
            <span className="hub-tile">◎</span>
            <h3>Skills Intelligence</h3>
            <p>Who knows what — mapped, inferred by AI and validated with assessments.</p>
          </div>
          <div className="hub-panel hub-panel--work">
            <span className="hub-tile">▦</span>
            <h3>Work Intelligence</h3>
            <p>How people actually work — seen in realistic simulations like this office.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "uses",
    label: "Use cases",
    render: () => (
      <div className="hub-s">
        <span className="hub-eyebrow">Use cases</span>
        <h2 className="hub-h2">Every Talent Decision That Matters</h2>
        <ul className="hub-uses list-reset">
          {[
            ["Skills-based Hiring", "Hire for skills, not just resumes."],
            ["Skill Gap Analysis", "Uncover the gaps. Build a future-ready workforce."],
            ["Upskilling & Reskilling", "Learning journeys backed by skills data."],
            ["Internal Mobility", "Unlock the talent you already have."],
            ["Workforce Planning", "Plan your future workforce, one skill at a time."],
            ["AI-Readiness", "Evidence of AI skills, not self-rated confidence."],
          ].map(([t, d], i) => (
            <m.li key={t} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 + i * 0.06 }}>
              <strong>{t}</strong>
              <span>{d}</span>
            </m.li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "assess",
    label: "Assessments",
    render: () => (
      <div className="hub-s">
        <span className="hub-eyebrow">Skills Assessment</span>
        <h2 className="hub-h2">Validate Skills with AI-powered Precision</h2>
        <ul className="hub-chips list-reset">
          {["Coding in 30+ compilers", "AI-LogicBox", "AI-EnglishPro", "Conversational AI Interviews", "Smart Proctoring Suite", "WCAG 2.1 accessible"].map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="hub-lead">Ready-made tests for thousands of roles, in 50+ languages.</p>
      </div>
    ),
  },
  {
    id: "connect",
    label: "Integrations",
    render: () => (
      <div className="hub-s">
        <span className="hub-eyebrow">Integrations</span>
        <h2 className="hub-h2">Connected to Your HR Tech</h2>
        <div className="hub-marquee" aria-label="Workday, SAP SuccessFactors, Lightcast, Oracle">
          <div className="hub-marquee__track">
            {[0, 1].map((k) => (
              <span key={k} aria-hidden={k === 1}>
                {["Workday", "SAP SuccessFactors", "Lightcast", "Oracle"].map((p) => (
                  <b key={p}>{p}</b>
                ))}
              </span>
            ))}
          </div>
        </div>
        <p className="hub-lead">Skills data flows straight into the systems where decisions are made.</p>
      </div>
    ),
  },
  {
    id: "cta",
    label: "Get started",
    render: () => (
      <div className="hub-s hub-s--cta">
        <h2 className="hub-h1">
          Unlock Your <span className="hub-grad">Workforce Potential</span>
        </h2>
        <p className="hub-lead">Trusted, AI-powered skills validation for hiring and growth.</p>
        <div className="hub-ctas">
          <a className="hub-cta" href={IMOCHA_URL} target="_blank" rel="noopener noreferrer">
            Open iMocha ↗
          </a>
          <a className="hub-cta hub-cta--tint" href={DEMO_URL} target="_blank" rel="noopener noreferrer">
            Book a Demo
          </a>
        </div>
      </div>
    ),
  },
];

/** The iMocha Hub screen: a pixel monitor playing an iMocha website-style deck. */
export function ImochaHub({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  const go = useCallback((n: number) => {
    setDir(n >= 0 ? 1 : -1);
    setI((cur) => (cur + n + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Escape: onClose,
        ArrowRight: () => go(1),
        ArrowLeft: () => go(-1),
        " ": () => setPaused((p) => !p),
      };
      if (!keys[e.key]) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      keys[e.key]!();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, go]);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => go(1), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [i, paused, go]);

  const slide = SLIDES[i]!;
  return (
    <div className="px-backdrop" role="dialog" aria-modal="true" aria-label="iMocha Hub" onClick={onClose}>
      <m.div
        className={`hub-monitor ${serif.variable} ${sans.variable}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, transform: "scale(0.92)" }}
        animate={{ opacity: 1, transform: "scale(1)" }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="hub-browser">
          <div className="hub-chrome">
            <span className="hub-tab">
              <PixelLogo variant="mark" height={14} />
              Skills and Work Intelligence | iMocha
            </span>
            <button className="hub-x" onClick={onClose} aria-label="Close iMocha Hub">
              ✕
            </button>
          </div>
          <div className="hub-address">
            <span aria-hidden="true">🔒</span>
            <a href={IMOCHA_URL} target="_blank" rel="noopener noreferrer">
              https://www.imocha.io
            </a>
            <span className="hub-address__count">
              {i + 1} / {SLIDES.length}
            </span>
          </div>
          <nav className="hub-nav">
            <PixelLogo height={22} />
            <span className="hub-nav__links">
              {SLIDES.map((s, k) => (
                <button key={s.id} className={k === i ? "is-on" : ""} onClick={() => { setDir(k > i ? 1 : -1); setI(k); }}>
                  {s.label}
                </button>
              ))}
            </span>
            <a className="hub-cta hub-cta--sm" href={DEMO_URL} target="_blank" rel="noopener noreferrer">
              Book a Demo
            </a>
          </nav>
          <div className="hub-view" aria-live="polite">
            <AnimatePresence mode="wait" custom={dir}>
              <m.div
                key={slide.id}
                className="hub-slide"
                custom={dir}
                initial={{ opacity: 0, x: dir * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -60 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                {slide.render()}
              </m.div>
            </AnimatePresence>
            <button className="hub-arrow hub-arrow--l" onClick={() => go(-1)} aria-label="Previous slide">
              ‹
            </button>
            <button className="hub-arrow hub-arrow--r" onClick={() => go(1)} aria-label="Next slide">
              ›
            </button>
          </div>
          <div className="hub-progress" role="tablist" aria-label="Slides">
            {SLIDES.map((s, k) => (
              <button key={s.id} role="tab" aria-selected={k === i} aria-label={s.label} onClick={() => { setDir(k > i ? 1 : -1); setI(k); }}>
                <span
                  key={`${k}-${i}-${paused}`}
                  className={k < i ? "is-done" : k === i ? (paused ? "is-on is-paused" : "is-on") : ""}
                  style={{ animationDuration: `${SLIDE_MS}ms` }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className={`hub-stand ${pixelTitle.className}`}>
          <span>iMocha Hub</span>
          <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "▶ play" : "❚❚ pause"} · ← → · Esc
          </button>
        </div>
      </m.div>
    </div>
  );
}
