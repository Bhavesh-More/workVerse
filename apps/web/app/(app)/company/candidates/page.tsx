"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CompanyGate } from "../../../../components/CompanyGate";
import { FormError } from "../../../../components/AuthShell";
import { BandDot, BandStack, FunnelChart, SkillBars } from "../../../../components/CompanyCharts";
import { companyApi, type CompanyCandidate } from "../../../../lib/company";
import { useApi } from "../../../../lib/useApi";

export default function CandidatesPage() {
  return <CompanyGate>{() => <Candidates />}</CompanyGate>;
}

type SortKey = "score" | "name" | "status" | "assessment";
const ORDER: Record<CompanyCandidate["status"], number> = { completed: 0, in_progress: 1, opened: 2, invited: 3, pending: 4, email_failed: 5 };

function Candidates() {
  const { data, error } = useApi("/company/candidates", companyApi.allCandidates);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [band, setBand] = useState("all");
  const [round, setRound] = useState("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const all = useMemo(() => data?.candidates ?? [], [data]);
  const rounds = useMemo(() => [...new Map(all.map((c) => [c.assessment_id, c.assessment_title])).entries()], [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q))
      .filter((c) => status === "all" || c.status === status)
      .filter((c) => band === "all" || c.band?.label === band)
      .filter((c) => round === "all" || c.assessment_id === round)
      .sort((x, y) =>
        sort === "name"
          ? x.name.localeCompare(y.name)
          : sort === "status"
            ? ORDER[x.status] - ORDER[y.status]
            : sort === "assessment"
              ? x.assessment_title.localeCompare(y.assessment_title)
              : (y.score ?? -1) - (x.score ?? -1),
      );
  }, [all, query, status, band, round, sort]);

  const exportFile = async (kind: "csv" | "pdf") => {
    setBusy(kind);
    setActionError(null);
    try {
      await (kind === "csv" ? companyApi.downloadAllCsv() : companyApi.downloadAllPdf());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <main className="app-main"><FormError message={error} /></main>;
  if (!data) return <main className="app-main"><div className="skeleton" style={{ height: 300 }} /></main>;
  const sm = data.summary;
  const th = (key: SortKey, label: string) => (
    <th><button onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button></th>
  );

  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <span className="eyebrow">Candidates · all assessments</span>
          <h1 className="page-title">
            Everyone you&apos;ve <span className="hl">assessed</span>
          </h1>
        </div>
        <div className="co-actions">
          <button className="btn btn--ghost" disabled={busy !== null || !all.length} onClick={() => exportFile("csv")} data-testid="export-all-csv">
            {busy === "csv" ? <span className="busy-dots">Exporting</span> : "Export CSV"}
          </button>
          <button className="btn" disabled={busy !== null || !all.length} onClick={() => exportFile("pdf")} data-testid="export-all-pdf">
            {busy === "pdf" ? <span className="busy-dots">Building PDF</span> : "Export PDF report"}
          </button>
        </div>
      </div>
      <FormError message={actionError} />

      <div className="co-kpis">
        <div className="card"><span className="eyebrow">Candidates</span><p className="stat" data-testid="all-total">{sm.total}</p></div>
        <div className="card">
          <span className="eyebrow">Completed</span>
          <p className="stat" data-testid="all-completed">{sm.completed}</p>
          <p className="xsmall muted">{sm.completion_rate}% completion</p>
        </div>
        <div className="card">
          <span className="eyebrow">Average score</span>
          <p className="stat">{sm.avg_score ?? "—"}{sm.avg_score !== null && <span className="small muted"> /100</span>}</p>
        </div>
        <div className="card">
          <span className="eyebrow">Suggested to advance</span>
          <p className="stat">{sm.bands.filter((b) => b.label === "Strong" || b.label === "Good").reduce((n, b) => n + b.count, 0)}</p>
          <p className="xsmall muted">Strong or Good band</p>
        </div>
      </div>

      {all.length > 0 && (
        <div className="co-two">
          <div className="card stack">
            <span className="eyebrow">Pipeline</span>
            <FunnelChart steps={sm.funnel} />
          </div>
          <div className="card stack">
            <span className="eyebrow">Recommendation bands</span>
            <BandStack bands={sm.bands} />
          </div>
          {sm.completed > 0 && (
            <div className="card stack" style={{ gridColumn: "1 / -1" }}>
              <span className="eyebrow">Skills across everyone who completed (avg 0–100)</span>
              <SkillBars skills={data.skills} values={Object.fromEntries(sm.skills.map((s) => [s.id, s.average]))} />
            </div>
          )}
        </div>
      )}

      <section className="co-section">
        <div className="co-actions" style={{ marginBottom: 14 }}>
          <input className="input" style={{ maxWidth: 280 }} type="search" aria-label="Search candidates" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="select" style={{ width: "auto" }} aria-label="Filter by assessment" value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="all">All assessments</option>
            {rounds.map(([id, title]) => (
              <option key={id} value={id}>{title}</option>
            ))}
          </select>
          <select className="select" style={{ width: "auto" }} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="in_progress">In progress</option>
            <option value="opened">Opened invite</option>
            <option value="invited">Invited</option>
            <option value="email_failed">Email failed</option>
          </select>
          <select className="select" style={{ width: "auto" }} aria-label="Filter by band" value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="all">All bands</option>
            {["Strong", "Good", "Developing", "Needs support"].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <span className="small muted">{rows.length} of {all.length}</span>
        </div>
        {all.length === 0 ? (
          <p className="muted small">No candidates yet. <Link className="text-link" href="/company/assessments">Invite some from an assessment →</Link></p>
        ) : (
          <div className="card co-table-wrap">
            <table className="co-table" data-testid="all-candidates-table">
              <thead>
                <tr>
                  {th("name", "Candidate")}
                  {th("assessment", "Assessment")}
                  {th("status", "Status")}
                  {th("score", "Score")}
                  <th>Band</th>
                  <th>Probe in interview</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><br /><span className="xsmall muted">{c.email}</span></td>
                    <td className="small"><Link className="text-link" href={`/company/assessments/${c.assessment_id}`}>{c.assessment_title}</Link></td>
                    <td><span className={`badge${c.status === "completed" ? " badge--ok" : c.status === "email_failed" ? " badge--warn" : ""}`}>{c.status_label}</span></td>
                    <td className="co-score">{c.score ?? "—"}</td>
                    <td className="small"><BandDot label={c.band?.label} /></td>
                    <td className="small">{c.gaps.map((g) => g.skill).join(", ") || <span className="muted">—</span>}</td>
                    <td>
                      {c.session_id && (
                        <Link className="btn btn--ghost btn--small" href={`/company/assessments/${c.assessment_id}/candidates/${c.id}`}>View report</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
