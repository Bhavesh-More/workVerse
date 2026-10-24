"""Custom-LLM bridge: ElevenAgents -> FastAPI -> hosted Ollama Cloud.

ElevenAgents calls this endpoint with an OpenAI-compatible Chat Completions request
(streaming SSE). We authenticate the caller (shared bridge secret), resolve the signed,
short-lived context grant to one authorized WorkVerse session + NPC, build the character's
current authorized context from the authoritative database, then stream hosted Ollama Cloud
output back in the exact SSE framing ElevenLabs expects (``data: {json}\\n\\n`` ... ``data: [DONE]``).

The model never mutates authoritative state: deterministic disclosure of facts still runs in
server code, and any world-changing action stays on the existing validated WorkVerse action API.
"""

from __future__ import annotations

import hmac
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from app.agents.ollama_cloud import OllamaCloudClient
from app.agents.prompts import build_character_messages
from app.core.config import Settings
from app.core.errors import AIConfigError, AuthError
from app.schemas.runtime import SimulationState
from app.schemas.scenario import CharacterBlueprint, ScenarioBlueprint

logger = logging.getLogger(__name__)

GRANT_MARKER_PREFIX = "[[workverse_grant:"
GRANT_MARKER_SUFFIX = "]]"
_FORBIDDEN_ROLES = {"system", "developer", "tool", "function"}
MAX_LATEST_USER_CHARS = 4000


def verify_bridge_secret(settings: Settings, headers: Any) -> None:
    """Authenticate an inbound custom-LLM request from ElevenLabs.

    ElevenLabs forwards the secret configured in the agent's Custom LLM settings. The exact
    header name is verified against the live dashboard during setup; we accept the documented
    Bearer form plus the common ``xi-api-key`` / ``x-api-key`` forms, compared in constant time.
    """
    secret = settings.voice_llm_bridge_secret.strip()
    if not secret:
        raise AIConfigError(
            "The voice custom-LLM bridge is not configured.",
            code="voice_llm_bridge_not_configured",
        )
    candidates: list[str] = []
    authorization = headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        candidates.append(authorization.split(" ", 1)[1].strip())
    for header in ("xi-api-key", "x-api-key"):
        value = headers.get(header)
        if value:
            candidates.append(value.strip())
    if not any(hmac.compare_digest(secret, candidate) for candidate in candidates):
        raise AuthError("Voice bridge authentication failed.")


def validate_bridge_request(body: dict[str, Any], messages: list[dict[str, Any]]) -> None:
    if len(messages) > 80:
        raise AIConfigError("Voice bridge request has too many messages.", code="payload_too_large")
    total = sum(len(m.get("content") or "") for m in messages if isinstance(m, dict))
    if total > 40_000:
        raise AIConfigError("Voice bridge request is too large.", code="payload_too_large")


def extract_grant(body: dict[str, Any], messages: list[dict[str, Any]] | None = None) -> str | None:
    """Read the context grant from the documented extra-body field, or a prompt marker."""
    extra = body.get("elevenlabs_extra_body") or body.get("customLlmExtraBody")
    if isinstance(extra, dict):
        grant = extra.get("context_grant") or extra.get("contextGrant")
        if isinstance(grant, str) and grant.strip():
            return grant.strip()
    direct = body.get("context_grant")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    for message in messages or []:
        content = message.get("content")
        if isinstance(content, str):
            found = _marker_in(content)
            if found:
                return found
    return None


def _marker_in(text: str) -> str | None:
    start = text.find(GRANT_MARKER_PREFIX)
    if start == -1:
        return None
    end = text.find(GRANT_MARKER_SUFFIX, start)
    if end == -1:
        return None
    return text[start + len(GRANT_MARKER_PREFIX) : end].strip() or None


def strip_grant_markers(text: str) -> str:
    """Remove any context-grant marker so internal routing metadata never reaches the model."""
    while True:
        start = text.find(GRANT_MARKER_PREFIX)
        if start == -1:
            return text
        end = text.find(GRANT_MARKER_SUFFIX, start)
        if end == -1:
            return text[:start]
        text = text[:start] + text[end + len(GRANT_MARKER_SUFFIX) :]


def latest_user_message(messages: list[dict[str, Any]]) -> str:
    turns = _conversation_turns(messages)
    if turns and turns[-1]["role"] == "user":
        return turns[-1]["content"][:MAX_LATEST_USER_CHARS]
    return ""


def _conversation_turns(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    turns: list[dict[str, str]] = []
    for message in messages:
        role = str(message.get("role") or "").lower()
        if role in _FORBIDDEN_ROLES or role not in {"user", "assistant"}:
            continue
        content = message.get("content")
        if not isinstance(content, str):
            continue
        cleaned = strip_grant_markers(content).strip()
        if not cleaned:
            continue
        turns.append({"role": role, "content": cleaned})
    return turns


def build_voice_messages(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    character: CharacterBlueprint,
    eleven_messages: list[dict[str, Any]],
    *,
    newly_revealed_fact_ids: list[str] | None = None,
    max_history: int = 24,
    max_history_chars: int = 6000,
) -> list[dict[str, str]]:
    """Build the trusted system prompt plus bounded recent history for one turn."""
    turns = _conversation_turns(eleven_messages)
    latest_user = ""
    if turns and turns[-1]["role"] == "user":
        latest_user = turns[-1]["content"][:MAX_LATEST_USER_CHARS]
        history = turns[:-1]
    else:
        history = turns

    bounded: list[dict[str, str]] = []
    total = 0
    for turn in reversed(history[-max(0, max_history) :]):
        total += len(turn["content"])
        if total > max_history_chars:
            break
        bounded.append(turn)
    bounded.reverse()

    return build_character_messages(
        blueprint,
        state,
        character,
        bounded,
        latest_user,
        list(newly_revealed_fact_ids or []),
        voice=True,
    )


_MARKDOWN = str.maketrans("", "", "*#`_>|")


def spoken(delta: str) -> str:
    """Drop markdown symbols the model may still emit; they would be read aloud or garble TTS."""
    return delta.translate(_MARKDOWN)


def sse_chunk(content: str, model: str) -> str:
    payload = {
        "id": "chatcmpl-workverse",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
    }
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"


def sse_finish(model: str) -> str:
    payload = {
        "id": "chatcmpl-workverse",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"


def sse_error(message: str) -> str:
    return f"data: {json.dumps({'error': {'message': message}}, separators=(',', ':'))}\n\n"


async def stream_response(
    messages: list[dict[str, str]],
    ai: OllamaCloudClient,
    *,
    model: str | None,
    max_tokens: int,
) -> AsyncIterator[str]:
    """Yield an ElevenLabs-compatible SSE stream. Always terminates with ``data: [DONE]``."""
    try:
        async for delta in ai.stream_chat(messages, model=model, max_tokens=max_tokens):
            text = spoken(delta)
            if text:
                yield sse_chunk(text, model or "workverse")
    except Exception as exc:  # noqa: BLE001 - translate to a safe SSE error, never leak internals
        logger.warning("voice_llm_stream_error", extra={"event": type(exc).__name__})
        yield sse_error("The language model is temporarily unavailable.")
    finally:
        yield sse_finish(model or "workverse")
        yield "data: [DONE]\n\n"
