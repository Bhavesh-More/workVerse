import type {
  ActionResponse,
  CompetencyTrend,
  Evaluation,
  Profile,
  ProgressResponse,
  ScenarioInstance,
  ScenarioTemplate,
  SessionSummary,
  SessionView,
  TranscriptMessage,
  TurnResponse,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, requestId?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

type RequestOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the WorkVerse API.");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? "error",
      err.message ?? `Request failed (${res.status}).`,
      err.request_id,
      err.details,
    );
  }
  return data as T;
}

export const api = {
  register: (body: { email: string; password: string; display_name?: string }) =>
    request<{ user_id: string; email: string }>("/auth/register", { method: "POST", body }),

  getMe: (token: string) => request<Profile>("/me", { token }),

  updateMe: (token: string, body: Partial<Profile>) =>
    request<Profile>("/me", { method: "PATCH", token, body }),

  addSkill: (token: string, body: { name: string; level_self_reported?: string | null }) =>
    request<unknown>("/me/skills", { method: "POST", token, body }),

  deleteSkill: (token: string, skillId: string) =>
    request<void>(`/me/skills/${skillId}`, { method: "DELETE", token }),

  listTemplates: (token: string) =>
    request<{ items: ScenarioTemplate[] }>("/scenario-templates", { token }),

  createInstance: (
    token: string,
    body: { template_slug: string; mode?: string; difficulty?: string; variation_request?: string },
  ) => request<ScenarioInstance>("/scenario-instances", { method: "POST", token, body }),

  getInstance: (token: string, instanceId: string) =>
    request<ScenarioInstance>(`/scenario-instances/${instanceId}`, { token }),

  startSession: (token: string, scenarioInstanceId: string, mode = "quick") =>
    request<SessionView>("/sessions", {
      method: "POST",
      token,
      body: { scenario_instance_id: scenarioInstanceId, mode },
    }),

  listSessions: (token: string) =>
    request<{ items: SessionSummary[] }>("/sessions", { token }),

  getSession: (token: string, sessionId: string) =>
    request<SessionView>(`/sessions/${sessionId}`, { token }),

  submitAction: (
    token: string,
    sessionId: string,
    body: { client_action_id: string; expected_state_version: number; type: string; payload?: Record<string, unknown> },
  ) => request<ActionResponse>(`/sessions/${sessionId}/actions`, { method: "POST", token, body }),

  submitTurn: (
    token: string,
    sessionId: string,
    body: { client_turn_id: string; expected_state_version: number; character_id: string; message: string },
  ) => request<TurnResponse>(`/sessions/${sessionId}/turns`, { method: "POST", token, body }),

  transcript: (token: string, sessionId: string) =>
    request<{ items: TranscriptMessage[] }>(`/sessions/${sessionId}/transcript`, { token }),

  complete: (token: string, sessionId: string, body: { expected_state_version?: number; force?: boolean }) =>
    request<{ status: string; evaluation: Evaluation }>(`/sessions/${sessionId}/complete`, {
      method: "POST",
      token,
      body,
    }),

  getEvaluation: (token: string, sessionId: string) =>
    request<Evaluation>(`/sessions/${sessionId}/evaluation`, { token }),

  retry: (token: string, sessionId: string) =>
    request<{ scenario_instance_id: string; session: SessionView; prebrief: ScenarioInstance["prebrief"] }>(
      `/sessions/${sessionId}/retry`,
      { method: "POST", token },
    ),

  progress: (token: string) => request<ProgressResponse>("/progress", { token }),

  competencies: (token: string) =>
    request<{ items: CompetencyTrend[] }>("/progress/competencies", { token }),
};
