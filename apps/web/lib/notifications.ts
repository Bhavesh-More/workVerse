// In-app notifications: assessment invites delivered inside WorkVerse, and company alerts when
// candidates start or finish. The web app polls; the server remembers which popups were shown.
import { request } from "./api";

export type NotificationKind = "assessment_invite" | "candidate_started" | "candidate_completed";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  read: boolean;
  popped: boolean;
  created_at: string;
};

export const notificationsApi = {
  list: () => request<{ items: AppNotification[]; unread: number }>("/notifications"),
  read: (ids?: string[]) => request<{ unread: number }>("/notifications/read", { method: "POST", body: { ids: ids ?? null } }),
  popped: (ids: string[]) => request<{ ok: boolean }>("/notifications/popped", { method: "POST", body: { ids } }),
};

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
