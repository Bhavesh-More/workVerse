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
  created_at: string;
};

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
};

export type TopicInput = {
  title: string;
  description: string;
  track: string;
  incident?: string | null;
  difficulty: string;
  judges: JudgeMap;
};

export type Topic = TopicInput & { id: string; assessment_count: number; created_at: string };

export type AssessmentSummary = {
  id: string;
  title: string;
  message: string;
  status: "active" | "closed";
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
  status: "completed" | "in_progress" | "opened" | "invited" | "pending" | "email_failed";
  status_label: string;
  email_status: string;
  email_error: string | null;
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

export type InviteResult = {
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
  assessment: string;
  message: string;
  topic: string;
  description: string;
  difficulty: string;
  email: string;
  candidate_name: string | null;
  open: boolean;
  started: boolean;
};

export const companyApi = {
  get: () => request<{ company: Company | null }>("/company"),
  create: (name: string) => request<{ company: Company }>("/company", { method: "POST", body: { name } }),
  update: (body: { name?: string; smtp?: Smtp & { password?: string | null }; judge_defaults?: JudgeMap }) =>
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
  createAssessment: (body: { topic_id: string; title: string; message: string }) =>
    request<AssessmentSummary>("/company/assessments", { method: "POST", body }),
  setStatus: (id: string, status: "active" | "closed") =>
    request<{ status: string }>(`/company/assessments/${id}`, { method: "PATCH", body: { status } }),
  invite: (id: string, candidates: { email: string; name?: string }[], resend = false) =>
    request<InviteResult>(`/company/assessments/${id}/invites`, { method: "POST", body: { candidates, resend } }),
  resend: (id: string, inviteId: string) =>
    request<{ ok: boolean; error: string | null }>(`/company/assessments/${id}/invites/${inviteId}/resend`, { method: "POST" }),
  removeInvite: (id: string, inviteId: string) =>
    request<void>(`/company/assessments/${id}/invites/${inviteId}`, { method: "DELETE" }),
  candidate: (id: string, inviteId: string) => request<CandidateReport>(`/company/assessments/${id}/candidates/${inviteId}`),
  downloadPdf: (id: string) => download(`/company/assessments/${id}/report.pdf`, "assessment-report.pdf"),
  downloadCsv: (id: string) => download(`/company/assessments/${id}/report.csv`, "assessment-results.csv"),

  allCandidates: () => request<AllCandidates>("/company/candidates"),
  downloadAllCsv: () => download("/company/candidates.csv", "all-candidates.csv"),
  downloadAllPdf: () => download("/company/candidates.pdf", "all-candidates.pdf"),

  invitePreview: (token: string) => request<InvitePreview>(`/invites/${token}`),
  acceptInvite: (token: string) =>
    request<{ session_id: string; scenario_instance_id: string; status: string }>(`/invites/${token}/accept`, { method: "POST" }),
  sessionAssessment: (sessionId: string) =>
    request<{ assessment: { company: string; title: string } | null }>(`/sessions/${sessionId}/assessment`),
};

export { parseCandidates } from "./candidates";

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
