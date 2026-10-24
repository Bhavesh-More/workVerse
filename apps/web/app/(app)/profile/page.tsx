"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Avatar } from "../../../components/Avatar";
import { FormError } from "../../../components/AuthShell";
import { api, peek, revalidate } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { LEVELS, splitList } from "../../../lib/practice";
import type { ContextSource, ContextView, DocumentKind, Profile } from "../../../lib/types";
import { RoleSelect } from "../../../components/RoleSelect";
import { builtLabel, ContextSummary, DocumentUpload, SourceStatus } from "../../../components/ContextBuilder";

export default function ProfilePage() {
  const { user } = useAuth();
  // Writes clear the API cache, so a cached profile is never stale relative to our own edits.
  const [cached] = useState(() => peek<Profile>("/me"));
  const [profile, setProfile] = useState<Profile | null>(cached ?? null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  // Comma-separated fields are edited as raw text and parsed on save, so typing ", " works.
  const [goalsText, setGoalsText] = useState(cached?.career_goals.join(", ") ?? "");
  const [stackText, setStackText] = useState(cached?.preferred_stack.join(", ") ?? "");
  const [ctx, setCtx] = useState<ContextView | null>(null);
  const [ctxBusy, setCtxBusy] = useState(false);
  const [ctxError, setCtxError] = useState<string | null>(null);

  useEffect(() => {
    api.getContext().then(setCtx).catch(() => {});
  }, []);

  // Any profile, link or document change can alter the context: rebuild it (a no-op server-side
  // when nothing it depends on changed). force re-reads every link even if unchanged.
  async function rebuild(force = false) {
    setCtxBusy(true);
    setCtxError(null);
    try {
      setCtx(await api.buildContext(force));
    } catch (err) {
      setCtxError(err instanceof Error ? err.message : "Could not rebuild your context.");
    } finally {
      setCtxBusy(false);
    }
  }

  // Skills feed the context too; flag it rather than spend a model call per chip.
  function markStale() {
    setCtx((v) => (v && v.status === "ready" ? { ...v, status: "stale" } : v));
  }

  function onDocument(kind: DocumentKind, source: ContextSource | null) {
    setCtx((v) => v && { ...v, sources: [...v.sources.filter((s) => s.kind !== kind), ...(source ? [source] : [])] });
    void rebuild();
  }

  useEffect(() => {
    if (cached) return;
    revalidate("/me", api.getMe)
      .then((p) => {
        setProfile(p);
        setGoalsText(p.career_goals.join(", "));
        setStackText(p.preferred_stack.join(", "));
      })
      .catch((e) => setError(e.message));
  }, [cached]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  if (!profile) {
    return (
      <main className="app-main">
        {error ? (
          <FormError message={error} />
        ) : (
          <div className="grid-2" aria-label="Loading profile">
            <div className="skeleton" style={{ height: 520 }} />
            <div className="skeleton" style={{ height: 260 }} />
          </div>
        )}
      </main>
    );
  }

  const name =
    profile.display_name ?? user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Learner";

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateMe({
        display_name: profile.display_name,
        target_role: profile.target_role,
        experience_level: profile.experience_level,
        career_goals: splitList(goalsText),
        preferred_stack: splitList(stackText),
        education_summary: profile.education_summary,
        experience_summary: profile.experience_summary,
        github_url: profile.github_url?.trim() || null,
        linkedin_url: profile.linkedin_url?.trim() || null,
        portfolio_url: profile.portfolio_url?.trim() || null,
        custom_situation: profile.custom_situation?.trim() || null,
      });
      setProfile(updated);
      setGoalsText(updated.career_goals.join(", "));
      setStackText(updated.preferred_stack.join(", "));
      setSaved(true);
      void rebuild();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function addSkill(e: FormEvent) {
    e.preventDefault();
    const skill = newSkill.trim();
    if (!skill) return;
    setSkillError(null);
    try {
      await api.addSkill({ name: skill });
      setNewSkill("");
      markStale();
      const me = await api.getMe();
      setProfile((p) => (p ? { ...p, skills: me.skills } : me));
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : "Could not add that skill.");
    }
  }

  async function removeSkill(id: string) {
    if (!profile) return;
    setSkillError(null);
    const before = profile.skills;
    setProfile({ ...profile, skills: before.filter((s) => s.id !== id) }); // optimistic
    try {
      await api.deleteSkill(id);
      markStale();
    } catch (err) {
      setProfile((p) => (p ? { ...p, skills: before } : p));
      setSkillError(err instanceof Error ? err.message : "Could not remove that skill.");
    }
  }

  return (
    <main className="app-main">
      <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="row page-head" style={{ gap: 20 }}>
          <Avatar imageUrl={user?.imageUrl} name={name} size={72} />
          <div>
            <span className="eyebrow">Profile</span>
            <h1 className="page-title" style={{ marginBottom: 8 }}>
              {name}
            </h1>
            <p className="muted small">{profile.email ?? user?.primaryEmailAddress?.emailAddress}</p>
          </div>
        </div>

        <div className="grid-2" style={{ alignItems: "start" }}>
          <form className="card stack" onSubmit={save}>
            <div>
              <h2 className="section-title">About you</h2>
              <p className="xsmall muted" style={{ marginTop: 6 }}>
                This tunes which scenarios you get. It&apos;s never treated as proof of skill.
              </p>
            </div>
            <FormError message={error} />
            <div className="field">
              <label htmlFor="dn">Display name</label>
              <input id="dn" className="input" value={profile.display_name ?? ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="tr">Target role</label>
              <RoleSelect id="tr" value={profile.target_role ?? ""} onChange={(role) => setProfile({ ...profile, target_role: role })} />
            </div>
            <div className="field">
              <label htmlFor="lvl">Experience level</label>
              <select id="lvl" className="select" value={profile.experience_level ?? "unspecified"} onChange={(e) => setProfile({ ...profile, experience_level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cg">Learning goals</label>
              <input id="cg" className="input" value={goalsText} onChange={(e) => setGoalsText(e.target.value)} aria-describedby="cg-hint" />
              <span id="cg-hint" className="field__hint">Separate with commas.</span>
            </div>
            <div className="field">
              <label htmlFor="ps">Preferred stack</label>
              <input id="ps" className="input" value={stackText} onChange={(e) => setStackText(e.target.value)} aria-describedby="ps-hint" />
              <span id="ps-hint" className="field__hint">Separate with commas.</span>
            </div>
            <div className="field">
              <label htmlFor="ed">Education</label>
              <textarea id="ed" className="textarea" value={profile.education_summary ?? ""} onChange={(e) => setProfile({ ...profile, education_summary: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ex">Projects &amp; experience</label>
              <textarea id="ex" className="textarea" value={profile.experience_summary ?? ""} onChange={(e) => setProfile({ ...profile, experience_summary: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="gh">GitHub</label>
              <input id="gh" className="input" value={profile.github_url ?? ""} onChange={(e) => setProfile({ ...profile, github_url: e.target.value })} placeholder="github.com/your-username" />
            </div>
            <div className="field">
              <label htmlFor="li">LinkedIn</label>
              <input id="li" className="input" value={profile.linkedin_url ?? ""} onChange={(e) => setProfile({ ...profile, linkedin_url: e.target.value })} placeholder="linkedin.com/in/your-name" />
            </div>
            <div className="field">
              <label htmlFor="pf">Portfolio or website</label>
              <input id="pf" className="input" value={profile.portfolio_url ?? ""} onChange={(e) => setProfile({ ...profile, portfolio_url: e.target.value })} placeholder="https://you.dev" />
            </div>
            <div className="field">
              <label htmlFor="sit">A situation you want to experience</label>
              <textarea id="sit" className="textarea" maxLength={1000} value={profile.custom_situation ?? ""} onChange={(e) => setProfile({ ...profile, custom_situation: e.target.value })} placeholder="Explaining a delay to an anxious client…" />
              <span className="field__hint">Adds one personalised scenario built around this moment.</span>
            </div>
            <div className="row">
              <button className="btn" type="submit" disabled={busy}>
                {busy ? <span className="busy-dots">Saving</span> : "Save profile"}
              </button>
              <AnimatePresence>
                {saved && (
                  <m.span
                    className="row small"
                    style={{ gap: 8 }}
                    role="status"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <span className="dot" aria-hidden="true" /> Saved
                  </m.span>
                )}
              </AnimatePresence>
            </div>
          </form>

          <div className="stack">
          <div className="card stack">
            <div className="row between" style={{ alignItems: "flex-start" }}>
              <div>
                <h2 className="section-title">Learner context</h2>
                <p className="xsmall muted" style={{ marginTop: 6 }} aria-live="polite">
                  {ctxBusy ? <span className="busy-dots">Rebuilding from your profile and sources</span> : ctx ? builtLabel(ctx) : "Loading…"}
                </p>
              </div>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => rebuild(true)} disabled={ctxBusy} title="Re-read every source and rebuild">
                Rebuild
              </button>
            </div>
            <FormError message={ctxError} />
            {ctx?.context && <ContextSummary view={ctx} />}
            <DocumentUpload kind="cv" label="CV / résumé" hint="PDF, Word or text, up to 5 MB." source={ctx?.sources.find((s) => s.kind === "cv")} onChange={(s) => onDocument("cv", s)} />
            <DocumentUpload kind="linkedin_pdf" label="LinkedIn PDF" hint="LinkedIn profile → More → Save to PDF." source={ctx?.sources.find((s) => s.kind === "linkedin_pdf")} onChange={(s) => onDocument("linkedin_pdf", s)} />
            {ctx && ctx.sources.some((s) => !["cv", "linkedin_pdf"].includes(s.kind)) && (
              <ul className="list-reset stack stack--sm" aria-label="Linked sources">
                {ctx.sources
                  .filter((s) => !["cv", "linkedin_pdf"].includes(s.kind))
                  .map((s) => (
                    <SourceStatus key={s.kind} source={s} />
                  ))}
              </ul>
            )}
            {ctx && ctx.scenarios.length > 0 && (
              <p className="xsmall muted">{ctx.scenarios.length} personalised scenarios on your Practice page.</p>
            )}
          </div>
          <div className="card stack">
            <div>
              <h2 className="section-title">Self-reported skills</h2>
              <p className="xsmall muted" style={{ marginTop: 6 }}>
                Recorded as self-reported unless a validated task provides evidence.
              </p>
            </div>
            <FormError message={skillError} />
            <ul className="list-reset chip-row" aria-label="Your skills">
              <AnimatePresence initial={false}>
                {profile.skills.map((s) => (
                  <m.li
                    key={s.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.2 }}
                    className="chip chip--static"
                    title={s.provenance}
                  >
                    {s.name}
                    <button type="button" className="chip__x" onClick={() => removeSkill(s.id)} aria-label={`Remove ${s.name}`}>
                      ×
                    </button>
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
            {profile.skills.length === 0 && <p className="small muted">No skills added yet — add what you&apos;ve used, even in class.</p>}
            <form className="field" onSubmit={addSkill}>
              <label htmlFor="sk">Add a skill</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input id="sk" className="input" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="FastAPI" />
                <button type="submit" className="btn" disabled={!newSkill.trim()}>
                  Add
                </button>
              </div>
            </form>
          </div>
          </div>
        </div>
      </m.div>
    </main>
  );
}
