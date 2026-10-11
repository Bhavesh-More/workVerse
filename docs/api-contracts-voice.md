# Voice API contracts

All user endpoints require the same Clerk bearer token as the rest of the API and enforce
ownership of the WorkVerse session. Errors use the standard envelope:
`{"error": {"code", "message", "request_id", "details?"}}`.

## Start a voice session

`POST /api/v1/sessions/{session_id}/voice-sessions`

```json
{ "npc_id": "manager", "client_request_id": "uuid" }
```

- Validates the session is owned and active, and that `npc_id` exists in the pinned scenario.
- Idempotent per (session, npc): repeated/concurrent starts reuse the active voice session.
- Returns `201`:

```json
{
  "voice_session_id": "…",
  "status": "connecting",
  "connection_type": "webrtc",
  "conversation_token": "<short-lived>",
  "context_grant": "<signed, short-lived>",
  "grant_expires_at": 1699999999,
  "npc": { "id": "manager", "name": "Priya Sharma", "role": "Engineering Manager" },
  "greeting": "Thanks for jumping on this…"
}
```

- Never returns the ElevenLabs API key, agent id, or any hidden fact.
- `409 session_not_active` / `voice_session_conflict`, `422 unknown_character`,
  `503 voice_not_configured` / `voice_disabled`, `502`/`429`/`504` for provider failures.

## Get voice session state + transcript

`GET /api/v1/sessions/{session_id}/voice-sessions/{voice_session_id}`

Returns status, NPC id and finalized voice transcript turns (owner-checked; `404`/`403`).

## Ingest a finalized transcript turn

`POST /api/v1/sessions/{session_id}/voice-sessions/{voice_session_id}/messages`

```json
{ "speaker": "user" | "npc", "text": "…", "provider_message_id": "evt-…", "sequence": 3 }
```

- Client telemetry is untrusted but authenticated; text is size-limited and stored verbatim.
- Deduplicated by `(session_id, provider_message_id)`; a repeat returns `duplicate: true`.
- Rejects writes to ended sessions (`409 voice_session_ended`).

## End a voice session

`POST /api/v1/sessions/{session_id}/voice-sessions/{voice_session_id}/end`

Idempotently marks the session ended. The browser also calls the SDK `endSession()`.

## Custom-LLM bridge (called by ElevenLabs, not the browser)

`POST /api/v1/voice/llm`

- Auth: shared secret as `Authorization: Bearer …` or `xi-api-key` (constant-time compare).
- Body: OpenAI Chat Completions request. The context grant is read from
  `elevenlabs_extra_body.context_grant` (fallback: a `[[workverse_grant:…]]` marker).
- Response: `text/event-stream`, OpenAI chunk SSE, terminated by `data: [DONE]`.
- Verifies the grant signature/expiry/scope against a live voice session owned by the user, then
  streams Ollama Cloud. Internal routing metadata is stripped before it reaches the model.
