"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "../../lib/api";
import type { ScenarioTemplate, SessionSummary } from "../../lib/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } };

export default function ScenariosPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [difficulty, setDifficulty] = useState("standard");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then((r) => setTemplates(r.items)).catch((e) => setError(e.message));
    api.listSessions().then((r) => setSessions(r.items)).catch(() => {});
  }, []);

  async function start(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const instance = await api.createInstance({ template_slug: slug, difficulty, mode: "quick" });
      router.push(`/briefing/${instance.scenario_instance_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the scenario.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-main">
      <motion.div variants={container} initial="hidden" animate="show">
        <motion.div variants={item}>
          <p className="eyebrow">Scenario catalogue</p>
          <h1 className="page-title" style={{ marginBottom: 8 }}>
            Choose a practice scenario
          </h1>
          <p className="muted small" style={{ marginBottom: 22 }}>
            Each attempt generates a fresh, validated variation with the same competency rubric.
          </p>
        </motion.div>

        {error && <div className="banner banner--error" style={{ marginBottom: 18 }}>{error}</div>}

        <motion.div variants={item} className="row" style={{ marginBottom: 18 }}>
          <span className="section-title">Difficulty</span>
          {["introductory", "standard", "challenging"].map((d) => (
            <button key={d} className={d === difficulty ? "btn btn--small" : "btn btn--ghost btn--small"} onClick={() => setDifficulty(d)} aria-pressed={d === difficulty}>
              {d}
            </button>
          ))}
        </motion.div>

        <motion.div variants={container} className="grid-2">
          {templates.map((t) => (
            <motion.article key={t.id} variants={item} className="panel stack" whileHover={{ y: -3 }}>
              <div className="row between">
                <h2 className="section-title">{t.title}</h2>
                <span className="badge">~{t.estimated_minutes} min</span>
              </div>
              <p className="small muted">{t.summary}</p>
              <div className="row">
                {t.categories.map((c) => (
                  <span key={c} className="badge">
                    {c.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              <button className="btn" onClick={() => start(t.slug)} disabled={busy === t.slug}>
                {busy === t.slug ? "Preparing…" : "Start practice"}
              </button>
            </motion.article>
          ))}
        </motion.div>

        <motion.section variants={item} style={{ marginTop: 44 }}>
          <h2 className="section-title" style={{ marginBottom: 14 }}>
            Recent attempts
          </h2>
          {sessions.length === 0 ? (
            <p className="small muted">No sessions yet. Start a scenario above.</p>
          ) : (
            <ul className="list-reset">
              {sessions.map((s) => (
                <li key={s.id} className="objective">
                  <span>
                    {s.title} <span className="muted small">· {s.difficulty} · {new Date(s.created_at).toLocaleString()}</span>
                  </span>
                  <span className="row">
                    <span className={s.status === "completed" ? "badge badge--ok" : "badge badge--active"}>{s.status}</span>
                    {s.status === "completed" ? (
                      <Link className="btn btn--ghost btn--small" href={`/session/${s.id}/debrief`}>
                        Report
                      </Link>
                    ) : (
                      <Link className="btn btn--ghost btn--small" href={`/session/${s.id}`}>
                        Resume
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      </motion.div>
    </main>
  );
}
