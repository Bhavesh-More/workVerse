"use client";

// The company profile candidates see on their assessment briefing. Company-wide (not per
// assessment), all optional; candidates only see what's filled in.
import { useState, type FormEvent } from "react";
import { FormError } from "../AuthShell";
import { companyApi, type Company, type CompanyProfile } from "../../lib/company";

const FIELDS: { key: keyof CompanyProfile; label: string; rows?: number; max: number; hint: string; placeholder: string }[] = [
  { key: "tagline", label: "One-line description", max: 160, hint: "The first thing candidates read about you.", placeholder: "We build payment tools for independent shops." },
  { key: "about", label: "What you do", rows: 3, max: 1200, hint: "A short paragraph in plain words.", placeholder: "Who your customers are, what you make, how big the team is…" },
  { key: "mission", label: "Mission", rows: 2, max: 600, hint: "Why the company exists.", placeholder: "Make getting paid effortless for small businesses." },
  { key: "vision", label: "Vision", rows: 2, max: 600, hint: "Where you're heading.", placeholder: "Every independent shop running on tools as good as the big chains'." },
  { key: "values", label: "How you work", rows: 2, max: 600, hint: "Values or working style.", placeholder: "Calm under pressure, write things down, customers first." },
  { key: "industry", label: "Industry", max: 80, hint: "", placeholder: "Fintech" },
  { key: "website", label: "Website", max: 200, hint: "", placeholder: "https://example.com" },
];

export function ProfileForm({ company, refresh }: { company: Company; refresh: (c: Company) => void }) {
  const [p, setP] = useState<CompanyProfile>(company.profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(company.profile);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await companyApi.update({ profile: p });
      refresh(res.company);
      setP(res.company.profile);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="profile" className="card stack" onSubmit={save} data-testid="profile-form">
      <div>
        <h2 className="section-title">Company profile</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Shown to candidates you invite, on each assessment&apos;s briefing. Leave anything blank to hide it. Changes apply to every assessment straight away.
        </p>
      </div>
      <FormError message={error} />
      {saved && !dirty && <div className="banner banner--info" role="status">Profile saved.</div>}
      <div className="pf-grid">
        {FIELDS.map((f) => (
          <div key={f.key} className={`field${f.rows ? " pf-wide" : ""}`}>
            <label htmlFor={`pf-${f.key}`}>{f.label}</label>
            {f.rows ? (
              <textarea id={`pf-${f.key}`} className="textarea" rows={f.rows} maxLength={f.max} value={p[f.key]} placeholder={f.placeholder} onChange={(e) => setP({ ...p, [f.key]: e.target.value })} data-testid={`pf-${f.key}`} />
            ) : (
              <input id={`pf-${f.key}`} className="input" maxLength={f.max} value={p[f.key]} placeholder={f.placeholder} onChange={(e) => setP({ ...p, [f.key]: e.target.value })} data-testid={`pf-${f.key}`} />
            )}
            {f.hint && <span className="field__hint xsmall muted">{f.hint}</span>}
          </div>
        ))}
      </div>
      <div>
        <button className="btn" type="submit" disabled={busy || !dirty} data-testid="save-profile">{busy ? <span className="busy-dots">Saving</span> : "Save profile"}</button>
      </div>
    </form>
  );
}
