"use client";

import Link from "next/link";
import { CompanyGate } from "../../../components/CompanyGate";
import { FunnelChart } from "../../../components/CompanyCharts";
import { companyApi, type Company } from "../../../lib/company";
import { useApi } from "../../../lib/useApi";

export default function CompanyOverview() {
  return <CompanyGate>{(company) => <Overview company={company} />}</CompanyGate>;
}

function Overview({ company }: { company: Company }) {
  const { data: list } = useApi("/company/assessments", companyApi.assessments);
  const { data: topics } = useApi("/company/topics", companyApi.topics);
  const items = list?.items ?? [];
  const invited = items.reduce((n, a) => n + a.invited, 0);
  const completed = items.reduce((n, a) => n + a.completed, 0);
  const scored = items.filter((a) => a.avg_score !== null);
  const avg = scored.length
    ? Math.round((scored.reduce((n, a) => n + a.avg_score! * a.completed, 0) / Math.max(1, scored.reduce((n, a) => n + a.completed, 0))) * 10) / 10
    : null;

  const steps = [
    { done: Boolean(company.world_mode), label: "Set up your virtual workplace", href: "/company/workplace/setup", hint: "Use the default office or build your own with the world editor." },
    { done: (topics?.items.length ?? 0) > 0, label: "Create a topic", href: "/company/topics/new", hint: "Just a title and a description — or fill a sample." },
    { done: Boolean(company.profile.tagline || company.profile.about), label: "Describe your company", href: "/company/settings#profile", hint: "Candidates read it on their briefing before they start." },
    { done: Boolean(company.judge_roster) || Object.keys(company.judge_defaults).length > 0, label: "Set up your AI judges", href: "/company/judges", hint: "Who candidates meet, how they sound and behave." },
    { done: company.smtp_ready, label: "Connect your SMTP server", href: "/company/settings", hint: "Optional: invitations can also go out inside WorkVerse." },
    { done: items.length > 0, label: "Create an assessment", href: "/company/assessments/new", hint: "Scenario, brief, deadline and candidates in one flow." },
    { done: invited > 0, label: "Invite candidates", href: items[0] ? `/company/assessments/${items[0].id}` : "/company/assessments", hint: "Type, paste or upload a CSV of emails." },
  ];

  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <span className="eyebrow">{company.name} · hiring</span>
          <h1 className="page-title">
            Assessment <span className="hl">overview</span>
          </h1>
        </div>
        <div className="co-actions">
          <Link className="btn btn--ghost" href="/company/topics/new">New topic</Link>
          <Link className="btn" href="/company/assessments/new">New assessment</Link>
        </div>
      </div>

      <div className="co-kpis">
        <div className="card"><span className="eyebrow">Assessments</span><p className="stat">{list ? items.length : "…"}</p></div>
        <div className="card"><span className="eyebrow">Candidates invited</span><p className="stat">{list ? invited : "…"}</p></div>
        <div className="card">
          <span className="eyebrow">Completed</span>
          <p className="stat">{list ? completed : "…"}</p>
          <p className="xsmall muted">{invited ? `${Math.round((completed / invited) * 100)}% completion` : " "}</p>
        </div>
        <div className="card">
          <span className="eyebrow">Average score</span>
          <p className="stat">{avg ?? "—"}{avg !== null && <span className="small muted"> /100</span>}</p>
        </div>
      </div>

      {steps.some((s) => !s.done) && (
        <section className="card co-section" style={{ marginTop: 0 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>Getting started</h2>
          <ul className="list-reset">
            {steps.map((s) => (
              <li key={s.label} className="list-row">
                <span className="row" style={{ gap: 12, alignItems: "center" }}>
                  <span className={`badge${s.done ? " badge--ok" : ""}`}>{s.done ? "Done" : "To do"}</span>
                  <span>
                    <strong>{s.label}</strong>
                    <br />
                    <span className="xsmall muted">{s.hint}</span>
                  </span>
                </span>
                {!s.done && <Link className="text-link small" href={s.href}>Open →</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="co-section">
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 className="section-title">Assessments</h2>
          <Link className="text-link small" href="/company/assessments">View all →</Link>
        </div>
        {list && !items.length && <p className="muted small">No assessments yet.</p>}
        <div className="grid-2">
          {items.slice(0, 6).map((a) => (
            <Link key={a.id} href={`/company/assessments/${a.id}`} className="card card--lift stack" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row between">
                <span className="eyebrow" style={{ marginBottom: 0 }}>{a.topic_title}</span>
                <span className={`badge${a.status === "active" ? " badge--ok" : ""}`}>{a.status}</span>
              </div>
              <div className="section-title">{a.title}</div>
              <FunnelChart
                steps={[
                  { id: "invited", label: "Invited", count: a.invited },
                  { id: "started", label: "Started", count: a.started },
                  { id: "completed", label: "Completed", count: a.completed },
                ]}
              />
              <p className="small muted">Average score: <strong>{a.avg_score ?? "—"}</strong></p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
