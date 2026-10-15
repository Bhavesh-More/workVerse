"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { m } from "framer-motion";
import { FormError } from "../../../../components/AuthShell";
import { Snap } from "../../../../components/Snap";
import { api } from "../../../../lib/api";
import type { ScenarioInstance } from "../../../../lib/types";
import { preloadGame, whenIdle } from "../../../../game/preload";

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
      const session = await api.startSession(instance.scenario_instance_id);
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
            You&apos;re the <strong style={{ color: "var(--color-ink)" }}>{b.role}</strong>. Read the
            brief, then walk in when you&apos;re ready — there&apos;s no timer on this page.
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
            <ul className="list-reset stack stack--sm">
              {b.controls.map((c) => (
                <li key={c} className="small muted">
                  {c}
                </li>
              ))}
            </ul>
          </m.div>
        </div>

        <m.div variants={item} className="row" style={{ marginTop: 32 }}>
          <button className="btn" onClick={enter} disabled={busy}>
            {busy ? <span className="busy-dots">Entering the office</span> : "Enter the office"}
          </button>
          <span className="small muted">Stuck inside? Hit “Need help?” and a guide walks you through it.</span>
        </m.div>
      </m.div>
    </main>
  );
}
