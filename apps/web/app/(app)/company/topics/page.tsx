"use client";

import Link from "next/link";
import { CompanyGate } from "../../../../components/CompanyGate";
import { TRACK_LABELS, companyApi } from "../../../../lib/company";
import { useApi } from "../../../../lib/useApi";

export default function TopicsPage() {
  return <CompanyGate>{(company) => <Topics roster={company.judge_roster?.length ?? null} />}</CompanyGate>;
}

function Topics({ roster }: { roster: number | null }) {
  const { data } = useApi("/company/topics", companyApi.topics);
  const items = data?.items ?? [];
  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <span className="eyebrow">Topics</span>
          <h1 className="page-title">
            What candidates <span className="hl">face</span>
          </h1>
          <p className="muted small">A topic is the brief and the AI judges for an assessment. Reuse it across hiring rounds.</p>
        </div>
        <Link className="btn" href="/company/topics/new">New topic</Link>
      </div>
      {data && !items.length && (
        <div className="card stack" style={{ maxWidth: 560 }}>
          <p>No topics yet.</p>
          <Link className="btn" href="/company/topics/new">Create your first topic</Link>
        </div>
      )}
      <div className="grid-2">
        {items.map((t) => (
          <Link key={t.id} href={`/company/topics/${t.id}`} className="card card--lift stack" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="row between">
              <span className="eyebrow" style={{ marginBottom: 0 }}>{TRACK_LABELS[t.track]}</span>
              <span className="badge">{t.difficulty}</span>
            </div>
            <div className="section-title">{t.title}</div>
            <p className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {t.description || "No description"}
            </p>
            <p className="xsmall muted">
              {roster !== null ? `${t.judge_ids?.length ?? roster} of ${roster} judges · ` : ""}
              {Object.keys(t.judges).length} customised judge{Object.keys(t.judges).length === 1 ? "" : "s"} · used by {t.assessment_count} assessment{t.assessment_count === 1 ? "" : "s"}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
