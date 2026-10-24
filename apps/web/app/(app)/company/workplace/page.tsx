"use client";

// Workplace hub: which office candidates get, the custom world's draft/published state, and the
// ways in (editor, setup) and out (switch back to default — the custom world is kept).
import { useEffect, useState } from "react";
import Link from "next/link";
import { CompanyGate } from "../../../../components/CompanyGate";
import { FormError } from "../../../../components/AuthShell";
import { WorldThumb } from "../../../../components/world/Thumbs";
import { workplaceApi, type WorkplaceState } from "../../../../lib/workplace";
import { KIT } from "../../../../lib/world/kit";
import { stats } from "../../../../lib/world/doc";
import { hasErrors, validateWorld } from "../../../../lib/world/validate";

export default function WorkplacePage() {
  return <CompanyGate>{() => <Workplace />}</CompanyGate>;
}

function Workplace() {
  const [wp, setWp] = useState<WorkplaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    workplaceApi.get().then(setWp, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load your workplace."));
    if (new URLSearchParams(window.location.search).get("chosen") === "default")
      setNotice("You're using the default office. Build a custom one whenever you like — it won't affect candidates until you publish and switch to it.");
  }, []);

  const run = async (label: string, fn: () => Promise<WorkplaceState>, done?: string) => {
    setBusy(label);
    setError(null);
    try {
      setWp(await fn());
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  if (!wp) return <main className="app-main">{error ? <FormError message={error} /> : <div className="skeleton" style={{ height: 300 }} />}</main>;
  const w = wp.world;
  const draft = w?.draft;
  const unpublished = w && w.draft_version !== w.published_version;
  const issues = draft ? validateWorld(draft, KIT, wp.members) : [];
  const s = draft ? stats(draft) : null;
  const usingCustom = wp.mode === "custom";

  return (
    <main className="app-main">
      <div className="co-head">
        <div>
          <span className="eyebrow">Virtual workplace</span>
          <h1 className="page-title">
            Your <span className="hl">office</span>
          </h1>
          <p className="muted small">Where candidates walk around, meet your AI judges and use the tools.</p>
        </div>
        <div className="co-actions">
          <Link className="btn" href={draft ? "/company/workplace/editor" : "/company/workplace/setup?step=choose"} data-testid="open-editor-hub">
            {draft ? "Open world editor" : "Build a custom world"}
          </Link>
        </div>
      </div>
      <FormError message={error} />
      {notice && <div className="banner banner--info" role="status" style={{ marginBottom: 20 }}>{notice}</div>}

      <div className="wp-active card" data-testid="active-world">
        <span className="eyebrow">Candidates currently get</span>
        <div className="row between" style={{ alignItems: "center" }}>
          <h2 className="section-title">{usingCustom ? `Your custom world${draft ? ` · ${draft.name}` : ""}` : "The default office"}</h2>
          <span className={`badge${usingCustom ? " badge--ok" : ""}`}>{usingCustom ? "Custom" : wp.mode === "default" ? "Default" : "Default (not chosen yet)"}</span>
        </div>
        <p className="small muted">
          {usingCustom
            ? `Published ${w?.published_at ? new Date(w.published_at).toLocaleString() : ""}. Runs already in progress keep the version they started with.`
            : "The ready-made seven-room office."}
        </p>
        <div className="co-actions">
          {usingCustom ? (
            <button className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => run("mode", () => workplaceApi.patch({ mode: "default" }), "Switched to the default office. Your custom world is kept — switch back any time.")} data-testid="switch-default">
              Switch to the default office
            </button>
          ) : w?.published ? (
            <button className="btn btn--small" disabled={busy !== null} onClick={() => run("mode", () => workplaceApi.patch({ mode: "custom" }), "New candidates now get your custom world.")} data-testid="switch-custom">
              Use my published world
            </button>
          ) : null}
        </div>
      </div>

      <div className="co-two co-section">
        <section className="card stack">
          <div className="row between">
            <span className="eyebrow" style={{ marginBottom: 0 }}>Custom world</span>
            {w && <span className={`badge${unpublished ? " badge--warn" : " badge--ok"}`}>{!w.published ? "Draft · never published" : unpublished ? "Draft has unpublished changes" : "Published = draft"}</span>}
          </div>
          {draft ? (
            <>
              <div className="wp-thumb">
                <WorldThumb doc={draft} members={wp.members} width={520} maxHeight={320} />
              </div>
              <p className="small">
                <strong>{draft.name}</strong> · {draft.width}×{draft.height} tiles · {s?.rooms} rooms · {s?.objects} objects · {s?.people} people
              </p>
              <p className={`small ${hasErrors(issues) ? "" : "muted"}`}>
                {issues.length === 0 ? "✓ No issues found." : `${issues.filter((i) => i.level === "error").length} errors · ${issues.filter((i) => i.level === "warning").length} warnings — open the editor to review.`}
              </p>
              <div className="co-actions">
                <Link className="btn btn--small" href="/company/workplace/editor">Edit</Link>
                <Link className="btn btn--ghost btn--small" href="/company/workplace/setup?step=presets">Start from new presets…</Link>
                {w?.published && unpublished && (
                  confirmRevert ? (
                    <span className="we-confirm">
                      Throw away draft changes and go back to the published version?
                      <button className="btn btn--small we-danger-fill" onClick={() => { setConfirmRevert(false); void run("revert", workplaceApi.revert, "Draft reset to the published version."); }}>Revert</button>
                      <button className="btn btn--ghost btn--small" onClick={() => setConfirmRevert(false)}>Keep</button>
                    </span>
                  ) : (
                    <button className="btn btn--ghost btn--small" onClick={() => setConfirmRevert(true)}>Revert to published</button>
                  )
                )}
              </div>
            </>
          ) : (
            <>
              <p className="small muted">No custom world yet. Pick room presets and we&apos;ll build a connected starting layout you can edit.</p>
              <Link className="btn btn--small" style={{ justifySelf: "start" }} href="/company/workplace/setup?step=choose">Build your workplace</Link>
            </>
          )}
        </section>
        <section className="card stack">
          <span className="eyebrow">Default office</span>
          <div className="wp-thumb wp-thumb--default">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/game/map/ground.png" alt="The default office" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/game/map/walls.png" alt="" />
          </div>
          <p className="small muted">Shared by every company and never changed by your edits.</p>
        </section>
      </div>
    </main>
  );
}
