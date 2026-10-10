"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.push("/scenarios");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-canvas">
      <AppNav />
      <main className="app-main" style={{ maxWidth: 520 }}>
        <p className="eyebrow">Sign in</p>
        <h1 className="page-title" style={{ marginBottom: 24 }}>
          Welcome back
        </h1>
        <form className="panel stack" onSubmit={onSubmit}>
          {error && <div className="banner banner--error">{error}</div>}
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
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="small muted">
            No account? <Link href="/signup">Create one</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
