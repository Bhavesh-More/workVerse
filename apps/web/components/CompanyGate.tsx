"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "./AuthShell";
import { companyApi, type Company } from "../lib/company";
import { useApi } from "../lib/useApi";

/** Renders children once the signed-in user has a company; otherwise the one-field setup form. */
export function CompanyGate({ children }: { children: (company: Company, refresh: (c: Company) => void) => ReactNode }) {
  const { data, error, setData } = useApi("/company", companyApi.get);
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error) return <main className="app-main"><FormError message={error} /></main>;
  if (!data)
    return (
      <main className="app-main">
        <div className="skeleton" style={{ height: 120, maxWidth: 560 }} />
      </main>
    );
  if (data.company) return <>{children(data.company, (c) => setData({ company: c }))}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      setData(await companyApi.create(name.trim()));
      // New company: next comes choosing its virtual workplace.
      router.push("/company/workplace/setup");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the company.");
      setBusy(false);
    }
  };

  return (
    <main className="app-main">
      <div className="page-head">
        <span className="eyebrow">Welcome</span>
        <h1 className="page-title">
          Set up your <span className="hl">company</span>
        </h1>
        <p className="muted">
          Just a name to start.
        </p>
      </div>
      <form className="card stack" style={{ maxWidth: 520 }} onSubmit={submit}>
        <FormError message={formError} />
        <div className="field">
          <label htmlFor="company-name">Company name</label>
          <input id="company-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." required maxLength={120} />
        </div>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>
          {busy ? <span className="busy-dots">Creating</span> : <>Create company <span className="arrow" aria-hidden="true">→</span></>}
        </button>
      </form>
    </main>
  );
}
