import type {
  ActionResponse,
  CompetencyTrend,
  ContextSource,
  ContextView,
  DocumentKind,
  Evaluation,
  Profile,
  ProgressResponse,
  ScenarioInstance,
  ScenarioTemplate,
  SessionSummary,
  SessionView,
  SimEvent,
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

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  // FormData (file uploads) goes as multipart; the browser sets its Content-Type boundary.
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    const token = tokenGetter ? await tokenGetter() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
      cache: "no-store",
    });
  };

  // On a flaky connection, retry requests that are safe to repeat: reads, and writes carrying a
  // client_*_id the server dedupes on (turns, actions, voice start).
  const retryable =
    (opts.method ?? "GET") === "GET" ||
    (typeof opts.body === "object" && opts.body !== null && Object.keys(opts.body).some((k) => /^client_\w+_id$/.test(k)));
  let res: Response | undefined;
  for (let attempt = 0; !res; attempt += 1) {
    try {
      res = await doFetch();
    } catch {
      if (opts.signal?.aborted || !retryable || attempt >= 2) {
        throw new ApiError(0, "network_error", "Could not reach the WorkVerse API. Check your connection and try again.");
      }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  try {
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

/** Fetch an authenticated file (PDF/CSV report) and hand it to the browser as a download. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const token = tokenGetter ? await tokenGetter() : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    // Prefer the server's own explanation (e.g. "none of the selected candidates has finished").
    const err = await res.json().then((d: { error?: { code?: string; message?: string } }) => d.error, () => undefined);
    throw new ApiError(res.status, err?.code ?? "download_failed", err?.message ?? `Download failed (${res.status}).`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  imochaGuide: () => request<{ name: string; suggestions: string[] }>("/imocha/guide"),
  imochaAsk: (body: { question: string; history: { role: "user" | "assistant"; content: string }[] }) =>
    request<{ answer: string }>("/imocha/guide/ask", { method: "POST", body }),

  updateMe: (body: Partial<Profile>) => request<Profile>("/me", { method: "PATCH", body }),

  addSkill: (body: { name: string; level_self_reported?: string | null }) =>
    request<unknown>("/me/skills", { method: "POST", body }),

  deleteSkill: (skillId: string) => request<void>(`/me/skills/${skillId}`, { method: "DELETE" }),

  getContext: () => request<ContextView>("/me/context"),

  /** Upload a CV or LinkedIn PDF; only its extracted text is kept. */
  uploadDocument: (kind: DocumentKind, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ source: ContextSource }>(`/me/documents/${kind}`, { method: "POST", body: form });
  },

  removeDocument: (kind: DocumentKind) => request<void>(`/me/documents/${kind}`, { method: "DELETE" }),

  /** Read the profile's GitHub / LinkedIn / website links (only new or changed ones unless forced). */
  refreshSources: (force = false) =>
    request<ContextView>("/me/sources/refresh", { method: "POST", body: { force } }),

  /** Rebuild the learner context and personalised scenarios if anything changed (or forced). */
  buildContext: (force = false) =>
    request<ContextView>("/me/context/build", { method: "POST", body: { force } }),

  listTemplates: () => request<{ items: ScenarioTemplate[] }>("/scenario-templates"),

  createInstance: (body: {
    template_slug: string;
    mode?: string;
    difficulty?: string;
    variation_request?: string;
    incident?: string;
    spec_id?: string;
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

  events: (sessionId: string) => request<{ items: SimEvent[] }>(`/sessions/${sessionId}/events`),

  complete: (sessionId: string, body: { expected_state_version?: number; force?: boolean }) =>
    request<{ status: string; evaluation: Evaluation }>(`/sessions/${sessionId}/complete`, {
      method: "POST",
      body,
    }),

  /** Skip the conversation: the colleague hands over what they may share now (logged as skipped). */
  skipCharacter: (sessionId: string, characterId: string) =>
    request<{ revealed: string[]; session: SessionView }>(`/sessions/${sessionId}/characters/${characterId}/skip`, { method: "POST" }),

  getEvaluation: (sessionId: string) =>
    request<Evaluation>(`/sessions/${sessionId}/evaluation`),

  retry: (sessionId: string) =>
    request<{ scenario_instance_id: string; session: SessionView; prebrief: ScenarioInstance["prebrief"] }>(
      `/sessions/${sessionId}/retry`,
      { method: "POST" },
    ),

  progress: () => request<ProgressResponse>("/progress"),

  competencies: () => request<{ items: CompetencyTrend[] }>("/progress/competencies"),

  startVoiceSession: (
    sessionId: string,
    body: { npc_id: string; client_request_id?: string; elevenlabs_api_key?: string },
  ) =>
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
    request<{ id: string; duplicate: boolean; session?: SessionView }>(
      `/sessions/${sessionId}/voice-sessions/${voiceSessionId}/messages`,
      { method: "POST", body },
    ),

  endVoiceSession: (sessionId: string, voiceSessionId: string, reason?: string) =>
    request<{ id: string; status: string; duplicate: boolean }>(
      `/sessions/${sessionId}/voice-sessions/${voiceSessionId}/end`,
      { method: "POST", body: { reason: reason ?? null } },
    ),
};
