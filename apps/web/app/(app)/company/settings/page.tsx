"use client";

import { useState, type FormEvent } from "react";
import { CompanyGate } from "../../../../components/CompanyGate";
import { FormError } from "../../../../components/AuthShell";
import { ProfileForm } from "../../../../components/company/ProfileForm";
import { companyApi, type Company, type Smtp } from "../../../../lib/company";
import { useAuth } from "../../../../lib/auth";

export default function SettingsPage() {
  return <CompanyGate>{(company, refresh) => <Settings company={company} refresh={refresh} />}</CompanyGate>;
}

function Settings({ company, refresh }: { company: Company; refresh: (c: Company) => void }) {
  const { user } = useAuth();
  const [name, setName] = useState(company.name);
  const [smtp, setSmtp] = useState<Smtp>({ port: 587, security: "starttls", ...company.smtp });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(user?.primaryEmailAddress?.emailAddress ?? "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { has_password: _hp, ...rest } = smtp;
      const res = await companyApi.update({ name, smtp: { ...rest, password: password || null } });
      refresh(res.company);
      setPassword("");
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await companyApi.testSmtp(testTo);
      if (res.ok) setNotice(`Test email sent to ${testTo}.`);
      else setError(`SMTP test failed: ${res.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SMTP test failed.");
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof Smtp, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`smtp-${k}`}>{label}</label>
      <input
        id={`smtp-${k}`}
        className="input"
        value={(smtp[k] as string | number | undefined) ?? ""}
        onChange={(e) => setSmtp({ ...smtp, [k]: props.type === "number" ? Number(e.target.value) : e.target.value })}
        {...props}
      />
    </div>
  );

  return (
    <main className="app-main">
      <div className="page-head">
        <span className="eyebrow">Settings</span>
        <h1 className="page-title">
          Company & <span className="hl">email</span>
        </h1>
      </div>
      <div style={{ maxWidth: 760, marginBottom: 24 }}>
        <ProfileForm company={company} refresh={refresh} />
      </div>
      <form className="stack" style={{ maxWidth: 760 }} onSubmit={save}>
        <FormError message={error} />
        {notice && <div className="banner banner--info" role="status">{notice}</div>}
        <section className="card stack">
          <h2 className="section-title">Company</h2>
          <div className="field">
            <label htmlFor="co-name">Company name</label>
            <input id="co-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            <span className="field__hint xsmall muted">Shown to candidates in invites and at the start of the assessment.</span>
          </div>
        </section>
        <section className="card stack">
          <div>
            <h2 className="section-title">SMTP server</h2>
            <p className="small muted">Candidate invites are sent through your mail server, from your address.</p>
          </div>
          <div className="grid-2">
            {field("host", "Host", { placeholder: "smtp.gmail.com" })}
            <div className="grid-2" style={{ gap: 12 }}>
              {field("port", "Port", { type: "number", min: 1, max: 65535 })}
              <div className="field">
                <label htmlFor="smtp-security">Security</label>
                <select id="smtp-security" className="select" value={smtp.security} onChange={(e) => setSmtp({ ...smtp, security: e.target.value as Smtp["security"] })}>
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="ssl">SSL/TLS (465)</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
            {field("username", "Username", { autoComplete: "off" })}
            <div className="field">
              <label htmlFor="smtp-password">Password</label>
              <input
                id="smtp-password"
                type="password"
                className="input"
                autoComplete="new-password"
                placeholder={smtp.has_password ? "•••••••• (saved — leave empty to keep)" : "App password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {field("from_email", "From email", { type: "email", placeholder: "hiring@yourcompany.com" })}
            {field("from_name", "From name", { placeholder: `${company.name} Hiring` })}
          </div>
          <div className="co-actions">
            <button className="btn" type="submit" disabled={busy} data-testid="save-settings">Save settings</button>
            <span className="small muted">then</span>
            <input className="input" style={{ maxWidth: 260 }} type="email" aria-label="Send a test email to" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@company.com" />
            <button type="button" className="btn btn--ghost" onClick={test} disabled={busy || !testTo || !company.smtp.host}>Send test email</button>
          </div>
        </section>
      </form>
    </main>
  );
}
