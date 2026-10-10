"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { Avatar } from "./Avatar";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/scenarios", label: "Practice", icon: "target" },
  { href: "/progress", label: "Progress", icon: "chart" },
  { href: "/profile", label: "Profile", icon: "user" },
];

const MIN = 180;
const MAX = 340;
const COLLAPSED = 72;

function Icon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 };
  if (name === "grid")
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
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

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [width, setWidth] = useState(248);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("wv.sidebar");
    if (saved) {
      const parsed = JSON.parse(saved) as { width?: number; collapsed?: boolean };
      if (parsed.width) setWidth(Math.min(MAX, Math.max(MIN, parsed.width)));
      if (typeof parsed.collapsed === "boolean") setCollapsed(parsed.collapsed);
    }
  }, []);

  function persist(nextW: number, nextCollapsed: boolean) {
    window.localStorage.setItem(
      "wv.sidebar",
      JSON.stringify({ width: nextW, collapsed: nextCollapsed }),
    );
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
    <motion.aside
      className="sidebar"
      initial={false}
      animate={{ width: effectiveWidth }}
      transition={dragging ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38 }}
    >
      <div className="sidebar__head">
        <Link href="/dashboard" className="sidebar__brand" aria-label="WorkVerse dashboard">
          <span className="sidebar__mark">WV</span>
          {!collapsed && <span className="sidebar__wordmark">WorkVerse</span>}
        </Link>
        <button
          className="sidebar__collapse"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            persist(width, next);
          }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar__link${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar__icon">
                <Icon name={item.icon} />
              </span>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {item.label}
                </motion.span>
              )}
              {active && <motion.span className="sidebar__activebar" layoutId="sidebar-active" />}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar__foot">
        <Link href="/profile" className="sidebar__user" title={name}>
          <Avatar imageUrl={user?.imageUrl} name={name} size={collapsed ? 34 : 38} />
          {!collapsed && (
            <span className="sidebar__userinfo">
              <span className="sidebar__username">{name}</span>
              <span className="sidebar__userrole">Practising</span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button className="sidebar__signout" onClick={() => signOut({ redirectUrl: "/" })}>
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
    </motion.aside>
  );
}
