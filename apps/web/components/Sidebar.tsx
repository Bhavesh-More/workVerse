"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { useAuth } from "../lib/auth";
import { clearCache } from "../lib/api";
import { prefetchRoute } from "../lib/useApi";
import { Avatar } from "./Avatar";
import { SoundToggles } from "./Sound";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/scenarios", label: "Practice", icon: "target" },
  { href: "/sessions", label: "Sessions", icon: "clock" },
  { href: "/progress", label: "Progress", icon: "chart" },
  { href: "/profile", label: "Profile", icon: "user" },
];

const COMPANY_NAV = [
  { href: "/company", label: "Overview", icon: "grid" },
  { href: "/company/assessments", label: "Assessments", icon: "mail" },
  { href: "/company/candidates", label: "Candidates", icon: "user" },
  { href: "/company/workplace", label: "Workplace", icon: "map" },
  { href: "/company/topics", label: "Topics", icon: "target" },
  { href: "/company/judges", label: "AI judges", icon: "users" },
  { href: "/company/settings", label: "Settings", icon: "sliders" },
];

const MIN = 200;
const MAX = 340;
const COLLAPSED = 72;

function Icon({ name }: { name: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "grid")
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </svg>
    );
  if (name === "target")
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.6" fill="currentColor" />
      </svg>
    );
  if (name === "clock")
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  if (name === "map")
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 10h8V3M11 10v11M11 15h10" />
      </svg>
    );
  if (name === "mail")
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    );
  if (name === "users")
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" />
        <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2.2.6 3.5 2.4 3.5 5.2" />
      </svg>
    );
  if (name === "sliders")
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </svg>
    );
  if (name === "chart")
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    );
  return (
    <svg {...common} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function Sidebar({ variant = "learner" }: { variant?: "learner" | "company" }) {
  const pathname = usePathname();
  const isCompany = variant === "company";
  const nav = isCompany ? COMPANY_NAV : NAV;
  const home = isCompany ? "/company" : "/dashboard";
  const { user, signOut } = useAuth();
  const [width, setWidth] = useState(248);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("wv.sidebar");
      if (!saved) return;
      const parsed = JSON.parse(saved) as { width?: number; collapsed?: boolean };
      if (parsed.width) setWidth(Math.min(MAX, Math.max(MIN, parsed.width)));
      if (typeof parsed.collapsed === "boolean") setCollapsed(parsed.collapsed);
    } catch {
      // Corrupt or blocked storage: keep defaults.
    }
  }, []);

  function persist(nextW: number, nextCollapsed: boolean) {
    try {
      window.localStorage.setItem("wv.sidebar", JSON.stringify({ width: nextW, collapsed: nextCollapsed }));
    } catch {
      // Storage unavailable (private mode); the preference just won't stick.
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: collapsed ? COLLAPSED : width };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const next = Math.min(MAX, Math.max(MIN, drag.current.startW + (e.clientX - drag.current.startX)));
    setWidth(next);
    if (collapsed) setCollapsed(false);
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    persist(width, false);
  }

  const effectiveWidth = collapsed ? COLLAPSED : width;
  const name = user?.fullName ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? "Learner";

  return (
    <m.aside
      className="sidebar"
      initial={false}
      animate={{ width: effectiveWidth }}
      transition={dragging ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38 }}
    >
      <div className="sidebar__head">
        <Link href={home} className="sidebar__brand" aria-label="WorkVerse dashboard">
          <span className="sidebar__mark">W</span>
          {!collapsed && <span className="sidebar__wordmark">WorkVerse</span>}
        </Link>
        {!collapsed && (
          <button
            className="sidebar__collapse"
            onClick={() => {
              setCollapsed(true);
              persist(width, true);
            }}
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        )}
      </div>

      {collapsed && (
        <button
          className="sidebar__collapse is-collapsed"
          style={{ margin: "0 auto 4px" }}
          onClick={() => {
            setCollapsed(false);
            persist(width, false);
          }}
          aria-label="Expand sidebar"
          title="Expand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}

      <nav className="sidebar__nav" aria-label="Primary">
        {nav.map((item) => {
          const active = item.href === home ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar__link${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              onMouseEnter={() => prefetchRoute(item.href)}
              onFocus={() => prefetchRoute(item.href)}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
            >
              {active && (
                <m.span
                  className="sidebar__activebg"
                  layoutId="sidebar-active"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className="sidebar__icon">
                <Icon name={item.icon} />
              </span>
              {!collapsed && <span className="sidebar__label">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar__foot">
        {!collapsed && <SoundToggles />}
        <Link href={isCompany ? "/company/settings" : "/profile"} className="sidebar__user" title={name}>
          <span className="sidebar__avatar">
            <Avatar imageUrl={user?.imageUrl} name={name} size={collapsed ? 34 : 38} />
            <span className="dot" aria-hidden="true" />
          </span>
          {!collapsed && (
            <span className="sidebar__userinfo">
              <span className="sidebar__username">{name}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {isCompany ? "Hiring team" : "In practice"}
              </span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button className="btn btn--ghost btn--small" onClick={() => {
              clearCache(); // cached reads belong to this user
              signOut({ redirectUrl: isCompany ? "/company/login" : "/" });
            }}>
            Sign out
          </button>
        )}
      </div>

      <div
        className="sidebar__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </m.aside>
  );
}
