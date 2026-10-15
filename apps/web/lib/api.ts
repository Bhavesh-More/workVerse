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
  VoiceSessionStart,
  VoiceSessionView,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

let tokenGetter: (() => Promise<string | null>) | null = null;

/** Registered by a Clerk bridge component so API calls always use a fresh session token. */
export function setTokenGetter(fn: (() => Promise<string | null>) | null) {
  tokenGetter = fn;
}

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
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const token = tokenGetter ? await tokenGetter() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  };

  let res: Response;
  try {
    res = await doFetch();
    // A freshly signed-in Clerk session may not expose a token for a brief moment; retry.
    for (let attempt = 0; attempt < 3 && res.status === 401; attempt += 1) {
      await new Promise((r) => setTimeout(r, 400));
      res = await doFetch();
    }
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the WorkVerse API.");
  }

  // Any successful write may change what GETs return; drop cached reads.
  if (res.ok && (opts.method ?? "GET") !== "GET") clearCache();

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: { error?: { code?: string; message?: string; request_id?: string; details?: unknown } } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body (e.g. a proxy error page): fall through to the status-based error.
    if (res.ok) throw new ApiError(res.status, "bad_response", "The WorkVerse API sent an unreadable response.");
  }
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

// Stale-while-revalidate read cache: pages render the last known data instantly and refresh
// in the background. In-flight requests are shared so a hover-prefetch and the page's own
// fetch never double up. ponytail: in-memory per tab, no TTL — cleared on writes and sign-out.
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

export function peek<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const gen = generation;
  const p = fetcher()
    .then((data) => {
      // A write landed while this read was in flight: don't resurrect pre-write data.
      if (gen === generation) cache.set(key, data);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function clearCache() {
  generation += 1;
  cache.clear();
  inflight.clear();
}

export const api = {
  getMe: () => request<Profile>("/me"),

  updateMe: (body: Partial<Profile>) => request<Profile>("/me", { method: "PATCH", body }),

  addSkill: (body: { name: string; level_self_reported?: string | null }) =>
    request<unknown>("/me/skills", { method: "POST", body }),

  deleteSkill: (skillId: string) => request<void>(`/me/skills/${skillId}`, { method: "DELETE" }),

  listTemplates: () => request<{ items: ScenarioTemplate[] }>("/scenario-templates"),

  createInstance: (body: {
    template_slug: string;
    mode?: string;
    difficulty?: string;
    variation_request?: string;
  }) => request<ScenarioInstance>("/scenario-instances", { method: "POST", body }),

  getInstance: (instanceId: string) =>
    request<ScenarioInstance>(`/scenario-instances/${instanceId}`),

  startSession: (scenarioInstanceId: string, mode = "quick") =>
    request<SessionView>("/sessions", {
      method: "POST",
      body: { scenario_instance_id: scenarioInstanceId, mode },
    }),

  listSessions: () => request<{ items: SessionSummary[] }>("/sessions"),

  getSession: (sessionId: string) => request<SessionView>(`/sessions/${sessionId}`),

  submitAction: (
    sessionId: string,
    body: {
      client_action_id: string;
      expected_state_version: number;
      type: string;
      payload?: Record<string, unknown>;
    },
  ) => request<ActionResponse>(`/sessions/${sessionId}/actions`, { method: "POST", body }),

  submitTurn: (
    sessionId: string,
    body: {
      client_turn_id: string;
      expected_state_version: number;
      character_id: string;
      message: string;
    },
  ) => request<TurnResponse>(`/sessions/${sessionId}/turns`, { method: "POST", body }),

  transcript: (sessionId: string) =>
    request<{ items: TranscriptMessage[] }>(`/sessions/${sessionId}/transcript`),

  complete: (sessionId: string, body: { expected_state_version?: number; force?: boolean }) =>
    request<{ status: string; evaluation: Evaluation }>(`/sessions/${sessionId}/complete`, {
      method: "POST",
      body,
    }),

  getEvaluation: (sessionId: string) =>
    request<Evaluation>(`/sessions/${sessionId}/evaluation`),

  retry: (sessionId: string) =>
    request<{ scenario_instance_id: string; session: SessionView; prebrief: ScenarioInstance["prebrief"] }>(
      `/sessions/${sessionId}/retry`,
      { method: "POST" },
    ),

  progress: () => request<ProgressResponse>("/progress"),

  competencies: () => request<{ items: CompetencyTrend[] }>("/progress/competencies"),

  startVoiceSession: (sessionId: string, body: { npc_id: string; client_request_id?: string }) =>
    request<VoiceSessionStart>(`/sessions/${sessionId}/voice-sessions`, {
      method: "POST",
      body,
    }),

  getVoiceSession: (sessionId: string, voiceSessionId: string) =>
    request<VoiceSessionView>(`/sessions/${sessionId}/voice-sessions/${voiceSessionId}`),

  ingestVoiceMessage: (
    sessionId: string,
    voiceSessionId: string,
    body: {
      speaker: "user" | "npc";
      text: string;
      provider_message_id?: string | null;
      provider_conversation_id?: string | null;
    },
  ) =>
    request<{ id: string; duplicate: boolean }>(
      `/sessions/${sessionId}/voice-sessions/${voiceSessionId}/messages`,
      { method: "POST", body },
    ),

  endVoiceSession: (sessionId: string, voiceSessionId: string, reason?: string) =>
    request<{ id: string; status: string; duplicate: boolean }>(
      `/sessions/${sessionId}/voice-sessions/${voiceSessionId}/end`,
      { method: "POST", body: { reason: reason ?? null } },
    ),
};
