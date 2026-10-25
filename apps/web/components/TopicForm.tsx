"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "./AuthShell";
import { JudgeEditor } from "./JudgeEditor";
import { TopicJudges } from "./judges/TopicJudges";
import { TRACK_LABELS, companyApi, suggestTrack, type Company, type Topic, type TopicInput } from "../lib/company";
import { useApi } from "../lib/useApi";

const EMPTY: TopicInput = { title: "", description: "", track: "backend", incident: null, difficulty: "standard", judges: {} };

export function TopicForm({ company, topic }: { company: Company; topic?: Topic }) {
  const router = useRouter();
  const { data: catalog } = useApi("/company/judges/catalog", companyApi.catalog);
  const [form, setForm] = useState<TopicInput>(topic ?? EMPTY);
  const [trackTouched, setTrackTouched] = useState(Boolean(topic));
  const [sampleIdx, setSampleIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Until the company picks a track, follow the title and description.
  const edit = (patch: Partial<TopicInput>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (trackTouched) return next;
      const track = suggestTrack(`${next.title} ${next.description}`);
      return track === f.track ? next : { ...next, track, incident: null };
    });

  const fillSample = () => {
    if (!catalog) return;
    const s = catalog.samples[sampleIdx % catalog.samples.length]!;
    setSampleIdx((i) => i + 1);
    // Samples tune roles; a roster company's topic tunes judges, so give each role's tuning to its first judge.
    const roster = company.judge_roster;
    const judges = roster
      ? Object.fromEntries(Object.entries(s.judges).flatMap(([role, cfg]) => {
          const j = roster.find((x) => x.role === role);
          return j && cfg ? [[j.id, { ...cfg, name: undefined }]] : [];
        }))
      : { ...s.judges };
    setForm({ ...s, incident: s.incident ?? null, judges, judge_ids: form.judge_ids ?? null });
    setTrackTouched(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (topic) {
        await companyApi.updateTopic(topic.id, form);
        setSaved(true);
      } else {
        const created = await companyApi.createTopic(form);
        router.push(`/company/topics/${created.id}?created=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the topic.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!topic || !window.confirm(`Delete the topic "${topic.title}"? This can't be undone.`)) return;
    try {
      await companyApi.deleteTopic(topic.id);
      router.push("/company/topics");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the topic.");
    }
  };

  const track = catalog?.tracks.find((t) => t.id === form.track);

  return (
    <form onSubmit={submit} className="stack--lg stack">
      <section className="card stack">
        <div className="row between">
          <h2 className="section-title">Brief</h2>
          <button type="button" className="btn btn--ghost btn--small" onClick={fillSample} disabled={!catalog} data-testid="fill-sample">
            ✦ Fill with sample
          </button>
        </div>
        <FormError message={error} />
        {saved && <div className="banner banner--info" role="status">Saved. New candidates will meet these judges.</div>}
        <div className="field">
          <label htmlFor="topic-title">Topic</label>
          <input id="topic-title" className="input" required maxLength={160} placeholder="e.g. On-call incident: checkout errors after a deploy" value={form.title} onChange={(e) => edit({ title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="topic-desc">Description</label>
          <textarea
            id="topic-desc"
            className="textarea"
            rows={5}
            maxLength={4000}
            placeholder="Who you're hiring and what you want to see. Candidates read this at the start."
            value={form.description}
            onChange={(e) => edit({ description: e.target.value })}
          />
          <span className="field__hint xsmall muted">That&apos;s all you need. The scenario, colleagues and scoring are built from it.</span>
        </div>
        <details>
          <summary className="mono xsmall" style={{ cursor: "pointer" }}>Scenario options (optional)</summary>
          <div className="grid-3" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="topic-track">Role track</label>
              <select
                id="topic-track"
                className="select"
                value={form.track}
                onChange={(e) => {
                  setTrackTouched(true);
                  setForm({ ...form, track: e.target.value, incident: null });
                }}
              >
                {Object.entries(TRACK_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="topic-incident">Problem</label>
              <select id="topic-incident" className="select" value={form.incident ?? ""} onChange={(e) => setForm({ ...form, incident: e.target.value || null })}>
                <option value="">Random per candidate</option>
                {track?.incidents.map((i) => (
                  <option key={i.id} value={i.id}>{i.title}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="topic-difficulty">Difficulty</label>
              <select id="topic-difficulty" className="select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                <option value="introductory">Introductory</option>
                <option value="standard">Standard</option>
                <option value="challenging">Challenging</option>
              </select>
            </div>
          </div>
        </details>
      </section>

      <section className="stack">
        <div>
          <h2 className="section-title">AI judges for this topic</h2>
          <p className="small muted">
            {company.judge_roster
              ? "Choose which of your judges take part in this scenario, and fine-tune how they behave for it. Names, looks and voices come from AI judges."
              : "These colleagues talk with the candidate and shape the evidence they're scored on. Anything you leave empty uses your company defaults from AI judges."}
          </p>
        </div>
        {catalog && company.judge_roster ? (
          <TopicJudges
            catalog={catalog}
            roster={company.judge_roster}
            selected={form.judge_ids ?? null}
            tuning={form.judges}
            onChange={({ judge_ids, judges }) => setForm({ ...form, judge_ids, judges })}
          />
        ) : catalog ? (
          <JudgeEditor catalog={catalog} track={form.track} value={form.judges} base={company.judge_defaults} onChange={(judges) => setForm({ ...form, judges })} />
        ) : (
          <div className="skeleton" style={{ height: 300 }} />
        )}
      </section>

      <div className="co-actions">
        <button className="btn" type="submit" disabled={busy || !form.title.trim() || (form.judge_ids?.length === 0)} data-testid="save-topic">
          {busy ? <span className="busy-dots">Saving</span> : topic ? "Save topic" : "Create topic"}
        </button>
        {topic && (
          <button type="button" className="btn btn--ghost" onClick={() => router.push(`/company/assessments/new?topic=${topic.id}`)}>
            Create assessment from this topic →
          </button>
        )}
        {topic && !topic.assessment_count && (
          <button type="button" className="btn btn--ghost" onClick={remove}>Delete</button>
        )}
      </div>
    </form>
  );
}
