"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api } from "../../lib/api";
import type { CompetencyTrend, ProgressResponse } from "../../lib/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [trends, setTrends] = useState<CompetencyTrend[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.progress().then(setProgress).catch((e) => setError(e.message));
    api.competencies().then((r) => setTrends(r.items)).catch(() => {});
  }, []);

  if (!progress) {
    return <main className="app-main spinner">{error ?? "Loading progress…"}</main>;
  }

  const scoreBySession = new Map(progress.evaluations.map((e) => [e.session_id, e]));

  return (
    <main className="app-main">
      <motion.div variants={container} initial="hidden" animate="show">
        <motion.div variants={item}>
          <p className="eyebrow">Progress</p>
          <h1 className="page-title" style={{ marginBottom: 8 }}>
            Your practice history
          </h1>
          <p className="muted small" style={{ marginBottom: 22 }}>
            Scores are formative feedback across comparable attempts — not a prediction of job performance.
          </p>
        </motion.div>

        <motion.div variants={container} className="grid-3" style={{ marginBottom: 28 }}>
          {trends.map((t) => (
            <motion.div key={t.criterion_id} variants={item} className="panel stack stack--sm">
              <h2 className="section-title">{t.criterion_name}</h2>
              {t.sufficient_data ? (
                <>
                  <p className="page-title" style={{ fontSize: "1.8rem" }}>
                    {t.average_score?.toFixed(1) ?? "—"}
                    <span className="muted small"> / {t.score_max}</span>
                  </p>
                  <div className="onboard__progress" style={{ margin: "4px 0 0" }}>
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${((t.average_score ?? 0) / t.score_max) * 100}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                  <p className="small muted">across {t.attempts} attempts</p>
                </>
              ) : (
                <p className="small muted">Not enough attempts yet ({t.attempts}). Complete more scenarios to see a trend.</p>
              )}
            </motion.div>
          ))}
          {trends.length === 0 && <p className="small muted">No competency data yet — finish a scenario to start tracking.</p>}
        </motion.div>

        <motion.h2 variants={item} className="section-title" style={{ marginBottom: 12 }}>
          Sessions
        </motion.h2>
        {progress.sessions.length === 0 ? (
          <p className="small muted">
            No sessions yet. <Link href="/scenarios">Start practising</Link>.
          </p>
        ) : (
          <motion.ul variants={container} className="list-reset">
            {progress.sessions.map((s) => {
              const ev = scoreBySession.get(s.id);
              return (
                <motion.li key={s.id} variants={item} className="objective">
                  <span className="muted small">
                    {s.difficulty} · {new Date(s.created_at).toLocaleString()}
                  </span>
                  <span className="row">
                    {ev ? (
                      <span className="badge badge--ok">{ev.overall_score === null ? "scored" : `${Math.round(ev.overall_score)}/100`}</span>
                    ) : (
                      <span className={s.status === "active" ? "badge badge--active" : "badge"}>{s.status}</span>
                    )}
                    <Link className="btn btn--ghost btn--small" href={s.status === "completed" ? `/session/${s.id}/debrief` : `/session/${s.id}`}>
                      {s.status === "completed" ? "Report" : "Resume"}
                    </Link>
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </motion.div>
    </main>
  );
}
