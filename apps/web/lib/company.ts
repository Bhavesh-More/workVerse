// Company portal: types and API calls (assessments, topics, judges, invites, reports).
import { download, request } from "./api";
import type { Evaluation } from "./types";

export type Smtp = {
  host?: string;
  port?: number;
  username?: string;
  from_email?: string;
  from_name?: string;
  security?: "starttls" | "ssl" | "none";
  has_password?: boolean;
};

export type JudgeConfig = {
  name?: string;
  personality?: string;
  tone?: string;
  strictness?: number;
  focus?: string;
  greeting?: string;
};
export type JudgeMap = Partial<Record<string, JudgeConfig>>;

export type Company = {
  id: string;
  name: string;
  smtp: Smtp;
  judge_defaults: JudgeMap;
  /** The company's own judges; null = the legacy five roles with names from the cast. */
  judge_roster: RosterJudge[] | null;
  world_mode?: "default" | "custom" | null;
  profile: CompanyProfile;
  smtp_ready: boolean;
  created_at: string;
};

export type JudgeRole = "manager" | "teammate" | "qa" | "client_pm" | "coworker";

/** One AI judge a company configured: plays a scenario role, with its own name, look, voice and manner. */
export type RosterJudge = {
  id: string;
  role: JudgeRole;
  name: string;
  avatar: string;
  voice: string;
  personality: string;
  greeting: string;
  focus: string;
  tone: string;
  strictness: number;
};

export type Avatar = { id: string; portrait: string; gender: "male" | "female"; sheet: string };
export type Voice = { id: string; label: string; gender: "male" | "female"; sample: string | null };

export type JudgeDefault = Required<Omit<JudgeConfig, "focus">> & { focus: string; role: string; knows: string };

export type JudgeCatalog = {
  slots: {
    id: string;
    names: { name: string; gender: string; portrait: string }[];
    defaults: Record<string, JudgeDefault>;
  }[];
  tones: { id: string; description: string }[];
  strictness: { level: number; description: string }[];
  tracks: { id: string; label: string; title: string; incidents: { id: string; title: string }[] }[];
  samples: TopicInput[];
  roles: { id: JudgeRole; label: string }[];
  avatars: Avatar[];
  voices: Voice[];
  default_roster: RosterJudge[];
  max_judges: number;
};

export type TopicInput = {
  title: string;
  description: string;
  track: string;
  incident?: string | null;
  difficulty: string;
  judges: JudgeMap;
  /** Roster companies: judges taking part (null = all). */
  judge_ids?: string[] | null;
};

export type Topic = TopicInput & { id: string; assessment_count: number; created_at: string };

export type AssessmentFields = {
  description: string;
  expectations: string;
  instructions: string;
  skills: string[];
  /** Absolute instant (ISO, UTC); one deadline for everyone. */
  due_at: string | null;
  /** IANA zone the company set the deadline in. */
  timezone: string | null;
};

export type AssessmentSummary = AssessmentFields & {
  id: string;
  title: string;
  message: string;
  status: "active" | "closed";
  past_due: boolean;
  closed_at: string | null;
  topic_id: string;
  topic_title: string;
  track: string;
  invited: number;
  opened: number;
  started: number;
  completed: number;
  avg_score: number | null;
  created_at: string;
};

export type Band = { label: string; advice: string };

export type Candidate = {
  id: string;
  email: string;
  name: string;
  status: "completed" | "submitted" | "in_progress" | "accepted" | "declined" | "revoked" | "expired" | "missed" | "opened" | "invited" | "pending" | "email_failed";
  invitation: "pending" | "accepted" | "declined" | "revoked";
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  revoked_at: string | null;
  /** Submitted after the due date. */
  late: boolean;
  status_label: string;
  email_status: string;
  email_error: string | null;
  /** How the invite was delivered: inside WorkVerse, by email, or both. */
  channel: InviteChannel;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  session_id: string | null;
  score: number | null;
  band: Band | null;
  skills: Record<string, number | null>;
  strengths: string[];
  gaps: { skill: string; advice: string }[];
  summary: string | null;
  minutes: number | null;
  messages: number | null;
  question_ratio: number | null;
  avg_words: number | null;
  checks_passed: number;
  checks_total: number;
};

export type CohortSummary = {
  total: number;
  completed: number;
  completion_rate: number;
  avg_score: number | null;
  median_score: number | null;
  top_score: number | null;
  top_candidate: string | null;
  avg_minutes: number | null;
  avg_question_ratio: number | null;
  avg_words: number | null;
  funnel: { id: string; label: string; count: number }[];
  bands: { label: string; advice: string; count: number }[];
  histogram: { range: string; count: number }[];
  skills: { id: string; name: string; description: string; average: number | null; n: number }[];
  ranking: { id: string; name: string; score: number; band: string }[];
};

export type AssessmentDetail = {
  assessment: AssessmentSummary & { topic_description: string };
  candidates: Candidate[];
  summary: CohortSummary;
  skills: { id: string; name: string; description: string }[];
  smtp_ready: boolean;
};

export type CompanyCandidate = Candidate & { assessment_id: string; assessment_title: string; topic_title: string };

export type AllCandidates = {
  candidates: CompanyCandidate[];
  summary: CohortSummary;
  skills: { id: string; name: string; description: string }[];
};

export type InviteChannel = "app" | "email" | "both";

export type InviteResult = {
  channel?: InviteChannel;
  /** In-app invites to emails with no WorkVerse account yet: delivered once they sign up. */
  awaiting_signup?: string[];
  /** "Both": emails that failed (the in-app invitation still went out). */
  email_failed?: { email: string; error: string }[];
  sent: number;
  failed: { email: string; error: string }[];
  invalid: string[];
  already_invited: string[];
};

export type CandidateReport = {
  candidate: Candidate;
  summary: CohortSummary;
  evaluation: Evaluation | null;
  transcript: { id: string; speaker: string; character_id: string | null; content: string; created_at: string }[];
  people: { id: string; name: string; role: string }[];
};

export type InvitePreview = {
  company: string;
  tagline: string;
  assessment: string;
  description: string;
  message: string;
  due_at: string | null;
  timezone: string | null;
  email: string;
  candidate_name: string | null;
  stage: string;
  label: string;
  note: string;
  open: boolean;
};

export type CompanyProfile = { tagline: string; about: string; mission: string; vision: string; values: string; industry: string; website: string };

export type TopicPreview = {
  valid: boolean;
  title: string;
  briefing: string;
  role: string;
  team: { name: string; role: string }[];
  objectives: string[];
  tools: string[];
  skills: { id: string; name: string; description: string }[];
  estimated_minutes: number;
};

export type PublishBody = Partial<AssessmentFields> & {
  topic_id: string;
  title: string;
  message: string;
  candidates?: { email: string; name?: string }[];
  channel?: InviteChannel;
  client_request_id?: string;
};

export const companyApi = {
  get: () => request<{ company: Company | null }>("/company"),
  create: (name: string) => request<{ company: Company }>("/company", { method: "POST", body: { name } }),
  update: (body: { name?: string; smtp?: Smtp & { password?: string | null }; judge_defaults?: JudgeMap; judge_roster?: RosterJudge[]; profile?: CompanyProfile }) =>
    request<{ company: Company }>("/company", { method: "PATCH", body }),
  testSmtp: (to: string) => request<{ ok: boolean; error: string | null }>("/company/smtp/test", { method: "POST", body: { to } }),
  catalog: () => request<JudgeCatalog>("/company/judges/catalog"),

  topics: () => request<{ items: Topic[] }>("/company/topics"),
  topic: (id: string) => request<Topic>(`/company/topics/${id}`),
  createTopic: (body: TopicInput) => request<Topic>("/company/topics", { method: "POST", body }),
  updateTopic: (id: string, body: TopicInput) => request<Topic>(`/company/topics/${id}`, { method: "PUT", body }),
  deleteTopic: (id: string) => request<void>(`/company/topics/${id}`, { method: "DELETE" }),

  assessments: () => request<{ items: AssessmentSummary[] }>("/company/assessments"),
  assessment: (id: string) => request<AssessmentDetail>(`/company/assessments/${id}`),
  createAssessment: (body: PublishBody) =>
    request<AssessmentSummary & { created: boolean; delivery: InviteResult | null }>("/company/assessments", { method: "POST", body }),
  updateAssessment: (id: string, body: Partial<AssessmentFields> & { title?: string; message?: string }) =>
    request<{ status: string; assessment: AssessmentSummary }>(`/company/assessments/${id}`, { method: "PATCH", body }),
  setStatus: (id: string, status: "active" | "closed") =>
    request<{ status: string }>(`/company/assessments/${id}`, { method: "PATCH", body: { status } }),
  revoke: (id: string, inviteId: string) => request<{ ok: boolean }>(`/company/assessments/${id}/invites/${inviteId}/revoke`, { method: "POST" }),
  topicPreview: (topicId: string) => request<TopicPreview>(`/company/topics/${topicId}/preview`),
  invite: (id: string, candidates: { email: string; name?: string }[], channel: InviteChannel = "app", resend = false) =>
    request<InviteResult>(`/company/assessments/${id}/invites`, { method: "POST", body: { candidates, resend, channel } }),
  resend: (id: string, inviteId: string) =>
    request<{ ok: boolean; error: string | null }>(`/company/assessments/${id}/invites/${inviteId}/resend`, { method: "POST" }),
  removeInvite: (id: string, inviteId: string) =>
    request<void>(`/company/assessments/${id}/invites/${inviteId}`, { method: "DELETE" }),
  candidate: (id: string, inviteId: string) => request<CandidateReport>(`/company/assessments/${id}/candidates/${inviteId}`),
  /** The whole assessment: one-page group summary, or the detailed group overview. */
  downloadPdf: (id: string, kind: "summary" | "detailed" = "detailed") =>
    download(`/company/assessments/${id}/report.pdf?kind=${kind}`, `group-${kind}.pdf`),
  downloadCsv: (id: string) => download(`/company/assessments/${id}/report.csv`, "assessment-results.csv"),
  /** Per-candidate PDF: a one-page summary each, or the in-detail review. Empty ids = everyone who completed. */
  downloadCandidateReports: (id: string, kind: "summary" | "detailed", ids: string[], filename: string) =>
    download(`/company/assessments/${id}/candidate-reports.pdf?kind=${kind}&ids=${encodeURIComponent(ids.join(","))}`, filename),

  allCandidates: () => request<AllCandidates>("/company/candidates"),
  downloadAllCsv: () => download("/company/candidates.csv", "all-candidates.csv"),
  downloadAllPdf: () => download("/company/candidates.pdf", "all-candidates.pdf"),

  invitePreview: (token: string) => request<InvitePreview>(`/invites/${token}`),
  /** Signed in with the emailed link: link the invitation to this account (never accepts or starts it). */
  claimInvite: (token: string) => request<{ invite_id: string }>(`/invites/${token}/claim`, { method: "POST" }),
  sessionAssessment: (sessionId: string) =>
    request<{ assessment: { company: string; title: string; invite_id: string } | null }>(`/sessions/${sessionId}/assessment`),
};

export { parseCandidates } from "./candidates";

/** Company-side candidate statuses: sort order (most advanced first) and filter labels. */
export const STATUS_ORDER: Record<Candidate["status"], number> = {
  completed: 0, submitted: 1, in_progress: 2, accepted: 3, opened: 4, invited: 5, pending: 6,
  declined: 7, missed: 8, expired: 9, revoked: 10, email_failed: 11,
};
export const STATUS_FILTERS: [Candidate["status"], string][] = [
  ["completed", "Completed"], ["submitted", "Submitted"], ["in_progress", "In progress"], ["accepted", "Accepted"],
  ["opened", "Opened invite"], ["invited", "Invited"], ["declined", "Declined"], ["missed", "Missed deadline"],
  ["expired", "Expired"], ["revoked", "Withdrawn"], ["email_failed", "Email failed"],
];
export function statusBadge(status: Candidate["status"]): string {
  if (status === "completed" || status === "submitted") return "badge badge--ok";
  if (status === "in_progress" || status === "accepted") return "badge badge--active";
  if (status === "email_failed" || status === "declined" || status === "missed") return "badge badge--warn";
  return "badge";
}

export const BAND_COLORS: Record<string, string> = {
  Strong: "#0ca30c",
  Good: "#21935b",
  Developing: "#fab219",
  "Needs support": "#d03b3b",
};

export const TRACK_LABELS: Record<string, string> = {
  backend: "Backend / on-call",
  frontend: "Frontend / mobile / QA",
  data: "Data / analytics",
  product: "Product / design",
};

/** Same keyword mapping as the API's track_for(), to pre-select a track from a description. */
export function suggestTrack(text: string): string {
  const t = text.toLowerCase();
  const words: [string, string[]][] = [
    ["frontend", ["frontend", "front-end", "mobile", "qa", "ios", "android", "web developer", "ui engineer", "react"]],
    ["data", ["data", "analyst", "analytics", "machine learning", "scientist", "dashboard", "sql"]],
    ["product", ["product", "design", "ux", "marketing", "growth", "launch"]],
  ];
  for (const [track, list] of words) if (list.some((w) => t.includes(w))) return track;
  return "backend";
}
