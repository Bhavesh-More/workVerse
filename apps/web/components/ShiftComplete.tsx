"use client";

import { useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import { play, setMusicOverride } from "../lib/sfx";
import type { WorldCharacter } from "../lib/types";

const EASE = [0.23, 1, 0.32, 1] as const;
const WORD = "SHIFT COMPLETE";

type Props = {
  characters: WorldCharacter[];
  objectives: { id: string; label: string; status: string; required: boolean }[];
  title: string;
  onDone: () => void;
};

/** Anime-style end card, same visual language as the team intro: shown after the shift is submitted. */
export function ShiftComplete({ characters, objectives, title, onDone }: Props) {
  const reduce = !!useReducedMotion();
  const [shake, setShake] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const done = objectives.filter((o) => o.status === "completed");
  const stampAt = 1300; // first objective stamp, after the title lands
  const resolvedAt = stampAt + done.length * 260 + 200;

  useEffect(() => {
    setMusicOverride("intro");
    const timers = [
      window.setTimeout(() => play("whoosh"), 0),
      window.setTimeout(() => {
        play("slam");
        setShake(true);
      }, 700),
      window.setTimeout(() => setShake(false), 1100),
      ...done.map((_, i) => window.setTimeout(() => play("stamp"), stampAt + i * 260)),
      window.setTimeout(() => play("complete"), resolvedAt),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        doneRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("keydown", onKey, true);
      setMusicOverride(null);
    };
    // Runs once per showing; the objective list is fixed by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mid = (characters.length - 1) / 2;
  return (
    <div className={`ti sc${shake && !reduce ? " is-shaking" : ""}`} role="dialog" aria-modal="true" aria-label="Shift complete">
      <div className="ti__lines" aria-hidden="true" />
      <div className="ti__halftone" aria-hidden="true" />
      <div className="ti__bars" aria-hidden="true" />
      <m.div
        className="sc__slash"
        aria-hidden="true"
        initial={{ transform: "translateX(-120%) skewX(-20deg)" }}
        animate={{ transform: "translateX(120%) skewX(-20deg)" }}
        transition={{ duration: reduce ? 0 : 0.6, ease: EASE }}
      />

      <section className="sc__body">
        <h2 className="sc__title" aria-label="Shift complete">
          {WORD.split("").map((ch, i) => (
            <m.span
              key={i}
              aria-hidden="true"
              initial={{ opacity: 0, transform: reduce ? "none" : "translateY(-60px) scale(1.8) rotate(-8deg)" }}
              animate={{ opacity: 1, transform: "translateY(0px) scale(1) rotate(0deg)" }}
              transition={{ delay: 0.45 + i * 0.035, type: "spring", duration: 0.4, bounce: 0.3 }}
            >
              {ch === " " ? " " : ch}
            </m.span>
          ))}
        </h2>

        <ul className="sc__objectives">
          {done.map((o, i) => (
            <m.li
              key={o.id}
              initial={{ opacity: 0, transform: reduce ? "none" : "translateX(-24px)" }}
              animate={{ opacity: 1, transform: "translateX(0px)" }}
              transition={{ delay: stampAt / 1000 + i * 0.26, duration: 0.25, ease: EASE }}
            >
              <m.span
                className="sc__check"
                initial={{ transform: reduce ? "none" : "scale(2.2) rotate(-20deg)" }}
                animate={{ transform: "scale(1) rotate(0deg)" }}
                transition={{ delay: stampAt / 1000 + i * 0.26, type: "spring", duration: 0.35, bounce: 0.4 }}
              >
                ✓
              </m.span>
              {o.label}
            </m.li>
          ))}
        </ul>

        <div className="ti-finale__row sc__team">
          {characters.map((c, i) => {
            const tilt = (i - mid) * 5;
            return (
              <m.div
                key={c.id}
                className="ti-finale__card"
                initial={{ opacity: 0, transform: reduce ? "none" : `translateY(60%) rotate(${tilt * 2}deg) scale(0.92)` }}
                animate={{ opacity: 1, transform: reduce ? "none" : `translateY(${Math.abs(i - mid) * 8}px) rotate(${tilt}deg) scale(1)` }}
                transition={{ delay: resolvedAt / 1000 - 0.5 + i * 0.06, type: "spring", duration: 0.55, bounce: 0.25 }}
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
          transition={{ delay: resolvedAt / 1000, type: "spring", duration: 0.4, bounce: 0.35 }}
        >
          <span>Incident resolved</span>
          {title}
        </m.div>

        <m.button
          className="btn ti-finale__go"
          data-sfx="confirm"
          autoFocus
          initial={{ opacity: 0, transform: "translateY(10px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ delay: resolvedAt / 1000 + 0.5, duration: 0.35, ease: EASE }}
          onClick={() => doneRef.current()}
        >
          See your debrief →
        </m.button>
      </section>
    </div>
  );
}
