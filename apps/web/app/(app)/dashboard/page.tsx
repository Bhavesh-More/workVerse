"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { Avatar } from "../../../components/Avatar";
import { CountUp } from "../../../components/CountUp";
import { Snap } from "../../../components/Snap";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { averageScore, strongestCriterion } from "../../../lib/practice";
import { useApi } from "../../../lib/useApi";
import { preloadGame } from "../../../game/preload";
import { candidateApi } from "../../../lib/candidate";
import { Glyph } from "../../../components/Glyph";
import { PixelLogo } from "../../../components/PixelLogo";
import { IMOCHA_URL } from "../../../components/ImochaHub";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

function sessionHref(s: { id: string; status: string }) {
  return s.status === "completed" ? `/session/${s.id}/debrief` : `/session/${s.id}`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { data: profile } = useApi("/me", api.getMe);
  const { data: progress } = useApi("/progress", api.progress);
  const { data: sessionList } = useApi("/sessions", api.listSessions);
  const { data: trendList } = useApi("/progress/competencies", api.competencies);
  const sessions = sessionList?.items ?? [];
  const { data: company } = useApi("/me/company-assessments", candidateApi.overview);
  const invites = (company?.assignments ?? []).filter((a) => a.state.stage === "invited").length;
  const trends = trendList?.items ?? [];

  // First-time users are sent through onboarding before seeing the dashboard.
  useEffect(() => {
    if (profile && !profile.target_role) router.replace("/onboarding");
  }, [profile, router]);

  const name = profile?.display_name || user?.firstName || null;
  const completed = progress?.evaluations ?? [];
  const avg = averageScore(completed);
  const active = sessions.find((s) => s.status === "active");
  const strongest = strongestCriterion(trends);
  const firstTime = progress !== undefined && progress.sessions.length === 0;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // A fresh scenario (random company + incident) straight to its briefing, like Practice → Start.
  async function createNew() {
    setCreating(true);
    setCreateError(null);
    try {
      const instance = await api.createInstance({ template_slug: "production-incident", mode: "quick" });
      router.push(`/briefing/${instance.scenario_instance_id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create a new session.");
      setCreating(false);
    }
  }

  return (
    <main className="app-main">
      <m.div variants={container} initial="hidden" animate="show">
        <m.div variants={item} className="row page-head" style={{ gap: 20, alignItems: "center" }}>
          <Avatar imageUrl={user?.imageUrl} name={name ?? "Learner"} size={64} />
          <div>
            <h1 className="page-title" style={{ marginBottom: 8 }}>
              {name ? (
                <>
                  Welcome back, <span className="hl">{name}</span>
                </>
              ) : (
                <>
                  Welcome <span className="hl">back</span>
                </>
              )}
            </h1>
            <p className="muted small">
              {profile ? (profile.target_role ? `Practising for ${profile.target_role}` : "Set your target role in your profile") : "\u00a0"}
            </p>
          </div>
        </m.div>

        <m.a variants={item} className="im-partner" href={IMOCHA_URL} target="_blank" rel="noopener noreferrer">
          <PixelLogo height={22} />
          <span>Your practice reports become skills evidence on iMocha.</span>
          <span className="im-partner__go">Explore iMocha ↗</span>
        </m.a>

        {invites > 0 && (
          // A pointer, not the list: company assessments live in their own area.
          <m.div variants={item} style={{ marginBottom: 24 }}>
            <Link href="/assessments" className="banner ca-dashlink" data-testid="dashboard-invites">
              <span>
                <strong>
                  {invites} company invitation{invites === 1 ? "" : "s"} waiting
                </strong>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          </m.div>
        )}

        <m.div variants={item} className="grid-3" style={{ marginBottom: 24 }}>
          <div className="card">
            <span className="eyebrow icon-label"><Glyph name="play" size={15} /> Attempts</span>
            <p className="stat" data-testid="stat-attempts">
              {progress ? <CountUp value={progress.sessions.length} /> : <span className="skeleton skeleton--stat" aria-label="Loading" />}
            </p>
          </div>
          <div className="card">
            <span className="eyebrow icon-label"><Glyph name="chart" size={15} /> Average score</span>
            <p className="stat">
              {progress ? <CountUp value={avg} /> : <span className="skeleton skeleton--stat" aria-label="Loading" />}
              {avg !== null && <span className="small muted"> / 100</span>}
            </p>
          </div>
          <div className="card">
            <span className="eyebrow icon-label"><Glyph name="star" size={15} /> Strongest so far</span>
            {strongest ? (
              <>
                <p className="section-title" style={{ marginTop: 4 }}>
                  {strongest.criterion_name}
                </p>
                <p className="small muted" style={{ marginTop: 8 }}>
                  {strongest.average_score?.toFixed(1)} / {strongest.score_max}
                </p>
              </>
            ) : (
              <p className="small muted" style={{ marginTop: 4 }}>
                Unlocks after 2 scenarios
              </p>
            )}
          </div>
        </m.div>

        <m.div variants={item} className="grid-2" style={{ marginBottom: 40 }}>
          {active ? (
            <div className="card stack" style={{ borderColor: "var(--color-ink)" }}>
              <span className="eyebrow row" style={{ gap: 8, margin: 0 }}>
                <span className="dot dot--live" aria-hidden="true" /> In progress
              </span>
              <h2 className="section-title">{active.title}</h2>
              <p className="small muted">{active.difficulty}</p>
              <div className="row" style={{ gap: 8 }}>
                <Link className="btn" href={`/session/${active.id}`} onMouseEnter={preloadGame} onFocus={preloadGame}>
                  Resume session <span className="arrow" aria-hidden="true">→</span>
                </Link>
                <button className="btn btn--ghost" data-testid="create-new-session" onClick={createNew} disabled={creating}>
                  {creating ? <span className="busy-dots">Creating</span> : "+ Create new"}
                </button>
              </div>
              {createError && (
                <p className="xsmall" role="alert" style={{ color: "var(--color-ember)" }}>
                  {createError}
                </p>
              )}
            </div>
          ) : (
            <div className="card stack">
              <span className="eyebrow" style={{ margin: 0 }}>
                {firstTime ? "Your first scenario" : "Next up"}
              </span>
              <h2 className="section-title">
                {firstTime ? "Walk into your first incident" : "Start a fresh scenario"}
              </h2>
              <p className="small muted">{firstTime ? "~15 min · mistakes are the point" : "New variation, same rubric"}</p>
              <Link className="btn" href="/scenarios" style={{ alignSelf: "flex-start" }}>
                Choose a scenario <span className="arrow" aria-hidden="true">→</span>
              </Link>
            </div>
          )}
          {completed[0] ? (
            <div className="card stack">
              <span className="eyebrow icon-label" style={{ margin: 0 }}>
                <Glyph name="file" size={15} /> Latest report
              </span>
              <h2 className="section-title">
                {completed[0].overall_score === null
                  ? "Report ready"
                  : `Scored ${Math.round(completed[0].overall_score)}/100`}
              </h2>
              <p className="small muted">{completed[0].difficulty}</p>
              <Link
                className="btn btn--ghost"
                href={`/session/${completed[0].session_id}/debrief`}
                style={{ alignSelf: "flex-start" }}
              >
                Open debrief
              </Link>
            </div>
          ) : (
            <Snap room="engineering" note="Waiting for you" style={{ ["--tilt" as string]: "1.5deg", maxWidth: 420, justifySelf: "center" }} />
          )}
        </m.div>

        <m.section variants={item}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <h2 className="section-title">Recent sessions</h2>
            <Link className="text-link small" href="/sessions">
              View all →
            </Link>
          </div>
          <div className="card" style={{ paddingBlock: 6 }}>
            {!sessionList ? (
              <div className="stack stack--sm" style={{ padding: "14px 0" }} aria-label="Loading sessions">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 22, borderRadius: 8 }} />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <p className="small muted" style={{ padding: "14px 0" }}>
                No sessions yet
              </p>
            ) : (
              <ul className="list-reset">
                {sessions.slice(0, 5).map((s) => (
                  <li key={s.id} className="list-row">
                    <span className="small">
                      {s.title} <span className="muted">· {s.difficulty}</span>
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={s.status === "completed" ? "badge badge--ok" : "badge badge--active"}>
                        {s.status}
                      </span>
                      <Link className="btn btn--ghost btn--small" href={sessionHref(s)}>
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
