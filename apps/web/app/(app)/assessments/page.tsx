"use client";

// Company assessments: invitations and assessments from companies, grouped by company. Separate
// from practice. Nothing on this page (or anything reached from it) starts a test by itself.
import Link from "next/link";
import { m } from "framer-motion";
import { FormError } from "../../../components/AuthShell";
import { CompanyMark, DueLabel, StagePill } from "../../../components/candidate/ui";
import { candidateApi, type Assignment, type CompanyGroup } from "../../../lib/candidate";
import { formatWhen } from "../../../lib/time";
import { useApi } from "../../../lib/useApi";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } } };

export default function CompanyAssessmentsPage() {
  const { data, error } = useApi("/me/company-assessments", candidateApi.overview);
  const upNext = (data?.assignments ?? []).filter((a) => ["invited", "ready", "in_progress"].includes(a.state.stage));
  const pending = upNext.filter((a) => a.state.stage === "invited").length;

  return (
    <main className="app-main ca-main">
      <div className="page-head">
        <span className="eyebrow">Company assessments</span>
        <h1 className="page-title">
          Invitations from <span className="hl">companies</span>
        </h1>
        <p className="muted">Opening one never starts the test.</p>
      </div>
      <FormError message={error} />
      {!data && !error && <Skeleton />}
      {data && data.companies.length === 0 && <Empty />}
      {data && data.companies.length > 0 && (
        <m.div variants={container} initial="hidden" animate="show" className="stack--lg stack">
          {upNext.length > 0 && (
            <m.section variants={item} className="ca-section" aria-labelledby="upnext">
              <div className="ca-section__head">
                <h2 id="upnext" className="section-title">Up next</h2>
                <span className="small muted">
                  {pending > 0 && <>{pending} invitation{pending === 1 ? "" : "s"} waiting · </>}
                  {upNext.length} to do
                </span>
              </div>
              <ol className="list-reset ca-timeline" data-testid="up-next">
                {upNext.slice(0, 6).map((a) => (
                  <UpNextRow key={a.id} a={a} />
                ))}
              </ol>
            </m.section>
          )}
          <m.section variants={item} className="ca-section" aria-labelledby="companies">
            <div className="ca-section__head">
              <h2 id="companies" className="section-title">Companies</h2>
              <span className="small muted">{data.companies.length} compan{data.companies.length === 1 ? "y" : "ies"}</span>
            </div>
            <div className="ca-companies">
              {data.companies.map((c) => (
                <CompanyCard key={c.id} c={c} />
              ))}
            </div>
          </m.section>
        </m.div>
      )}
    </main>
  );
}

function UpNextRow({ a }: { a: Assignment }) {
  const d = a.due_at ? new Date(a.due_at) : null;
  return (
    <li>
      <Link href={`/assessments/${a.id}`} className="ca-tl" data-testid={`up-next-${a.id}`}>
        <span className={`ca-tl__date${d ? "" : " is-none"}`} aria-hidden="true">
          {d ? (
            <>
              <strong>{d.toLocaleDateString(undefined, { day: "numeric" })}</strong>
              <span>{d.toLocaleDateString(undefined, { month: "short" })}</span>
            </>
          ) : (
            <span>No date</span>
          )}
        </span>
        <span className="ca-tl__body">
          <span className="ca-tl__company">{a.company_name}</span>
          <strong>{a.title}</strong>
          <span className="small">
            <DueLabel due={a.due_at} />
          </span>
        </span>
        <StagePill state={a.state} small />
        <span className="ca-chev" aria-hidden="true">→</span>
      </Link>
    </li>
  );
}

function CompanyCard({ c }: { c: CompanyGroup }) {
  return (
    <Link href={`/assessments/company/${c.id}`} className={`ca-company${c.pending ? " has-pending" : ""}`} data-testid={`company-card-${c.id}`}>
      <div className="ca-company__head">
        <CompanyMark name={c.name} size={48} />
        <div className="ca-company__who">
          <strong>{c.name}</strong>
          <span className="small muted">{c.tagline || c.industry || "Company"}</span>
        </div>
        {c.pending > 0 && <span className="ca-badge" data-testid="company-pending">{c.pending} new</span>}
      </div>
      <dl className="ca-company__stats">
        <div>
          <dt>Assessments</dt>
          <dd>{c.total}</dd>
        </div>
        <div>
          <dt>To do</dt>
          <dd>{c.active}</dd>
        </div>
        <div>
          <dt>Done</dt>
          <dd>{c.done}</dd>
        </div>
      </dl>
      <div className="ca-company__foot small">
        {c.next_due ? (
          <span>
            Next: <strong>{c.next_title}</strong> · due {formatWhen(c.next_due)}
          </span>
        ) : (
          <span className="muted">{c.active ? "No deadline set" : "Nothing waiting on you"}</span>
        )}
        <span className="ca-chev" aria-hidden="true">→</span>
      </div>
    </Link>
  );
}

function Empty() {
  return (
    <div className="ca-empty card" data-testid="ca-empty">
      <span className="ca-empty__icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
        </svg>
      </span>
      <h2 className="section-title">No company assessments yet</h2>
      <p className="muted">Company invites will show up here.</p>
      <Link className="btn btn--ghost" href="/scenarios">Practise in the meantime</Link>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="stack">
      <div className="skeleton" style={{ height: 160 }} />
      <div className="ca-companies">
        <div className="skeleton" style={{ height: 190 }} />
        <div className="skeleton" style={{ height: 190 }} />
      </div>
    </div>
  );
}
