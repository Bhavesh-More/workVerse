# Real-time voice setup (ElevenLabs ElevenAgents + Ollama Cloud)

This document is the owner's checklist for enabling the live voice characters. Nothing here
requires pasting a secret into chat or source. All application code is already in place and
runs without credentials (voice endpoints return a controlled setup error until configured).

## Architecture at a glance

```
Browser (Phaser + React overlay)
   │  1. POST /api/v1/sessions/{id}/voice-sessions        (Clerk-authenticated)
   ▼
FastAPI ──▶ ElevenLabs GET /v1/convai/conversation/token   (xi-api-key, server-only)
   │  returns { conversation_token, context_grant }
   ▼
Browser ── startSession({ conversationToken, customLlmExtraBody }) ──▶ ElevenLabs WebRTC
   │
   ▼                                (per turn)
ElevenLabs ── POST /api/v1/voice/llm  (Custom LLM, OpenAI Chat Completions, SSE)
   │   Authorization: Bearer <WORKVERSE_ELEVEN_LLM_BRIDGE_SECRET>
   │   body.elevenlabs_extra_body.context_grant = <signed grant>
   ▼
FastAPI bridge ── verifies grant + bridge secret, loads authorized NPC context from Postgres,
   │              applies deterministic fact disclosure, streams from ──▶ Ollama Cloud
   ▼
ElevenLabs speaks; finalized text arrives in the browser via `onMessage` and is persisted.
```

The browser never receives `ELEVENLABS_API_KEY`, the Ollama key, the agent id, or any hidden
scenario fact. It only ever sees a short-lived conversation token and a short-lived signed
context grant.

## 1. ElevenLabs account and agent

1. Sign in / create an account at <https://elevenlabs.io/>. Confirm the plan includes
   ElevenAgents (conversational AI) and WebRTC.
2. In **Agents**, create an agent per character role you want to voice, e.g.
   `WorkVerse - Engineering Manager (Dev)`. Give it an approved voice. Keep the system prompt
   short and workplace-flavoured — the authoritative scenario context is injected server-side by
   the FastAPI bridge, so the agent prompt must **not** contain facts, credentials or hidden data.
3. In the agent's **LLM** settings choose **Custom LLM**:
   - **Model ID:** any label, e.g. `workverse-ollama`. The bridge ignores it and uses
     `OLLAMA_MODEL`.
   - **Server URL:** `https://<your-public-api-host>/api/v1/voice/llm`
     (for local development, expose FastAPI with a tunnel such as ngrok; see step 5).
   - **API key / secret:** create a new secret whose value equals `VOICE_LLM_BRIDGE_SECRET`.
     ElevenLabs forwards it to the bridge. The bridge accepts it as `Authorization: Bearer …`
     or `xi-api-key` (verify the exact header in the dashboard and, if different, update
     `verify_bridge_secret` in `apps/api/app/services/voice_llm.py`).
4. Publish the agent and copy its `agent_...` id from the agent details. The agent id is an
   identifier, not a secret, but it is mapped **server-side only**.

## 2. API key (least privilege)

Create the key at **Developers → API Keys → Create API Key**.

- **Name:** `workverse-dev` (separate key per environment).
- **Restrict Key:** ON. **Expire After:** a limited lifetime (e.g. 30 days); rotate before expiry.
- **Usage limits (credits):** set a modest development budget. Credits ≠ voice minutes.
- **ElevenAgents / ConvAI:** the verified conversation-token endpoint
  (`GET /v1/convai/conversation/token`) requires the **`convai_write`** permission — even though
  it is a GET. A read-only key returns
  `authentication_error / missing_permissions: missing the permission convai_write`. Grant the
  narrowest scope that includes `convai_write` (do **not** broaden unrelated scopes).
- **Text to Speech / Speech to Speech / Speech to Text:** **No Access** (handled inside the
  configured ElevenAgents session).
- **Voices:** **No Access** unless you separately list voices through the API.
- **Everything else** (Sound Effects, Music, Dubbing, Projects, History, Models, Webhooks,
  Workspace, User, etc.): **No Access**.
- **Restrict by IP:** OFF for localhost; for a stable deployment egress IP you may allow-list
  the server egress CIDR only (never a laptop/browser IP).
- **Auto-disable if leaked:** ON.

Official references: token endpoint
<https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-webrtc-token>,
authentication <https://elevenlabs.io/docs/api-reference/authentication>.

## 3. Ollama Cloud

Hosted inference only — `https://ollama.com/v1` with a server-side Bearer token. No local model,
no `ollama pull`, no `localhost:11434`. Set `OLLAMA_MODEL` to a model id that exists in your
account and supports streaming chat completions (the existing dialogue path already uses it).

## 4. Environment files

Copy the voice block from `.env.example` into `apps/api/.env` (server-only) and fill placeholders:

| Variable | Purpose |
| --- | --- |
| `VOICE_ENABLED` | Master switch for voice endpoints. |
| `ELEVENLABS_API_KEY` | Server-only. Mints conversation tokens. |
| `ELEVENLABS_AGENT_ID` | Default agent for every NPC. |
| `ELEVENLABS_AGENT_MAP` | Optional per-NPC JSON, e.g. `{"manager":"agent_…"}`. |
| `VOICE_LLM_BRIDGE_SECRET` | Shared secret configured in the agent's Custom LLM settings. |
| `VOICE_CONTEXT_GRANT_SECRET` | HMAC secret for short-lived session/NPC context grants. |
| `VOICE_CONTEXT_GRANT_TTL_SECONDS` | Grant lifetime (default 900). |
| `OLLAMA_API_KEY`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Already used by the text path. |

Generate secrets with e.g. `openssl rand -hex 32`. Never use `NEXT_PUBLIC_*` for any of them.

## 5. Local development

ElevenLabs must reach the bridge over public HTTPS:

```sh
# terminal 1
pnpm --filter @workverse/api dev        # FastAPI on :8000
# terminal 2
ngrok http 8000                          # gives https://<id>.ngrok.app
```

Set the agent's Custom LLM **Server URL** to `https://<id>.ngrok.app/api/v1/voice/llm`.

## 6. Verify without leaking secrets

- **Configuration status only:** `GET /health/ready` returns
  `voice_configured` and `voice_llm_bridge_configured` booleans plus provider-agnostic checks.
  It never returns key values.
- **Backend tests:** `cd apps/api && uv run pytest -q` (all provider calls are mocked).
- **Smoke test endpoint:**
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/api/v1/voice/llm`
  should return `503` (bridge not configured) / `401` (unauthenticated), never `500`.

## 7. Manual live smoke test

1. Configure the env values above, apply migration `0003` to your database, start web + api.
2. Sign in, start a scenario, walk to a character, press **E**.
3. Grant microphone access. The overlay shows `connecting → listening`.
4. Ask a workplace question. The character answers aloud; the exact words appear in the
   bottom-right transcript once.
5. Press **End voice**. Movement unlocks; refresh the page and confirm the transcript persisted.
6. Complete the session and check the debrief cites the spoken turn.

## 8. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `503 voice_not_configured` | `ELEVENLABS_API_KEY` / agent id missing. |
| `403 voice_provider_auth` | Restricted key lacks the required ElevenAgents scope, or agent access. |
| `404 voice_agent_not_found` | Wrong `ELEVENLABS_AGENT_ID` / `ELEVENLABS_AGENT_MAP`. |
| Bridge returns `401` to ElevenLabs | `VOICE_LLM_BRIDGE_SECRET` mismatch or wrong auth header. |
| `voice context grant` error | Clock skew, expired grant, or `VOICE_CONTEXT_GRANT_SECRET` mismatch. |
| Agent speaks generic answers | Custom LLM URL not pointed at the bridge, or grant not forwarded. |
| Mic blocked | Browser permission denied; text chat remains available. |
| `429` | ElevenLabs/Ollama quota or concurrency limit reached. |

Pricing and concurrency are account-specific — check the current ElevenLabs pricing page and your
Ollama plan. Application code makes no assumption about free allowances.
