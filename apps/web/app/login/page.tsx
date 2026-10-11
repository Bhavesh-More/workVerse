"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { clerkErrorMessage } from "../../lib/auth";

export default function LoginPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (sessionId: string | null) => {
    await setActive?.({ session: sessionId });
    router.push("/dashboard");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email, password });
      if (attempt.status === "complete") {
        await finish(attempt.createdSessionId);
        return;
      }
      const needsCode =
        attempt.status === "needs_second_factor" &&
        attempt.supportedSecondFactors?.some((f) => f.strategy === "email_code");
      if (needsCode) {
        await signIn.prepareSecondFactor({ strategy: "email_code" });
        setNeedCode(true);
        return;
      }
      setError("We couldn't sign you in with those details.");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.attemptSecondFactor({ strategy: "email_code", code });
      if (attempt.status === "complete") {
        await finish(attempt.createdSessionId);
        return;
      }
      setError("That code didn't work. Request a new one and try again.");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-canvas">
      <div className="landing__topbar">
        <Link href="/" className="landing__brand">
          WorkVerse AI
        </Link>
      </div>
      <div className="auth-wrap">
        <div className="auth-panel">
          <p className="eyebrow">Sign in</p>
          <h1 className="page-title" style={{ marginBottom: 20 }}>
            Welcome back
          </h1>

          {error && (
            <p className="small" role="alert" style={{ color: "var(--color-danger)", marginBottom: 14 }}>
              {error}
            </p>
          )}

          {needCode ? (
            <form className="stack stack--sm" onSubmit={verify}>
              <p className="small muted">
                For your security we sent a one-time code to <strong>{email}</strong>. Enter it below.
              </p>
              <div className="field">
                <label htmlFor="code">Verification code</label>
                <input
                  id="code"
                  name="code"
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={busy || !code.trim()}>
                {busy ? "Verifying…" : "Verify & continue"}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => {
                  setNeedCode(false);
                  setCode("");
                  setError(null);
                }}
              >
                Use a different account
              </button>
            </form>
          ) : (
            <form className="stack stack--sm" onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={busy || !isLoaded}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          <p className="auth-switch">
            No account? <Link href="/signup">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
