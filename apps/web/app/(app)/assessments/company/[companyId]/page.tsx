"use client";

// One company: its public profile and every assessment it assigned to you, needs-action first.
// Selecting an assessment opens its briefing; nothing here starts a test (Continue resumes an
// attempt that already exists).
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormError } from "../../../../../components/AuthShell";
import { CompanyMark, DueLabel, StagePill, actionLabel } from "../../../../../components/candidate/ui";
import { attemptHref, candidateApi, type Assignment } from "../../../../../lib/candidate";
import { useApi } from "../../../../../lib/useApi";

type Filter = "all" | "todo" | "done" | "closed";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["todo", "To do"],
  ["done", "Submitted"],
  ["closed", "Closed"],
];
const IN: Record<Filter, (a: Assignment) => boolean> = {
  all: () => true,
  todo: (a) => ["invited", "ready", "in_progress"].includes(a.state.stage),
  done: (a) => ["submitted", "evaluated"].includes(a.state.stage),
  closed: (a) => ["missed", "expired", "declined", "withdrawn"].includes(a.state.stage),
};

export default function CompanyAssessmentsCompanyPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const { data, error } = useApi(`/me/company-assessments/companies/${companyId}`, () => candidateApi.company(companyId));
  const [filter, setFilter] = useState<Filter>("all");
  const [more, setMore] = useState(false);

  if (error)
    return (
      <main className="app-main ca-main">
        <Link className="text-link small" href="/assessments">← Company assessments</Link>
        <div className="card stack" style={{ marginTop: 20, maxWidth: 560 }} data-testid="ca-not-found">
          <h1 className="section-title">Nothing to show here</h1>
          <p className="muted small">No assessments from this company.</p>
          <FormError message={error} />
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="app-main ca-main">
        <div className="skeleton" style={{ height: 150, marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </main>
    );
  const { company: c, assignments } = data;
  const rows = assignments.filter(IN[filter]);
  const about = c.about || c.mission || c.vision;

  return (
    <main className="app-main ca-main">
      <Link className="text-link small" href="/assessments" data-testid="back-to-companies">← Company assessments</Link>
      <header className="ca-chead card">
        <CompanyMark name={c.name} size={64} />
        <div className="ca-chead__text">
          <span className="eyebrow" style={{ margin: 0 }}>{[c.industry, "Company"].filter(Boolean).join(" · ")}</span>
          <h1 className="ca-chead__name">{c.name}</h1>
          {c.tagline && <p className="ca-chead__tagline">{c.tagline}</p>}
          {about && (
            <p className={`small muted ca-chead__about${more ? " is-open" : ""}`}>
              {c.about || (c.mission ? `Mission: ${c.mission}` : `Vision: ${c.vision}`)}
            </p>
          )}
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            {about && about.length > 180 && (
              <button type="button" className="text-link xsmall" onClick={() => setMore((v) => !v)}>
                {more ? "Show less" : "Read more"}
              </button>
            )}
            {c.website && (
              <a className="text-link xsmall" href={c.website} target="_blank" rel="noopener noreferrer">
                {c.website.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="ca-section__head" style={{ marginTop: 28 }}>
        <h2 className="section-title">Assessments from {c.name}</h2>
        {assignments.length > 3 && (
          <div className="jr-seg" role="tablist" aria-label="Filter assessments">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? "is-on" : ""} onClick={() => setFilter(id)}>
                {label} <span className="muted">{assignments.filter(IN[id]).length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted small">Nothing in this view.</p>
      ) : (
        <ul className="list-reset ca-list" data-testid="assignment-list">
          {rows.map((a) => (
            <AssignmentCard key={a.id} a={a} />
          ))}
        </ul>
      )}
    </main>
  );
}

function AssignmentCard({ a }: { a: Assignment }) {
  const router = useRouter();
  const open = () => router.push(`/assessments/${a.id}`);
  const resume = a.state.can_continue || a.state.can_view_results ? attemptHref(a) : null;
  const done = ["submitted", "evaluated"].includes(a.state.stage);
  return (
    <li className={`ca-card ca-card--${a.state.tone}`} data-testid={`assignment-card-${a.id}`}>
      <button type="button" className="ca-card__main" onClick={open} aria-label={`${a.title}: ${a.state.label}. Open details`}>
        <span className="ca-card__top">
          <StagePill state={a.state} />
          <span className="xsmall muted">About {a.estimated_minutes} min</span>
        </span>
        <strong className="ca-card__title">{a.title}</strong>
        {a.description && <span className="small muted ca-card__desc">{a.description}</span>}
        {a.skills.length > 0 && (
          <span className="ca-chips">
            {a.skills.map((s) => (
              <span key={s.id} className="ca-chip">{s.name}</span>
            ))}
          </span>
        )}
        <span className="ca-card__meta small">
          {done && a.submitted_at ? <span>Submitted {new Date(a.submitted_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span> : <DueLabel due={a.due_at} />}
          {a.state.note && <span className="muted"> · {a.state.note}</span>}
        </span>
      </button>
      <div className="ca-card__side">
        {resume ? (
          <Link className={`btn btn--small${a.state.can_continue ? "" : " btn--ghost"}`} href={resume} data-testid={`card-action-${a.id}`}>
            {actionLabel(a.state)} →
          </Link>
        ) : (
          <button type="button" className={`btn btn--small${a.state.tone === "muted" ? " btn--ghost" : ""}`} onClick={open} data-testid={`card-action-${a.id}`}>
            {actionLabel(a.state)} →
          </button>
        )}
      </div>
    </li>
  );
}
