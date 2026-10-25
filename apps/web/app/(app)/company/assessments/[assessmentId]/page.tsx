"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { FormError } from "../../../../../components/AuthShell";
import { BandDot, BandStack, FunnelChart, HistogramChart, RankingBars, SkillBars } from "../../../../../components/CompanyCharts";
import { companyApi, parseCandidates, type AssessmentDetail, type Candidate, type InviteChannel, type InviteResult } from "../../../../../lib/company";
import { useApi } from "../../../../../lib/useApi";

export default function AssessmentPage() {
  return <CompanyGate>{() => <Assessment />}</CompanyGate>;
}

function Assessment() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const key = `/company/assessments/${assessmentId}`;
  const { data, error, setData } = useApi(key, () => companyApi.assessment(assessmentId));
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = async () => setData(await companyApi.assessment(assessmentId));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <main className="app-main"><FormError message={error} /></main>;
  if (!data) return <main className="app-main"><div className="skeleton" style={{ height: 300 }} /></main>;
  const { assessment: a, summary: sm } = data;

  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <Link className="text-link small" href="/company/assessments">← Assessments</Link>
          <span className="eyebrow" style={{ marginTop: 16 }}>
            {a.topic_title} · <span className={`badge${a.status === "active" ? " badge--ok" : ""}`}>{a.status}</span>
          </span>
          <h1 className="page-title">{a.title}</h1>
        </div>
        <div className="co-actions">
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => run("csv", () => companyApi.downloadCsv(a.id))} data-testid="export-csv">
            {busy === "csv" ? <span className="busy-dots">Exporting</span> : "Export CSV"}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => run("pdf", () => companyApi.downloadPdf(a.id))} data-testid="export-pdf">
            {busy === "pdf" ? <span className="busy-dots">Building PDF</span> : "Export PDF report"}
          </button>
          <button
            className="btn btn--ghost"
            disabled={busy !== null}
            onClick={() => run("status", async () => {
              await companyApi.setStatus(a.id, a.status === "active" ? "closed" : "active");
              await reload();
            })}
          >
            {a.status === "active" ? "Close" : "Reopen"}
          </button>
        </div>
      </div>
      <FormError message={actionError} />

      <div className="co-kpis">
        <div className="card"><span className="eyebrow">Invited</span><p className="stat" data-testid="kpi-invited">{sm.total}</p></div>
        <div className="card">
          <span className="eyebrow">Completed</span>
          <p className="stat" data-testid="kpi-completed">{sm.completed}</p>
          <p className="xsmall muted">{sm.completion_rate}% completion</p>
        </div>
        <div className="card">
          <span className="eyebrow">Average score</span>
          <p className="stat">{sm.avg_score ?? "—"}{sm.avg_score !== null && <span className="small muted"> /100</span>}</p>
          <p className="xsmall muted">{sm.median_score !== null ? `median ${sm.median_score}` : " "}</p>
        </div>
        <div className="card">
          <span className="eyebrow">Top candidate</span>
          <p className="section-title" style={{ marginTop: 8 }}>{sm.top_candidate ?? "—"}</p>
          <p className="xsmall muted">{sm.top_score !== null ? `${sm.top_score}/100` : " "}</p>
        </div>
      </div>

      {a.status === "active" && <InvitePanel detail={data} onDone={reload} />}

      <section className="co-section">
        <h2 className="section-title">Results at a glance</h2>
        <div className="co-two">
          <div className="card stack">
            <span className="eyebrow">Candidate pipeline</span>
            <FunnelChart steps={sm.funnel} />
          </div>
          <div className="card stack">
            <span className="eyebrow">Recommendation bands</span>
            <BandStack bands={sm.bands} />
          </div>
          <div className="card stack">
            <span className="eyebrow">Score distribution</span>
            {sm.completed ? <HistogramChart bins={sm.histogram} /> : <p className="small muted">Appears once candidates finish.</p>}
          </div>
          <div className="card stack">
            <span className="eyebrow">Skills across the group (avg 0–100)</span>
            {sm.completed ? (
              <SkillBars skills={data.skills} values={Object.fromEntries(sm.skills.map((s) => [s.id, s.average]))} />
            ) : (
              <p className="small muted">Appears once candidates finish.</p>
            )}
          </div>
        </div>
        {sm.ranking.length > 0 && <RankingPanel detail={data} />}
      </section>

      <CandidateTable detail={data} busy={busy} run={run} reload={reload} />
    </main>
  );
}

function RankingPanel({ detail }: { detail: AssessmentDetail }) {
  const router = useRouter();
  return (
    <div className="card stack" style={{ marginTop: 20 }}>
      <span className="eyebrow">Ranking · click a candidate for their full report</span>
      <RankingBars ranking={detail.summary.ranking} onPick={(id) => router.push(`/company/assessments/${detail.assessment.id}/candidates/${id}`)} />
    </div>
  );
}

function InvitePanel({ detail, onDone }: { detail: AssessmentDetail; onDone: () => Promise<void> }) {
  const [tab, setTab] = useState<"manual" | "paste" | "csv">("manual");
  const [rows, setRows] = useState([{ name: "", email: "" }]);
  const [paste, setPaste] = useState("");
  const [csv, setCsv] = useState<{ file: string; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [channel, setChannel] = useState<InviteChannel>("app");
  const needsSmtp = channel !== "app";
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (tab === "manual") return parseCandidates(rows.filter((r) => r.email.trim()).map((r) => `${r.name} <${r.email.trim()}>`).join("\n"));
    if (tab === "paste") return parseCandidates(paste);
    return csv ? parseCandidates(csv.text) : [];
  }, [tab, rows, paste, csv]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setCsv({ file: f.name, text: await f.text() });
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await companyApi.invite(detail.assessment.id, parsed, channel);
      setResult(res);
      if (res.sent) {
        setRows([{ name: "", email: "" }]);
        setPaste("");
        setCsv(null);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invites.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack co-section" style={{ marginTop: 0 }}>
      <div className="row between">
        <div>
          <h2 className="section-title">Invite candidates</h2>
          <p className="small muted">Each candidate gets a personal assessment link. Already-invited emails are skipped.</p>
        </div>
      </div>
      <fieldset className="co-channel" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="eyebrow" style={{ marginBottom: 8 }}>Deliver</legend>
        {(
          [
            ["app", "In WorkVerse", "A notification and a live popup in the app"],
            ["email", "By email", "Sent from your SMTP server"],
            ["both", "Both", "In the app and by email"],
          ] as const
        ).map(([id, label, hint]) => (
          <label key={id} title={hint}>
            <input type="radio" name="invite-channel" value={id} checked={channel === id} onChange={() => setChannel(id)} data-testid={`channel-${id}`} />
            <span>
              <strong>{label}</strong> <span className="xsmall muted">· {hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {channel === "app" && (
        <p className="xsmall muted" style={{ margin: 0 }}>
          Candidates with a WorkVerse account get it right away. Anyone else sees it as soon as they sign up with the same email — choose <b>Both</b> to also email them a link.
        </p>
      )}
      {needsSmtp && !detail.smtp_ready && (
        <div className="banner banner--error">
          SMTP isn&apos;t set up yet, so invites can&apos;t be emailed. <Link className="text-link" href="/company/settings">Add your SMTP server →</Link>
        </div>
      )}
      <div className="co-tabs" role="tablist">
        {(
          [
            ["manual", "Type"],
            ["paste", "Paste list"],
            ["csv", "Upload CSV"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "manual" && (
        <div className="stack--sm stack">
          {rows.map((r, i) => (
            <div key={i} className="co-manual-row">
              <input className="input" aria-label={`Candidate ${i + 1} name`} placeholder="Full name (optional)" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" type="email" aria-label={`Candidate ${i + 1} email`} placeholder="email@example.com" value={r.email} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              <button type="button" className="btn btn--ghost btn--small" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--small" style={{ justifySelf: "start" }} onClick={() => setRows([...rows, { name: "", email: "" }])}>+ Add another</button>
        </div>
      )}
      {tab === "paste" && (
        <div className="field">
          <label htmlFor="invite-paste">Emails</label>
          <textarea
            id="invite-paste"
            className="textarea"
            rows={6}
            placeholder={"One per line, or separated by commas:\nAsha Patel <asha@example.com>\nben@example.com, chen@example.com"}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
        </div>
      )}
      {tab === "csv" && (
        <div
          className={`co-dropzone${over ? " is-over" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void readFile(e.dataTransfer.files[0]);
          }}
        >
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden data-testid="csv-input" onChange={(e) => void readFile(e.target.files?.[0])} />
          <p><strong>{csv ? csv.file : "Drop a CSV here or click to choose"}</strong></p>
          <p className="xsmall muted">Needs an <span className="mono">email</span> column; <span className="mono">name</span> (or first/last name) is optional.</p>
        </div>
      )}

      {parsed.length > 0 && (
        <div className="stack--sm stack">
          <span className="eyebrow" style={{ marginBottom: 0 }}>{parsed.length} candidate{parsed.length === 1 ? "" : "s"} ready</span>
          <div className="co-preview">
            {parsed.map((p) => (
              <span key={p.email} className="chip chip--static">{p.name ? `${p.name} · ` : ""}{p.email}</span>
            ))}
          </div>
        </div>
      )}
      <FormError message={error} />
      {result && (
        <div className={`banner ${result.failed.length ? "banner--error" : "banner--info"}`} role="status" data-testid="invite-result">
          <span>
            {result.channel === "app" ? "Delivered" : "Sent"} {result.sent} invite{result.sent === 1 ? "" : "s"}{result.channel === "app" ? " in WorkVerse" : result.channel === "both" ? " (app + email)" : ""}.
            {(result.awaiting_signup?.length ?? 0) > 0 && ` ${result.awaiting_signup!.length} ${result.awaiting_signup!.length === 1 ? "person doesn't" : "people don't"} have an account yet and will see it when they sign up.`}
            {result.already_invited.length > 0 && ` ${result.already_invited.length} already invited.`}
            {result.invalid.length > 0 && ` Invalid: ${result.invalid.join(", ")}.`}
            {result.failed.length > 0 && ` Failed: ${result.failed.map((f) => `${f.email} (${f.error})`).join("; ")}`}
          </span>
        </div>
      )}
      <div>
        <button className="btn" onClick={send} disabled={busy || !parsed.length} data-testid="send-invites">
          {busy ? <span className="busy-dots">Sending</span> : `Send ${parsed.length || ""} invite${parsed.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

type SortKey = "score" | "name" | "status";

function CandidateTable({
  detail,
  busy,
  run,
  reload,
}: {
  detail: AssessmentDetail;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [sort, setSort] = useState<SortKey>("score");
  const [filter, setFilter] = useState("all");
  const order: Record<Candidate["status"], number> = { completed: 0, in_progress: 1, opened: 2, invited: 3, pending: 4, email_failed: 5 };
  const rows = detail.candidates
    .filter((c) => filter === "all" || c.status === filter)
    .sort((x, y) =>
      sort === "name" ? x.name.localeCompare(y.name) : sort === "status" ? order[x.status] - order[y.status] : (y.score ?? -1) - (x.score ?? -1),
    );
  const base = `/company/assessments/${detail.assessment.id}`;

  return (
    <section className="co-section">
      <div className="row between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <h2 className="section-title">Candidates ({detail.candidates.length})</h2>
        <select className="select" style={{ width: "auto" }} aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="in_progress">In progress</option>
          <option value="opened">Opened invite</option>
          <option value="invited">Invited</option>
          <option value="email_failed">Email failed</option>
        </select>
      </div>
      {detail.candidates.length === 0 ? (
        <p className="muted small">No one invited yet.</p>
      ) : (
        <div className="card co-table-wrap">
          <table className="co-table" data-testid="candidate-table">
            <thead>
              <tr>
                <th><button onClick={() => setSort("name")}>Candidate{sort === "name" ? " ↓" : ""}</button></th>
                <th><button onClick={() => setSort("status")}>Status{sort === "status" ? " ↓" : ""}</button></th>
                <th><button onClick={() => setSort("score")}>Score{sort === "score" ? " ↓" : ""}</button></th>
                <th>Band</th>
                <th>Strengths</th>
                <th>Probe in interview</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <br />
                    <span className="xsmall muted">{c.email}</span>
                  </td>
                  <td>
                    <span className={`badge${c.status === "completed" ? " badge--ok" : c.status === "email_failed" ? " badge--warn" : c.status === "in_progress" ? " badge--active" : ""}`} title={c.email_error ?? undefined}>
                      {c.status_label}
                    </span>
                    <br />
                    <span className="xsmall muted" data-testid="invite-channel">{c.channel === "app" ? "via WorkVerse" : c.channel === "both" ? "via app + email" : "via email"}</span>
                  </td>
                  <td className="co-score">{c.score ?? "—"}</td>
                  <td className="small"><BandDot label={c.band?.label} /></td>
                  <td className="small">{c.strengths.join(", ") || <span className="muted">—</span>}</td>
                  <td className="small">{c.gaps.map((g) => g.skill).join(", ") || <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.session_id ? (
                      <Link className="btn btn--ghost btn--small" href={`${base}/candidates/${c.id}`}>View report</Link>
                    ) : (
                      <>
                        <button className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => run(`resend-${c.id}`, async () => {
                          const res = await companyApi.resend(detail.assessment.id, c.id);
                          if (!res.ok) throw new Error(`Resend failed: ${res.error}`);
                          await reload();
                        })}>
                          {busy === `resend-${c.id}` ? "…" : "Resend"}
                        </button>{" "}
                        <button className="btn btn--ghost btn--small" aria-label={`Remove ${c.email}`} disabled={busy !== null} onClick={() => run(`rm-${c.id}`, async () => {
                          if (!window.confirm(`Remove ${c.email} from this assessment?`)) return;
                          await companyApi.removeInvite(detail.assessment.id, c.id);
                          await reload();
                        })}>
                          ✕
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
