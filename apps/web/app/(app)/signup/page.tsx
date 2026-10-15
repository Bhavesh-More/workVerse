"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignUp } from "@clerk/nextjs";
import { clerkErrorMessage } from "../../../lib/auth";
import { AuthShell, FormError, PasswordInput } from "../../../components/AuthShell";

const MIN_PASSWORD = 15;

export default function SignupPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const remaining = Math.max(0, MIN_PASSWORD - password.length);
  const longEnough = remaining === 0;

  return (
    <AuthShell>
      <span className="eyebrow">Sign-up · free</span>
      <h1 className="page-title">
        Start <span className="hl">practising</span>
      </h1>
      <p className="small muted" style={{ marginBottom: 24 }}>
        Two minutes to set up. No résumé, no test — just an email we can send a code to.
      </p>

      <div className="stack">
        <FormError message={error} />

        {verifying ? (
          <form className="stack" onSubmit={verify}>
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
            <button className="btn btn--block" type="submit" disabled={busy || !code.trim()}>
              {busy ? <span className="busy-dots">Verifying</span> : "Verify & continue"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
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
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                className="input"
                autoComplete="email"
                placeholder="you@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                shown={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
                describedBy="password-hint"
              />
              <div className={`meter${longEnough ? " is-ok" : ""}`} aria-hidden="true">
                <span style={{ width: `${Math.min(100, (password.length / MIN_PASSWORD) * 100)}%` }} />
              </div>
              <span id="password-hint" className="field__hint" data-testid="password-hint" aria-live="polite">
                {longEnough
                  ? "✓ Long enough. A short sentence works great."
                  : password.length === 0
                    ? `At least ${MIN_PASSWORD} characters — try a short sentence.`
                    : `${remaining} more character${remaining === 1 ? "" : "s"} to go.`}
              </span>
            </div>
            {/* Required for sign-up flows when legacy bot sign-up protection is enabled. */}
            <div id="clerk-captcha" />
            <button className="btn btn--block" type="submit" disabled={busy || !isLoaded}>
              {busy ? <span className="busy-dots">Creating account</span> : <>Continue <span className="arrow" aria-hidden="true">→</span></>}
            </button>
          </form>
        )}

        <p className="small muted" style={{ textAlign: "center" }}>
          Already registered?{" "}
          <Link className="text-link" href="/login">
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
