"use client";

import Link from "next/link";
import { m } from "framer-motion";
import { CountUp } from "../../../components/CountUp";
import { ScoreLine } from "../../../components/Charts";
import { api } from "../../../lib/api";
import { useApi } from "../../../lib/useApi";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function ProgressPage() {
  const { data: progress, error } = useApi("/progress", api.progress);
  const { data: trendList } = useApi("/progress/competencies", api.competencies);
  const trends = trendList?.items ?? [];

  if (!progress) {
    return (
      <main className="app-main">
        {error ? (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        ) : (
          <div className="stack" aria-label="Loading progress">
            <div className="skeleton" style={{ height: 90, maxWidth: 480 }} />
            <div className="grid-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 150 }} />
              ))}
            </div>
          </div>
        )}
      </main>
    );
  }

  const scoreBySession = new Map(progress.evaluations.map((e) => [e.session_id, e]));

  return (
    <main className="app-main">
      <m.div variants={container} initial="hidden" animate="show">
        <m.div variants={item} className="page-head">
          <span className="eyebrow">Progress</span>
          <h1 className="page-title">
            How you&apos;re <span className="hl">growing</span>
          </h1>
          <p className="muted small">
            Trends appear once a skill has enough attempts to mean something. Scores are formative
            feedback across comparable attempts — not a prediction of job performance.
          </p>
        </m.div>

        <m.div variants={container} className="grid-3" style={{ marginBottom: 48 }}>
          {trends.map((t) => (
            <m.div key={t.criterion_id} variants={item} className="card stack stack--sm">
              <h2 className="section-title" style={{ fontSize: 18 }}>
                {t.criterion_name}
              </h2>
              {t.sufficient_data ? (
                <>
                  <p className="stat" style={{ fontSize: 40 }}>
                    <CountUp value={t.average_score} decimals={1} />
                    <span className="small muted"> / {t.score_max}</span>
                  </p>
                  <div className="track">
                    <m.span
                      initial={{ width: 0 }}
                      animate={{ width: `${((t.average_score ?? 0) / t.score_max) * 100}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                    />
                  </div>
                  <p className="xsmall muted">across {t.attempts} attempts</p>
                </>
              ) : (
                <p className="small muted">
                  {t.attempts} attempt{t.attempts === 1 ? "" : "s"} so far — a few more and a trend
                  will show up here.
                </p>
              )}
            </m.div>
          ))}
          {trends.length === 0 && (
            <m.p variants={item} className="small muted">
              No skill data yet — finish a scenario to start tracking.
            </m.p>
          )}
        </m.div>

        <m.section variants={item} className="card stack" style={{ marginBottom: 48 }}>
          <h2 className="section-title">Overall score by attempt</h2>
          <ScoreLine
            points={[...progress.evaluations]
              .filter((e) => e.overall_score !== null)
              .sort((a, b) => a.completed_at.localeCompare(b.completed_at))
              .map((e, i) => ({
                label: `Attempt ${i + 1} · ${e.difficulty} · ${new Date(e.completed_at).toLocaleDateString()}`,
                score: Math.round(e.overall_score ?? 0),
              }))}
          />
        </m.section>

        <m.h2 variants={item} className="section-title" style={{ marginBottom: 12 }}>
          Sessions
        </m.h2>
        <m.div variants={item} className="card" style={{ paddingBlock: 6 }}>
          {progress.sessions.length === 0 ? (
            <p className="small muted" style={{ padding: "14px 0" }}>
              No sessions yet.{" "}
              <Link className="text-link" href="/scenarios">
                Start practising
              </Link>
              .
            </p>
          ) : (
            <ul className="list-reset">
              {progress.sessions.map((s) => {
                const ev = scoreBySession.get(s.id);
                return (
                  <li key={s.id} className="list-row">
                    <span className="small muted">
                      {s.difficulty} · {new Date(s.created_at).toLocaleString()}
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      {ev ? (
                        <span className="badge badge--ok">
                          {ev.overall_score === null ? "scored" : `${Math.round(ev.overall_score)}/100`}
                        </span>
                      ) : (
                        <span className={s.status === "active" ? "badge badge--active" : "badge"}>{s.status}</span>
                      )}
                      <Link
                        className="btn btn--ghost btn--small"
                        href={ev || s.status === "completed" ? `/session/${s.id}/debrief` : `/session/${s.id}`}
                      >
                        {ev || s.status === "completed" ? "Report" : "Resume"}
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </m.div>
      </m.div>
    </main>
  );
}
