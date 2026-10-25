"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { FormError } from "../../../../../components/AuthShell";
import { BandDot, BandStack, FunnelChart, HistogramChart, RankingBars, SkillBars } from "../../../../../components/CompanyCharts";
import { BriefFields, DeadlineField, SKILL_OPTIONS } from "../../../../../components/company/AssessmentFields";
import { CandidateEntry, type Person } from "../../../../../components/company/CandidateEntry";
import { STATUS_FILTERS, STATUS_ORDER, companyApi, statusBadge, type AssessmentDetail, type AssessmentFields, type InviteChannel, type InviteResult } from "../../../../../lib/company";
import { formatWhen, relative, zoneAbbr } from "../../../../../lib/time";
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
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

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
          <p className="small" style={{ margin: 0 }} data-testid="assessment-deadline">
            {a.due_at ? (
              <>
                <b>Due {formatWhen(a.due_at, a.timezone, true)} {zoneAbbr(a.due_at, a.timezone)}</b>{" "}
                <span className={a.past_due ? "jr-err" : "muted"}>· {a.past_due ? `passed ${relative(a.due_at)}` : relative(a.due_at)}</span>
              </>
            ) : (
              <span className="muted">No deadline</span>
            )}
          </p>
        </div>
        <div className="co-actions">
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => run("csv", () => companyApi.downloadCsv(a.id))} data-testid="export-csv">
            {busy === "csv" ? <span className="busy-dots">Exporting</span> : "Export CSV"}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => run("pdf", () => companyApi.downloadPdf(a.id))} data-testid="export-pdf">
            {busy === "pdf" ? <span className="busy-dots">Building PDF</span> : "Export PDF report"}
          </button>
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => setEditing(true)} data-testid="edit-assessment">Edit details</button>
          {a.status === "active" ? (
            <button className="btn btn--ghost" disabled={busy !== null} onClick={() => setConfirmClose(true)} data-testid="withdraw-assessment">Withdraw</button>
          ) : (
            <button className="btn btn--ghost" disabled={busy !== null} onClick={() => run("status", async () => { await companyApi.setStatus(a.id, "active"); await reload(); })}>Reopen</button>
          )}
        </div>
      </div>
      <FormError message={actionError} />
      {confirmClose && (
        <div className="banner banner--warn jr-confirm" role="alert" data-testid="withdraw-confirm">
          <span>
            Withdraw this assessment? People who haven&apos;t started can no longer accept or start it, and they&apos;ll be told. Anyone already in
            the middle can finish, and finished reports stay.
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button className="btn btn--small" onClick={() => run("status", async () => { await companyApi.setStatus(a.id, "closed"); setConfirmClose(false); await reload(); })} data-testid="withdraw-yes">Withdraw</button>
            <button className="btn btn--ghost btn--small" onClick={() => setConfirmClose(false)}>Keep it open</button>
          </span>
        </div>
      )}
      {editing && <EditDialog detail={data} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await reload(); }} />}
      <Brief detail={data} />

      <div className="co-kpis">
        <div className="card">
          <span className="eyebrow">Invited</span>
          <p className="stat" data-testid="kpi-invited">{sm.total}</p>
          <p className="xsmall muted" data-testid="kpi-responses">
            {data.candidates.filter((c) => c.accepted_at || c.session_id).length} accepted · {data.candidates.filter((c) => c.invitation === "declined").length} declined
          </p>
        </div>
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
  const [people, setPeople] = useState<Person[]>([]);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<InviteChannel>("app");
  const needsSmtp = channel !== "app";
  const a = detail.assessment;

  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await companyApi.invite(a.id, people, channel);
      setResult(res);
      if (res.sent) setReset((r) => r + 1);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invites.");
    } finally {
      setBusy(false);
    }
  };

  if (a.past_due)
    return (
      <section className="card stack co-section" style={{ marginTop: 0 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Invite candidates</h2>
        <p className="small muted" style={{ margin: 0 }}>Deadline passed. Move the due date to invite more.</p>
      </section>
    );

  return (
    <section className="card stack co-section" style={{ marginTop: 0 }}>
      <div>
        <h2 className="section-title">Invite candidates</h2>
      </div>
      <fieldset className="co-channel" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="eyebrow" style={{ marginBottom: 8 }}>Deliver</legend>
        {(
          [
            ["app", "In WorkVerse", "In-app notification"],
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
      {needsSmtp && !detail.smtp_ready && (
        <div className="banner banner--error">
          SMTP isn&apos;t set up yet, so invites can&apos;t be emailed. <Link className="text-link" href="/company/settings">Add your SMTP server →</Link>
        </div>
      )}
      <CandidateEntry onChange={setPeople} resetKey={reset} />
      <FormError message={error} />
      {result && (
        <div className={`banner ${result.failed.length || result.email_failed?.length ? "banner--error" : "banner--info"}`} role="status" data-testid="invite-result">
          <span>
            {result.channel === "app" ? "Delivered" : "Sent"} {result.sent} invite{result.sent === 1 ? "" : "s"}{result.channel === "app" ? " in WorkVerse" : result.channel === "both" ? " (app + email)" : ""}.
            {(result.awaiting_signup?.length ?? 0) > 0 && ` ${result.awaiting_signup!.length} ${result.awaiting_signup!.length === 1 ? "person doesn't" : "people don't"} have an account yet and will see it when they sign up.`}
            {result.already_invited.length > 0 && ` ${result.already_invited.length} already invited.`}
            {result.invalid.length > 0 && ` Invalid: ${result.invalid.join(", ")}.`}
            {result.channel === "both" && (result.email_failed?.length ?? 0) > 0 && ` Email not sent to ${result.email_failed!.map((f) => f.email).join(", ")} (${result.email_failed![0]!.error}); they still have it in WorkVerse.`}
            {result.failed.length > 0 && ` Failed: ${result.failed.map((f) => `${f.email} (${f.error})`).join("; ")}`}
          </span>
        </div>
      )}
      <div>
        <button className="btn" onClick={send} disabled={busy || !people.length} data-testid="send-invites">
          {busy ? <span className="busy-dots">Sending</span> : `Send ${people.length || ""} invite${people.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}

function Brief({ detail }: { detail: AssessmentDetail }) {
  const a = detail.assessment;
  const skills = SKILL_OPTIONS.filter((s) => a.skills.includes(s.id));
  const empty = !a.description && !a.expectations && !a.instructions;
  return (
    <details className="card co-brief" open={!empty} data-testid="assessment-brief">
      <summary>
        <span className="eyebrow" style={{ margin: 0 }}>What candidates see on their briefing</span>
      </summary>
      <div className="co-brief__grid">
        <div>
          <span className="eyebrow">Description</span>
          <p className="small">{a.description || <span className="muted">Using topic description.</span>}</p>
        </div>
        <div>
          <span className="eyebrow">What you&apos;re looking for</span>
          <p className="small">{a.expectations || <span className="muted">Not written.</span>}</p>
        </div>
        <div>
          <span className="eyebrow">Skills emphasised</span>
          <p className="small">{skills.length ? skills.map((s) => s.name).join(", ") : <span className="muted">All five equally.</span>}</p>
        </div>
        <div>
          <span className="eyebrow">Instructions</span>
          <p className="small" style={{ whiteSpace: "pre-line" }}>{a.instructions || <span className="muted">None.</span>}</p>
        </div>
      </div>
    </details>
  );
}

function EditDialog({ detail, onClose, onSaved }: { detail: AssessmentDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const a = detail.assessment;
  const [title, setTitle] = useState(a.title);
  const [fields, setFields] = useState<AssessmentFields>({ description: a.description, expectations: a.expectations, instructions: a.instructions, skills: a.skills, due_at: a.due_at, timezone: a.timezone });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dueChanged = fields.due_at !== a.due_at;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await companyApi.updateAssessment(a.id, { title: title.trim(), ...fields });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };
  return (
    <div className="we-modal" role="dialog" aria-modal="true" aria-label="Edit assessment" onClick={onClose}>
      <div className="we-modal__card co-edit" onClick={(e) => e.stopPropagation()} data-testid="edit-dialog">
        <h2 className="section-title" style={{ marginTop: 0 }}>Edit assessment</h2>
        <div className="field">
          <label htmlFor="ed-title">Title</label>
          <input id="ed-title" className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <BriefFields idPrefix="ed" value={fields} onChange={(p) => setFields((f) => ({ ...f, ...p }))} />
        <DeadlineField idPrefix="ed" dueAt={fields.due_at} timezone={fields.timezone} onChange={(v) => setFields((f) => ({ ...f, ...v }))} />
        {dueChanged && <p className="xsmall muted" data-testid="due-change-note">Unfinished candidates will be notified.</p>}
        <FormError message={error} />
        <div className="we-actions" style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={save} disabled={busy || !title.trim()} data-testid="save-assessment">{busy ? <span className="busy-dots">Saving</span> : "Save changes"}</button>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
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
  const order = STATUS_ORDER;
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
          {STATUS_FILTERS.filter(([id]) => detail.candidates.some((c) => c.status === id)).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
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
                    <span className={statusBadge(c.status)} title={c.email_error ?? undefined} data-testid={`status-${c.email}`}>
                      {c.status_label}
                    </span>
                    {c.late && <span className="badge badge--warn" style={{ marginLeft: 4 }}>Late</span>}
                    {c.status === "declined" && c.decline_reason && (
                      <>
                        <br />
                        <span className="xsmall muted">&ldquo;{c.decline_reason}&rdquo;</span>
                      </>
                    )}
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
                        {["pending", "invited", "opened", "email_failed", "accepted"].includes(c.status) && (
                          <button className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => run(`resend-${c.id}`, async () => {
                            const res = await companyApi.resend(detail.assessment.id, c.id);
                            if (!res.ok) throw new Error(`Resend failed: ${res.error}`);
                            await reload();
                          })}>
                            {busy === `resend-${c.id}` ? "…" : "Resend"}
                          </button>
                        )}{" "}
                        {["invited", "opened", "accepted", "pending", "email_failed"].includes(c.status) && (
                          <button className="btn btn--ghost btn--small" aria-label={`Withdraw ${c.email}`} disabled={busy !== null} data-testid={`revoke-${c.email}`} onClick={() => run(`rm-${c.id}`, async () => {
                            if (!window.confirm(`Withdraw the invitation for ${c.email}? They'll be told it's no longer available.`)) return;
                            await companyApi.revoke(detail.assessment.id, c.id);
                            await reload();
                          })}>
                            Withdraw
                          </button>
                        )}
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
