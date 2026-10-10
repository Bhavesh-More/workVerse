"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "../../../lib/api";
import type { ScenarioInstance } from "../../../lib/types";

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
    return <main className="app-main spinner">{error ?? "Loading briefing…"}</main>;
  }

  const b = instance.prebrief;
  return (
    <main className="app-main">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <p className="eyebrow">Briefing · {b.difficulty}</p>
        <h1 className="page-title" style={{ marginBottom: 8 }}>
          {b.title}
        </h1>
        <p className="muted small" style={{ marginBottom: 22 }}>
          You are practising as {b.role} · about {b.estimated_minutes} minutes
        </p>

        {error && <div className="banner banner--error" style={{ marginBottom: 18 }}>{error}</div>}

        <div className="grid-2">
          <div className="panel stack">
            <h2 className="section-title">Situation</h2>
            <p style={{ lineHeight: 1.7 }}>{b.briefing}</p>
          </div>
          <div className="panel stack">
            <h2 className="section-title">Objectives</h2>
            <ul className="list-reset">
              {b.objectives.map((o) => (
                <li key={o} className="objective">
                  {o}
                </li>
              ))}
            </ul>
            <h2 className="section-title">Controls</h2>
            <ul className="list-reset stack stack--sm">
              {b.controls.map((c) => (
                <li key={c} className="small muted">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn" onClick={enter} disabled={busy}>
            {busy ? "Entering the office…" : "Enter the office"}
          </button>
          <span className="small muted">A guide inside will walk you through each step if you want it.</span>
        </div>
      </motion.div>
    </main>
  );
}
