"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { authRedirect, clerkErrorMessage, useWithRedirect } from "../../../lib/auth";
import { AuthShell, FormError, PasswordInput } from "../../../components/AuthShell";

export default function LoginPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();
  // /company/login and /company/signup reuse this page with company copy and landing.
  const company = usePathname().startsWith("/company");
  const switchHref = useWithRedirect(company ? "/company/signup" : "/signup");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (sessionId: string | null) => {
    await setActive?.({ session: sessionId });
    router.push(authRedirect(company ? "/company" : "/dashboard"));
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
    <AuthShell>
      <span className="eyebrow">{company ? "Company log-in" : "Log-in"}</span>
      <h1 className="page-title">
        {company ? <>Hiring <span className="hl">dashboard</span></> : <>Welcome <span className="hl">back</span></>}
      </h1>
      <p className="small muted" style={{ marginBottom: 24 }}>
        {company
          ? "Create assessments, invite candidates and read their results."
          : "Pick up where you left off — your sessions and reports are waiting."}
      </p>

      <div className="stack">
        <FormError message={error} />

        {needCode ? (
          <form className="stack" onSubmit={verify}>
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
            <button className="btn btn--block" type="submit" disabled={busy || !code.trim()}>
              {busy ? <span className="busy-dots">Verifying</span> : "Verify & continue"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
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
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                className="input"
                autoComplete="email"
                placeholder={company ? "you@company.com" : "you@university.edu"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                shown={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </div>
            <button className="btn btn--block" type="submit" disabled={busy || !isLoaded}>
              {busy ? <span className="busy-dots">Signing in</span> : <>Log in <span className="arrow" aria-hidden="true">→</span></>}
            </button>
          </form>
        )}

        <p className="small muted" style={{ textAlign: "center" }}>
          New here?{" "}
          <Link className="text-link" href={switchHref}>
            {company ? "Create a company account" : "Create a free account"}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
