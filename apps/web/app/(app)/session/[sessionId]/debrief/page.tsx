"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { m } from "framer-motion";
import { CountUp } from "../../../../../components/CountUp";
import { FormError } from "../../../../../components/AuthShell";
import { api, ApiError } from "../../../../../lib/api";
import type { Evaluation } from "../../../../../lib/types";
import { preloadGame } from "../../../../../game/preload";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

function Pips({ score, max }: { score: number | null; max: number }) {
  return (
    <span className="pips" role="img" aria-label={score === null ? "Not scored" : `${score} out of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <m.span
          key={i}
          className={score !== null && i < score ? "is-on" : ""}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3 + i * 0.06, type: "spring", stiffness: 500, damping: 22 }}
        />
      ))}
    </span>
  );
}

export default function DebriefPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvaluation(await api.getEvaluation(sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report.");
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.retry(sessionId);
      router.push(`/session/${res.session.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a retry.");
      setBusy(false);
    }
  }

  if (!evaluation) {
    return (
      <main className="app-main">
        {error ? (
          <FormError message={error} />
        ) : (
          <div className="stack" aria-label="Loading report">
            <div className="skeleton" style={{ height: 110, maxWidth: 560 }} />
            <div className="grid-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 170 }} />
              ))}
            </div>
          </div>
        )}
      </main>
    );
  }

  const scored = evaluation.items.filter((i) => i.status === "scored");
  const strengths = scored.filter((i) => (i.score ?? 0) >= 3);
  const improvements = scored.filter((i) => (i.score ?? 0) < 3);

  return (
    <main className="app-main">
      <m.div variants={container} initial="hidden" animate="show">
        <m.div variants={item} className="page-head">
          <span className="eyebrow">Debrief · rubric {evaluation.rubric_version}</span>
          <h1 className="page-title">Practice report</h1>
          <p className="muted small">
            {evaluation.limitations[0] ??
              "This report is formative practice feedback, not a validated predictor of job performance."}
          </p>
        </m.div>

        <FormError message={error} />

        <m.div variants={item} className="grid-3" style={{ margin: "0 0 48px" }}>
          <div className="card">
            <span className="eyebrow">Overall</span>
            <p className="stat" style={{ fontSize: 72 }}>
              <CountUp value={evaluation.overall_score === null ? null : Math.round(evaluation.overall_score)} />
            </p>
            <p className="xsmall muted" style={{ marginTop: 8 }}>
              {evaluation.score_scale.interpretation}
              {evaluation.evaluator_model ? ` · model ${evaluation.evaluator_model}` : ""}
            </p>
          </div>
          <div className="card">
            <span className="eyebrow">In short</span>
            <p className="small">{evaluation.summary}</p>
          </div>
          <div className="card stack stack--sm">
            <span className="eyebrow">What next</span>
            <button className="btn btn--block" onClick={retry} disabled={busy} onMouseEnter={preloadGame} onFocus={preloadGame}>
              {busy ? <span className="busy-dots">Starting</span> : "Retry a variant"}
            </button>
            <Link className="btn btn--ghost btn--block" href="/progress">
              View progress
            </Link>
            <Link className="btn btn--ghost btn--block" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </m.div>

        {(strengths.length > 0 || improvements.length > 0) && (
          <m.div variants={item} className="grid-2" style={{ marginBottom: 48 }}>
            <div className="card stack stack--sm">
              <h2 className="section-title">
                <span className="hl">Keep doing</span>
              </h2>
              {strengths.length === 0 ? (
                <p className="small muted">Nothing rated highly yet — that&apos;s what retries are for.</p>
              ) : (
                <ul className="list-reset stack stack--sm">
                  {strengths.map((i) => (
                    <li key={i.criterion_id} className="small row" style={{ gap: 8 }}>
                      <span className="dot" aria-hidden="true" /> {i.criterion_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card stack stack--sm">
              <h2 className="section-title">Try next time</h2>
              {improvements.length === 0 ? (
                <p className="small muted">No weak spots detected this attempt.</p>
              ) : (
                <ul className="list-reset stack stack--sm">
                  {improvements.map((i) => (
                    <li key={i.criterion_id} className="small row" style={{ gap: 8 }}>
                      <span className="dot" style={{ background: "var(--color-ember)" }} aria-hidden="true" /> {i.criterion_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </m.div>
        )}

        <m.h2 variants={item} className="section-title" style={{ marginBottom: 12 }}>
          Criterion feedback
        </m.h2>
        <div className="stack">
          {evaluation.items.map((it) => (
            <m.article key={it.criterion_id} variants={item} className="card stack">
              <div className="row between">
                <h3 className="section-title" style={{ fontSize: 18 }}>
                  {it.criterion_name}
                </h3>
                <span className="row" style={{ gap: 10 }}>
                  {it.status === "scored" ? (
                    <Pips score={it.score} max={it.score_max} />
                  ) : (
                    <span className="badge badge--warn">{it.status.replace(/_/g, " ")}</span>
                  )}
                  {it.score !== null && (
                    <span className="mono">
                      {it.score}/{it.score_max}
                    </span>
                  )}
                </span>
              </div>
              <p className="small">{it.explanation}</p>
              {it.evidence.length > 0 && (
                <div className="stack stack--sm">
                  <span className="eyebrow" style={{ margin: 0 }}>
                    Evidence from your session
                  </span>
                  {it.evidence.map((ev, i) => (
                    <blockquote key={i} className="evidence">
                      {ev.quote ? <q>{ev.quote}</q> : <em>({ev.source_type} reference)</em>}
                      <span className="muted"> — {ev.interpretation}</span>
                    </blockquote>
                  ))}
                </div>
              )}
              <p className="small" style={{ paddingTop: 12, borderTop: "1px solid var(--color-hairline)" }}>
                <span className="mono" style={{ marginRight: 8 }}>
                  Next step →
                </span>
                <span className="muted">{it.recommendation}</span>
              </p>
            </m.article>
          ))}
        </div>
      </m.div>
    </main>
  );
}
