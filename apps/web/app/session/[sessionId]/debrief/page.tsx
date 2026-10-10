"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api, ApiError } from "../../../../lib/api";
import type { Evaluation } from "../../../../lib/types";

function ratingLabel(score: number | null, max: number) {
  return score === null ? "not scored" : `${score}/${max}`;
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
    return <main className="app-main spinner">{error ?? "Loading report…"}</main>;
  }

  const scored = evaluation.items.filter((i) => i.status === "scored");
  const strengths = scored.filter((i) => (i.score ?? 0) >= 3);
  const improvements = scored.filter((i) => (i.score ?? 0) < 3);

  return (
    <main className="app-main">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <p className="eyebrow">Debrief · rubric {evaluation.rubric_version}</p>
        <h1 className="page-title" style={{ marginBottom: 8 }}>
          Practice report
        </h1>
        <p className="muted small" style={{ marginBottom: 20 }}>
          {evaluation.limitations[0] ?? "This report is formative practice feedback, not a validated predictor of job performance."}
        </p>

        {error && <div className="banner banner--error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="grid-3" style={{ marginBottom: 24 }}>
          <div className="panel">
            <p className="eyebrow">Overall</p>
            <motion.p
              className="page-title"
              style={{ fontSize: "2.4rem" }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
            >
              {evaluation.overall_score === null ? "—" : Math.round(evaluation.overall_score)}
            </motion.p>
            <p className="small muted">
              {evaluation.score_scale.interpretation}
              {evaluation.evaluator_model ? ` · model ${evaluation.evaluator_model}` : ""}
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow">Summary</p>
            <p className="small">{evaluation.summary}</p>
          </div>
          <div className="panel">
            <p className="eyebrow">Actions</p>
            <div className="stack stack--sm">
              <button className="btn btn--small" onClick={retry} disabled={busy}>
                {busy ? "Starting…" : "Retry a variant"}
              </button>
              <Link className="btn btn--ghost btn--small" href="/progress">
                View progress
              </Link>
              <Link className="btn btn--ghost btn--small" href="/dashboard">
                Dashboard
              </Link>
            </div>
          </div>
        </div>

        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Criterion feedback
        </h2>
        <div className="stack">
          {evaluation.items.map((item, idx) => (
            <motion.article
              key={item.criterion_id}
              className="panel stack stack--sm"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <div className="row between">
                <h3 className="section-title">{item.criterion_name}</h3>
                <span className={item.status === "scored" ? "badge badge--active" : "badge badge--warn"}>
                  {ratingLabel(item.score, item.score_max)} · {item.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="small">{item.explanation}</p>
              {item.evidence.length > 0 && (
                <div className="stack stack--sm">
                  <span className="eyebrow" style={{ fontSize: 9 }}>
                    Evidence
                  </span>
                  {item.evidence.map((ev, i) => (
                    <blockquote key={i} style={{ margin: 0, borderLeft: "2px solid var(--color-ink)", paddingLeft: 12 }} className="small">
                      {ev.quote ? `“${ev.quote}”` : <em>({ev.source_type} reference)</em>}
                      <span className="muted"> — {ev.interpretation}</span>
                    </blockquote>
                  ))}
                </div>
              )}
              <p className="small muted">
                <strong>Next step:</strong> {item.recommendation}
              </p>
            </motion.article>
          ))}
        </div>

        {(strengths.length > 0 || improvements.length > 0) && (
          <div className="grid-2" style={{ marginTop: 24 }}>
            <div className="panel stack stack--sm">
              <h2 className="section-title">Strengths</h2>
              {strengths.length === 0 ? (
                <p className="small muted">None rated highly this attempt.</p>
              ) : (
                <ul className="list-reset">
                  {strengths.map((i) => (
                    <li key={i.criterion_id} className="small">
                      {i.criterion_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel stack stack--sm">
              <h2 className="section-title">Opportunities</h2>
              {improvements.length === 0 ? (
                <p className="small muted">No weak criteria detected.</p>
              ) : (
                <ul className="list-reset">
                  {improvements.map((i) => (
                    <li key={i.criterion_id} className="small">
                      {i.criterion_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </main>
  );
}
