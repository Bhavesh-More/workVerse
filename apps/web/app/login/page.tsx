"use client";

import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
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
          <SignIn
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
            No account? <Link href="/signup">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
