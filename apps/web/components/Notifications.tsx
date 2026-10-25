"use client";

// Notifications for the signed-in user: polled from the API, shown as live popups while the app is
// open (and as desktop notifications when the tab is in the background, if allowed), plus a bell
// with the full list. Invites a company sends "in app" arrive here.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { AnimatePresence, m } from "framer-motion";
import { notificationsApi, timeAgo, type AppNotification } from "../lib/notifications";
import { play } from "../lib/sfx";

const POLL_VISIBLE_MS = 12_000;
const POLL_HIDDEN_MS = 30_000;
const POPUP_MS = 9_000;
const ICON: Record<string, string> = {
  assessment_invite: "✉",
  candidate_completed: "★",
  candidate_started: "▶",
  invite_accepted: "✓",
  invite_declined: "✕",
  due_changed: "⟳",
  due_soon: "!",
  assessment_withdrawn: "–",
};
const CTA: Record<string, string> = {
  assessment_invite: "Review invitation",
  candidate_completed: "View report",
  candidate_started: "View candidate",
  invite_accepted: "View assessment",
  invite_declined: "View assessment",
  due_changed: "View details",
  due_soon: "View details",
  assessment_withdrawn: "View details",
};

type Ctx = {
  items: AppNotification[];
  unread: number;
  loaded: boolean;
  open: (n: AppNotification) => void;
  markAllRead: () => void;
  desktop: NotificationPermission | "unsupported";
  enableDesktop: () => void;
};

const NotificationsContext = createContext<Ctx | null>(null);

export function useNotifications(): Ctx | null {
  return useContext(NotificationsContext);
}

function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  // Sign-in pages redirect straight away; a popup there would be lost.
  const onAuthPage = /^\/(login|signup|company\/login|company\/signup)/.test(pathname);
  const active = Boolean(isSignedIn) && !onAuthPage;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [popups, setPopups] = useState<AppNotification[]>([]);
  const [desktop, setDesktop] = useState<NotificationPermission | "unsupported">("unsupported");
  const shown = useRef(new Set<string>());
  const here = useRef(pathname);
  here.current = pathname;
  const inflight = useRef(false);

  useEffect(() => setDesktop(desktopPermission()), []);

  // A popup counts as shown once the person saw it (opened, closed, or it timed out on screen);
  // if they navigate away first, it comes back on the next page.
  const seen = useCallback((ids: string[]) => {
    if (ids.length) notificationsApi.popped(ids).catch(() => {});
  }, []);
  const dismiss = useCallback(
    (id: string) => {
      setPopups((p) => p.filter((x) => x.id !== id));
      seen([id]);
    },
    [seen],
  );

  const open = useCallback(
    (n: AppNotification) => {
      dismiss(n.id);
      if (!n.read) {
        setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
        notificationsApi.read([n.id]).then((r) => setUnread(r.unread), () => {});
      }
      if (n.link) router.push(n.link);
    },
    [dismiss, router],
  );

  const poll = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await notificationsApi.list();
      setItems(res.items);
      setUnread(res.unread);
      setLoaded(true);
      const unseen = res.items.filter((n) => !n.popped && !n.read && !shown.current.has(n.id));
      // Already looking at it: no popup for the page you're on.
      const onPage = unseen.filter((n) => n.link === here.current);
      if (onPage.length) seen(onPage.map((n) => n.id));
      const fresh = unseen.filter((n) => n.link !== here.current);
      onPage.forEach((n) => shown.current.add(n.id));
      if (!fresh.length) return;
      fresh.forEach((n) => shown.current.add(n.id));
      const hidden = document.visibilityState === "hidden";
      if (hidden && desktopPermission() === "granted") {
        seen(fresh.slice(0, 3).map((n) => n.id));
        for (const n of fresh.slice(0, 3)) {
          const note = new Notification(n.title, { body: n.body, tag: n.id, icon: "/favicon.ico" });
          note.onclick = () => {
            window.focus();
            open(n);
            note.close();
          };
        }
      } else {
        setPopups((cur) => [...fresh.slice(0, 3), ...cur].slice(0, 3));
        play("shimmer");
      }
    } catch {
      // Offline or signed out mid-poll: try again next tick.
    } finally {
      inflight.current = false;
    }
  }, [open, seen]);

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, document.visibilityState === "hidden" ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };
    const tick = () => {
      void poll().finally(schedule);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [active, poll]);

  // Popups leave on their own.
  useEffect(() => {
    if (!popups.length) return;
    const t = window.setTimeout(() => {
      const last = popups[popups.length - 1]!;
      setPopups((p) => p.filter((x) => x.id !== last.id));
      seen([last.id]);
    }, POPUP_MS);
    return () => window.clearTimeout(t);
  }, [popups, seen]);

  const markAllRead = useCallback(() => {
    setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    setUnread(0);
    notificationsApi.read().catch(() => {});
  }, []);

  const enableDesktop = useCallback(() => {
    if (desktopPermission() === "unsupported") return;
    void Notification.requestPermission().then(setDesktop);
  }, []);

  const value = useMemo<Ctx>(() => ({ items, unread, loaded, open, markAllRead, desktop, enableDesktop }), [items, unread, loaded, open, markAllRead, desktop, enableDesktop]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {active && (
        <div className="nt-popups" aria-live="polite" aria-label="Notifications">
          <AnimatePresence initial={false}>
            {popups.map((n) => (
              <m.div
                key={n.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className={`nt-popup nt-popup--${n.kind}`}
                role="status"
                data-testid="notification-popup"
              >
                <KindIcon kind={n.kind} />
                <div className="nt-popup__text">
                  <strong>{n.title}</strong>
                  {n.body && <span>{n.body}</span>}
                  {n.link && (
                    <button type="button" className="nt-popup__cta" onClick={() => open(n)} data-testid="notification-popup-open">
                      {CTA[n.kind] ?? "Open"} →
                    </button>
                  )}
                </div>
                <button type="button" className="nt-popup__x" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
                  ✕
                </button>
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </NotificationsContext.Provider>
  );
}

function KindIcon({ kind }: { kind: AppNotification["kind"] }) {
  return (
    <span className="nt-icon" aria-hidden="true">
      {ICON[kind] ?? "•"}
    </span>
  );
}

/** Bell with an unread badge and the notification list. */
export function NotificationBell({ collapsed = false }: { collapsed?: boolean }) {
  const ctx = useNotifications();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!ctx) return null;
  const { items, unread, loaded, desktop } = ctx;
  return (
    <div className={`nt-bell${collapsed ? " is-compact" : ""}`} ref={ref}>
      <button
        type="button"
        className={`sidebar__link nt-bell__btn${open ? " is-active" : ""}`}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        title={collapsed ? "Notifications" : undefined}
        aria-expanded={open}
        onClick={(e) => {
          // The panel opens beside the sidebar, level with the bell (kept on screen).
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ left: Math.min(r.right + 12, window.innerWidth - 396), top: Math.max(16, Math.min(r.top - 12, window.innerHeight - 420)) });
          setOpen((o) => !o);
        }}
        data-testid="notification-bell"
      >
        <span className="sidebar__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </span>
        {!collapsed && <span className="sidebar__label">Notifications</span>}
        {unread > 0 && <span className="nt-bell__count" data-testid="notification-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="nt-panel" role="dialog" aria-label="Notifications" data-testid="notification-panel" style={at ? { left: Math.max(16, at.left), top: at.top } : undefined}>
          <div className="nt-panel__head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="text-link xsmall" onClick={ctx.markAllRead} data-testid="notification-read-all">
                Mark all read
              </button>
            )}
          </div>
          {desktop === "default" && (
            <button type="button" className="nt-panel__desktop" onClick={ctx.enableDesktop}>
              Turn on desktop alerts — get notified even when WorkVerse is in another tab
            </button>
          )}
          <ul className="list-reset nt-list">
            {!loaded && <li className="nt-empty">Loading…</li>}
            {loaded && items.length === 0 && <li className="nt-empty">You&apos;re all caught up.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`nt-item${n.read ? "" : " is-unread"}`}
                  onClick={() => {
                    setOpen(false);
                    ctx.open(n);
                  }}
                  data-testid="notification-item"
                >
                  <KindIcon kind={n.kind} />
                  <span className="nt-item__text">
                    <strong>{n.title}</strong>
                    {n.body && <span>{n.body}</span>}
                    <span className="nt-item__time">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read && <span className="nt-dot" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
