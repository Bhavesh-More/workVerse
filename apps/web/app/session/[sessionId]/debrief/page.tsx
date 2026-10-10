"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppNav } from "../../../../components/AppNav";
import { RequireAuth } from "../../../../components/RequireAuth";
import { api, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";
import type { Evaluation } from "../../../../lib/types";

function ratingLabel(score: number | null, max: number) {
  if (score === null) return "not scored";
  return `${score}/${max}`;
}

function Debrief() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { token } = useAuth();
  const router = useRouter();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setEvaluation(await api.getEvaluation(token, sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report.");
    }
  }, [token, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function retry() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.retry(token, sessionId);
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
      <p className="eyebrow">Debrief · rubric {evaluation.rubric_version}</p>
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        Practice report
      </h1>
      <p className="muted small" style={{ marginBottom: 20 }}>
        {evaluation.limitations[0] ??
          "This report is formative practice feedback, not a validated predictor of job performance."}
      </p>

      {error && <div className="banner banner--error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="panel">
          <p className="eyebrow">Overall</p>
          <p className="page-title" style={{ fontSize: "2.4rem" }}>
            {evaluation.overall_score === null ? "—" : Math.round(evaluation.overall_score)}
          </p>
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
            <Link className="btn btn--ghost btn--small" href="/scenarios">
              Back to scenarios
            </Link>
          </div>
        </div>
      </div>

      <h2 className="section-title" style={{ marginBottom: 12 }}>
        Criterion feedback
      </h2>
      <div className="stack">
        {evaluation.items.map((item) => (
          <article key={item.criterion_id} className="panel stack stack--sm">
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
                {item.evidence.map((ev, idx) => (
                  <blockquote
                    key={idx}
                    style={{
                      margin: 0,
                      borderLeft: "2px solid var(--color-ink)",
                      paddingLeft: 12,
                    }}
                    className="small"
                  >
                    {ev.quote ? `“${ev.quote}”` : <em>({ev.source_type} reference)</em>}
                    <span className="muted"> — {ev.interpretation}</span>
                  </blockquote>
                ))}
              </div>
            )}
            <p className="small muted">
              <strong>Next step:</strong> {item.recommendation}
            </p>
          </article>
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

      {evaluation.validation_warnings.length > 0 && (
        <p className="small muted" style={{ marginTop: 18 }}>
          Evaluation notes: {evaluation.validation_warnings.join(" ")}
        </p>
      )}
    </main>
  );
}

export default function DebriefPage() {
  return (
    <div className="app-shell">
      <AppNav />
      <RequireAuth>
        <Debrief />
      </RequireAuth>
    </div>
  );
}
