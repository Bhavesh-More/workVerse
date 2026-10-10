"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Avatar } from "../../components/Avatar";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Profile } from "../../lib/types";

const LEVELS = ["beginner", "early_career", "intermediate", "experienced", "unspecified"];

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSkill, setNewSkill] = useState("");

  useEffect(() => {
    api
      .getMe()
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, []);

  if (!profile) {
    return <main className="app-main spinner">{error ?? "Loading profile…"}</main>;
  }

  const name =
    profile.display_name ?? user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Learner";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await api.updateMe({
        display_name: profile.display_name,
        target_role: profile.target_role,
        experience_level: profile.experience_level as Profile["experience_level"],
        career_goals: profile.career_goals,
        preferred_stack: profile.preferred_stack,
        education_summary: profile.education_summary,
        experience_summary: profile.experience_summary,
      });
      setProfile(updated);
      setStatus("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function addSkill() {
    if (!newSkill.trim()) return;
    await api.addSkill({ name: newSkill.trim() });
    setNewSkill("");
    setProfile(await api.getMe());
  }

  async function removeSkill(id: string) {
    await api.deleteSkill(id);
    setProfile(await api.getMe());
  }

  return (
    <main className="app-main">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="row" style={{ gap: 16, marginBottom: 24 }}>
          <Avatar imageUrl={user?.imageUrl} name={name} size={64} />
          <div>
            <p className="eyebrow">Profile</p>
            <h1 className="page-title">{name}</h1>
            <p className="muted small">{profile.email ?? user?.primaryEmailAddress?.emailAddress}</p>
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 24 }}>
          This personalises scenario relevance. It is never treated as proof of skill.
        </p>

        <div className="grid-2">
          <form className="panel stack" onSubmit={save}>
            {error && <div className="banner banner--error">{error}</div>}
            {status && <div className="banner banner--info">{status}</div>}
            <div className="field">
              <label htmlFor="dn">Display name</label>
              <input id="dn" className="input" value={profile.display_name ?? ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="tr">Target role</label>
              <input id="tr" className="input" value={profile.target_role ?? ""} onChange={(e) => setProfile({ ...profile, target_role: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="lvl">Experience level</label>
              <select id="lvl" className="select" value={profile.experience_level ?? "unspecified"} onChange={(e) => setProfile({ ...profile, experience_level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cg">Learning goals (comma separated)</label>
              <input id="cg" className="input" value={profile.career_goals.join(", ")} onChange={(e) => setProfile({ ...profile, career_goals: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div className="field">
              <label htmlFor="ps">Preferred stack (comma separated)</label>
              <input id="ps" className="input" value={profile.preferred_stack.join(", ")} onChange={(e) => setProfile({ ...profile, preferred_stack: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div className="field">
              <label htmlFor="ed">Education summary</label>
              <textarea id="ed" className="textarea" value={profile.education_summary ?? ""} onChange={(e) => setProfile({ ...profile, education_summary: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ex">Experience summary</label>
              <textarea id="ex" className="textarea" value={profile.experience_summary ?? ""} onChange={(e) => setProfile({ ...profile, experience_summary: e.target.value })} />
            </div>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </button>
          </form>

          <div className="panel stack">
            <h2 className="section-title">Self-reported skills</h2>
            <p className="small muted">
              Skills are recorded as self-reported unless a validated task provides evidence.
            </p>
            <ul className="list-reset stack stack--sm">
              {profile.skills.length === 0 && <li className="small muted">No skills added yet.</li>}
              {profile.skills.map((s) => (
                <li key={s.id} className="row between">
                  <span>
                    {s.name} <span className="muted small">({s.provenance})</span>
                  </span>
                  <button className="btn btn--ghost btn--small" onClick={() => removeSkill(s.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="field">
              <label htmlFor="sk">Add a skill</label>
              <div className="row">
                <input id="sk" className="input" style={{ flex: 1 }} value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="FastAPI" />
                <button type="button" className="btn btn--small" onClick={addSkill}>
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
