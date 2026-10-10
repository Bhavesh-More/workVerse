"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { RequireAuth } from "../../components/RequireAuth";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { CompetencyTrend, ProgressResponse } from "../../lib/types";

function Progress() {
  const { token } = useAuth();
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [trends, setTrends] = useState<CompetencyTrend[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.progress(token).then(setProgress).catch((e) => setError(e.message));
    api.competencies(token).then((r) => setTrends(r.items)).catch(() => {});
  }, [token]);

  if (!progress) {
    return <main className="app-main spinner">{error ?? "Loading progress…"}</main>;
  }

  const scoreBySession = new Map(progress.evaluations.map((e) => [e.session_id, e]));

  return (
    <main className="app-main">
      <p className="eyebrow">Progress</p>
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        Your practice history
      </h1>
      <p className="muted small" style={{ marginBottom: 22 }}>
        Scores are formative feedback across comparable attempts — not a prediction of job performance.
      </p>

      <div className="grid-3" style={{ marginBottom: 28 }}>
        {trends.map((t) => (
          <div key={t.criterion_id} className="panel stack stack--sm">
            <h2 className="section-title">{t.criterion_name}</h2>
            {t.sufficient_data ? (
              <>
                <p className="page-title" style={{ fontSize: "1.8rem" }}>
                  {t.average_score?.toFixed(1) ?? "—"}
                  <span className="muted small"> / {t.score_max}</span>
                </p>
                <p className="small muted">across {t.attempts} attempts</p>
              </>
            ) : (
              <p className="small muted">
                Not enough attempts yet ({t.attempts}). Complete more scenarios to see a trend.
              </p>
            )}
          </div>
        ))}
        {trends.length === 0 && (
          <p className="small muted">No competency data yet — finish a scenario to start tracking.</p>
        )}
      </div>

      <h2 className="section-title" style={{ marginBottom: 12 }}>
        Sessions
      </h2>
      {progress.sessions.length === 0 ? (
        <p className="small muted">
          No sessions yet. <Link href="/scenarios">Start practising</Link>.
        </p>
      ) : (
        <ul className="list-reset">
          {progress.sessions.map((s) => {
            const ev = scoreBySession.get(s.id);
            return (
              <li key={s.id} className="objective">
                <span>
                  <span className="muted small">
                    {s.difficulty} · {new Date(s.created_at).toLocaleString()}
                  </span>
                </span>
                <span className="row">
                  {ev ? (
                    <span className="badge badge--ok">
                      {ev.overall_score === null ? "scored" : `${Math.round(ev.overall_score)}/100`}
                    </span>
                  ) : (
                    <span className={s.status === "active" ? "badge badge--active" : "badge"}>
                      {s.status}
                    </span>
                  )}
                  <Link
                    className="btn btn--ghost btn--small"
                    href={s.status === "completed" ? `/session/${s.id}/debrief` : `/session/${s.id}`}
                  >
                    {s.status === "completed" ? "Report" : "Resume"}
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function ProgressPage() {
  return (
    <div className="app-shell">
      <AppNav />
      <RequireAuth>
        <Progress />
      </RequireAuth>
    </div>
  );
}
