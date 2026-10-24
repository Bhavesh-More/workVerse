"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { RoomImage } from "../../../components/Snap";
import { FormError } from "../../../components/AuthShell";
import { api } from "../../../lib/api";
import { useApi } from "../../../lib/useApi";
import type { ScenarioSpec } from "../../../lib/types";
import { builtLabel } from "../../../components/ContextBuilder";

const SPEC_KIND: Record<ScenarioSpec["kind"], string> = {
  major: "Core to your role",
  custom: "Your situation",
  stretch: "Stretch",
};
const FOCUS_LABEL: Record<string, string> = {
  diagnosis: "Diagnosis",
  risk_decision: "Risk-aware decisions",
  communication: "Communication",
  ownership: "Ownership",
  adaptation: "Adaptation",
};

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

const DIFFICULTIES = [
  { value: "introductory", hint: "Extra hints, forgiving timeline — great for a first go." },
  { value: "standard", hint: "A realistic day: some ambiguity, some pressure." },
  { value: "challenging", hint: "Less help, more red herrings, tighter deadlines." },
];

export default function ScenariosPage() {
  const router = useRouter();
  const { data: templateList, error: loadError, setData: setTemplateList } = useApi("/scenario-templates", api.listTemplates);
  const { data: sessionList } = useApi("/sessions", api.listSessions);
  const { data: ctx, setData: setCtx } = useApi("/me/context", api.getContext);
  const templates = templateList?.items ?? (loadError ? [] : null);
  const sessions = sessionList?.items ?? [];
  const [difficulty, setDifficulty] = useState("standard");
  const [startError, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const error = startError ?? loadError;

  // The catalog deals a random incident per card; ask again until this card gets a different one.
  async function shuffle(slug: string, current?: string) {
    setBusy(`shuffle:${slug}`);
    setError(null);
    try {
      for (let i = 0; i < 5; i++) {
        const fresh = (await api.listTemplates()).items.find((x) => x.slug === slug);
        if (fresh && (fresh.incident !== current || i === 4)) {
          setTemplateList((list) => list && { ...list, items: list.items.map((x) => (x.slug === slug ? fresh : x)) });
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not shuffle.");
    } finally {
      setBusy(null);
    }
  }

  async function start(slug: string, incident?: string) {
    setBusy(slug);
    setError(null);
    try {
      const instance = await api.createInstance({ template_slug: slug, difficulty, mode: "quick", incident });
      router.push(`/briefing/${instance.scenario_instance_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the scenario.");
      setBusy(null);
    }
  }

  async function startSpec(spec: ScenarioSpec) {
    setBusy(spec.id);
    setError(null);
    try {
      const instance = await api.createInstance({ template_slug: spec.template_slug, spec_id: spec.id, mode: "quick" });
      router.push(`/briefing/${instance.scenario_instance_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the scenario.");
      setBusy(null);
    }
  }

  async function refreshPlan() {
    setBusy("plan");
    setError(null);
    try {
      setCtx(await api.buildContext());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your scenarios.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-main">
      <m.div variants={container} initial="hidden" animate="show">
        <m.div variants={item} className="page-head">
          <span className="eyebrow">Practice</span>
          <h1 className="page-title">
            Pick a <span className="hl">scenario</span>
          </h1>
          <p className="muted small">
            Each attempt generates a fresh, validated variation with the same competency rubric — so
            retries are fair comparisons.
          </p>
        </m.div>

        <m.div variants={item} className="stack stack--sm" style={{ marginBottom: 28 }}>
          <span className="field__label" id="difficulty-label">
            Difficulty
          </span>
          <div className="seg" role="group" aria-labelledby="difficulty-label" style={{ alignSelf: "flex-start" }}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                className="seg__btn"
                onClick={() => setDifficulty(d.value)}
                aria-pressed={d.value === difficulty}
              >
                {d.value === difficulty && (
                  <m.span className="seg__thumb" layoutId="difficulty-thumb" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <span className="seg__label">{d.value}</span>
              </button>
            ))}
          </div>
          <p className="xsmall muted" aria-live="polite">
            {DIFFICULTIES.find((d) => d.value === difficulty)?.hint}
          </p>
        </m.div>

        {error && (
          <div style={{ marginBottom: 20 }}>
            <FormError message={error} />
          </div>
        )}

        {ctx && (
          <m.section variants={item} style={{ marginBottom: 48 }} aria-labelledby="made-for-you">
            <div className="row between" style={{ marginBottom: 12, alignItems: "flex-end" }}>
              <div>
                <h2 id="made-for-you" className="section-title">
                  Made for you
                </h2>
                <p className="xsmall muted" style={{ marginTop: 6 }}>
                  {ctx.status === "empty"
                    ? "Add your CV, GitHub or LinkedIn and we'll build scenarios around your background."
                    : ctx.context?.headline
                      ? `Built for: ${ctx.context.headline}. ${builtLabel(ctx)}`
                      : builtLabel(ctx)}
                </p>
              </div>
              {ctx.status === "empty" ? (
                <Link className="btn btn--small" href="/profile">
                  Build my context
                </Link>
              ) : (
                ctx.status === "stale" && (
                  <button className="btn btn--small" onClick={refreshPlan} disabled={busy !== null}>
                    {busy === "plan" ? <span className="busy-dots">Updating</span> : "Update my scenarios"}
                  </button>
                )
              )}
            </div>
            <div className="grid-2">
              {ctx.scenarios.map((s) => (
                <article key={s.id} className="card card--lift stack stack--sm" data-testid="personal-scenario">
                  <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <span className={s.kind === "custom" ? "badge badge--active" : s.kind === "stretch" ? "badge badge--warn" : "badge"}>
                      {SPEC_KIND[s.kind]}
                    </span>
                    <span className="badge">{s.difficulty}</span>
                  </div>
                  <h3 className="section-title">{s.title}</h3>
                  <p className="xsmall muted">
                    {s.track_label} at <strong>{s.company}</strong>, {s.product}
                  </p>
                  {s.story && <p className="small">{s.story}</p>}
                  {s.why && <p className="small muted">{s.why}</p>}
                  {s.kind === "custom" && ctx.custom_note && <p className="xsmall muted">{ctx.custom_note}</p>}
                  <div className="chip-row">
                    {s.focus.map((f) => (
                      <span key={f} className="badge">
                        {FOCUS_LABEL[f] ?? f}
                      </span>
                    ))}
                  </div>
                  <div>
                    <button className="btn" onClick={() => startSpec(s)} disabled={busy !== null}>
                      {busy === s.id ? <span className="busy-dots">Preparing</span> : "Start"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </m.section>
        )}

        {ctx && ctx.scenarios.length > 0 && (
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Scenario library
          </h2>
        )}
        <div className="grid-2">
          {templates === null &&
            [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 380 }} aria-hidden="true" />)}
          {templates?.map((t) => (
            <m.article key={t.id} variants={item} initial="hidden" animate="show" className="card card--lift stack" style={{ padding: 12 }}>
              <RoomImage room="desks" />
              <div className="stack stack--sm" style={{ padding: "8px 8px 4px" }}>
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <h2 className="section-title">{t.title}</h2>
                  <span className="badge">~{t.estimated_minutes} min</span>
                </div>
                <p className="small muted">{t.story ?? t.summary}</p>
                {t.you_will && (
                  <>
                    <span className="eyebrow" style={{ marginTop: 8 }}>You will</span>
                    <ul className="list-reset stack stack--sm">
                      {t.you_will.map((w) => (
                        <li key={w} className="small row" style={{ gap: 8, alignItems: "baseline", flexWrap: "nowrap" }}>
                          <span className="dot" aria-hidden="true" /> {w}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {t.people && (
                  <>
                    <span className="eyebrow" style={{ marginTop: 8 }}>Who you&apos;ll meet</span>
                    <ul className="list-reset stack stack--sm">
                      {t.people.map((p) => (
                        <li key={p.role} className="xsmall">
                          <strong>{p.role}</strong> <span className="muted">— {p.knows}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {t.report && (
                  <p className="xsmall muted" style={{ marginTop: 4 }}>
                    <span className="mono">Your report →</span> {t.report}
                  </p>
                )}
                <div className="chip-row" style={{ margin: "4px 0 8px" }}>
                  {(t.skills ?? t.categories).map((c) => (
                    <span key={c} className="badge">
                      {c.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" onClick={() => start(t.slug, t.incident)} disabled={busy !== null}>
                    {busy === t.slug ? <span className="busy-dots">Preparing</span> : "Start practice"}
                  </button>
                  {t.incident && (
                    <button
                      className="btn btn--ghost"
                      data-testid="shuffle-scenario"
                      onClick={() => shuffle(t.slug, t.incident)}
                      disabled={busy !== null}
                      title="Deal a different incident"
                    >
                      {busy === `shuffle:${t.slug}` ? <span className="busy-dots">Shuffling</span> : "⇄ Shuffle"}
                    </button>
                  )}
                </div>
              </div>
            </m.article>
          ))}
        </div>

        <m.section variants={item} style={{ marginTop: 56 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Your attempts
          </h2>
          <div className="card" style={{ paddingBlock: 6 }}>
            {sessions.length === 0 ? (
              <p className="small muted" style={{ padding: "14px 0" }}>
                No sessions yet. Start a scenario above — your attempts will collect here.
              </p>
            ) : (
              <ul className="list-reset">
                {sessions.map((s) => (
                  <li key={s.id} className="list-row">
                    <span className="small">
                      {s.title}{" "}
                      <span className="muted">
                        · {s.difficulty} · {new Date(s.created_at).toLocaleString()}
                      </span>
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={s.status === "completed" ? "badge badge--ok" : "badge badge--active"}>{s.status}</span>
                      <Link
                        className="btn btn--ghost btn--small"
                        href={s.status === "completed" ? `/session/${s.id}/debrief` : `/session/${s.id}`}
                      >
                        {s.status === "completed" ? "Report" : "Resume"}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </m.section>
      </m.div>
    </main>
  );
}
