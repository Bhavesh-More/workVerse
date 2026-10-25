"use client";

import { useRef, useState } from "react";
import { api } from "../lib/api";
import type { ContextSource, ContextView, DocumentKind } from "../lib/types";

export const SITUATION_EXAMPLES = [
  "Explaining a delay to an anxious client",
  "My manager wants a status update while I'm still unsure of the cause",
  "Pushing back on a teammate who wants a risky fix",
  "My first on-call shift and something breaks",
];

const SOURCE_LABELS: Record<string, string> = {
  cv: "CV",
  linkedin_pdf: "LinkedIn PDF",
  github: "GitHub",
  linkedin: "LinkedIn",
  portfolio: "Website",
};

/** One line per source: what we read, or why we couldn't. */
export function SourceStatus({ source }: { source: ContextSource }) {
  return (
    <li className="ctx-source">
      <span className={source.ok ? "badge badge--ok" : "badge badge--warn"}>{SOURCE_LABELS[source.kind] ?? source.kind}</span>
      <span className="xsmall">
        {source.ok ? (
          <span>{source.found.join(" · ") || "Read"}</span>
        ) : (
          <span className="muted">{source.error}</span>
        )}
      </span>
    </li>
  );
}

/** File picker for a CV or LinkedIn export. Reports links found in it so the form can pre-fill them. */
export function DocumentUpload({
  kind,
  label,
  hint,
  source,
  onChange,
}: {
  kind: DocumentKind;
  label: string;
  hint: string;
  source?: ContextSource;
  onChange: (source: ContextSource | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { source: next } = await api.uploadDocument(kind, file);
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    try {
      await api.removeDocument(kind);
      onChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it.");
    }
  }

  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="dropzone">
        <input
          ref={input}
          id={`doc-${kind}`}
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        {source?.ok ? (
          <span className="small">
            <strong>{source.filename}</strong> <span className="muted">· {source.found.join(" · ")}</span>
          </span>
        ) : (
          <span className="small muted">{hint}</span>
        )}
        <span className="row" style={{ gap: 8 }}>
          <label htmlFor={`doc-${kind}`} className="btn btn--ghost btn--small" aria-disabled={busy}>
            {busy ? <span className="busy-dots">Reading</span> : source?.ok ? "Replace" : "Upload"}
          </label>
          {source?.ok && (
            <button type="button" className="btn btn--ghost btn--small" onClick={remove}>
              Remove
            </button>
          )}
        </span>
      </div>
      {error && <span className="field__hint field__hint--error" role="alert">{error}</span>}
    </div>
  );
}

/** The built context: who the model thinks the learner is, and what it will train. */
export function ContextSummary({ view }: { view: ContextView }) {
  const c = view.context;
  if (!c) return null;
  return (
    <div className="stack stack--sm">
      <p className="small">
        <strong>{c.headline}</strong>
      </p>
      {c.summary && <p className="small muted">{c.summary}</p>}
      {c.tech_stack.length > 0 && (
        <div className="chip-row">
          {c.tech_stack.slice(0, 10).map((t) => (
            <span key={t} className="badge">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="grid-2" style={{ gap: 16 }}>
        {c.strengths.length > 0 && (
          <div>
            <span className="eyebrow">Strengths</span>
            <ul className="list-reset stack stack--sm">
              {c.strengths.map((s) => (
                <li key={s} className="xsmall">✓ {s}</li>
              ))}
            </ul>
          </div>
        )}
        {c.growth_areas.length > 0 && (
          <div>
            <span className="eyebrow">We&apos;ll train</span>
            <ul className="list-reset stack stack--sm">
              {c.growth_areas.map((s) => (
                <li key={s} className="xsmall">→ {s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function builtLabel(view: ContextView): string {
  if (view.status === "empty") return "Not built yet";
  const when = view.built_at ? new Date(view.built_at).toLocaleString() : "";
  const by = view.builder === "deterministic" ? " (basic — AI unavailable)" : "";
  return view.status === "stale" ? `Out of date — your profile changed${by}` : `Updated ${when}${by}`;
}
