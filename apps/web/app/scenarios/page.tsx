"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { RequireAuth } from "../../components/RequireAuth";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { ScenarioTemplate, SessionSummary } from "../../lib/types";

function Catalog() {
  const { token } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<ScenarioTemplate[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [difficulty, setDifficulty] = useState("standard");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.listTemplates(token).then((r) => setTemplates(r.items)).catch((e) => setError(e.message));
    api.listSessions(token).then((r) => setSessions(r.items)).catch(() => {});
  }, [token]);

  async function start(slug: string) {
    if (!token) return;
    setBusy(slug);
    setError(null);
    try {
      const instance = await api.createInstance(token, {
        template_slug: slug,
        difficulty,
        mode: "quick",
      });
      router.push(`/briefing/${instance.scenario_instance_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the scenario.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-main">
      <p className="eyebrow">Scenario catalogue</p>
      <h1 className="page-title" style={{ marginBottom: 8 }}>
        Choose a practice scenario
      </h1>
      <p className="muted small" style={{ marginBottom: 22 }}>
        Each attempt generates a fresh, validated variation with the same competency rubric.
      </p>

      {error && <div className="banner banner--error" style={{ marginBottom: 18 }}>{error}</div>}

      <div className="row" style={{ marginBottom: 18 }}>
        <span className="section-title">Difficulty</span>
        {["introductory", "standard", "challenging"].map((d) => (
          <button
            key={d}
            className={d === difficulty ? "btn btn--small" : "btn btn--ghost btn--small"}
            onClick={() => setDifficulty(d)}
            aria-pressed={d === difficulty}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid-2">
        {templates.map((t) => (
          <article key={t.id} className="panel stack">
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
          </article>
        ))}
      </div>

      <section style={{ marginTop: 44 }}>
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
                  {s.title}{" "}
                  <span className="muted small">
                    · {s.difficulty} · {new Date(s.created_at).toLocaleString()}
                  </span>
                </span>
                <span className="row">
                  <span className={s.status === "completed" ? "badge badge--ok" : "badge badge--active"}>
                    {s.status}
                  </span>
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
      </section>
    </main>
  );
}

export default function ScenariosPage() {
  return (
    <div className="app-shell">
      <AppNav />
      <RequireAuth>
        <Catalog />
      </RequireAuth>
    </div>
  );
}
