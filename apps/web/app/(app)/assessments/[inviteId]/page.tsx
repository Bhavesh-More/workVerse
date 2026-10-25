"use client";

// The assessment briefing: a full-screen page that explains the company, what it is looking for
// and how the assessment works, with one next step that fits the assignment's state. Viewing or
// refreshing it changes nothing; accepting adds it to Company assessments; only "Start" (after a
// confirmation) creates the attempt.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { CompanyMark, StagePill } from "../../../../components/candidate/ui";
import { attemptHref, candidateApi, type Briefing } from "../../../../lib/candidate";
import { formatWhen, relative, urgency, zoneAbbr } from "../../../../lib/time";

export default function AssessmentBriefingPage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const router = useRouter();
  const [a, setA] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"start" | "decline" | null>(null);

  useEffect(() => {
    candidateApi.briefing(inviteId).then(
      (r) => setA(r.assignment),
      (e: unknown) => {
        const status = (e as { status?: number }).status;
        if (status === 404) setMissing(true);
        else setError(e instanceof Error ? e.message : "Could not load this assessment.");
      },
    );
  }, [inviteId]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const accept = () =>
    run("accept", async () => {
      const r = await candidateApi.accept(inviteId);
      setA(r.assignment);
      setNotice(`Accepted. It's saved under ${r.assignment.company_name} in Company assessments — nothing has started. Start whenever you're ready${r.assignment.due_at ? " before the deadline" : ""}.`);
    });
  const decline = (reason: string) =>
    run("decline", async () => {
      const r = await candidateApi.decline(inviteId, reason);
      setA(r.assignment);
      setDialog(null);
      setNotice(`You declined. ${r.assignment.company_name} has been told${reason ? ", with your note" : ""}.`);
    });
  const start = () =>
    run("start", async () => {
      const r = await candidateApi.start(inviteId);
      router.push(r.status === "completed" ? `/session/${r.session_id}/debrief` : `/briefing/${r.scenario_instance_id}?session=${r.session_id}`);
    });

  const back = a ? `/assessments/company/${a.company_id}` : "/assessments";

  if (missing)
    return (
      <Frame back="/assessments">
        <div className="ca-brief__missing card stack" data-testid="briefing-missing">
          <h1 className="section-title">This assessment isn&apos;t available</h1>
          <p className="muted small">It may have been sent to a different email address, or the link is wrong. If someone shared it with you, ask the company to invite you directly.</p>
          <Link className="btn btn--ghost" href="/assessments">Go to Company assessments</Link>
        </div>
      </Frame>
    );
  if (!a)
    return (
      <Frame back="/assessments">
        <div className="ca-brief__loading" aria-busy="true">
          {error ? <div className="banner banner--error" role="alert">{error}</div> : <><div className="skeleton" style={{ height: 180 }} /><div className="skeleton" style={{ height: 320 }} /></>}
        </div>
      </Frame>
    );

  const s = a.state;
  const c = a.company;
  const hasProfile = Boolean(c.tagline || c.about || c.mission || c.vision || c.values);

  return (
    <Frame back={back} crumbs={[{ href: "/assessments", label: "Company assessments" }, { href: back, label: a.company_name }]}>
      <header className="ca-hero">
        <div className="ca-hero__inner">
          <CompanyMark name={a.company_name} size={56} />
          <div className="ca-hero__text">
            <span className="eyebrow" style={{ margin: 0 }}>{a.company_name} · {s.invitation === "pending" ? "invited you" : "assessment"}</span>
            <h1 className="ca-hero__title" data-testid="briefing-title">{a.title}</h1>
            <div className="ca-hero__meta">
              <StagePill state={s} />
              <span className="ca-meta">About {a.estimated_minutes} minutes</span>
              <span className="ca-meta">Not timed</span>
              <span className="ca-meta">{a.scenario.kind} · {a.scenario.difficulty}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="ca-brief">
        <article className="ca-brief__main">
          <AnimatePresence>
            {notice && (
              <m.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="banner banner--info" role="status" data-testid="briefing-notice">
                <span>{notice}</span>
              </m.div>
            )}
          </AnimatePresence>
          {/* Closed states explain themselves in the next-step panel; live ones get a banner. */}
          {s.note && s.tone !== "muted" && <div className="banner banner--warn" role="note">{s.note}</div>}

          {a.expectations && (
            <Section title={`What ${a.company_name} is looking for`} testid="sec-expectations">
              <p className="ca-lead">{a.expectations}</p>
            </Section>
          )}

          <Section title="About this assessment" testid="sec-about">
            {a.description && <p>{a.description}</p>}
            <div className="ca-scenario">
              <span className="eyebrow" style={{ margin: 0 }}>The scenario</span>
              <strong>{a.scenario.title}</strong>
              {a.scenario.summary && a.scenario.summary !== a.description && <p className="small muted" style={{ margin: 0 }}>{a.scenario.summary}</p>}
              <p className="small" style={{ margin: 0 }}>
                You&apos;ll spend a simulated workday in {a.company_name}&apos;s virtual office: talk to colleagues, investigate a realistic problem, decide what to do and keep people informed.
              </p>
            </div>
          </Section>

          <Section title="Skills you'll be assessed on" testid="sec-skills" aside={a.skills_chosen ? `Chosen by ${a.company_name}` : "All five are scored"}>
            <ul className="list-reset ca-skills">
              {a.skills.map((sk) => (
                <li key={sk.id}>
                  <strong>{sk.name}</strong>
                  {sk.description && <span className="small muted">{sk.description}</span>}
                </li>
              ))}
            </ul>
          </Section>

          {(a.instructions || a.message) && (
            <Section title={`Instructions from ${a.company_name}`} testid="sec-instructions">
              {a.instructions && <p className="ca-pre">{a.instructions}</p>}
              {a.message && (
                <blockquote className="ca-quote">
                  <span className="eyebrow" style={{ margin: 0 }}>Note in your invitation</span>
                  {a.message}
                </blockquote>
              )}
            </Section>
          )}

          <Section title="How it works" testid="sec-how">
            <ul className="list-reset ca-facts">
              <li><b>About {a.estimated_minutes} minutes</b> for most people. There&apos;s no countdown timer.</li>
              <li><b>Progress saves as you go.</b> You can leave and continue the same attempt{a.due_at ? " until the deadline" : ""}.</li>
              <li><b>Starting is a separate step.</b> Accepting the invitation doesn&apos;t start anything.</li>
              <li><b>When you finish,</b> you get your own debrief, and {a.company_name} receives your report.</li>
              <li><b>The colleagues are AI.</b> Ask short, specific questions; each one knows different things.</li>
            </ul>
          </Section>

          {a.team.length > 0 && (
            <Section title="Who you'll meet" testid="sec-team">
              <ul className="list-reset ca-team">
                {a.team.map((t) => (
                  <li key={t.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.portrait ? <img src={t.portrait} alt="" width={44} height={44} /> : <span className="ca-team__ph" />}
                    <span>
                      <strong>{t.name}</strong>
                      <span className="xsmall muted">{t.role}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`About ${c.name}`} testid="sec-company">
            {hasProfile ? (
              <div className="ca-about">
                {c.tagline && <p className="ca-lead">{c.tagline}</p>}
                {c.about && <p>{c.about}</p>}
                <div className="ca-about__grid">
                  {c.mission && <AboutBlock label="Mission" text={c.mission} />}
                  {c.vision && <AboutBlock label="Vision" text={c.vision} />}
                  {c.values && <AboutBlock label="How we work" text={c.values} />}
                </div>
              </div>
            ) : (
              <p className="muted small">{c.name} hasn&apos;t added a company profile yet.</p>
            )}
            {(c.industry || c.website) && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                {c.industry}
                {c.industry && c.website && " · "}
                {c.website && (
                  <a className="text-link" href={c.website} target="_blank" rel="noopener noreferrer">{c.website.replace(/^https?:\/\//, "")} ↗</a>
                )}
              </p>
            )}
          </Section>
        </article>

        <aside className="ca-brief__side">
          <NextStep a={a} busy={busy} error={error} onAccept={accept} onDecline={() => setDialog("decline")} onStart={() => setDialog("start")} />
        </aside>
      </div>

      {dialog === "start" && <StartDialog a={a} busy={busy === "start"} error={error} onCancel={() => setDialog(null)} onConfirm={start} />}
      {dialog === "decline" && <DeclineDialog a={a} busy={busy === "decline"} onCancel={() => setDialog(null)} onConfirm={decline} />}
    </Frame>
  );
}

function Frame({ children, back, crumbs = [] }: { children: React.ReactNode; back: string; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="ca-frame">
      <nav className="ca-topbar" aria-label="Breadcrumb">
        <Link href="/dashboard" className="sidebar__mark" aria-label="WorkVerse home">W</Link>
        <ol className="list-reset ca-crumbs">
          {crumbs.map((cr) => (
            <li key={cr.href}><Link href={cr.href} className="text-link">{cr.label}</Link></li>
          ))}
        </ol>
        <Link href={back} className="btn btn--ghost btn--small" data-testid="briefing-back">← Back</Link>
      </nav>
      {children}
    </div>
  );
}

function Section({ title, aside, testid, children }: { title: string; aside?: string; testid: string; children: React.ReactNode }) {
  return (
    <section className="ca-sec" data-testid={testid}>
      <div className="ca-sec__head">
        <h2>{title}</h2>
        {aside && <span className="xsmall muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function AboutBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="ca-aboutb">
      <span className="eyebrow" style={{ margin: 0 }}>{label}</span>
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

function Deadline({ a }: { a: Briefing }) {
  if (!a.due_at) return <p className="small muted" style={{ margin: 0 }}>No deadline set.</p>;
  const u = urgency(a.due_at);
  const done = ["submitted", "evaluated"].includes(a.state.stage);
  // Only mention the company's zone when it reads differently from the viewer's.
  const differs = a.timezone && formatWhen(a.due_at, a.timezone) !== formatWhen(a.due_at);
  return (
    <div className={`ca-deadline ca-deadline--${done ? "done" : u}`} data-testid="briefing-deadline">
      <span className="eyebrow" style={{ margin: 0 }}>Due</span>
      <strong>{formatWhen(a.due_at, undefined, true)}</strong>
      <span className="xsmall muted">Your time ({zoneAbbr(a.due_at)}){!done && ` · ${relative(a.due_at)}`}</span>
      {differs && <span className="xsmall muted">Set by {a.company_name} as {formatWhen(a.due_at, a.timezone)} {zoneAbbr(a.due_at, a.timezone)}</span>}
    </div>
  );
}

function NextStep({ a, busy, error, onAccept, onDecline, onStart }: { a: Briefing; busy: string | null; error: string | null; onAccept: () => void; onDecline: () => void; onStart: () => void }) {
  const s = a.state;
  const href = attemptHref(a);
  return (
    <div className="ca-next card" data-testid="next-step">
      <span className="eyebrow" style={{ margin: 0 }}>Your next step</span>
      <Deadline a={a} />
      {error && <div className="banner banner--error small" role="alert">{error}</div>}
      {s.can_accept && (
        <>
          <button className="btn btn--block" onClick={onAccept} disabled={busy !== null} data-testid="accept-invitation">
            {busy === "accept" ? <span className="busy-dots">Accepting</span> : "Accept invitation"}
          </button>
          <p className="xsmall muted" style={{ margin: 0 }}>Accepting saves it to Company assessments and lets {a.company_name} know. It doesn&apos;t start the assessment.</p>
          <button className="text-link small ca-decline" onClick={onDecline} disabled={busy !== null} data-testid="decline-invitation">Decline invitation</button>
        </>
      )}
      {s.can_start && (
        <>
          <button className="btn btn--block" onClick={onStart} disabled={busy !== null} data-testid="start-assessment">
            Start assessment →
          </button>
          <p className="xsmall muted" style={{ margin: 0 }}>You&apos;ll confirm before anything begins.</p>
        </>
      )}
      {s.can_continue && href && (
        <>
          <Link className="btn btn--block" href={href} data-testid="continue-assessment">Continue assessment →</Link>
          <p className="xsmall muted" style={{ margin: 0 }}>Picks up your existing attempt where you left it.</p>
        </>
      )}
      {s.can_view_results && href && (
        <>
          <Link className="btn btn--block btn--ghost" href={href} data-testid="view-results">{s.stage === "evaluated" ? "View your results" : "View your submission"}</Link>
          <p className="xsmall muted" style={{ margin: 0 }}>
            Submitted{a.submitted_at ? ` ${formatWhen(a.submitted_at)}` : ""}. {a.company_name} has your report.
          </p>
        </>
      )}
      {!s.can_accept && !s.can_start && !s.can_continue && !s.can_view_results && (
        <p className="small" style={{ margin: 0 }} data-testid="no-action">{s.note || "There's nothing to do for this assessment."}</p>
      )}
      <hr className="ca-hr" />
      <p className="xsmall muted" style={{ margin: 0 }}>
        Invitation sent to {a.sent_to}
        {a.invited_at && <> · {new Date(a.invited_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</>}
      </p>
    </div>
  );
}

function Modal({ label, children, onCancel }: { label: string; children: React.ReactNode; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, textarea")?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="we-modal" role="dialog" aria-modal="true" aria-label={label} onClick={onCancel}>
      <m.div ref={ref} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="we-modal__card ca-dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </m.div>
    </div>
  );
}

function StartDialog({ a, busy, error, onCancel, onConfirm }: { a: Briefing; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal label="Start the assessment" onCancel={onCancel}>
      <span className="eyebrow">{a.company_name}</span>
      <h2 className="section-title" style={{ marginTop: 0 }}>Start {a.title}?</h2>
      <ul className="list-reset ca-facts">
        <li><b>Plan for about {a.estimated_minutes} minutes.</b> There&apos;s no countdown.</li>
        <li><b>This creates your attempt</b> and takes you into the office.</li>
        <li><b>You can leave and continue</b> the same attempt{a.due_at ? ` until ${formatWhen(a.due_at)}` : ""}.</li>
        <li><b>When you finish,</b> {a.company_name} receives your report.</li>
      </ul>
      {error && <div className="banner banner--error small" role="alert">{error}</div>}
      <div className="we-actions">
        <button className="btn" onClick={onConfirm} disabled={busy} data-testid="confirm-start">
          {busy ? <span className="busy-dots">Preparing your office</span> : "Start now"}
        </button>
        <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>Not yet</button>
      </div>
    </Modal>
  );
}

function DeclineDialog({ a, busy, onCancel, onConfirm }: { a: Briefing; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal label="Decline the invitation" onCancel={onCancel}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Decline this invitation?</h2>
      <p className="small muted">{a.company_name} will see that you declined. If they invite you again later, it will show up here.</p>
      <div className="field">
        <label htmlFor="decline-reason">Note to {a.company_name} (optional)</label>
        <textarea id="decline-reason" className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I've accepted another offer." />
      </div>
      <div className="we-actions">
        <button className="btn" onClick={() => onConfirm(reason.trim())} disabled={busy} data-testid="confirm-decline">
          {busy ? <span className="busy-dots">Declining</span> : "Decline invitation"}
        </button>
        <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>Keep it</button>
      </div>
    </Modal>
  );
}
