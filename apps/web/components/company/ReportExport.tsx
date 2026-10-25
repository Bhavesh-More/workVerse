"use client";

// Download reports for an assessment: choose the report (one-page summary per candidate, the
// in-detail review, or the group report) and, for the per-candidate ones, which candidates.
import { useEffect, useMemo, useState } from "react";
import { BAND_COLORS, companyApi, type AssessmentDetail, type AssessmentSummary } from "../../lib/company";
import "./report-export.css";

export type ReportKind = "summary" | "detailed" | "group-summary" | "group-detailed";

type KindMeta = { id: ReportKind; scope: "candidate" | "group"; title: string; blurb: string; pages: (n: number) => string };
const KINDS: KindMeta[] = [
  {
    id: "summary",
    scope: "candidate",
    title: "Single summary",
    blurb: "One visual page per candidate: score, skill radar against the group, strengths, areas to probe, best and weakest moments.",
    pages: (n) => `${n} page${n === 1 ? "" : "s"}${n > 1 ? " + a contents page" : ""}`,
  },
  {
    id: "detailed",
    scope: "candidate",
    title: "In-detail review",
    blurb: "Everything behind each score: quoted evidence, the checks it rests on, conversation analysis, coaching and the full transcript.",
    pages: () => "several pages per candidate",
  },
  {
    id: "group-summary",
    scope: "group",
    title: "Group summary",
    blurb: "The whole round on one page: key numbers, score distribution, bands, pipeline, skill spread, top candidates and key insights.",
    pages: () => "1 page for the whole assessment",
  },
  {
    id: "group-detailed",
    scope: "group",
    title: "Group detailed overview",
    blurb: "Every chart and the full ranking of everyone invited, with a page per completed candidate and how to read the scores.",
    pages: () => "the whole assessment, several pages",
  },
];

export function ReportExportDialog({
  detail,
  initialKind = "summary",
  initialIds,
  onClose,
}: {
  detail: AssessmentDetail;
  initialKind?: ReportKind;
  initialIds?: string[];
  onClose: () => void;
}) {
  const a = detail.assessment;
  const completed = useMemo(() => detail.candidates.filter((c) => c.status === "completed").sort((x, y) => (y.score ?? -1) - (x.score ?? -1)), [detail.candidates]);
  const others = useMemo(() => detail.candidates.filter((c) => c.status !== "completed"), [detail.candidates]);
  const [kind, setKind] = useState<ReportKind>(initialKind);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialIds ?? completed.map((c) => c.id)));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perCandidate = kind === "summary" || kind === "detailed";

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);

  const q = query.trim().toLowerCase();
  const match = (c: { name: string; email: string }) => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  const shown = completed.filter(match);
  const count = completed.filter((c) => picked.has(c.id)).length;
  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "group-summary" || kind === "group-detailed") await companyApi.downloadPdf(a.id, kind === "group-summary" ? "summary" : "detailed");
      else {
        const ids = completed.filter((c) => picked.has(c.id)).map((c) => c.id);
        await companyApi.downloadCandidateReports(a.id, kind, ids, `${kind === "summary" ? "summary" : "detailed-review"}.pdf`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the report.");
    } finally {
      setBusy(false);
    }
  };

  const meta = KINDS.find((k) => k.id === kind)!;
  return (
    <div className="we-modal" role="dialog" aria-modal="true" aria-labelledby="rx-title" onClick={() => !busy && onClose()}>
      <div className="we-modal__card rx" onClick={(e) => e.stopPropagation()} data-testid="report-dialog">
        <div className="rx__head">
          <div>
            <span className="eyebrow" style={{ margin: 0 }}>{a.title}</span>
            <h2 id="rx-title" className="section-title" style={{ margin: "4px 0 0" }}>Download reports</h2>
          </div>
          <button type="button" className="nt-popup__x" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <fieldset className="rx__kinds">
          <legend className="eyebrow">1 · Report</legend>
          {(["candidate", "group"] as const).map((scope) => (
            <div key={scope} className="rx__group">
              <span className="rx__scope">{scope === "candidate" ? "About each candidate" : "About the whole assessment"}</span>
              <div className="rx__pair">
                {KINDS.filter((k) => k.scope === scope).map((k) => (
                  <label key={k.id} className={`rx__kind${kind === k.id ? " is-on" : ""}`} data-testid={`report-kind-${k.id}`}>
                    <input type="radio" name="rx-kind" checked={kind === k.id} onChange={() => setKind(k.id)} />
                    <KindIcon kind={k.id} />
                    <span>
                      <strong>{k.title}</strong>
                      <span className="xsmall muted">{k.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        {perCandidate && (
          <fieldset className="rx__people">
            <legend className="eyebrow">2 · Candidates</legend>
            {completed.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>Nobody has finished yet. Reports appear here as candidates complete the assessment.</p>
            ) : (
              <>
                <div className="rx__tools">
                  <input className="input" type="search" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search candidates" />
                  <button type="button" className="text-link xsmall" onClick={() => setPicked(new Set(completed.map((c) => c.id)))} data-testid="report-select-all">Select all</button>
                  <button type="button" className="text-link xsmall" onClick={() => setPicked(new Set())} data-testid="report-select-none">Clear</button>
                </div>
                <ul className="list-reset rx__list" data-testid="report-candidates">
                  {shown.map((c) => (
                    <li key={c.id}>
                      <label className={`rx__person${picked.has(c.id) ? " is-on" : ""}`}>
                        <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} data-testid={`report-pick-${c.email}`} />
                        <span className="rx__who">
                          <strong>{c.name}</strong>
                          <span className="xsmall muted">{c.email}</span>
                        </span>
                        <span className="rx__score">
                          <b>{c.score ?? "—"}</b>
                          {c.band && (
                            <span className="xsmall muted">
                              <span className="rx__dot" style={{ background: BAND_COLORS[c.band.label] ?? "#141414" }} aria-hidden="true" /> {c.band.label}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                  {shown.length === 0 && <li className="small muted" style={{ padding: 10 }}>No match for “{query}”.</li>}
                </ul>
                {others.length > 0 && (
                  <p className="xsmall muted" style={{ margin: 0 }}>
                    {others.length} candidate{others.length === 1 ? " hasn't" : "s haven't"} finished yet, so {others.length === 1 ? "has" : "have"} no report.
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}

        {error && <div className="banner banner--error small" role="alert">{error}</div>}
        <div className="rx__foot">
          <span className="small muted" data-testid="report-summary">
            {perCandidate ? (count ? `${count} candidate${count === 1 ? "" : "s"} · one PDF · ${meta.pages(count)}` : "Choose at least one candidate") : `One PDF · ${meta.pages(0)}`}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={download} disabled={busy || (perCandidate && count === 0)} data-testid="report-download">
              {busy ? <span className="busy-dots">Building PDF</span> : "Download PDF"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Small drawn previews of each report's shape, so the choice is visual as well as written. */
function KindIcon({ kind }: { kind: ReportKind }) {
  return (
    <svg className="rx__icon" width="44" height="56" viewBox="0 0 44 56" aria-hidden="true">
      <rect x="0.5" y="0.5" width="43" height="55" rx="4" fill="#fff" stroke="#141414" />
      {kind === "summary" && (
        <>
          <circle cx="32" cy="12" r="6" fill="none" stroke="#21935b" strokeWidth="3" />
          <rect x="6" y="8" width="16" height="3" rx="1" fill="#141414" />
          <rect x="6" y="14" width="11" height="2" rx="1" fill="#b5b5b5" />
          <polygon points="14,24 22,28 20,37 10,37 7,29" fill="#141414" fillOpacity="0.15" stroke="#141414" strokeWidth="1" />
          <rect x="26" y="25" width="12" height="2" rx="1" fill="#141414" />
          <rect x="26" y="30" width="9" height="2" rx="1" fill="#141414" />
          <rect x="26" y="35" width="11" height="2" rx="1" fill="#141414" />
          <rect x="6" y="43" width="15" height="7" rx="1.5" fill="#eef7ee" />
          <rect x="23" y="43" width="15" height="7" rx="1.5" fill="#fdf5e1" />
        </>
      )}
      {kind === "detailed" && (
        <>
          <rect x="6" y="7" width="20" height="3" rx="1" fill="#141414" />
          {[14, 19, 24, 29, 34, 39, 44].map((y, i) => (
            <rect key={y} x="6" y={y} width={i % 3 === 2 ? 22 : 32} height="2" rx="1" fill={i % 3 === 0 ? "#141414" : "#b5b5b5"} />
          ))}
          <rect x="34" y="4" width="6" height="8" rx="1" fill="none" stroke="#141414" />
          <rect x="36" y="2" width="6" height="8" rx="1" fill="#fff" stroke="#141414" />
        </>
      )}
      {kind === "group-summary" && (
        <>
          <rect x="6" y="6" width="32" height="6" rx="1" fill="#f2f2f2" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={7 + i * 3.4} y={30 - [3, 6, 10, 13, 8, 4][i]!} width="2.6" height={[3, 6, 10, 13, 8, 4][i]} fill={["#d03b3b", "#d03b3b", "#fab219", "#21935b", "#0ca30c", "#0ca30c"][i]} />
          ))}
          <rect x="28" y="17" width="10" height="3" rx="1" fill="#0ca30c" />
          <rect x="28" y="22" width="7" height="3" rx="1" fill="#fab219" />
          <rect x="28" y="27" width="4" height="3" rx="1" fill="#d03b3b" />
          {[36, 40, 44].map((y) => (
            <rect key={y} x="6" y={y} width="14" height="2" rx="1" fill="#141414" />
          ))}
          <rect x="23" y="35" width="15" height="13" rx="1.5" fill="#fff8dc" />
        </>
      )}
      {kind === "group-detailed" && (
        <>
          <rect x="6" y="7" width="18" height="3" rx="1" fill="#141414" />
          {[16, 22, 28, 34].map((y, i) => (
            <rect key={y} x="6" y={y} width={30 - i * 6} height="3.5" rx="1" fill="#141414" />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={7 + i * 6} y={50 - [4, 8, 11, 6, 3][i]!} width="4" height={[4, 8, 11, 6, 3][i]} fill="#b5b5b5" />
          ))}
        </>
      )}
    </svg>
  );
}

/** The two whole-group PDFs (summary on one page, or the detailed overview), for a list of candidates. */
export function GroupPdfDialog({
  title,
  subtitle,
  onDownload,
  onClose,
}: {
  title: string;
  subtitle: string;
  onDownload: (kind: "summary" | "detailed") => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"summary" | "detailed">("summary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);
  const options = [
    { id: "summary" as const, icon: "group-summary" as ReportKind, title: "Summary · 1 page", blurb: "Everyone on one page: key numbers, score distribution, bands, pipeline, skill spread, top candidates, a per-assessment breakdown and key insights." },
    { id: "detailed" as const, icon: "group-detailed" as ReportKind, title: "Detailed overview", blurb: "Every chart and the full ranking of everyone, with a page per completed candidate and how to read the scores." },
  ];
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDownload(kind);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="we-modal" role="dialog" aria-modal="true" aria-labelledby="gx-title" onClick={() => !busy && onClose()}>
      <div className="we-modal__card rx" onClick={(e) => e.stopPropagation()} data-testid="group-report-dialog">
        <div className="rx__head">
          <div>
            <span className="eyebrow" style={{ margin: 0 }}>{subtitle}</span>
            <h2 id="gx-title" className="section-title" style={{ margin: "4px 0 0" }}>{title}</h2>
          </div>
          <button type="button" className="nt-popup__x" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="rx__pair">
          {options.map((o) => (
            <label key={o.id} className={`rx__kind${kind === o.id ? " is-on" : ""}`} data-testid={`group-kind-${o.id}`}>
              <input type="radio" name="gx-kind" checked={kind === o.id} onChange={() => setKind(o.id)} />
              <KindIcon kind={o.icon} />
              <span>
                <strong>{o.title}</strong>
                <span className="xsmall muted">{o.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        {error && <div className="banner banner--error small" role="alert">{error}</div>}
        <div className="rx__foot">
          <span className="small muted">One PDF · {kind === "summary" ? "1 page" : "several pages"}</span>
          <span className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={go} disabled={busy} data-testid="group-download">
              {busy ? <span className="busy-dots">Building PDF</span> : "Download PDF"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Assessment-wise results: pick the assessments, then a one-page comparison or the detailed report. */
export function AssessmentsPdfDialog({ assessments, onClose }: { assessments: AssessmentSummary[]; onClose: () => void }) {
  const [kind, setKind] = useState<"summary" | "detailed">("summary");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(assessments.map((a) => a.id)));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? assessments.filter((a) => `${a.title} ${a.topic_title}`.toLowerCase().includes(q)) : assessments;
  }, [assessments, query]);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const count = picked.size;
  const options = [
    { id: "summary" as const, icon: "group-summary" as ReportKind, title: "Summary · 1 page", blurb: "Every assessment side by side: score spread, band mix and completion, a table with each round's numbers and top candidate, and key insights." },
    { id: "detailed" as const, icon: "group-detailed" as ReportKind, title: "Detailed report", blurb: "The comparison page, then for each assessment its one-page result and the full ranking of everyone invited." },
  ];
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await companyApi.downloadAssessmentsReport(kind, count === assessments.length ? [] : [...picked]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="we-modal" role="dialog" aria-modal="true" aria-labelledby="ax-title" onClick={() => !busy && onClose()}>
      <div className="we-modal__card rx" onClick={(e) => e.stopPropagation()} data-testid="assessments-report-dialog">
        <div className="rx__head">
          <div>
            <span className="eyebrow" style={{ margin: 0 }}>Assessment results</span>
            <h2 id="ax-title" className="section-title" style={{ margin: "4px 0 0" }}>Download reports</h2>
          </div>
          <button type="button" className="nt-popup__x" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <fieldset className="rx__kinds">
          <legend className="eyebrow">1 · Report</legend>
          <div className="rx__pair">
            {options.map((o) => (
              <label key={o.id} className={`rx__kind${kind === o.id ? " is-on" : ""}`} data-testid={`assessments-kind-${o.id}`}>
                <input type="radio" name="ax-kind" checked={kind === o.id} onChange={() => setKind(o.id)} />
                <KindIcon kind={o.icon} />
                <span>
                  <strong>{o.title}</strong>
                  <span className="xsmall muted">{o.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="rx__people">
          <legend className="eyebrow">2 · Assessments</legend>
          <div className="rx__tools">
            <input className="input" type="search" placeholder="Search assessments" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search assessments" />
            <button type="button" className="text-link xsmall" onClick={() => setPicked(new Set(assessments.map((a) => a.id)))} data-testid="assessments-select-all">Select all</button>
            <button type="button" className="text-link xsmall" onClick={() => setPicked(new Set())} data-testid="assessments-select-none">Clear</button>
          </div>
          <ul className="list-reset rx__list" data-testid="assessments-list">
            {shown.map((a) => (
              <li key={a.id}>
                <label className={`rx__person${picked.has(a.id) ? " is-on" : ""}`}>
                  <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} data-testid={`assessments-pick-${a.id}`} />
                  <span className="rx__who">
                    <strong>{a.title}</strong>
                    <span className="xsmall muted">{a.topic_title} · {a.status === "active" ? "open" : "closed"}</span>
                  </span>
                  <span className="rx__score">
                    <b>{a.completed}/{a.invited}</b>
                    <span className="xsmall muted">completed</span>
                  </span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="small muted" style={{ padding: 10 }}>No match for “{query}”.</li>}
          </ul>
        </fieldset>
        {error && <div className="banner banner--error small" role="alert">{error}</div>}
        <div className="rx__foot">
          <span className="small muted" data-testid="assessments-summary">
            {count ? `${count} assessment${count === 1 ? "" : "s"} · one PDF · ${kind === "summary" ? "1 page" : "several pages"}` : "Choose at least one assessment"}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={go} disabled={busy || count === 0} data-testid="assessments-download">
              {busy ? <span className="busy-dots">Building PDF</span> : "Download PDF"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
