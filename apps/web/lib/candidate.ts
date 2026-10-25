// Company assessments, candidate side: invitations grouped by company, the briefing, and the
// explicit accept -> start steps. Only `start` creates an attempt.
import { request } from "./api";

export type Stage = "invited" | "ready" | "in_progress" | "submitted" | "evaluated" | "missed" | "expired" | "declined" | "withdrawn";

export type StageInfo = {
  stage: Stage;
  label: string;
  tone: "attention" | "active" | "ready" | "done" | "muted";
  priority: number;
  invitation: "pending" | "accepted" | "declined" | "revoked";
  attempt: "none" | "in_progress" | "submitted" | "evaluated";
  past_due: boolean;
  withdrawn: boolean;
  note: string;
  can_accept: boolean;
  can_decline: boolean;
  can_start: boolean;
  can_continue: boolean;
  can_view_results: boolean;
};

export type CompanyPublic = { id: string; name: string; tagline: string; about: string; mission: string; vision: string; values: string; industry: string; website: string };

export type CompanyGroup = CompanyPublic & {
  total: number;
  pending: number;
  attention: number;
  active: number;
  done: number;
  next_due: string | null;
  next_title: string | null;
  top_stage: Stage;
};

export type Assignment = {
  id: string;
  assessment_id: string;
  company_id: string;
  company_name: string;
  title: string;
  description: string;
  skills: { id: string; name: string; description?: string }[];
  due_at: string | null;
  timezone: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  session_id: string | null;
  estimated_minutes: number;
  state: StageInfo;
};

export type Briefing = Assignment & {
  expectations: string;
  instructions: string;
  message: string;
  skills_chosen: boolean;
  scenario: { title: string; summary: string; kind: string; difficulty: string };
  team: { name: string; role: string; portrait: string | null }[];
  sent_to: string;
  declined_at: string | null;
  revoked_at: string | null;
  company: CompanyPublic;
  timed: boolean;
};

export const candidateApi = {
  overview: () => request<{ companies: CompanyGroup[]; assignments: Assignment[]; now: string }>("/me/company-assessments"),
  company: (id: string) => request<{ company: CompanyPublic; assignments: Assignment[]; now: string }>(`/me/company-assessments/companies/${id}`),
  briefing: (id: string) => request<{ assignment: Briefing }>(`/me/company-assessments/${id}`),
  accept: (id: string) => request<{ assignment: Briefing; changed: boolean }>(`/me/company-assessments/${id}/accept`, { method: "POST" }),
  decline: (id: string, reason?: string) =>
    request<{ assignment: Briefing; changed: boolean }>(`/me/company-assessments/${id}/decline`, { method: "POST", body: { reason: reason ?? null } }),
  start: (id: string) =>
    request<{ session_id: string; scenario_instance_id: string; status: string; resumed: boolean }>(`/me/company-assessments/${id}/start`, { method: "POST" }),
};

/** Where an attempt continues: the debrief once submitted, the office otherwise. */
export function attemptHref(a: Pick<Assignment, "session_id" | "state">): string | null {
  if (!a.session_id) return null;
  return a.state.can_view_results ? `/session/${a.session_id}/debrief` : `/session/${a.session_id}`;
}
