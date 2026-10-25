"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { FormError } from "../../../../../components/AuthShell";
import { companyApi } from "../../../../../lib/company";
import { useApi } from "../../../../../lib/useApi";

export default function NewAssessmentPage() {
  return <CompanyGate>{() => <NewAssessment />}</CompanyGate>;
}

function NewAssessment() {
  const router = useRouter();
  const { data: topics } = useApi("/company/topics", companyApi.topics);
  const [topicId, setTopicId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = topics?.items ?? [];

  // ?topic= preselects (from the topic page); otherwise the newest topic.
  useEffect(() => {
    if (!items.length || topicId) return;
    const wanted = new URLSearchParams(window.location.search).get("topic");
    const pick = items.find((t) => t.id === wanted) ?? items[0]!;
    setTopicId(pick.id);
    setTitle((cur) => cur || `${pick.title} — ${new Date().toLocaleDateString(undefined, { month: "short", year: "numeric" })}`);
  }, [items, topicId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await companyApi.createAssessment({ topic_id: topicId, title: title.trim(), message: message.trim() });
      router.push(`/company/assessments/${a.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the assessment.");
      setBusy(false);
    }
  };

  return (
    <main className="app-main">
      <div className="page-head">
        <Link className="text-link small" href="/company/assessments">← Assessments</Link>
        <span className="eyebrow" style={{ marginTop: 16 }}>New assessment</span>
        <h1 className="page-title">
          Start a hiring <span className="hl">round</span>
        </h1>
      </div>
      {topics && !items.length ? (
        <div className="card stack" style={{ maxWidth: 560 }}>
          <p>You need a topic first — it defines the scenario and the AI judges.</p>
          <Link className="btn" href="/company/topics/new">Create a topic</Link>
        </div>
      ) : (
        <form className="card stack" style={{ maxWidth: 640 }} onSubmit={submit}>
          <FormError message={error} />
          <div className="field">
            <label htmlFor="as-topic">Topic</label>
            <select id="as-topic" className="select" value={topicId} onChange={(e) => setTopicId(e.target.value)} required>
              {items.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="as-title">Assessment name</label>
            <input id="as-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
            <span className="field__hint xsmall muted">Candidates see this in the invite email.</span>
          </div>
          <div className="field">
            <label htmlFor="as-message">Note to candidates (optional)</label>
            <textarea id="as-message" className="textarea" rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please complete this by Friday. It takes about 15 minutes." />
          </div>
          <button className="btn" type="submit" disabled={busy || !topicId || !title.trim()} data-testid="create-assessment">
            {busy ? <span className="busy-dots">Creating</span> : <>Create & invite candidates <span className="arrow" aria-hidden="true">→</span></>}
          </button>
        </form>
      )}
    </main>
  );
}
