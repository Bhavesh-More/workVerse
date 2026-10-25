"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { m } from "framer-motion";
import { CountUp } from "../../../../../components/CountUp";
import { FormError } from "../../../../../components/AuthShell";
import { ScoreBars, TalkBalance, TurnLengths } from "../../../../../components/Charts";
import { api, ApiError } from "../../../../../lib/api";
import { companyApi } from "../../../../../lib/company";
import { play } from "../../../../../lib/sfx";
import type { Evaluation, LedgerCheck, SessionView, SimEvent, TranscriptMessage } from "../../../../../lib/types";
import { preloadGame } from "../../../../../game/preload";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

function Pips({ score, max }: { score: number | null; max: number }) {
  return (
    <span className="pips" role="img" aria-label={score === null ? "Not scored" : `${score} out of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <m.span
          key={i}
          className={score !== null && i < score ? "is-on" : ""}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3 + i * 0.06, type: "spring", stiffness: 500, damping: 22 }}
        />
      ))}
    </span>
  );
}


type Line =
  | { kind: "msg"; at: string; seq: number; msg: TranscriptMessage }
  | { kind: "event"; at: string; seq: number; ev: SimEvent; text: string };

export default function DebriefPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when this run was a company assessment: the candidate is told the report is shared.
  const [assessment, setAssessment] = useState<{ company: string; title: string; invite_id: string } | null>(null);
  useEffect(() => {
    companyApi.sessionAssessment(sessionId).then((r) => setAssessment(r.assessment), () => {});
  }, [sessionId]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvaluation(await api.getEvaluation(sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report.");
      return;
    }
    // Supporting data: the report still renders if any of these fail.
    const [t, ev, s] = await Promise.allSettled([api.transcript(sessionId), api.events(sessionId), api.getSession(sessionId)]);
    if (t.status === "fulfilled") setMessages(t.value.items);
    if (ev.status === "fulfilled") setEvents(ev.value.items);
    if (s.status === "fulfilled") setSession(s.value);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const names = useMemo(
    () => new Map((session?.world.characters ?? []).map((c) => [c.id, c.name] as const)),
    [session],
  );

  const timeline = useMemo<Line[]>(() => {
    if (!session) return messages.map((msg) => ({ kind: "msg", at: msg.created_at ?? "", seq: msg.sequence_number, msg }));
    const actionLabel = (id: unknown) => session.world.actions.find((a) => a.id === id)?.label ?? String(id);
    const factLabel = (id: unknown) => session.facts_known.find((f) => f.id === id)?.label ?? String(id);
    const objLabel = (id: unknown) => session.objectives.find((o) => o.id === id)?.label ?? String(id);
    const describe = (ev: SimEvent): string | null => {
      const p = ev.payload ?? {};
      switch (ev.event_type) {
        case "action_applied":
          return `You: ${actionLabel(p.action_id)}`;
        case "fact_discovered":
          return `Learned: ${factLabel(p.fact_id)}`;
        case "decision_rejected":
          return `Blocked: ${actionLabel(p.action_id)} — ${String(p.reason ?? "")}`;
        case "objective_completed":
          return `✓ Objective: ${objLabel(p.objective_id)}`;
        case "session_completed":
          return "Session ended";
        default:
          return null;
      }
    };
    const lines: Line[] = messages.map((msg) => ({ kind: "msg", at: msg.created_at ?? "", seq: msg.sequence_number, msg }));
    for (const ev of events) {
      const text = describe(ev);
      if (text) lines.push({ kind: "event", at: ev.created_at ?? "", seq: 10_000 + ev.sequence_number, ev, text });
    }
    // Same-transaction rows share a timestamp: messages first, then the events they caused.
    return lines.sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
  }, [messages, events, session]);

  useEffect(() => {
    if (evaluation) play("complete");
  }, [evaluation]);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.retry(sessionId);
      router.push(`/session/${res.session.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a retry.");
      setBusy(false);
    }
  }

  if (!evaluation) {
    return (
      <main className="app-main">
        {error ? (
          <FormError message={error} />
        ) : (
          <div className="stack" aria-label="Loading report">
            <div className="skeleton" style={{ height: 110, maxWidth: 560 }} />
            <div className="grid-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 170 }} />
              ))}
            </div>
          </div>
        )}
      </main>
    );
  }

  const scored = evaluation.items.filter((i) => i.status === "scored");
  const strengths = scored.filter((i) => (i.score ?? 0) >= 3);
  const improvements = evaluation.items.filter((i) => i.status !== "scored" || (i.score ?? 0) < 3);
  const conv = evaluation.conversation;
  const cited = new Set(evaluation.items.flatMap((i) => i.evidence.filter((e) => e.source_type === "message").map((e) => e.source_id)));
  const coachingById = new Map(evaluation.coaching.map((c) => [c.message_id, c]));
  const allChecks = Object.values(evaluation.ledger).flat();
  const passed = allChecks.filter((c) => c.passed).length;
  // The status-update deliverable is also stored as your last colleague-less message.
  const lastUpdateId = [...messages].reverse().find((msg) => msg.speaker_type === "learner" && !msg.character_id)?.id;
  const proofHref = (type: string | null, id: string | null): string | null => {
    if (!type || !id) return null;
    if (type === "message") return `#msg-${id}`;
    if (type === "event") return `#ev-${id}`;
    return lastUpdateId ? `#msg-${lastUpdateId}` : null;
  };

  return (
    <main className="app-main">
      <m.div variants={container} initial="hidden" animate="show">
        <m.div variants={item} className="page-head">
          <span className="eyebrow">Debrief · rubric {evaluation.rubric_version}</span>
          <h1 className="page-title">Practice report</h1>
          <p className="muted small">
            {evaluation.limitations[0] ??
              "This report is formative practice feedback, not a validated predictor of job performance."}
          </p>
        </m.div>

        <FormError message={error} />
        {assessment && (
          <div className="banner banner--info" style={{ marginBottom: 24 }}>
            <span>
              This was the <strong>{assessment.title}</strong> assessment. Your report has been shared with {assessment.company}.
            </span>
          </div>
        )}

        <m.div variants={item} className="grid-3" style={{ margin: "0 0 32px" }}>
          <div className="card">
            <span className="eyebrow">Overall</span>
            <p className="stat" style={{ fontSize: 72 }}>
              <CountUp value={evaluation.overall_score === null ? null : Math.round(evaluation.overall_score)} />
            </p>
            <p className="xsmall muted" style={{ marginTop: 8 }}>
              {evaluation.score_scale.interpretation}
              {evaluation.evaluator_model ? ` · model ${evaluation.evaluator_model}` : ""}
            </p>
            {allChecks.length > 0 && (
              <p className="xsmall" style={{ marginTop: 8 }}>
                <strong>{passed}</strong> of {allChecks.length} evidence checks passed
              </p>
            )}
          </div>
          <div className="card">
            <span className="eyebrow">In short</span>
            <p className="small">{evaluation.summary}</p>
          </div>
          <div className="card stack stack--sm">
            <span className="eyebrow">What next</span>
            {assessment ? (
              // A company assessment is one submission, not practice: no retry, no progress stats.
              <Link className="btn btn--block" href={`/assessments/${assessment.invite_id}`} data-testid="back-to-company-assessment">
                Back to Company assessments
              </Link>
            ) : (
              <>
                <button className="btn btn--block" onClick={retry} disabled={busy} onMouseEnter={preloadGame} onFocus={preloadGame}>
                  {busy ? <span className="busy-dots">Starting</span> : "Retry a variant"}
                </button>
                <Link className="btn btn--ghost btn--block" href="/progress">
                  View progress
                </Link>
              </>
            )}
            <a className="btn btn--ghost btn--block" href="#transcript">
              Read your transcript
            </a>
            <button className="btn btn--ghost btn--block no-print" onClick={() => window.print()}>
              Save as PDF
            </button>
          </div>
        </m.div>

        <m.div variants={item} className="grid-2" style={{ marginBottom: 32, alignItems: "start" }}>
          <section className="card stack">
            <h2 className="section-title">Skill scores</h2>
            <ScoreBars
              items={evaluation.items.map((i) => ({
                id: i.criterion_id,
                name: i.criterion_name,
                score: i.status === "scored" ? i.score : null,
                max: i.score_max,
              }))}
            />
            <div className="grid-2" style={{ gap: 12 }}>
              <div>
                <span className="eyebrow">
                  <span className="hl">Keep doing</span>
                </span>
                <ul className="list-reset stack stack--sm">
                  {strengths.length === 0 ? (
                    <li className="xsmall muted">Nothing rated highly yet — that&apos;s what retries are for.</li>
                  ) : (
                    strengths.map((i) => (
                      <li key={i.criterion_id} className="small">
                        {i.criterion_name}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div>
                <span className="eyebrow">Work on</span>
                <ul className="list-reset stack stack--sm">
                  {improvements.length === 0 ? (
                    <li className="xsmall muted">No weak spots detected this attempt.</li>
                  ) : (
                    improvements.map((i) => (
                      <li key={i.criterion_id} className="small">
                        {i.criterion_name}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </section>

          {conv && (
            <section className="card stack">
              <h2 className="section-title">How you talked</h2>
              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="eyebrow">Avg words</span>
                  <strong>{conv.avg_words}</strong>
                  <span className="xsmall muted">per message · aim 5–25</span>
                </div>
                <div className="stat-tile">
                  <span className="eyebrow">Questions</span>
                  <strong>{conv.questions}</strong>
                  <span className="xsmall muted">of {conv.learner_turns} messages</span>
                </div>
                <div className="stat-tile">
                  <span className="eyebrow">Too long</span>
                  <strong>{conv.long_turns}</strong>
                  <span className="xsmall muted">over {conv.long_turn_words} words</span>
                </div>
              </div>
              <TalkBalance people={conv.people} />
            </section>
          )}
        </m.div>

        {(evaluation.coaching.length > 0 || evaluation.say_next_time.length > 0) && (
          <m.section variants={item} className="card stack" style={{ marginBottom: 32 }}>
            <div>
              <h2 className="section-title">Say this next time</h2>
              <p className="small muted">Real colleagues talk in short turns. Here&apos;s how to sound like one.</p>
            </div>
            <div className="grid-2" style={{ gap: 12 }}>
              {evaluation.coaching.map((c) => (
                <div key={c.message_id} className="say-card">
                  <span className="eyebrow">You said</span>
                  <p className="say-card__before">{c.original.length > 180 ? `${c.original.slice(0, 180)}…` : c.original}</p>
                  <p className="say-card__after">“{c.better}”</p>
                  <p className="xsmall muted" style={{ marginTop: 6 }}>
                    {c.why} · <a className="proof-link" href={`#msg-${c.message_id}`}>see in transcript</a>
                  </p>
                </div>
              ))}
              {evaluation.say_next_time.map((s) => (
                <div key={s.check} className="say-card">
                  <span className="eyebrow">Missed: {s.check}</span>
                  <p className="xsmall muted">To {s.to}:</p>
                  <p className="say-card__after">“{s.say}”</p>
                </div>
              ))}
            </div>
          </m.section>
        )}

        <m.div variants={item}>
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            Evidence Ledger
          </h2>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Why you got each score. Every check links to the exact moment in your session that proves it.
          </p>
        </m.div>
        <div className="stack" style={{ marginBottom: 32 }}>
          {evaluation.items.map((it) => {
            const checks: LedgerCheck[] = evaluation.ledger[it.criterion_id] ?? [];
            return (
              <m.article key={it.criterion_id} variants={item} className="card stack">
                <div className="row between">
                  <h3 className="section-title" style={{ fontSize: 18 }}>
                    {it.criterion_name}
                  </h3>
                  <span className="row" style={{ gap: 10 }}>
                    {it.status === "scored" ? (
                      <Pips score={it.score} max={it.score_max} />
                    ) : (
                      <span className="badge badge--warn">{it.status.replace(/_/g, " ")}</span>
                    )}
                    {it.score !== null && (
                      <span className="mono">
                        {it.score}/{it.score_max}
                      </span>
                    )}
                  </span>
                </div>
                <p className="small">{it.explanation}</p>
                {checks.length > 0 && (
                  <div className="stack stack--sm">
                    <span className="eyebrow" style={{ margin: 0 }}>
                      Checks · {checks.filter((c) => c.passed).length}/{checks.length} passed
                    </span>
                    <ul className="list-reset ledger">
                      {checks.map((c) => {
                        const href = proofHref(c.source_type, c.source_id);
                        return (
                          <li key={c.id} className={c.passed ? "" : "is-missed"}>
                            <span className="ledger__mark" aria-hidden="true">
                              {c.passed ? "✓" : "✕"}
                            </span>
                            <span>
                              <span className="sr-only">{c.passed ? "Passed: " : "Missed: "}</span>
                              {c.label}
                              {c.detail && <span className="muted"> · {c.detail}</span>}
                            </span>
                            {href ? (
                              <a className="proof-link" href={href}>
                                proof →
                              </a>
                            ) : (
                              <span className="xsmall muted">{c.passed ? "" : "missed"}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {it.evidence.length > 0 && (
                  <div className="stack stack--sm">
                    <span className="eyebrow" style={{ margin: 0 }}>
                      What the AI cited
                    </span>
                    {it.evidence.map((ev, i) => {
                      const href = proofHref(ev.source_type, ev.source_id);
                      return (
                        <blockquote key={i} className="evidence">
                          {ev.quote ? <q>{ev.quote}</q> : <em>({ev.source_type} reference)</em>}
                          <span className="muted"> — {ev.interpretation}</span>{" "}
                          {href && (
                            <a className="proof-link" href={href}>
                              open
                            </a>
                          )}
                        </blockquote>
                      );
                    })}
                  </div>
                )}
                <p className="small" style={{ paddingTop: 12, borderTop: "1px solid var(--color-hairline)" }}>
                  <span className="mono" style={{ marginRight: 8 }}>
                    Next step →
                  </span>
                  <span className="muted">{it.recommendation}</span>
                </p>
              </m.article>
            );
          })}
        </div>

        {conv && conv.turns.length > 0 && (
          <m.section variants={item} className="card stack" style={{ marginBottom: 32 }}>
            <div>
              <h2 className="section-title">Message length, turn by turn</h2>
              <p className="small muted">
                Average {conv.avg_words} words from you vs {conv.npc_avg_words} from colleagues. Shorter turns with a
                question keep the conversation moving.
              </p>
            </div>
            <TurnLengths stats={conv} names={names} />
          </m.section>
        )}

        <m.section variants={item} className="card stack" id="transcript">
          <div>
            <h2 className="section-title">Your transcript</h2>
            <p className="small muted">
              Everything you said and did, in order. <span className="hl">Highlighted</span> messages were cited as
              evidence.
            </p>
          </div>
          {timeline.length === 0 ? (
            <p className="small muted">No messages were recorded in this session.</p>
          ) : (
            <div className="transcript">
              {timeline.map((line) => {
                if (line.kind === "event") {
                  return (
                    <div key={`ev-${line.ev.id}`} id={`ev-${line.ev.id}`} className="transcript__event">
                      {line.text}
                    </div>
                  );
                }
                const msg = line.msg;
                const mine = msg.speaker_type === "learner";
                const isUpdate = mine && !msg.character_id;
                const words = (msg.content.match(/[A-Za-z0-9']+/g) ?? []).length;
                const coach = coachingById.get(msg.id);
                const who = mine
                  ? isUpdate
                    ? "You · status update"
                    : `You → ${names.get(msg.character_id ?? "") ?? "colleague"}`
                  : (names.get(msg.character_id ?? "") ?? "Colleague");
                return (
                  <div
                    key={msg.id}
                    id={`msg-${msg.id}`}
                    className={`bubble${mine ? " bubble--learner" : ""}${cited.has(msg.id) ? " is-cited" : ""}`}
                  >
                    <span className="bubble__who">{who}</span>
                    {msg.content}
                    <span className="transcript__meta">
                      {words} words
                      {msg.modality === "voice_transcript" ? " · voice" : ""}
                      {coach ? ` · try: “${coach.better}”` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </m.section>
      </m.div>
    </main>
  );
}
