"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Avatar } from "../../../components/Avatar";
import { FormError } from "../../../components/AuthShell";
import { api, peek, revalidate } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { LEVELS, splitList } from "../../../lib/practice";
import type { Profile } from "../../../lib/types";
import { RoleSelect } from "../../../components/RoleSelect";

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
      });
      setProfile(updated);
      setGoalsText(updated.career_goals.join(", "));
      setStackText(updated.preferred_stack.join(", "));
      setSaved(true);
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
      </m.div>
    </main>
  );
}
