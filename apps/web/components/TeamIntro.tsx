"use client";

// Anime-opening style "meet the team" sequence. One card per colleague (slash wipe → portrait
// slam → name → designation → stats → quote), then a line-up finale. Rare, first-time moment:
// this is where the motion budget is spent. Skippable at any time; reduced motion keeps fades only.
import { AnimatePresence, animate, m, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { isMuted, play, setMusicOverride } from "../lib/sfx";
import type { WorldCharacter } from "../lib/types";

const EASE = [0.22, 1, 0.36, 1] as const; // the codebase's --ease-out
const CARD_MS = 4600;

type Props = {
  characters: WorldCharacter[];
  /** Big stamp on the finale, e.g. the incident title. */
  title: string;
  /** Show only this colleague's card (from an info button), no finale. */
  only?: string;
  onDone: () => void;
  /** Called as each colleague's card is shown, so they count as "met". */
  onSeen?: (id: string) => void;
};

export function TeamIntro({ characters, title, only, onDone, onSeen }: Props) {
  const cast = only ? characters.filter((c) => c.id === only) : characters;
  const [index, setIndex] = useState(0);
  const [finale, setFinale] = useState(false);
  const reduce = useReducedMotion();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const next = useCallback(() => {
    if (finale) return doneRef.current();
    if (index < cast.length - 1) setIndex((i) => i + 1);
    else if (only) doneRef.current();
    else setFinale(true);
  }, [finale, index, cast.length, only]);

  // Auto-advance; any key/click advances sooner.
  useEffect(() => {
    if (finale) return;
    const t = window.setTimeout(next, CARD_MS);
    return () => window.clearTimeout(t);
  }, [index, finale, next]);

  // Own the keyboard while open so the game underneath doesn't move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        doneRef.current();
      } else if ([" ", "Enter", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next]);

  // Action/survival soundtrack while the intro runs, then back to the page's music.
  useEffect(() => {
    setMusicOverride("intro");
    return () => setMusicOverride(null);
  }, []);

  const c = cast[index];
  const seenRef = useRef(onSeen);
  seenRef.current = onSeen;
  useEffect(() => {
    if (c && !finale) seenRef.current?.(c.id);
  }, [c, finale]);
  if (!c) return null;

  return (
    <div className="ti" role="dialog" aria-modal="true" aria-label={only ? `${c.name}, ${c.role}` : "Meet your team"} onClick={next}>
      <div className="ti__lines" aria-hidden="true" />
      <div className="ti__halftone" aria-hidden="true" />
      <div className="ti__bars" aria-hidden="true" />
      <AnimatePresence mode="popLayout" initial={true}>
        {finale ? (
          <Finale key="finale" cast={cast} title={title} reduce={!!reduce} onStart={() => doneRef.current()} />
        ) : (
          <Card key={c.id} c={c} n={index} total={cast.length} reduce={!!reduce} />
        )}
      </AnimatePresence>

      <div className="ti__chrome" onClick={(e) => e.stopPropagation()}>
        {!finale && (
          <ol className="ti__pips" aria-label="Progress">
            {cast.map((p, i) => (
              <li key={p.id} className={i < index ? "is-done" : i === index ? "is-on" : ""}>
                {i === index && <span key={index} style={{ animationDuration: `${CARD_MS}ms` }} />}
              </li>
            ))}
          </ol>
        )}
        <button className="ti__skip" data-sfx="back" onClick={() => doneRef.current()} autoFocus>
          {only || finale ? "Close" : "Skip intro"} <span className="kbd">Esc</span>
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {finale ? "Your team is ready." : `${c.name}, ${c.role}.`}
      </p>
    </div>
  );
}

function Card({ c, n, total, reduce }: { c: WorldCharacter; n: number; total: number; reduce: boolean }) {
  const p = c.profile;
  const [shake, setShake] = useState(false);

  // The soundtrack is scheduled against the same beats as the motion below.
  useEffect(() => {
    const at = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
    const timers = [
      at(0, () => play("whoosh")),
      at(330, () => {
        play("slam");
        setShake(true);
      }),
      at(560, () => play("shimmer")),
      at(1150, () => play("stat")),
    ];
    // Their own voice says "Hello, I'm <name>" as the name lands (clips from scripts/gen_intro_voices.py).
    const portrait = c.profile?.portrait;
    const hello = portrait && !isMuted() ? new Audio(portrait.replace("/portraits/", "/voices/").replace(/\.svg$/, ".mp3")) : null;
    if (hello) timers.push(at(520, () => void hello.play().catch(() => {}))); // no clip yet: stay silent
    return () => {
      timers.forEach(window.clearTimeout);
      hello?.pause();
    };
  }, [c.profile?.portrait]);

  const from = reduce ? "none" : "translateX(18%) scale(1.18) rotate(-9deg)";
  const words = c.name.split(" ");
  let letter = 0;

  return (
    <m.section
      className={`ti-card${shake && !reduce ? " is-shaking" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateX(-6%) skewX(-8deg)" }}
      transition={{ duration: 0.26, ease: EASE }}
    >
      {/* Slash wipe + white flash: the cut into each character. */}
      {!reduce && (
        <>
          <m.div
            className="ti-card__slash"
            aria-hidden="true"
            initial={{ transform: "translateX(-170%) skewX(-24deg)" }}
            animate={{ transform: "translateX(240%) skewX(-24deg)" }}
            transition={{ duration: 0.5, ease: [0.77, 0, 0.175, 1] }}
          />
          <m.div
            className="ti-card__flash"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.34, delay: 0.3, times: [0, 0.15, 1] }}
          />
        </>
      )}

      {/* Giant outlined role, drifting — the background title card. */}
      <div className="ti-card__marquee" aria-hidden="true">
        <span>{`${c.role} · `.repeat(4)}</span>
        <span>{`${c.name} · `.repeat(4)}</span>
      </div>

      <div className="ti-card__grid">
        <div className="ti-card__text">
          <m.span
            className="ti-card__num"
            initial={{ opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ delay: 0.45, duration: 0.4, ease: EASE }}
          >
            {String(n + 1).padStart(2, "0")}
            <small>/{String(total).padStart(2, "0")}</small>
          </m.span>

          <h2 className="ti-card__name" aria-label={c.name}>
            {words.map((w, wi) => (
              <span key={wi} className={`ti-card__word${wi > 0 ? " is-outline" : ""}`} aria-hidden="true">
                {Array.from(w).map((ch) => {
                  const i = letter++;
                  return (
                    <span key={i} className="ti-card__clip">
                      <m.span
                        initial={{ transform: reduce ? "none" : "translateY(110%) rotate(8deg)", opacity: reduce ? 0 : 1 }}
                        animate={{ transform: "translateY(0%) rotate(0deg)", opacity: 1 }}
                        transition={{ delay: 0.5 + i * 0.03, duration: 0.5, ease: EASE }}
                      >
                        {ch}
                      </m.span>
                    </span>
                  );
                })}
              </span>
            ))}
          </h2>

          <m.div
            className="ti-card__role"
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ delay: 0.78, duration: 0.42, ease: EASE }}
          >
            {c.role}
          </m.div>

          {p && (
            <>
              <m.div
                className="ti-card__badges"
                initial={{ opacity: 0, transform: "translateY(8px) scale(0.94)" }}
                animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                transition={{ delay: 0.98, type: "spring", duration: 0.45, bounce: 0.3 }}
              >
                <span className="ti-badge ti-badge--exp">
                  <b>{p.years}</b> yrs exp
                </span>
                {p.traits.map((t) => (
                  <span key={t} className="ti-badge">
                    {t}
                  </span>
                ))}
              </m.div>

              <m.ul
                className="ti-stats"
                initial={{ opacity: 0, transform: "translateY(10px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ delay: 1.05, duration: 0.35, ease: EASE }}
              >
                {Object.entries(p.stats).map(([k, v], i) => (
                  <Stat key={k} label={k} value={v} delay={1.1 + i * 0.09} />
                ))}
              </m.ul>

              <m.div
                initial={{ opacity: 0, transform: reduce ? "none" : "translateX(-14px) scale(0.96)" }}
                animate={{ opacity: 1, transform: "translateX(0px) scale(1)" }}
                transition={{ delay: 1.45, type: "spring", duration: 0.4, bounce: 0.25 }}
              >
                <Typewriter className="ti-card__quote" text={`“${c.greeting}”`} delay={1.6} />
              </m.div>

              <m.dl
                className="ti-card__facts"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2.1, duration: 0.4 }}
              >
                <div>
                  <dt>Personality</dt>
                  <dd>{p.personality}</dd>
                </div>
                <div>
                  <dt>Knows about</dt>
                  <dd>{p.knows}</dd>
                </div>
                <div>
                  <dt>★ Special move</dt>
                  <dd>{p.power}</dd>
                </div>
                <div>
                  <dt>⚠ Weak spot</dt>
                  <dd>{p.weakness}</dd>
                </div>
              </m.dl>
            </>
          )}
        </div>

        <m.figure
          className="ti-card__portrait"
          initial={{ opacity: 0, transform: from, filter: reduce ? "none" : "blur(10px)" }}
          animate={{ opacity: 1, transform: reduce ? "none" : "translateX(0%) scale(1) rotate(-4deg)", filter: "blur(0px)" }}
          transition={{ delay: 0.12, type: "spring", duration: 0.5, bounce: 0.18 }}
        >
          <span className="ti-card__backpanel" aria-hidden="true" />
          {!reduce && (
            <m.span
              className="ti-card__impact"
              aria-hidden="true"
              initial={{ opacity: 0, transform: "translate(-50%, -50%) scale(0.6)" }}
              animate={{ opacity: [0, 1, 0], transform: "translate(-50%, -50%) scale(1.7)" }}
              transition={{ delay: 0.33, duration: 0.6, ease: EASE }}
            />
          )}
          <div className="ti-card__frame">
            <span className="ti-card__burst" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG, no optimisation needed */}
            {p?.portrait && <img src={p.portrait} alt="" draggable={false} />}
            <span className="ti-card__frame-dots" aria-hidden="true" />
            <span className="ti-card__frame-shine" aria-hidden="true" />
            <span className="ti-card__plate" aria-hidden="true">
              {words[0]}
            </span>
          </div>
          {p && (
            <m.span
              className="ti-card__level"
              aria-hidden="true"
              initial={{ opacity: 0, transform: "scale(1.5) rotate(-30deg)" }}
              animate={{ opacity: 1, transform: "scale(1) rotate(-12deg)" }}
              transition={{ delay: 0.95, type: "spring", duration: 0.4, bounce: 0.4 }}
            >
              <small>LV</small>
              {p.years}
            </m.span>
          )}
          <figcaption aria-hidden="true">{c.role.split(" ").pop()}</figcaption>
        </m.figure>
      </div>
    </m.section>
  );
}

function Stat({ label, value, delay }: { label: string; value: number; delay: number }) {
  const v = useMotionValue(0);
  const shown = useTransform(v, (x) => Math.round(x));
  useEffect(() => {
    const c = animate(v, value, { delay, duration: 0.9, ease: EASE });
    return () => c.stop();
  }, [v, value, delay]);
  return (
    <li>
      <span className="ti-stats__label">{label}</span>
      <span className="ti-stats__track">
        <m.span
          className="ti-stats__fill"
          initial={{ clipPath: "inset(0 100% 0 0)" }}
          animate={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
          transition={{ delay, duration: 0.9, ease: EASE }}
        />
      </span>
      <m.span className="ti-stats__value">{shown}</m.span>
    </li>
  );
}

function Typewriter({ text, delay, className }: { text: string; delay: number; className: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let i = 0;
    let timer = 0;
    const start = window.setTimeout(function tick() {
      i += 1;
      setCount(i);
      if (i % 2 === 0) play("type");
      if (i < text.length) timer = window.setTimeout(tick, 18);
    }, delay * 1000);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(timer);
    };
  }, [text, delay]);
  return (
    <p className={className} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, count)}</span>
      <span className="ti-caret" aria-hidden="true" />
    </p>
  );
}

function Finale({ cast, title, reduce, onStart }: { cast: WorldCharacter[]; title: string; reduce: boolean; onStart: () => void }) {
  useEffect(() => {
    play("whoosh");
    const t1 = window.setTimeout(() => play("stamp"), 650);
    const t2 = window.setTimeout(() => play("complete"), 1250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  const mid = (cast.length - 1) / 2;
  return (
    <m.section className="ti-finale" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <m.p
        className="ti-finale__eyebrow"
        initial={{ opacity: 0, transform: "translateY(10px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        Your team for this shift
      </m.p>
      <div className="ti-finale__row">
        {cast.map((c, i) => {
          const tilt = (i - mid) * 5;
          return (
            <m.div
              key={c.id}
              className="ti-finale__card"
              initial={{ opacity: 0, transform: reduce ? "none" : `translateY(60%) rotate(${tilt * 2}deg) scale(0.92)` }}
              animate={{ opacity: 1, transform: reduce ? "none" : `translateY(${Math.abs(i - mid) * 10}px) rotate(${tilt}deg) scale(1)` }}
              transition={{ delay: 0.12 + i * 0.07, type: "spring", duration: 0.55, bounce: 0.25 }}
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
        className="ti-finale__stamp"
        initial={{ opacity: 0, transform: reduce ? "rotate(-3deg)" : "scale(1.6) rotate(-12deg)" }}
        animate={{ opacity: 1, transform: "scale(1) rotate(-3deg)" }}
        transition={{ delay: 0.62, type: "spring", duration: 0.4, bounce: 0.35 }}
      >
        <span>Incident</span>
        {title}
      </m.div>
      <m.button
        className="btn ti-finale__go"
        data-sfx="confirm"
        initial={{ opacity: 0, transform: "translateY(10px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ delay: 1.2, duration: 0.35, ease: EASE }}
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
      >
        Start shift →
      </m.button>
    </m.section>
  );
}
