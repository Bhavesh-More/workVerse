"use client";

import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export default function SignupPage() {
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
          <SignUp
            appearance={{
              elements: {
                rootBox: "wv-clerk-root",
                card: "wv-clerk-card",
                formButtonPrimary: "wv-clerk-button",
                socialButtons: "wv-hide",
                socialButtonsBlockButton: "wv-hide",
                dividerRow: "wv-hide",
              },
            }}
          />
          <p className="auth-switch">
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
