"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/scenarios", label: "Practice" },
  { href: "/progress", label: "Progress" },
  { href: "/profile", label: "Profile" },
];

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <nav className="site-nav" aria-label="Primary">
      <Link href="/" className="site-nav__brand">
        WorkVerse<span className="muted"> AI</span>
      </Link>
      <div className="site-nav__links">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
              {link.label}
            </Link>
          );
        })}
        {user ? (
          <button
            type="button"
            className="nav-button"
            onClick={async () => {
              await signOut();
              router.push("/");
            }}
          >
            Sign out
          </button>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </div>
    </nav>
  );
}
