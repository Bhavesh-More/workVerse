"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, m, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { play, setMusicOverride } from "../lib/sfx";
import type { WorldCharacter } from "../lib/types";

const EASE = [0.23, 1, 0.32, 1] as const;
const WORD = "SHIFT COMPLETE";
const TITLE_MS = 1900; // title slam before the first stat
const SLIDE_MS = 3600; // how long each stat stays up

export type ShiftStats = {
  facts: { id: string; label: string }[];
  /** How many times you spoke to each colleague (typed or voice). */
  talks: { id: string; count: number }[];
  /** Time on shift; 0 hides that slide. */
  seconds: number;
};

type Props = {
  characters: WorldCharacter[];
  objectives: { id: string; label: string; status: string; required: boolean }[];
  title: string;
  stats: ShiftStats;
  onDone: () => void;
};

/**
 * Anime-style end card, same visual language as the team intro: title slam, then a slideshow of stats
 * (one chart at a time, a few seconds each), then the team line-up and "Incident resolved".
 * Victory music + trumpet fanfare. Enter/→ skips to the next slide; Esc goes straight to the debrief.
 */
export function ShiftComplete({ characters, objectives, title, stats, onDone }: Props) {
  const reduce = !!useReducedMotion();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [shake, setShake] = useState(false);
  const done = objectives.filter((o) => o.status === "completed");
  const talks = stats.talks
    .map((t) => ({ ...t, who: characters.find((c) => c.id === t.id) }))
    .filter((t) => t.who && t.count > 0)
    .sort((a, b) => b.count - a.count);

  const slides: { kicker: string; title: string; body: ReactNode }[] = [
    { kicker: "Objectives", title: "Mission cleared", body: <Ring done={done.length} total={objectives.length} labels={done.map((o) => o.label)} reduce={reduce} /> },
    { kicker: "Evidence", title: "Clues found", body: <Clues facts={stats.facts} reduce={reduce} /> },
    ...(talks.length
      ? [{ kicker: "Teamwork", title: "Who you talked to", body: <Talks rows={talks.map((t) => ({ id: t.id, name: t.who!.name, portrait: t.who!.profile?.portrait, count: t.count }))} /> }]
      : []),
    ...(stats.seconds > 0 ? [{ kicker: "Clock", title: "Time on shift", body: <Clock seconds={stats.seconds} /> }] : []),
  ];
  const finale = slides.length;
  const [slide, setSlide] = useState(-1); // -1 title, 0..n-1 stats, n finale

  useEffect(() => {
    setMusicOverride("victory");
    play("fanfare");
    const timers = [
      window.setTimeout(() => play("whoosh"), 250),
      window.setTimeout(() => {
        play("slam");
        setShake(true);
      }, 800),
      window.setTimeout(() => setShake(false), 1200),
    ];
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      setMusicOverride(null);
    };
  }, []);

  // Advance the slideshow; each slide lands with a whoosh + trumpet, the finale with the full fanfare.
  useEffect(() => {
    if (slide === finale) {
      play("fanfare");
      const t = window.setTimeout(() => play("stamp"), 900);
      return () => window.clearTimeout(t);
    }
    if (slide >= 0) {
      play("whoosh");
      play("trumpet");
    }
    const t = window.setTimeout(() => setSlide((s) => s + 1), slide < 0 ? TITLE_MS : SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [slide, finale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter" && e.key !== "ArrowRight" && e.key !== " ") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") doneRef.current();
      else setSlide((s) => (s >= finale ? (doneRef.current(), s) : s + 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finale]);

  const mid = (characters.length - 1) / 2;
  return (
    <div className={`ti sc${shake && !reduce ? " is-shaking" : ""}`} role="dialog" aria-modal="true" aria-label="Shift complete">
      <div className="ti__lines" aria-hidden="true" />
      <div className="ti__halftone" aria-hidden="true" />
      <div className="ti__bars" aria-hidden="true" />
      {/* A fresh slash wipe for every slide change. */}
      <m.div
        key={`slash-${slide}`}
        className="sc__slash"
        aria-hidden="true"
        initial={{ transform: "translateX(-120%) skewX(-20deg)" }}
        animate={{ transform: "translateX(120%) skewX(-20deg)" }}
        transition={{ duration: reduce ? 0 : 0.55, ease: EASE }}
      />

      <section className="sc__body">
        <h2 className={`sc__title${slide >= 0 ? " is-small" : ""}`} aria-label="Shift complete">
          {WORD.split("").map((ch, i) => (
            <m.span
              key={i}
              aria-hidden="true"
              initial={{ opacity: 0, transform: reduce ? "none" : "translateY(-60px) scale(1.8) rotate(-8deg)" }}
              animate={{ opacity: 1, transform: "translateY(0px) scale(1) rotate(0deg)" }}
              transition={{ delay: 0.5 + i * 0.035, type: "spring", duration: 0.4, bounce: 0.3 }}
            >
              {ch === " " ? " " : ch}
            </m.span>
          ))}
        </h2>

        <AnimatePresence mode="wait">
          {slide >= 0 && slide < finale && (
            <m.div
              key={slide}
              className="sc-slide"
              initial={{ opacity: 0, transform: reduce ? "none" : "translateX(80px) skewX(-8deg)" }}
              animate={{ opacity: 1, transform: "translateX(0px) skewX(0deg)" }}
              exit={{ opacity: 0, transform: reduce ? "none" : "translateX(-80px) skewX(-8deg)" }}
              transition={{ duration: 0.32, ease: EASE }}
            >
              <span className="sc-slide__kicker">
                {String(slide + 1).padStart(2, "0")} / {String(finale).padStart(2, "0")} · {slides[slide]!.kicker}
              </span>
              <m.h3
                className="sc-slide__title"
                initial={{ opacity: 0, transform: reduce ? "none" : "scale(1.5) rotate(-4deg)" }}
                animate={{ opacity: 1, transform: "scale(1) rotate(-2deg)" }}
                transition={{ delay: 0.12, type: "spring", duration: 0.4, bounce: 0.3 }}
              >
                {slides[slide]!.title}
              </m.h3>
              {slides[slide]!.body}
            </m.div>
          )}

          {slide === finale && (
            <m.div key="finale" className="sc-finale" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <div className="ti-finale__row sc__team">
                {characters.map((c, i) => {
                  const tilt = (i - mid) * 5;
                  return (
                    <m.div
                      key={c.id}
                      className="ti-finale__card"
                      initial={{ opacity: 0, transform: reduce ? "none" : `translateY(60%) rotate(${tilt * 2}deg) scale(0.92)` }}
                      animate={{ opacity: 1, transform: reduce ? "none" : `translateY(${Math.abs(i - mid) * 8}px) rotate(${tilt}deg) scale(1)` }}
                      transition={{ delay: 0.1 + i * 0.06, type: "spring", duration: 0.55, bounce: 0.25 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
                      {c.profile?.portrait && <img src={c.profile.portrait} alt="" draggable={false} />}
                      <strong>{c.name}</strong>
                      <span>{c.role}</span>
                    </m.div>
                  );
                })}
              </div>
              <m.div
                className="ti-finale__stamp sc__stamp"
                initial={{ opacity: 0, transform: reduce ? "rotate(-3deg)" : "scale(1.6) rotate(-12deg)" }}
                animate={{ opacity: 1, transform: "scale(1) rotate(-3deg)" }}
                transition={{ delay: 0.9, type: "spring", duration: 0.4, bounce: 0.35 }}
              >
                <span>Incident resolved</span>
                {title}
              </m.div>
            </m.div>
          )}
        </AnimatePresence>

        {slide >= 0 && (
          <div className="sc-dots" aria-hidden="true">
            {[...slides, null].map((_, i) => (
              <i key={i} className={i === slide ? "is-on" : i < slide ? "is-past" : ""} />
            ))}
          </div>
        )}

        <div className="row" style={{ gap: 8, justifyContent: "center" }}>
          {slide < finale && (
            <button className="btn btn--ghost ti-finale__go sc__skip" data-sfx="click" onClick={() => setSlide((s) => s + 1)}>
              Next →
            </button>
          )}
          <button className="btn ti-finale__go" data-sfx="confirm" autoFocus onClick={() => doneRef.current()}>
            See your debrief →
          </button>
        </div>
      </section>
    </div>
  );
}

/** Number that counts up like the intro's stat values. */
function Count({ to, delay = 0.2, format = String }: { to: number; delay?: number; format?: (n: number) => string }) {
  const v = useMotionValue(0);
  const shown = useTransform(v, (x) => format(Math.round(x)));
  useEffect(() => {
    const c = animate(v, to, { delay, duration: 1.1, ease: EASE });
    return () => c.stop();
  }, [v, to, delay]);
  return <m.span>{shown}</m.span>;
}

function Ring({ done, total, labels, reduce }: { done: number; total: number; labels: string[]; reduce: boolean }) {
  const r = 70;
  const len = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="sc-chart sc-ring">
      <svg viewBox="0 0 180 180" width="180" height="180" aria-hidden="true">
        <circle cx="90" cy="90" r={r} className="sc-ring__track" />
        <m.circle
          cx="90"
          cy="90"
          r={r}
          className="sc-ring__fill"
          strokeDasharray={len}
          initial={{ strokeDashoffset: len }}
          animate={{ strokeDashoffset: len * (1 - pct) }}
          transition={{ delay: 0.3, duration: reduce ? 0 : 1.1, ease: EASE }}
        />
      </svg>
      <div className="sc-ring__center">
        <strong>
          <Count to={done} delay={0.3} />
        </strong>
        <span>of {total}</span>
      </div>
      <ul className="sc__objectives">
        {labels.map((l, i) => (
          <m.li
            key={l}
            initial={{ opacity: 0, transform: reduce ? "none" : "translateX(-24px)" }}
            animate={{ opacity: 1, transform: "translateX(0px)" }}
            transition={{ delay: 0.5 + i * 0.18, duration: 0.25, ease: EASE }}
          >
            <span className="sc__check">✓</span>
            {l}
          </m.li>
        ))}
      </ul>
    </div>
  );
}

function Clues({ facts, reduce }: { facts: { id: string; label: string }[]; reduce: boolean }) {
  return (
    <div className="sc-chart sc-clues">
      <strong className="sc-big">
        <Count to={facts.length} />
      </strong>
      <ul className="sc-tags">
        {facts.map((f, i) => (
          <m.li
            key={f.id}
            initial={{ opacity: 0, transform: reduce ? "none" : "scale(1.6) rotate(-6deg)" }}
            animate={{ opacity: 1, transform: `scale(1) rotate(${(i % 3) - 1}deg)` }}
            transition={{ delay: 0.4 + i * 0.16, type: "spring", duration: 0.35, bounce: 0.35 }}
          >
            {f.label}
          </m.li>
        ))}
      </ul>
    </div>
  );
}

function Talks({ rows }: { rows: { id: string; name: string; portrait?: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="sc-chart ti-stats sc-talks">
      {rows.map((r, i) => (
        <li key={r.id}>
          <span className="ti-stats__label sc-talks__who">
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
            {r.portrait && <img src={r.portrait} alt="" draggable={false} />}
            {r.name.split(" ")[0]}
          </span>
          <span className="ti-stats__track">
            <m.span
              className="ti-stats__fill"
              initial={{ clipPath: "inset(0 100% 0 0)" }}
              animate={{ clipPath: `inset(0 ${100 - (r.count / max) * 100}% 0 0)` }}
              transition={{ delay: 0.3 + i * 0.15, duration: 0.9, ease: EASE }}
            />
          </span>
          <span className="ti-stats__value">
            <Count to={r.count} delay={0.3 + i * 0.15} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Clock({ seconds }: { seconds: number }) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="sc-chart sc-clues">
      <strong className="sc-big">
        <Count to={seconds} format={fmt} />
      </strong>
      <span className="sc-slide__note">minutes on the incident</span>
    </div>
  );
}
