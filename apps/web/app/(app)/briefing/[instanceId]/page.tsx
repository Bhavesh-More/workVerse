"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { m } from "framer-motion";
import { FormError } from "../../../../components/AuthShell";
import { Snap } from "../../../../components/Snap";
import { api } from "../../../../lib/api";
import type { ScenarioInstance } from "../../../../lib/types";
import { preloadGame, whenIdle } from "../../../../game/preload";
import { Glyph } from "../../../../components/Glyph";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function BriefingPage() {
  const params = useParams<{ instanceId: string }>();
  const router = useRouter();
  const [instance, setInstance] = useState<ScenarioInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!params.instanceId) return;
    api.getInstance(params.instanceId).then(setInstance).catch((e) => setError(e.message));
  }, [params.instanceId]);

  // ~1.2 MB game engine downloads while the learner reads, so "Enter the office" is instant.
  useEffect(() => whenIdle(preloadGame), []);

  async function enter() {
    if (!instance) return;
    setBusy(true);
    setError(null);
    try {
      // A company invite already started the session (?session=); just enter it.
      const invited = new URLSearchParams(window.location.search).get("session");
      const session = invited ? { id: invited } : await api.startSession(instance.scenario_instance_id);
      router.push(`/session/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the session.");
      setBusy(false);
    }
  }

  if (!instance) {
    return (
      <main className="app-main">
        {error ? (
          <FormError message={error} />
        ) : (
          <div className="stack" aria-label="Loading briefing">
            <div className="skeleton" style={{ height: 110, maxWidth: 560 }} />
            <div className="grid-2">
              <div className="skeleton" style={{ height: 260 }} />
              <div className="skeleton" style={{ height: 260 }} />
            </div>
          </div>
        )}
      </main>
    );
  }

  const b = instance.prebrief;
  return (
    <main className="app-main">
      <m.div variants={container} initial="hidden" animate="show">
        <m.div variants={item} className="page-head">
          <span className="eyebrow">Briefing · {b.difficulty} · ~{b.estimated_minutes} min</span>
          <h1 className="page-title">{b.title}</h1>
          <p className="muted small">
            You&apos;re the <strong style={{ color: "var(--color-ink)" }}>{b.role}</strong>
          </p>
        </m.div>

        <FormError message={error} />

        <div className="grid-2" style={{ alignItems: "start", marginTop: error ? 20 : 0 }}>
          <m.div variants={item} className="stack stack--lg">
            <div className="card stack">
              <h2 className="section-title">Situation</h2>
              <p style={{ lineHeight: 1.65 }}>{b.briefing}</p>
            </div>
            <Snap room="engineering" note="Where it starts" style={{ ["--tilt" as string]: "-1.5deg", maxWidth: 380 }} />
          </m.div>
          <m.div variants={item} className="card stack">
            <h2 className="section-title">What you need to do</h2>
            <ol className="list-reset numbered">
              {b.objectives.map((o) => (
                <li key={o} className="small">
                  {o}
                </li>
              ))}
            </ol>
            <h2 className="section-title" style={{ marginTop: 8 }}>
              Controls
            </h2>
            <ul className="list-reset chip-row">
              {b.controls.map((c) => (
                <li key={c} className="badge">
                  {c}
                </li>
              ))}
            </ul>
          </m.div>
        </div>

        {b.incident && (
          <m.div variants={item} className="stat-tiles" style={{ marginTop: 32 }}>
            {[
              ["Service", b.incident.service],
              ["Requests failing", b.incident.impact_pct !== undefined ? `${String(b.incident.impact_pct)}%` : undefined],
              ["Severity", b.incident.severity],
              ["Deploy was", b.incident.deploy_minutes_ago !== undefined ? `${String(b.incident.deploy_minutes_ago)} min ago` : undefined],
            ]
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => (
                <div key={String(k)} className="stat-tile">
                  <span className="eyebrow">{String(k)}</span>
                  <strong className="mono" style={{ fontSize: 20 }}>{String(v)}</strong>
                </div>
              ))}
          </m.div>
        )}

        {b.people && (
          <m.section variants={item} className="card stack" style={{ marginTop: 32 }}>
            <h2 className="section-title">Who&apos;s in the office</h2>
            <div className="people-grid">
              {b.people.map((p) => (
                <div key={p.id} className="person">
                  <strong>{p.name}</strong>
                  <p className="small muted">{p.role}</p>
                  <span className="badge" style={{ marginTop: 8 }}>@ {p.location}</span>
                </div>
              ))}
            </div>
          </m.section>
        )}

        {(b.assessed || b.tips) && (
          <div className="grid-2" style={{ alignItems: "start", marginTop: 32 }}>
            {b.assessed && (
              <m.section variants={item} className="card stack">
                <h2 className="section-title">How you&apos;re scored</h2>
                <div className="stack stack--sm">
                  {b.assessed.map((a) => (
                    <details key={a.id} className="disclosure">
                      <summary>{a.name}</summary>
                      <p className="small muted">
                        <span className="icon-label"><Glyph name="star" size={15} /> 4/4:</span> {a.great}
                      </p>
                    </details>
                  ))}
                </div>
              </m.section>
            )}
            {b.tips && (
              <m.section variants={item} className="card stack">
                <h2 className="section-title">Tips</h2>
                <ul className="list-reset checklist checklist--todo">
                  {b.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </m.section>
            )}
          </div>
        )}

        <m.div variants={item} className="row" style={{ marginTop: 32 }}>
          <button className="btn" onClick={enter} disabled={busy}>
            {busy ? <span className="busy-dots">Entering the office</span> : "Enter the office"}
          </button>
        </m.div>
      </m.div>
    </main>
  );
}
