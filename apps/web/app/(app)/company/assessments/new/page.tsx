"use client";

// New assessment: scenario -> brief & deadline -> people -> review, then one publish that creates
// the assessment and its invitations together. Publishing is idempotent (a retry or double click
// returns the same assessment), and the result screen reports exactly what was delivered.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { FormError } from "../../../../../components/AuthShell";
import { BriefFields, DeadlineField, SKILL_OPTIONS } from "../../../../../components/company/AssessmentFields";
import { CandidateEntry, type Person } from "../../../../../components/company/CandidateEntry";
import { TRACK_LABELS, companyApi, type AssessmentFields, type Company, type InviteChannel, type InviteResult, type Topic, type TopicPreview } from "../../../../../lib/company";
import { formatWhen, localZone, zoneAbbr } from "../../../../../lib/time";
import { useApi } from "../../../../../lib/useApi";

type Step = "scenario" | "details" | "people" | "review";
const STEPS: [Step, string][] = [
  ["scenario", "Scenario"],
  ["details", "Brief & deadline"],
  ["people", "Candidates"],
  ["review", "Review & send"],
];

export default function NewAssessmentPage() {
  return <CompanyGate>{(company) => <Wizard company={company} />}</CompanyGate>;
}

function Wizard({ company }: { company: Company }) {
  const router = useRouter();
  const { data: topics } = useApi("/company/topics", companyApi.topics);
  const items = topics?.items ?? [];
  const [step, setStep] = useState<Step>("scenario");
  const [topicId, setTopicId] = useState("");
  const [preview, setPreview] = useState<TopicPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<AssessmentFields>({ description: "", expectations: "", instructions: "", skills: [], due_at: null, timezone: localZone() });
  const [people, setPeople] = useState<Person[]>([]);
  const [channel, setChannel] = useState<InviteChannel>(company.smtp_ready ? "both" : "app");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; delivery: InviteResult | null; created: boolean } | null>(null);
  // One id per wizard: retries and double clicks publish once.
  const requestId = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random()}`);
  const topic = items.find((t) => t.id === topicId);

  // ?topic= preselects (from a topic page); otherwise the newest topic.
  useEffect(() => {
    if (!items.length || topicId) return;
    const wanted = new URLSearchParams(window.location.search).get("topic");
    pickTopic((items.find((t) => t.id === wanted) ?? items[0]!).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const pickTopic = (id: string) => {
    setTopicId(id);
    setPreview(null);
    setPreviewError(null);
    const t = items.find((x) => x.id === id);
    if (t) {
      setTitle((cur) => (cur && !items.some((x) => cur.startsWith(x.title)) ? cur : `${t.title} — ${new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" })}`));
      setFields((f) => ({ ...f, description: f.description || t.description }));
    }
    companyApi.topicPreview(id).then(setPreview, (e: unknown) => setPreviewError(e instanceof Error ? e.message : "Could not build a preview."));
  };

  const dueProblem = fields.due_at && new Date(fields.due_at).getTime() <= Date.now() ? "The deadline is in the past." : null;
  const canNext: Record<Step, boolean> = {
    scenario: Boolean(topicId && preview?.valid),
    details: Boolean(title.trim()) && !dueProblem,
    people: true,
    review: true,
  };
  const idx = STEPS.findIndex(([s]) => s === step);
  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await companyApi.createAssessment({
        topic_id: topicId,
        title: title.trim(),
        message: message.trim(),
        ...fields,
        candidates: people,
        channel,
        client_request_id: requestId.current,
      });
      setResult({ id: res.id, delivery: res.delivery, created: res.created });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish. Nothing was sent — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (topics && !items.length)
    return (
      <main className="app-main">
        <Head />
        <div className="card stack" style={{ maxWidth: 560 }}>
          <p>You need a topic first — it defines the scenario and which AI judges take part.</p>
          <Link className="btn" href="/company/topics/new">Create a topic</Link>
        </div>
      </main>
    );

  if (result) return <Published company={company} result={result} title={title} people={people} channel={channel} onOpen={() => router.push(`/company/assessments/${result.id}`)} />;

  return (
    <main className="app-main nw-main">
      <Head />
      <ol className="ws-steps nw-steps" aria-label="Steps">
        {STEPS.map(([s, label], i) => (
          <li key={s} className={i === idx ? "is-current" : i < idx ? "is-done" : ""} aria-current={i === idx ? "step" : undefined}>
            <button type="button" disabled={i > idx && !STEPS.slice(0, i).every(([x]) => canNext[x])} onClick={() => go(s)}>
              <span className="mono">{i < idx ? "✓" : i + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>

      <m.section key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="nw-body">
        {step === "scenario" && (
          <div className="nw-two">
            <div className="stack">
              <h2 className="section-title" style={{ margin: 0 }}>Choose the scenario</h2>
              <p className="small muted" style={{ margin: 0 }}>The incident and AI judges every candidate gets.</p>
              <ul className="list-reset nw-topics" role="radiogroup" aria-label="Topic">
                {items.map((t) => (
                  <li key={t.id}>
                    <button type="button" role="radio" aria-checked={t.id === topicId} className={`nw-topic${t.id === topicId ? " is-on" : ""}`} onClick={() => pickTopic(t.id)} data-testid={`topic-${t.id}`}>
                      <strong>{t.title}</strong>
                      <span className="xsmall muted">{TRACK_LABELS[t.track] ?? t.track} · {t.difficulty}{t.judge_ids ? ` · ${t.judge_ids.length} judges` : ""}</span>
                      {t.description && <span className="small nw-topic__desc">{t.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <Link className="text-link small" href="/company/topics/new">+ Create a new topic</Link>
            </div>
            <ScenarioPreview topic={topic} preview={preview} error={previewError} />
          </div>
        )}

        {step === "details" && (
          <div className="nw-two">
            <div className="stack">
              <h2 className="section-title" style={{ margin: 0 }}>Brief & deadline</h2>
              <p className="small muted" style={{ margin: 0 }}>Shown on the candidate briefing.</p>
              <div className="field">
                <label htmlFor="nw-title">Assessment title</label>
                <input id="nw-title" className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} data-testid="field-title" />
              </div>
              <BriefFields value={fields} onChange={(p) => setFields((f) => ({ ...f, ...p }))} />
              <DeadlineField dueAt={fields.due_at} timezone={fields.timezone} onChange={(v) => setFields((f) => ({ ...f, ...v }))} />
              <div className="field">
                <label htmlFor="nw-message">Personal note in the invitation (optional)</label>
                <textarea id="nw-message" className="textarea" rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Thanks for applying! This is the next step in our process." />
              </div>
            </div>
            <ProfileCard company={company} />
          </div>
        )}

        {step === "people" && (
          <div className="stack" style={{ maxWidth: 760 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Who should take it?</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Add by email. You can add more later.
            </p>
            <CandidateEntry onChange={setPeople} />
          </div>
        )}

        {step === "review" && (
          <Review
            company={company}
            topic={topic}
            preview={preview}
            title={title}
            fields={fields}
            message={message}
            people={people}
            channel={channel}
            setChannel={setChannel}
            onEdit={go}
          />
        )}
      </m.section>

      <FormError message={error} />
      <div className="nw-nav">
        {idx > 0 ? <button className="btn btn--ghost" onClick={() => go(STEPS[idx - 1]![0])} disabled={busy}>← Back</button> : <Link className="btn btn--ghost" href="/company/assessments">Cancel</Link>}
        <span className="small muted">{step === "details" && dueProblem}</span>
        {step !== "review" ? (
          <button className="btn" onClick={() => go(STEPS[idx + 1]![0])} disabled={!canNext[step]} data-testid="wizard-next">
            Continue <span className="arrow" aria-hidden="true">→</span>
          </button>
        ) : (
          <button className="btn" onClick={publish} disabled={busy} data-testid="publish-assessment">
            {busy ? <span className="busy-dots">Publishing</span> : people.length ? `Publish & invite ${people.length}` : "Publish without inviting"}
          </button>
        )}
      </div>
    </main>
  );
}

function Head() {
  return (
    <div className="page-head">
      <Link className="text-link small" href="/company/assessments">← Assessments</Link>
      <span className="eyebrow" style={{ marginTop: 16 }}>New assessment</span>
      <h1 className="page-title">
        Start a hiring <span className="hl">round</span>
      </h1>
    </div>
  );
}

function ScenarioPreview({ topic, preview, error }: { topic?: Topic; preview: TopicPreview | null; error: string | null }) {
  return (
    <aside className="card stack nw-preview" data-testid="scenario-preview">
      <div className="row between">
        <span className="eyebrow" style={{ margin: 0 }}>Preview · what candidates get</span>
        {preview && <span className={`badge${preview.valid ? " badge--ok" : " badge--warn"}`} data-testid="preview-valid">{preview.valid ? "Checked ✓" : "Needs fixing"}</span>}
      </div>
      {error && <FormError message={error} />}
      {!preview && !error && <div className="skeleton" style={{ height: 260 }} />}
      {preview && (
        <>
          <h3 className="section-title" style={{ margin: 0 }}>{preview.title}</h3>
          <p className="small" style={{ margin: 0 }}>{preview.briefing.split("\n\n").slice(-1)[0]}</p>
          <div>
            <span className="eyebrow">Candidate&apos;s role</span>
            <p className="small" style={{ margin: 0 }}>{preview.role} · about {preview.estimated_minutes} minutes, not timed</p>
          </div>
          <div>
            <span className="eyebrow">Who they meet</span>
            <ul className="list-reset small nw-dotlist">
              {preview.team.map((t) => (
                <li key={t.name}><strong>{t.name}</strong> <span className="muted">· {t.role}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <span className="eyebrow">What they need to do</span>
            <ul className="list-reset small nw-dotlist">
              {preview.objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
          {!preview.valid && <div className="banner banner--error small">This topic doesn&apos;t produce a valid scenario. Edit the topic and try again.</div>}
          {topic && <Link className="text-link xsmall" href={`/company/topics/${topic.id}`}>Edit this topic ↗</Link>}
        </>
      )}
    </aside>
  );
}

function ProfileCard({ company }: { company: Company }) {
  const p = company.profile;
  const filled = [p.tagline, p.about, p.mission, p.vision, p.values].filter(Boolean).length;
  return (
    <aside className="card stack nw-preview" data-testid="profile-card">
      <span className="eyebrow" style={{ margin: 0 }}>Also on the briefing · company-wide</span>
      <h3 className="section-title" style={{ margin: 0 }}>{company.name}</h3>
      {p.tagline ? <p className="small" style={{ margin: 0 }}>{p.tagline}</p> : <p className="small muted" style={{ margin: 0 }}>No tagline yet.</p>}
      {(p.mission || p.vision) && <p className="xsmall muted" style={{ margin: 0 }}>{p.mission || p.vision}</p>}
      <div className="nw-meter" aria-label={`${filled} of 5 profile sections filled`}>
        {Array.from({ length: 5 }, (_, i) => <span key={i} className={i < filled ? "is-on" : ""} />)}
      </div>
      <p className="xsmall muted" style={{ margin: 0 }}>
        Shown to every candidate. Managed in Settings.
      </p>
      <Link className="text-link small" href="/company/settings#profile" target="_blank">{filled ? "Edit company profile ↗" : "Add your company profile ↗"}</Link>
    </aside>
  );
}

function Review(props: {
  company: Company;
  topic?: Topic;
  preview: TopicPreview | null;
  title: string;
  fields: AssessmentFields;
  message: string;
  people: Person[];
  channel: InviteChannel;
  setChannel: (c: InviteChannel) => void;
  onEdit: (s: Step) => void;
}) {
  const { topic, title, fields, people, channel } = props;
  const skills = useMemo(() => SKILL_OPTIONS.filter((s) => fields.skills.includes(s.id)), [fields.skills]);
  return (
    <div className="stack" data-testid="review">
      <h2 className="section-title" style={{ margin: 0 }}>Review before sending</h2>
      <div className="nw-review">
        <ReviewBlock label="Scenario" onEdit={() => props.onEdit("scenario")}>
          <strong>{topic?.title}</strong>
          <span className="small muted">{props.preview?.team.length ?? 0} AI colleagues · about {props.preview?.estimated_minutes ?? 15} min</span>
        </ReviewBlock>
        <ReviewBlock label="Brief" onEdit={() => props.onEdit("details")}>
          <strong>{title}</strong>
          {fields.description && <span className="small">{fields.description}</span>}
          <span className="small muted">
            {fields.expectations ? "Expectations set" : "No expectations written"} · {skills.length ? skills.map((s) => s.name).join(", ") : "all skills equally"}
            {fields.instructions ? " · instructions added" : ""}
          </span>
        </ReviewBlock>
        <ReviewBlock label="Deadline" onEdit={() => props.onEdit("details")}>
          {fields.due_at ? (
            <>
              <strong data-testid="review-due">{formatWhen(fields.due_at, fields.timezone, true)} {zoneAbbr(fields.due_at, fields.timezone)}</strong>
              <span className="small muted">Shown in each candidate's local time.</span>
            </>
          ) : (
            <strong>No deadline</strong>
          )}
        </ReviewBlock>
        <ReviewBlock label={`Candidates (${people.length})`} onEdit={() => props.onEdit("people")}>
          {people.length ? (
            <ul className="list-reset nw-people" data-testid="review-people">
              {people.slice(0, 12).map((p) => (
                <li key={p.email}><strong>{p.name || p.email.split("@")[0]}</strong> <span className="muted">{p.email}</span></li>
              ))}
              {people.length > 12 && <li className="muted">and {people.length - 12} more</li>}
            </ul>
          ) : (
            <span className="small muted">Nobody yet — invite after publishing.</span>
          )}
        </ReviewBlock>
      </div>
      {people.length > 0 && channel !== "app" && !props.company.smtp_ready && (
        <div className="banner banner--warn" role="alert" data-testid="smtp-warning">
          <span>
            Email isn&apos;t set up, so invitations can&apos;t be emailed. Choose <b>In WorkVerse only</b>, or <Link className="text-link" href="/company/settings" target="_blank">add your SMTP server ↗</Link>.
          </span>
        </div>
      )}
      {people.length > 0 && (
        <fieldset className="co-channel" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="eyebrow" style={{ marginBottom: 8 }}>Send the invitations</legend>
          {(
            [
              ["both", "In WorkVerse + email", "Recommended"],
              ["app", "In WorkVerse only", "Notification and popup"],
              ["email", "Email only", "From your SMTP server"],
            ] as const
          ).map(([id, label, hint]) => (
            <label key={id}>
              <input type="radio" name="nw-channel" checked={channel === id} onChange={() => props.setChannel(id)} data-testid={`nw-channel-${id}`} />
              <span><strong>{label}</strong> <span className="xsmall muted">· {hint}</span></span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function ReviewBlock({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="nw-rblock">
      <div className="row between">
        <span className="eyebrow" style={{ margin: 0 }}>{label}</span>
        <button type="button" className="text-link xsmall" onClick={onEdit}>Edit</button>
      </div>
      <div className="nw-rblock__body">{children}</div>
    </div>
  );
}

function Published({ company, result, title, people, channel, onOpen }: { company: Company; result: { id: string; delivery: InviteResult | null; created: boolean }; title: string; people: Person[]; channel: InviteChannel; onOpen: () => void }) {
  const d = result.delivery;
  const failed = d?.failed ?? [];
  return (
    <main className="app-main">
      <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card stack nw-done" data-testid="published">
        <span className="nw-done__tick" aria-hidden="true">✓</span>
        <span className="eyebrow" style={{ margin: 0 }}>{company.name} · published</span>
        <h1 className="page-title" style={{ fontSize: 36, margin: 0 }}>{title}</h1>
        {!result.created && <div className="banner">This assessment was already published (the request was sent twice). Nothing was duplicated.</div>}
        {d ? (
          <ul className="list-reset stack--sm stack small" data-testid="publish-result">
            <li>
              <b>{d.sent}</b> of {people.length} invitation{people.length === 1 ? "" : "s"} delivered
              {channel === "app" ? " in WorkVerse" : channel === "email" ? " by email" : " (WorkVerse and email)"}.
            </li>
            {(d.awaiting_signup?.length ?? 0) > 0 && <li>{d.awaiting_signup!.length === 1 ? "1 person doesn't" : `${d.awaiting_signup!.length} people don't`} have an account yet — the invitation waits for them when they sign up with that email.</li>}
            {d.already_invited.length > 0 && <li>{d.already_invited.length} were already invited and were skipped.</li>}
            {d.invalid.length > 0 && <li className="jr-err">Invalid addresses skipped: {d.invalid.join(", ")}</li>}
            {(d.email_failed?.length ?? 0) > 0 && channel === "both" && (
              <li className="jr-err" data-testid="email-failed">
                Email couldn&apos;t be sent to {d.email_failed!.map((f) => f.email).join(", ")} ({d.email_failed![0]!.error}). They still have the invitation in WorkVerse.
              </li>
            )}
            {failed.length > 0 && (
              <li className="jr-err">
                Not delivered: {failed.map((f) => `${f.email} (${f.error})`).join("; ")}. You can resend from the assessment page.
              </li>
            )}
          </ul>
        ) : (
          <p className="small muted">No one invited yet.</p>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={onOpen} data-testid="open-assessment">Manage this assessment →</button>
          <Link className="btn btn--ghost" href="/company/assessments">All assessments</Link>
        </div>
      </m.div>
    </main>
  );
}
