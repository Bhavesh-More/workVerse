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

- Supabase Auth is used with ES256 JWT verification against the project JWKS (signature,
  issuer, audience, expiry).
- `POST /api/v1/auth/register` creates a **confirmed** user via the Supabase Admin API using
  the server-side secret key, so a learner can start immediately without outbound email. In a
  production deployment this should be replaced with Supabase's email-confirmation flow; the
  endpoint is disabled when `APP_ENV=production` unless `DEV_AUTH_ENABLED=true`.
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
- Uploaded documents are not yet ingested (no resume parsing). The storage adapter and MinIO
  compose file are present but the core flow does not depend on them.

## Simulation

- One orchestrated character turn at a time; no autonomous agent-to-agent loops.
- Concurrency uses optimistic `state_version` checks rather than a long-lived row lock, so a
  database transaction is never held open across a model call. Concurrent writes to the same
  session are rejected with `409`.
- Scenario variation changes surface details (service, timing, impact, stakeholder voice) while
  keeping the action graph, required facts and rubric stable, so attempts remain comparable.

## Object storage

- MinIO is provided for local development only. The upstream community distribution's
  maintenance/licensing status should be reviewed and an image pinned (the compose file
  intentionally requires an explicit `MINIO_IMAGE`) before any real use.

## Evaluation framing

- Reports are **formative practice feedback**, not validated predictors of job performance,
  employability or hiring success. The UI states this explicitly.
