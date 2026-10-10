"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { useAuth } from "../../lib/auth";
import { api, ApiError } from "../../lib/api";

export default function SignupPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register({ email, password, display_name: displayName || undefined });
      await signIn(email, password);
      router.push("/profile");
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_taken") {
        setError("That email is already registered. Try signing in instead.");
      } else {
        setError(err instanceof Error ? err.message : "Sign up failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-canvas">
      <AppNav />
      <main className="app-main" style={{ maxWidth: 520 }}>
        <p className="eyebrow">Create account</p>
        <h1 className="page-title" style={{ marginBottom: 24 }}>
          Start practising
        </h1>
        <form className="panel stack" onSubmit={onSubmit}>
          {error && <div className="banner banner--error">{error}</div>}
          <div className="field">
            <label htmlFor="name">Display name</label>
            <input
              id="name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex"
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password (min 8 characters)</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
          <p className="small muted">
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
