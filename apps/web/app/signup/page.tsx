"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignUp } from "@clerk/nextjs";
import { clerkErrorMessage } from "../../lib/auth";

export default function SignupPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (sessionId: string | null) => {
    await setActive?.({ session: sessionId });
    router.push("/onboarding");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signUp.create({ emailAddress: email, password });
      if (attempt.status === "complete") {
        await finish(attempt.createdSessionId);
        return;
      }
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setVerifying(true);
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
      const attempt = await signUp.attemptEmailAddressVerification({ code });
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
          <p className="eyebrow">Create account</p>
          <h1 className="page-title" style={{ marginBottom: 8 }}>
            Start practising
          </h1>
          <p className="small muted" style={{ marginBottom: 16 }}>
            Use an email and a password of at least 15 characters. We&apos;ll email you a short code
            to verify it.
          </p>

          {error && (
            <p className="small" role="alert" style={{ color: "var(--color-danger)", marginBottom: 14 }}>
              {error}
            </p>
          )}

          {verifying ? (
            <form className="stack stack--sm" onSubmit={verify}>
              <p className="small muted">
                Enter the code we sent to <strong>{email}</strong>.
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
                  setVerifying(false);
                  setCode("");
                  setError(null);
                }}
              >
                Use a different email
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
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {/* Required for sign-up flows when legacy bot sign-up protection is enabled. */}
              <div id="clerk-captcha" />
              <button className="btn" type="submit" disabled={busy || !isLoaded}>
                {busy ? "Creating account…" : "Continue"}
              </button>
            </form>
          )}

          <p className="auth-switch">
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
