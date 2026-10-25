"use client";

import { useState } from "react";
import Link from "next/link";
import { CompanyGate } from "../../../../components/CompanyGate";
import { companyApi } from "../../../../lib/company";
import { useApi } from "../../../../lib/useApi";
import { AssessmentsPdfDialog } from "../../../../components/company/ReportExport";

export default function AssessmentsPage() {
  return <CompanyGate>{() => <Assessments />}</CompanyGate>;
}

function Assessments() {
  const { data } = useApi("/company/assessments", companyApi.assessments);
  const items = data?.items ?? [];
  const [pdfOpen, setPdfOpen] = useState(false);
  return (
    <main className="app-main">
      {pdfOpen && <AssessmentsPdfDialog assessments={items} onClose={() => setPdfOpen(false)} />}
      <div className="co-head">
        <div>
          <span className="eyebrow">Assessments</span>
          <h1 className="page-title">
            Hiring <span className="hl">rounds</span>
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn--ghost" disabled={!items.length} onClick={() => setPdfOpen(true)} data-testid="assessments-report">
            Download reports
          </button>
          <Link className="btn" href="/company/assessments/new">New assessment</Link>
        </div>
      </div>
      {data && !items.length && <p className="muted">No assessments yet.</p>}
      {items.length > 0 && (
        <div className="card co-table-wrap">
          <table className="co-table">
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Status</th>
                <th>Invited</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Avg score</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link className="text-link" href={`/company/assessments/${a.id}`}><strong>{a.title}</strong></Link>
                    <br />
                    <span className="xsmall muted">{a.topic_title}</span>
                  </td>
                  <td><span className={`badge${a.status === "active" ? " badge--ok" : ""}`}>{a.status}</span></td>
                  <td className="mono">{a.invited}</td>
                  <td className="mono">{a.started}</td>
                  <td className="mono">{a.completed}</td>
                  <td className="co-score">{a.avg_score ?? "—"}</td>
                  <td className="small muted">{new Date(a.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
