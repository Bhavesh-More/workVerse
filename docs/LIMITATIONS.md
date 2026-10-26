# WorkVerse AI — Known limitations and decisions

This file records honest limitations and the deliberate scope decisions for the MVP.

## Inference

- **Remote only.** All AI calls go to hosted Ollama Cloud (`https://ollama.com/v1`). The base
  URL is allow-listed at startup and local inference endpoints are rejected. There is no
  fallback to a local model or another provider.
- **Model.** The default model is `gemma4:31b`. The identifier is configurable via
  `OLLAMA_MODEL`. Availability/quota depends on the account; the adapter rotates across
  `OLLAMA_API_KEYS` on rate-limit/quota responses and returns a controlled `429` when all keys
  are exhausted.
- **Non-streaming turns.** Conversation turns use a single request/response rather than SSE.
  The API contract allows a non-streaming first slice; this avoids partial-state and
  disconnect edge cases. Streaming is a documented future enhancement.
- **Evaluation is inline.** `POST /sessions/{id}/complete` runs the evaluation synchronously and
  returns the report. It is idempotent (repeat calls return the stored report).

## Authentication

- Identity is provided by **Clerk**. FastAPI verifies Clerk session tokens (RS256) against the
  instance JWKS, checking signature, issuer and expiry. Supabase is used only as the PostgreSQL
  database; internal profile rows are keyed by a unique `clerk_user_id` and created on first
  authenticated request.
- The frontend uses Clerk's `<SignIn/>` / `<SignUp/>` components and Clerk's short-lived session
  tokens are fetched per API call (never cached). A custom avatar component renders Clerk's
  image URL with an initials fallback; the profile page is custom (no prebuilt Clerk components).
- New users are routed through a three-step onboarding form before reaching the dashboard.
- A gated development auth path (`Authorization: Bearer dev:<uuid>`) exists for local testing
  and is hard-disabled in production.

## Data and security

- FastAPI connects with a privileged database role that **bypasses RLS**. Every repository read
  and write therefore enforces ownership in application code; RLS policies exist for the
  Supabase Data API path but are not relied upon for the API. A restricted runtime role is
  recommended before production.
- Evaluation quotes are verified in two places: the application verifies each cited id belongs
  to the session and stores an exact substring of the persisted source, and a database trigger
  re-checks quote/session membership on insert.
- Uploaded documents are not yet ingested (no resume parsing). Files are read into memory for
  text extraction and are not persisted to object storage.

## Simulation

- One orchestrated character turn at a time; no autonomous agent-to-agent loops.
- Concurrency uses optimistic `state_version` checks rather than a long-lived row lock, so a
  database transaction is never held open across a model call. Concurrent writes to the same
  session are rejected with `409`.
- Scenario variation changes surface details (service, timing, impact, stakeholder voice) while
  keeping the action graph, required facts and rubric stable, so attempts remain comparable.

## Real-time voice (ElevenAgents)

- **Custom-LLM bridge.** Voice reasoning goes through a FastAPI OpenAI-compatible bridge
  (`POST /api/v1/voice/llm`) so per-turn authorized scenario context can be injected securely.
  The browser only ever receives a short-lived conversation token and a signed context grant.
  See `docs/elevenagents-setup.md` and `docs/adr/0001-elevenagents-ollama-voice.md`.
- **Live provider verification is pending.** The WebRTC connection and the
  ElevenLabs→bridge call path are covered by mocked unit tests. They are **not** marked verified
  until run against a real published agent and credentials. In particular the exact Custom-LLM
  auth header in the dashboard must be confirmed.
- **No automatic reconnection.** A dropped WebRTC connection ends the meeting; the learner can
  restart (the backend reuses the active voice-session row). Server-side expiry/reconciliation of
  abandoned sessions is not yet scheduled.
- **Partial/final reconciliation.** The current React SDK does not expose an explicit
  partial/final flag on `onMessage`. Agent turns dedupe by `response_id`; user turns use a short
  debounce and server-side dedupe by `provider_message_id`. This is best-effort, not exact.
- **No audio retention.** Only finalized text is stored. Raw audio is never persisted.
- **Voice does not mutate state.** Spoken statements are dialogue; completed actions still
  require the authoritative validated action API.

## Security note (pre-existing)

- `apps/api/app/core/logging.py` contains two hard-coded hex redaction markers that appear to be
  previously exposed provider keys. They should be **rotated** and removed from source. They are
  unrelated to voice but should not remain committed.

## Evaluation framing

- Reports are **formative practice feedback**, not validated predictors of job performance,
  employability or hiring success. The UI states this explicitly.
