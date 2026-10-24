"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CompanyGate } from "../../../../../../../components/CompanyGate";
import { FormError } from "../../../../../../../components/AuthShell";
import { BandDot, SkillBars } from "../../../../../../../components/CompanyCharts";
import { TalkBalance } from "../../../../../../../components/Charts";
import { companyApi } from "../../../../../../../lib/company";
import { useApi } from "../../../../../../../lib/useApi";

const SKILLS = [
  { id: "diagnosis", name: "Problem solving", description: "Gathers facts and evidence before acting; asks targeted questions." },
  { id: "risk_decision", name: "Judgement under risk", description: "Checks what could go wrong before making a change; picks a safe option." },
  { id: "communication", name: "Communication", description: "Keeps people informed clearly: impact, what's known, next steps and timing." },
  { id: "ownership", name: "Ownership & teamwork", description: "Takes responsibility, involves the right people and follows up." },
  { id: "adaptation", name: "Adaptability", description: "Changes course when new information appears and confirms the result." },
];

export default function CandidatePage() {
  return <CompanyGate>{() => <CandidateReport />}</CompanyGate>;
}

function CandidateReport() {
  const { assessmentId, inviteId } = useParams<{ assessmentId: string; inviteId: string }>();
  const { data, error } = useApi(`/company/assessments/${assessmentId}/candidates/${inviteId}`, () => companyApi.candidate(assessmentId, inviteId));
  if (error) return <main className="app-main"><FormError message={error} /></main>;
  if (!data) return <main className="app-main"><div className="skeleton" style={{ height: 300 }} /></main>;
  const { candidate: c, summary: sm, evaluation: ev } = data;
  const cohort = Object.fromEntries(sm.skills.map((s) => [s.id, s.average]));

  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <Link className="text-link small" href={`/company/assessments/${assessmentId}`}>← Back to assessment</Link>
          <span className="eyebrow" style={{ marginTop: 16 }}>Candidate report · {c.status_label}</span>
          <h1 className="page-title">{c.name}</h1>
          <p className="small muted">{c.email}{c.minutes !== null && ` · finished in ${c.minutes} min`}</p>
        </div>
        <div className="card" style={{ minWidth: 220 }}>
          <span className="eyebrow">Overall</span>
          <p className="stat" data-testid="candidate-score">{c.score ?? "—"}{c.score !== null && <span className="small muted"> /100</span>}</p>
          <p className="small" style={{ marginTop: 6 }}><BandDot label={c.band?.label} /></p>
        </div>
      </div>

      {c.status !== "completed" && (
        <div className="banner">This candidate hasn&apos;t finished yet. Their report appears here when they do.</div>
      )}

      {c.band && (
        <div className="banner banner--info" style={{ marginBottom: 20 }}>
          <span><strong>Suggested next step:</strong> {c.band.advice}</span>
        </div>
      )}

      {c.status === "completed" && (
        <div className="co-two">
          <section className="card stack">
            <span className="eyebrow">Skill profile vs. group</span>
            <SkillBars skills={SKILLS} values={c.skills} compare={cohort} />
          </section>
          <section className="card stack">
            <span className="eyebrow">Summary</span>
            <p>{c.summary}</p>
            <div>
              <h3 className="mono xsmall" style={{ margin: "8px 0" }}>Strengths</h3>
              <p className="small">{c.strengths.join(", ") || "No skill reached the strong level."}</p>
            </div>
            <div>
              <h3 className="mono xsmall" style={{ margin: "8px 0" }}>Areas to probe in interview</h3>
              <ul className="list-reset stack--sm stack">
                {c.gaps.length ? c.gaps.map((g) => (
                  <li key={g.skill} className="small"><strong>{g.skill}</strong>{g.advice && ` — ${g.advice}`}</li>
                )) : <li className="small">No major gaps found.</li>}
              </ul>
            </div>
            <div className="stat-tiles">
              <div className="stat-tile"><span className="xsmall muted">Messages</span><strong>{c.messages ?? "—"}</strong></div>
              <div className="stat-tile"><span className="xsmall muted">Questions</span><strong>{c.question_ratio !== null ? `${Math.round(c.question_ratio * 100)}%` : "—"}</strong></div>
              <div className="stat-tile"><span className="xsmall muted">Words / msg</span><strong>{c.avg_words ?? "—"}</strong></div>
              <div className="stat-tile"><span className="xsmall muted">Key checks</span><strong>{c.checks_total ? `${c.checks_passed}/${c.checks_total}` : "—"}</strong></div>
            </div>
          </section>
        </div>
      )}

      {ev && (
        <section className="co-section">
          <h2 className="section-title">Evidence behind each score</h2>
          <div className="stack">
            {ev.items.map((it) => (
              <div key={it.criterion_id} className="card stack--sm stack">
                <div className="row between">
                  <strong>{SKILLS.find((s) => s.id === it.criterion_id)?.name ?? it.criterion_name}</strong>
                  <span className="mono small">{it.score === null ? "no evidence" : `${it.score}/${it.score_max}`}</span>
                </div>
                <p className="small">{it.explanation}</p>
                {it.evidence.map((e, i) => e.quote && <blockquote key={i} className="co-quote">“{e.quote}”</blockquote>)}
              </div>
            ))}
          </div>
        </section>
      )}

      {ev?.conversation && ev.conversation.people.length > 0 && (
        <section className="co-section card stack">
          <span className="eyebrow">Who did the talking</span>
          <TalkBalance people={ev.conversation.people} />
        </section>
      )}

      {data.transcript.length > 0 && (
        <section className="co-section">
          <h2 className="section-title">Transcript</h2>
          <ul className="list-reset card co-transcript">
            {data.transcript.map((m) => (
              <li key={m.id}>
                <span className={`mono xsmall${m.speaker === "candidate" ? "" : " muted"}`}>{m.speaker === "candidate" ? c.name : m.speaker}</span>
                <span>{m.content}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
