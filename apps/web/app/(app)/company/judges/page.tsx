"use client";

// AI judges: the company's own team of simulated colleagues (any number, each on a scenario role,
// with a name, avatar, voice and manner). The same editor opens full screen from workplace setup.
import { useEffect, useMemo, useState } from "react";
import { CompanyGate } from "../../../../components/CompanyGate";
import { FormError } from "../../../../components/AuthShell";
import { JudgeRosterEditor, effectiveRoster } from "../../../../components/judges/JudgeRoster";
import { companyApi, type Company, type RosterJudge } from "../../../../lib/company";
import { useApi } from "../../../../lib/useApi";

export default function JudgesPage() {
  return <CompanyGate>{(company, refresh) => <Judges company={company} refresh={refresh} />}</CompanyGate>;
}

function Judges({ company, refresh }: { company: Company; refresh: (c: Company) => void }) {
  const { data: catalog } = useApi("/company/judges/catalog", companyApi.catalog);
  const [roster, setRoster] = useState<RosterJudge[] | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    if (catalog && roster === null) {
      const r = effectiveRoster(company, catalog);
      setRoster(r);
      setSaved(JSON.stringify(r));
    }
  }, [catalog, company, roster]);

  const dirty = roster !== null && JSON.stringify(roster) !== saved;
  const issue = useMemo(() => {
    if (!roster) return null;
    if (roster.some((j) => !j.name.trim())) return "Every judge needs a name.";
    const names = roster.map((j) => j.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return "Two judges have the same name.";
    return null;
  }, [roster]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    if (!roster || issue) return;
    setBusy(true);
    setError(null);
    setNotice(false);
    try {
      const res = await companyApi.update({ judge_roster: roster.map((j) => ({ ...j, name: j.name.trim() })) });
      refresh(res.company);
      const r = res.company.judge_roster ?? roster;
      setRoster(r);
      setSaved(JSON.stringify(r));
      setNotice(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <span className="eyebrow">AI judges · your team</span>
          <h1 className="page-title">
            Who candidates <span className="hl">meet</span>
          </h1>
          <p className="muted small">They stay in role and never give away the answer.</p>
        </div>
        <div className="co-actions">
          {dirty && <span className="xsmall muted">Unsaved changes</span>}
          {dirty && (
            <button className="btn btn--ghost" onClick={() => setRoster(JSON.parse(saved) as RosterJudge[])} disabled={busy}>
              Discard
            </button>
          )}
          <button className="btn" onClick={save} disabled={busy || !dirty || !!issue} data-testid="save-judges">
            {busy ? <span className="busy-dots">Saving</span> : "Save judges"}
          </button>
        </div>
      </div>
      <div className="stack">
        <FormError message={error} />
        {issue && <div className="banner banner--warn" role="status">{issue}</div>}
        {notice && !dirty && <div className="banner banner--info" role="status">Saved. Every new assessment session uses these judges.</div>}
        {!company.judge_roster && (
          <div className="banner" role="note">
            You&apos;re using the standard five judges, with names that vary per candidate. Edit anything below and save to make this your own team.
          </div>
        )}
        {catalog && roster ? (
          <div className="jr-page">
            <JudgeRosterEditor catalog={catalog} value={roster} onChange={setRoster} />
          </div>
        ) : (
          <div className="skeleton" style={{ height: 420 }} />
        )}
      </div>
    </main>
  );
}
