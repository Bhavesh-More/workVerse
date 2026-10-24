"use client";

// Workplace setup: choose default vs custom, pick room presets, review who's in the office,
// then open the editor with a generated, connected layout. Progress is saved after each step.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { FormError } from "../../../../../components/AuthShell";
import { CharThumb, PresetThumb, WorldThumb } from "../../../../../components/world/Thumbs";
import type { Company } from "../../../../../lib/company";
import { useAuth } from "../../../../../lib/auth";
import { workplaceApi, type WorkplaceState } from "../../../../../lib/workplace";
import { uid } from "../../../../../lib/world/doc";
import { KIT, JUDGE_LOOK, JUDGE_TITLES } from "../../../../../lib/world/kit";
import { PRESETS, generateLayout, presetById, type RoomPreset } from "../../../../../lib/world/presets";
import { JUDGE_SLOTS } from "../../../../../lib/world/validate";
import type { Member } from "../../../../../lib/world/types";

type Step = "choose" | "presets" | "people";
const STEPS: { id: Step; label: string }[] = [
  { id: "choose", label: "Workplace" },
  { id: "presets", label: "Rooms" },
  { id: "people", label: "People" },
];
const RECOMMENDED = ["reception", "ops_lab", "meeting", "executive", "lounge"];
const LOOKS = ["m1", "m2", "m3", "m4", "m5", "f1", "f2", "f3", "f4", "f5"];

export default function WorkplaceSetupPage() {
  return <CompanyGate>{(company) => <Setup company={company} />}</CompanyGate>;
}

function Setup({ company }: { company: Company }) {
  const router = useRouter();
  const { user } = useAuth();
  const [wp, setWp] = useState<WorkplaceState | null>(null);
  const [step, setStep] = useState<Step>("choose");
  const [presets, setPresets] = useState<string[]>(RECOMMENDED);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RoomPreset | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);

  useEffect(() => {
    workplaceApi.get().then(
      (w) => {
        setWp(w);
        const wanted = new URLSearchParams(window.location.search).get("step") as Step | null;
        const saved = w.setup.step && w.setup.step !== "done" ? (w.setup.step as Step) : null;
        setStep(wanted && STEPS.some((s) => s.id === wanted) ? wanted : saved ?? "choose");
        if (w.setup.presets?.length) setPresets(w.setup.presets.filter((id) => presetById(id)));
        setMembers(
          w.members.length
            ? w.members
            : [
                { id: uid("mem"), name: "Alex Morgan", title: "Office manager", look: "m3" },
                { id: uid("mem"), name: "Priya Nair", title: "Product designer", look: "f4" },
                { id: uid("mem"), name: "Tom Reed", title: "Data analyst", look: "m4" },
              ],
        );
      },
      (e: unknown) => setError(e instanceof Error ? e.message : "Could not load your workplace."),
    );
  }, []);

  const judgeNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [slot, cfg] of Object.entries(company.judge_defaults)) if (cfg?.name) out[slot] = cfg.name;
    return out;
  }, [company]);
  const layout = useMemo(() => (presets.length ? generateLayout(KIT, presets, { name: `${company.name} HQ`, members }) : null), [presets, members, company.name]);

  const go = async (next: Step) => {
    setError(null);
    setStep(next);
    window.history.replaceState(null, "", `?step=${next}`);
    try {
      await workplaceApi.patch({ setup: { ...(wp?.setup ?? {}), step: next, presets } });
    } catch {
      // Progress saving is best-effort; the step still changes.
    }
  };

  const useDefault = async () => {
    setBusy("default");
    setError(null);
    try {
      await workplaceApi.patch({ mode: "default", setup: { ...(wp?.setup ?? {}), step: "done", completed: true } });
      router.push("/company/workplace?chosen=default");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice.");
      setBusy(null);
    }
  };

  const openEditor = async () => {
    if (!layout) return;
    const named = members.filter((mm) => mm.name.trim());
    if (named.some((mm) => mm.name.trim().length > 60 || mm.title.length > 60)) return setError("Names and titles are up to 60 characters.");
    setBusy("editor");
    setError(null);
    try {
      await workplaceApi.patch({ members: named.map((mm) => ({ ...mm, name: mm.name.trim(), title: mm.title.trim() })), setup: { step: "done", completed: true, presets } });
      const doc = generateLayout(KIT, presets, { name: `${company.name} HQ`, members: named });
      if (!wp?.world) await workplaceApi.saveDraft(doc, 0);
      else if (replaceOk) await workplaceApi.saveDraft(doc, wp.world.draft_version);
      router.push("/company/workplace/editor");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create your world.");
      setBusy(null);
    }
  };

  if (!wp) return <main className="app-main">{error ? <FormError message={error} /> : <div className="skeleton" style={{ height: 320 }} />}</main>;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <main className="app-main ws-main">
      <ol className="ws-steps" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === stepIndex ? "is-current" : i < stepIndex ? "is-done" : ""} aria-current={i === stepIndex ? "step" : undefined}>
            <span className="mono">{i < stepIndex ? "✓" : i + 1}</span> {s.label}
          </li>
        ))}
      </ol>
      <FormError message={error} />

      {step === "choose" && (
        <m.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="page-head">
            <span className="eyebrow">{company.name} · virtual workplace</span>
            <h1 className="page-title">
              Where will candidates <span className="hl">work</span>?
            </h1>
            <p className="muted">Candidates walk around this office, talk to your AI judges and use the tools. You can change your mind later — both options stay available in Workplace.</p>
          </div>
          <div className="ws-choice">
            <article className="ws-option" data-testid="choice-custom">
              <div className="ws-option__art">{layout ? <WorldThumb doc={layout} members={members} width={460} maxHeight={250} /> : null}</div>
              <span className="eyebrow">Option 1</span>
              <h2 className="section-title">Build your workplace</h2>
              <p className="small muted">Design a virtual workplace that reflects your company: choose room layouts and position your team in a world you control.</p>
              <ul className="list-reset ws-bullets small">
                <li>Six editable room presets, or start blank</li>
                <li>Drag-and-drop editor with a real grid</li>
                <li>Save as you go and publish when ready</li>
              </ul>
              <button className="btn" onClick={() => go("presets")} data-testid="create-world">
                {wp.world ? "Continue my world" : "Create my world"} <span className="arrow" aria-hidden="true">→</span>
              </button>
            </article>
            <article className="ws-option" data-testid="choice-default">
              <div className="ws-option__art ws-option__art--default">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/game/map/ground.png" alt="" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/game/map/walls.png" alt="" />
              </div>
              <span className="eyebrow">Option 2</span>
              <h2 className="section-title">Use the default workplace</h2>
              <p className="small muted">Get started immediately with the ready-made office. You can customise your workplace later.</p>
              <ul className="list-reset ws-bullets small">
                <li>Seven rooms, fully furnished</li>
                <li>Tested with the incident scenario</li>
                <li>Switch to a custom world any time</li>
              </ul>
              <button className="btn btn--ghost" onClick={useDefault} disabled={busy !== null} data-testid="use-default">
                {busy === "default" ? <span className="busy-dots">Saving</span> : "Use default world"}
              </button>
            </article>
          </div>
        </m.section>
      )}

      {step === "presets" && (
        <m.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="page-head">
            <span className="eyebrow">Step 2 · rooms</span>
            <h1 className="page-title">
              Pick your <span className="hl">rooms</span>
            </h1>
            <p className="muted">
              Each one becomes a furnished room in your starting layout, joined by a corridor with doorways. Every desk, chair and plant stays editable — this is a starting point, not a template.
            </p>
          </div>
          <div className="ws-presets">
            {PRESETS.map((p) => {
              const on = presets.includes(p.id);
              return (
                <article key={p.id} className={`ws-preset${on ? " is-on" : ""}`} data-testid={`preset-${p.id}`}>
                  <button type="button" className="ws-preset__pick" aria-pressed={on} onClick={() => setPresets((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}>
                    <span className="ws-preset__thumb">
                      <PresetThumb preset={p} width={300} />
                    </span>
                    <span className="ws-preset__check" aria-hidden="true">{on ? "✓" : "+"}</span>
                    <strong>{p.name}</strong>
                    <span className="small muted">{p.description}</span>
                    <span className="xsmall mono ws-preset__meta">
                      {p.w}×{p.h} tiles · {p.capacity}
                    </span>
                  </button>
                  <button type="button" className="text-link xsmall ws-preset__preview" onClick={() => setPreview(p)}>
                    Preview layout
                  </button>
                </article>
              );
            })}
          </div>
          <div className="ws-summary card">
            <div>
              <span className="eyebrow">Your starting layout</span>
              {presets.length ? (
                <p className="small">
                  {presets.length} room{presets.length > 1 ? "s" : ""}: {presets.map((id) => presetById(id)?.name).join(", ")} — plus a corridor connecting them.
                  {!presets.includes("ops_lab") && " Tip: the operations lab holds the incident tools candidates investigate."}
                </p>
              ) : (
                <p className="small">No rooms selected: you&apos;ll start with a blank canvas and build everything yourself.</p>
              )}
            </div>
            {layout && <WorldThumb doc={layout} members={members} width={260} maxHeight={150} />}
          </div>
          <div className="ws-nav">
            <button className="btn btn--ghost" onClick={() => go("choose")}>← Back</button>
            <button className="btn" onClick={() => go("people")} data-testid="presets-continue">
              Continue to people <span className="arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </m.section>
      )}

      {step === "people" && (
        <m.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="page-head">
            <span className="eyebrow">Step 3 · people</span>
            <h1 className="page-title">
              Who&apos;s in the <span className="hl">office</span>?
            </h1>
            <p className="muted">We&apos;ll place everyone in a sensible spot to start; you can move them in the editor.</p>
          </div>
          <div className="ws-people">
            <section className="card stack">
              <div className="row between">
                <h2 className="section-title">AI judges</h2>
                <span className="badge">5 · simulated</span>
              </div>
              <p className="small muted">Simulated colleagues who talk to candidates and shape the evaluation. Their personalities are set in AI judges.</p>
              <ul className="list-reset ws-roster">
                {JUDGE_SLOTS.map((slot) => (
                  <li key={slot}>
                    <CharThumb sheet={JUDGE_LOOK[slot]!} box={36} />
                    <span>
                      <strong>{judgeNames[slot] ?? "Random cast member"}</strong>
                      <span className="xsmall muted">{JUDGE_TITLES[slot]}</span>
                    </span>
                    <span className="badge">AI judge</span>
                  </li>
                ))}
              </ul>
              <Link className="text-link small" href="/company/judges">Edit judge personalities →</Link>
            </section>
            <section className="card stack">
              <div className="row between">
                <h2 className="section-title">Team members</h2>
                <span className="badge">{members.length} · display only</span>
              </div>
              <p className="small muted">People shown in your office for atmosphere — named desk neighbours candidates walk past. Not logins and not judges.</p>
              <ul className="list-reset ws-members">
                {members.map((mm, i) => (
                  <li key={mm.id} data-testid={`member-row-${i}`}>
                    <button type="button" className="ws-look" title="Change look" aria-label={`Change look for ${mm.name || "member"}`} onClick={() => setMembers(members.map((x) => (x.id === mm.id ? { ...x, look: LOOKS[(LOOKS.indexOf(x.look) + 1) % LOOKS.length]! } : x)))}>
                      <CharThumb sheet={mm.look} box={36} />
                    </button>
                    <input className="input" aria-label={`Member ${i + 1} name`} placeholder="Name" value={mm.name} maxLength={60} onChange={(e) => setMembers(members.map((x) => (x.id === mm.id ? { ...x, name: e.target.value } : x)))} />
                    <input className="input" aria-label={`Member ${i + 1} title`} placeholder="Role (optional)" value={mm.title} maxLength={60} onChange={(e) => setMembers(members.map((x) => (x.id === mm.id ? { ...x, title: e.target.value } : x)))} />
                    <button type="button" className="btn btn--ghost btn--small" aria-label={`Remove ${mm.name || "member"}`} onClick={() => setMembers(members.filter((x) => x.id !== mm.id))}>✕</button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn--ghost btn--small" style={{ justifySelf: "start" }} disabled={members.length >= 20} onClick={() => setMembers([...members, { id: uid("mem"), name: "", title: "", look: LOOKS[members.length % LOOKS.length]! }])} data-testid="add-member">
                + Add team member
              </button>
            </section>
            <section className="card stack">
              <div className="row between">
                <h2 className="section-title">Company accounts</h2>
                <span className="badge">real logins</span>
              </div>
              <p className="small muted">People who sign in to manage assessments. They aren&apos;t placed in the office.</p>
              <ul className="list-reset ws-roster">
                <li>
                  <CharThumb sheet="player" box={36} />
                  <span>
                    <strong>{user?.fullName || user?.primaryEmailAddress?.emailAddress || "You"}</strong>
                    <span className="xsmall muted">{user?.primaryEmailAddress?.emailAddress} · admin</span>
                  </span>
                  <span className="badge badge--ok">You</span>
                </li>
              </ul>
            </section>
          </div>
          <div className="ws-summary card">
            <div>
              <span className="eyebrow">Ready to build</span>
              <p className="small">
                {presets.length ? `${presets.length} rooms` : "A blank canvas"} · 5 AI judges · {members.filter((x) => x.name.trim()).length} team members. Everyone gets a starting spot you can change.
              </p>
              {wp.world && (
                <label className="we-check" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} data-testid="replace-draft" />
                  Replace my current draft with this new layout (otherwise your existing world opens unchanged)
                </label>
              )}
            </div>
            {layout && <WorldThumb doc={layout} members={members.filter((x) => x.name.trim())} width={260} maxHeight={150} />}
          </div>
          <div className="ws-nav">
            <button className="btn btn--ghost" onClick={() => go("presets")}>← Back</button>
            <button className="btn" onClick={openEditor} disabled={busy !== null} data-testid="open-editor">
              {busy === "editor" ? <span className="busy-dots">Building your world</span> : <>Open world editor <span className="arrow" aria-hidden="true">→</span></>}
            </button>
          </div>
        </m.section>
      )}

      {preview && (
        <div className="we-modal" role="dialog" aria-modal="true" aria-label={`${preview.name} layout`} onClick={() => setPreview(null)}>
          <div className="we-modal__card ws-preview" onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">{preview.w}×{preview.h} tiles · {preview.capacity}</span>
            <h2 className="section-title">{preview.name}</h2>
            <PresetThumb preset={preview} width={500} />
            <p className="small">{preview.description}</p>
            <p className="small muted">Good for: {preview.useFor}</p>
            <div className="we-actions">
              <button className="btn btn--small" onClick={() => { setPresets((cur) => (cur.includes(preview.id) ? cur : [...cur, preview.id])); setPreview(null); }}>
                {presets.includes(preview.id) ? "Selected ✓" : "Add this room"}
              </button>
              <button className="btn btn--ghost btn--small" onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

