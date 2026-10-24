"use client";

import { useState } from "react";
import { CompanyGate } from "../../../../components/CompanyGate";
import { FormError } from "../../../../components/AuthShell";
import { JudgeEditor } from "../../../../components/JudgeEditor";
import { TRACK_LABELS, companyApi, type Company, type JudgeMap } from "../../../../lib/company";
import { useApi } from "../../../../lib/useApi";

export default function JudgesPage() {
  return <CompanyGate>{(company, refresh) => <Judges company={company} refresh={refresh} />}</CompanyGate>;
}

function Judges({ company, refresh }: { company: Company; refresh: (c: Company) => void }) {
  const { data: catalog } = useApi("/company/judges/catalog", companyApi.catalog);
  const [value, setValue] = useState<JudgeMap>(company.judge_defaults);
  const [preview, setPreview] = useState("backend");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await companyApi.update({ judge_defaults: value });
      refresh(res.company);
      setValue(res.company.judge_defaults);
      setSaved(true);
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
          <span className="eyebrow">AI judges · company defaults</span>
          <h1 className="page-title">
            Who candidates <span className="hl">meet</span>
          </h1>
          <p className="muted small" style={{ maxWidth: 640 }}>
            Five AI colleagues run every assessment. Set how they behave across all your topics; a topic can still override any of
            them. They stay in role and never give away the answer — these settings change their manner, how demanding they are and
            what they probe.
          </p>
        </div>
        <div className="co-actions">
          <label className="small muted" htmlFor="judge-preview">Preview roles for</label>
          <select id="judge-preview" className="select" style={{ width: "auto" }} value={preview} onChange={(e) => setPreview(e.target.value)}>
            {Object.entries(TRACK_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="stack">
        <FormError message={error} />
        {saved && <div className="banner banner--info" role="status">Saved. Every new assessment session uses these judges.</div>}
        {catalog ? <JudgeEditor catalog={catalog} track={preview} value={value} onChange={setValue} /> : <div className="skeleton" style={{ height: 300 }} />}
        <div className="co-actions">
          <button className="btn" onClick={save} disabled={busy} data-testid="save-judges">
            {busy ? <span className="busy-dots">Saving</span> : "Save judges"}
          </button>
        </div>
      </div>
    </main>
  );
}
