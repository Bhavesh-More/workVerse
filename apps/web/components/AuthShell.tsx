"use client";

import Link from "next/link";
import { m } from "framer-motion";
import type { ReactNode } from "react";

/** Grid-paper page with the wordmark and one centred white card. */
export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div>
      <header className="topbar">
        <Link href="/" className="topbar__brand">
          WorkVerse
        </Link>
      </header>
      <div className="center-wrap">
        <m.div
          className={`card ${wide ? "onboard-card" : "auth-card"}`}
          initial={{ opacity: 0, y: 16, rotate: -1 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </m.div>
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <m.div
      className="banner banner--error"
      role="alert"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: [6, -4, 2, 0] }}
      transition={{ duration: 0.35 }}
    >
      {message}
    </m.div>
  );
}

export function PasswordInput({
  id,
  autoComplete,
  value,
  onChange,
  shown,
  onToggle,
  describedBy,
}: {
  id: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  shown: boolean;
  onToggle: () => void;
  describedBy?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        name={id}
        type={shown ? "text" : "password"}
        className="input"
        style={{ paddingRight: 76 }}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button
        type="button"
        className="ghost-link"
        style={{ position: "absolute", right: 18, top: "50%", translate: "0 -50%", fontSize: 11 }}
        onClick={onToggle}
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
