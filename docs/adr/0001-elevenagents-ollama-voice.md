# ADR 0001 — Real-time voice characters via ElevenAgents + a FastAPI custom-LLM bridge

- **Status:** Accepted (live provider verification pending owner credentials)
- **Date:** 2026-10-11
- **Context owners:** WorkVerse AI

## Context

WorkVerse AI already ships text dialogue where **FastAPI is authoritative**: it owns session
ownership, scenario rules, deterministic fact disclosure and evaluation, and calls hosted
**Ollama Cloud** for reasoning (no local inference, base URL allow-listed). Identity is Clerk;
Supabase is the PostgreSQL database.

We need real-time spoken workplace characters: the learner walks to an NPC, presses **E**, and
holds a live voice conversation. The NPC must speak naturally, the learner speaks through the
mic, and every finalized NPC turn must appear verbatim in a bottom-right transcript that feeds
the existing evidence-grounded debrief.

The two hard constraints are:

1. Spoken dialogue must use the **current authorized scenario context and character knowledge**,
   not a generic assistant.
2. Hidden scenario facts, the answer key, and any credential must never reach the browser, and
   the model must never mutate authoritative state.

## Decision

Use **ElevenAgents for the real-time audio/ASR/TTS/WebRTC transport** and a **FastAPI
OpenAI-compatible custom-LLM bridge** for reasoning. ElevenAgents is configured with a
**Custom LLM** whose server URL is `POST /api/v1/voice/llm`.

Per turn:

1. The browser asks FastAPI to start a voice session (Clerk-authenticated).
2. FastAPI verifies ownership/state, mints a **short-lived WebRTC conversation token** from
   `GET /v1/convai/conversation/token` using the server-side `ELEVENLABS_API_KEY`, and issues a
   **signed, short-lived context grant** scoped to `{user, session, voice_session, NPC}`.
3. The browser calls `startSession({ conversationToken, customLlmExtraBody })` — the grant
   travels in `elevenlabs_extra_body.context_grant`, never in visible prompt text it controls.
4. ElevenAgents calls the bridge. The bridge authenticates with the shared
   `VOICE_LLM_BRIDGE_SECRET`, verifies the grant signature/expiry/scope, loads the authorized
   blueprint + state + character from Postgres, runs the same deterministic
   `apply_disclosure` the text path uses, builds the trusted character prompt, and **streams**
   Ollama Cloud output back as OpenAI-compatible SSE (`data: {...}\n\n` … `data: [DONE]`).
5. Finalized transcript turns are persisted from the browser (deduplicated by provider message
   id) into the existing `conversation_messages` table with `modality = 'voice_transcript'`, so
   the debrief and evidence resolver work unchanged.

## Rationale

- **Context control.** A custom-LLM bridge is the only way to inject per-turn *authorized*
  scenario state and character disclosure rules while keeping the model provider behind our
  server. Pointing ElevenLabs directly at Ollama Cloud would satisfy "the LLM is Ollama" but
  could not carry session-scoped context securely.
- **Least privilege.** The browser receives only a token and a scoped grant. The agent id and
  API keys stay server-side. A compromised client cannot mint tokens for another session or NPC:
  the grant is HMAC-signed and matched against a live voice session.
- **Evidence integrity.** Reusing `conversation_messages` (already the source of truth for the
  evaluator and the DB trigger that validates quotes) means voice evidence is handled exactly
  like text evidence.
- **State safety.** The model output never mutates state. Fact disclosure remains deterministic
  server code; any consequential action still goes through the validated action API.

## Alternatives considered

- **ElevenLabs Custom LLM pointed directly at Ollama Cloud** (key stored as an ElevenLabs
  secret). Rejected: no secure per-session context injection; hidden facts would have to be sent
  through client-visible dynamic variables.
- **Client-side prompt override only.** Rejected: prompt text is client-controlled and can be
  inspected/tampered with; not an authorization boundary.

## Verified contracts (as of implementation)

- `@elevenlabs/react` **v1.17.0** (re-exports `@elevenlabs/client` v1.27.0). Confirmed from the
  installed TypeScript definitions: `useConversation({ conversationToken, customLlmExtraBody,
  dynamicVariables, overrides, userId })`, `ConversationProvider`, `onMessage: (MessagePayload)`
  with `{ message, event_id, response_id?, role: "user" | "agent" }`, `onConnect`, `onDisconnect`,
  `onError`, `onModeChange`, `isSpeaking`, `isMuted`, `setMuted`, `startSession`, `endSession`.
- Custom LLM contract: OpenAI Chat Completions or Responses, SSE, `Content-Type:
  text/event-stream`, chunks `data: {json}\n\n`, end `data: [DONE]\n\n`
  (<https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm>).
- Conversation token: `GET /v1/convai/conversation/token?agent_id=…` with `xi-api-key`.
  **Verified:** a restricted key without the `convai_write` permission returns `401
  authentication_error / missing_permissions` ("missing the permission convai_write"), despite
  the endpoint being a GET. The owner's restricted key must include `convai_write`.

## Consequences and open items

- **Live verification pending.** Without owner ElevenLabs credentials and a published agent, the
  WebRTC connection and the ElevenLabs→bridge call path are covered by mocked tests only. The
  exact Custom-LLM auth header must be confirmed in the dashboard; `verify_bridge_secret`
  currently accepts `Authorization: Bearer`, `xi-api-key`, and `x-api-key`.
- **Partial/final transcripts.** The React SDK's `onMessage` payload does not expose an explicit
  partial/final flag. Agent turns are deduplicated by the stable `response_id`; user transcripts
  are persisted with a short debounce and deduplicated server-side by `provider_message_id`.
  If ElevenLabs later exposes partial agent text, wire `onAgentChatResponsePart` for streaming
  display and keep `onMessage` as the canonical final text.
- **Reconnection.** Sessions are not resumed across a dropped WebRTC connection; the user ends
  and restarts. The backend reuses the active voice-session row, so restart is cheap and does not
  create duplicate billable provider sessions on repeated starts.
