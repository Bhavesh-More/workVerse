"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Avatar } from "../../components/Avatar";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { CompetencyTrend, Profile, ProgressResponse, SessionSummary } from "../../lib/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } };

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [trends, setTrends] = useState<CompetencyTrend[]>([]);

  useEffect(() => {
    api
      .getMe()
      .then((p) => {
        // First-time users are sent through onboarding before seeing the dashboard.
        if (!p.target_role) router.replace("/onboarding");
        setProfile(p);
      })
      .catch(() => {});
    api.progress().then(setProgress).catch(() => {});
    api.listSessions().then((r) => setSessions(r.items)).catch(() => {});
    api.competencies().then((r) => setTrends(r.items)).catch(() => {});
  }, [router]);

  const name = profile?.display_name ?? user?.firstName ?? "there";
  const completed = progress?.evaluations ?? [];
  const avg =
    completed.length > 0
      ? Math.round(
          completed.reduce((s, e) => s + (e.overall_score ?? 0), 0) / completed.length,
        )
      : null;
  const active = sessions.find((s) => s.status === "active");
  const strongest = [...trends].sort((a, b) => (b.average_score ?? 0) - (a.average_score ?? 0))[0];

  return (
    <main className="app-main">
      <motion.div variants={container} initial="hidden" animate="show">
        <motion.div variants={item} className="row" style={{ gap: 16, marginBottom: 26 }}>
          <Avatar imageUrl={user?.imageUrl} name={name} size={56} />
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1 className="page-title">Welcome back, {name}</h1>
            <p className="muted small">
              {profile?.target_role ? `Practising for ${profile.target_role}` : "Set your target role in your profile"}
            </p>
          </div>
        </motion.div>

        <motion.div variants={item} className="grid-3" style={{ marginBottom: 28 }}>
          <div className="panel">
            <p className="eyebrow">Attempts</p>
            <p className="page-title" style={{ fontSize: "2rem" }}>
              {progress?.sessions.length ?? 0}
            </p>
          </div>
          <div className="panel">
            <p className="eyebrow">Average score</p>
            <p className="page-title" style={{ fontSize: "2rem" }}>
              {avg === null ? "—" : avg}
            </p>
            <p className="small muted">formative practice score</p>
          </div>
          <div className="panel">
            <p className="eyebrow">Strongest so far</p>
            <p style={{ fontSize: "1.05rem", fontWeight: 600, marginTop: 6 }}>
              {strongest && strongest.sufficient_data ? strongest.criterion_name : "Not enough data yet"}
            </p>
            {strongest?.sufficient_data && (
              <p className="small muted">
                {strongest.average_score?.toFixed(1)} / {strongest.score_max}
              </p>
            )}
          </div>
        </motion.div>

        <motion.div variants={item} className="grid-2" style={{ marginBottom: 28 }}>
          <div className="panel stack">
            <h2 className="section-title">Start practising</h2>
            <p className="small muted">
              Generate a fresh, validated production-incident scenario with a stable rubric.
            </p>
            <Link className="btn" href="/scenarios" style={{ alignSelf: "flex-start" }}>
              Choose a scenario
            </Link>
          </div>
          {active ? (
            <div className="panel stack">
              <h2 className="section-title">Continue where you left off</h2>
              <p className="small muted">
                {active.title} · {active.difficulty} · v{active.state_version}
              </p>
              <Link className="btn" href={`/session/${active.id}`} style={{ alignSelf: "flex-start" }}>
                Resume session
              </Link>
            </div>
          ) : (
            <div className="panel stack">
              <h2 className="section-title">Recent report</h2>
              {completed[0] ? (
                <>
                  <p className="small muted">
                    {completed[0].overall_score === null
                      ? "Completed"
                      : `Scored ${Math.round(completed[0].overall_score)}/100`}{" "}
                    · {completed[0].difficulty}
                  </p>
                  <Link
                    className="btn btn--ghost"
                    href={`/session/${completed[0].session_id}/debrief`}
                    style={{ alignSelf: "flex-start" }}
                  >
                    Open debrief
                  </Link>
                </>
              ) : (
                <p className="small muted">No completed attempts yet.</p>
              )}
            </div>
          )}
        </motion.div>

        <motion.div variants={item}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Recent sessions
          </h2>
          {sessions.length === 0 ? (
            <p className="small muted">Nothing yet — start your first scenario.</p>
          ) : (
            <ul className="list-reset">
              {sessions.slice(0, 5).map((s) => (
                <li key={s.id} className="objective">
                  <span>
                    {s.title} <span className="muted small">· {s.difficulty}</span>
                  </span>
                  <Link
                    className="btn btn--ghost btn--small"
                    href={s.status === "completed" ? `/session/${s.id}/debrief` : `/session/${s.id}`}
                  >
                    {s.status === "completed" ? "Report" : "Resume"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </motion.div>
    </main>
  );
}
