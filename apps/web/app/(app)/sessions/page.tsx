"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { api } from "../../../lib/api";
import type { SessionSummary } from "../../../lib/types";
import { useApi } from "../../../lib/useApi";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] as const } },
};

function when(s: SessionSummary) {
  const d = new Date(s.started_at ?? s.created_at);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function SessionsPage() {
  const router = useRouter();
  const { data, error } = useApi("/sessions", api.listSessions);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const sessions = data?.items ?? [];

  // Finished sessions open their report. Unfinished ones start a fresh run of the same scenario
  // (new incident and company); "Resume" next to it still picks the old one back up.
  async function open(s: SessionSummary) {
    if (s.status === "completed") {
      router.push(`/session/${s.id}/debrief`);
      return;
    }
    setBusy(s.id);
    setFailed(null);
    try {
      const res = await api.retry(s.id);
      router.push(`/session/${res.session.id}`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not start a new session.");
      setBusy(null);
    }
  }

  return (
    <main className="app-main">
      <div className="page-head">
        <span className="eyebrow">History</span>
        <h1 className="page-title">Previous sessions</h1>
        <p className="small muted">
          Click a finished session to see its report. Click an unfinished one to start it again with a fresh incident, or use{" "}
          <strong>Resume</strong> to continue it.
        </p>
      </div>
      {(failed || error) && (
        <p className="banner banner--error" role="alert">
          {failed ?? error}
        </p>
      )}
      {!data && !error ? (
        <div className="stack stack--sm" aria-label="Loading sessions">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 56 }} />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="card stack">
          <p className="small muted">No sessions yet.</p>
          <Link className="btn" href="/scenarios" style={{ alignSelf: "flex-start" }}>
            Start your first
          </Link>
        </div>
      ) : (
        <m.ul className="list-reset stack stack--sm" variants={container} initial="hidden" animate="show">
          {sessions.map((s) => {
            const done = s.status === "completed";
            return (
              <m.li key={s.id} variants={item} className="card session-row">
                <button className="session-row__main" data-testid="session-row" onClick={() => open(s)} disabled={busy !== null}>
                  <span className="session-row__title">{s.title}</span>
                  <span className="xsmall muted">
                    {when(s)} · {s.difficulty}
                  </span>
                </button>
                <span className="row" style={{ gap: 8 }}>
                  <span className={done ? "badge badge--ok" : "badge badge--active"}>{done ? "completed" : "unfinished"}</span>
                  {busy === s.id ? (
                    <span className="xsmall busy-dots">Starting new</span>
                  ) : done ? (
                    <Link className="btn btn--ghost btn--small" href={`/session/${s.id}/debrief`}>
                      Report
                    </Link>
                  ) : (
                    <>
                      <button className="btn btn--small" onClick={() => open(s)} disabled={busy !== null}>
                        Start new
                      </button>
                      <Link className="btn btn--ghost btn--small" href={`/session/${s.id}`}>
                        Resume
                      </Link>
                    </>
                  )}
                </span>
              </m.li>
            );
          })}
        </m.ul>
      )}
    </main>
  );
}
