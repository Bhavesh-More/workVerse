"""Authoritative voice-session lifecycle.

FastAPI owns the durable voice session, its ownership checks and its transcript. The
browser only ever receives a short-lived conversation token plus a signed, narrowly scoped
context grant; the long-lived ElevenLabs API key and agent ids stay server-side.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.exc import IntegrityError

from app.agents.elevenlabs_cloud import ElevenLabsClient
from app.agents.ollama_cloud import OllamaCloudClient
from app.company.judges import behaviour_prompt, voice_agent
from app.core.config import Settings
from app.core.errors import (
    AIConfigError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationAppError,
)
from app.core.voice_grant import issue_grant
from app.db.repository import Repository
from app.services.fact_check import facts_stated
from app.services.session_service import _load, _persist_pending_events, session_view
from app.simulation.engine import reveal_facts

logger = logging.getLogger(__name__)

MAX_VOICE_MESSAGE_CHARS = 4000
_VOICE_STATUSES = {"created", "connecting", "active", "ended", "failed", "expired"}


async def _load_voice_session(
    repo: Repository, user_id: str, session_id: str, voice_session_id: str
) -> dict[str, Any]:
    voice = await repo.get_voice_session(voice_session_id)
    if voice is None or str(voice["session_id"]) != str(session_id):
        raise NotFoundError("Voice session not found.")
    if str(voice["user_id"]) != str(user_id):
        raise ForbiddenError("You do not have access to this voice session.")
    return voice


async def start_voice_session(
    *,
    repo: Repository,
    voice_client: ElevenLabsClient,
    settings: Settings,
    user_id: str,
    session_id: str,
    npc_id: str,
    client_request_id: str | None = None,
) -> dict[str, Any]:
    row, blueprint, state = await _load(repo, user_id, session_id)
    if row["status"] != "active":
        raise ConflictError("This session is not active.", code="session_not_active")

    npc_id = (npc_id or "").strip()
    character = blueprint.character(npc_id)
    if character is None:
        raise ValidationAppError(f"Unknown character '{npc_id}'.", code="unknown_character")

    if not settings.voice_enabled:
        raise AIConfigError(
            "Real-time voice is disabled for this deployment.", code="voice_disabled"
        )
    # Picks the ElevenLabs account (and its agent) that can take the call; raises if none can.
    token, agent_id = await voice_client.mint_for_npc(*voice_agent(blueprint, npc_id, character.name))

    voice = await repo.get_active_voice_session(session_id, npc_id)
    if voice is None:
        voice = await repo.create_voice_session(
            session_id=session_id,
            user_id=user_id,
            npc_id=npc_id,
            agent_config_key=agent_id,
            metadata={"client_request_id": client_request_id} if client_request_id else {},
        )
        if voice is None:  # lost a race against a concurrent start
            voice = await repo.get_active_voice_session(session_id, npc_id)
            if voice is None:
                raise ConflictError(
                    "Could not create a voice session.", code="voice_session_conflict"
                )

    voice_session_id = str(voice["id"])
    await repo.set_voice_session_status(voice_session_id, "connecting")

    context_grant: str | None = None
    grant_expires_at: int | None = None
    if settings.voice_context_grant_secret:
        context_grant, grant_expires_at = issue_grant(
            settings.voice_context_grant_secret,
            user_id=user_id,
            session_id=session_id,
            voice_session_id=voice_session_id,
            npc_id=npc_id,
            ttl_seconds=settings.voice_context_grant_ttl_seconds,
        )

    return {
        "voice_session_id": voice_session_id,
        "status": "connecting",
        "connection_type": "webrtc",
        "conversation_token": token,
        "context_grant": context_grant,
        "grant_expires_at": grant_expires_at,
        "npc": {"id": character.id, "name": character.name, "role": character.role},
        "greeting": character.greeting,
        # Filled into the agent prompt's {{shared_facts}} for this call only (never stored on the agent).
        "dynamic_variables": {"shared_facts": voice_facts(blueprint, state, character.id) + _voice_behaviour(blueprint, character.id)},
    }


def _voice_behaviour(blueprint: Any, character_id: str) -> str:
    """A company-configured judge personality rides along with the facts (the agent prompt has one slot)."""
    judge = (blueprint.metadata.get("judges") or {}).get(character_id)
    return f"\n\nHow to behave on this call (manner only): {behaviour_prompt(judge)}" if judge else ""


def voice_facts(blueprint: Any, state: Any, character_id: str) -> str:
    """What this colleague may tell the learner on this call, exact wording and numbers included.
    Same scope as text chat: only their own facts, and only ones not gated behind an action the learner
    hasn't done yet. A fact that follows another of their own facts is marked so they share it in order."""
    character = blueprint.character(character_id)
    own = {r.fact_id for r in character.disclosure_rules} if character else set()
    lines: list[str] = []
    for rule in character.disclosure_rules if character else []:
        if not all(a in state.actions_done for a in rule.requires_actions):
            continue
        if any(f not in state.facts_known and f not in own for f in rule.requires_facts):
            continue
        fact = blueprint.fact(rule.fact_id)
        if fact is None:
            continue
        after = [blueprint.fact(f).label for f in rule.requires_facts if f in own and f not in state.facts_known and blueprint.fact(f)]
        lines.append(f"- {fact.label}: {fact.detail}" + (f" (only after you've told them: {', '.join(after)})" if after else ""))
    return "\n".join(lines) or "None. You hold no specific facts for this incident; say you don't know or point them to someone else."


async def get_voice_session_view(
    repo: Repository, user_id: str, session_id: str, voice_session_id: str
) -> dict[str, Any]:
    await _load(repo, user_id, session_id)
    voice = await _load_voice_session(repo, user_id, session_id, voice_session_id)
    messages = await repo.list_messages(session_id)
    transcript = [
        {
            "id": str(m["id"]),
            "sequence_number": m["sequence_number"],
            "speaker": "learner" if m["speaker_type"] == "learner" else "npc",
            "text": m["content"],
            "created_at": m["created_at"].isoformat() if m.get("created_at") else None,
        }
        for m in messages
        if m.get("modality") == "voice_transcript"
    ]
    return {
        "id": str(voice["id"]),
        "status": voice["status"],
        "npc_id": voice["npc_id"],
        "created_at": voice["created_at"].isoformat() if voice.get("created_at") else None,
        "ended_at": voice["ended_at"].isoformat() if voice.get("ended_at") else None,
        "transcript": transcript,
    }


async def ingest_transcript_message(
    *,
    repo: Repository,
    user_id: str,
    session_id: str,
    voice_session_id: str,
    speaker: str,
    text: str,
    provider_message_id: str | None = None,
    provider_conversation_id: str | None = None,
    sequence: int | None = None,
    ai: OllamaCloudClient | None = None,
) -> dict[str, Any]:
    voice = await _load_voice_session(repo, user_id, session_id, voice_session_id)
    if voice["status"] in {"ended", "failed", "expired"}:
        raise ConflictError("This voice session has ended.", code="voice_session_ended")

    speaker = (speaker or "").strip().lower()
    if speaker not in {"user", "npc"}:
        raise ValidationAppError("speaker must be 'user' or 'npc'.", code="invalid_speaker")
    clean = (text or "").strip()
    if not clean:
        raise ValidationAppError("Message text is required.", code="empty_message")
    if len(clean) > MAX_VOICE_MESSAGE_CHARS:
        raise ValidationAppError("Message text is too long.", code="message_too_long")

    if provider_message_id:
        existing = await repo.get_message_by_provider_id(session_id, provider_message_id)
        if existing is not None:
            return {"id": str(existing["id"]), "duplicate": True}

    # Serialize sequence allocation and tolerate a duplicate provider id that raced in
    # concurrently (the unique index would otherwise abort the transaction with a 500).
    await repo.lock_session_messages(session_id)
    seq = await repo.next_message_sequence(session_id)
    try:
        async with repo.session.begin_nested():
            row = await repo.insert_message(
                session_id=session_id,
                sequence_number=seq,
                turn_id=None,
                client_turn_id=None,
                speaker_type="learner" if speaker == "user" else "character",
                character_id=str(voice["npc_id"]),
                content=clean,
                modality="voice_transcript",
                metadata={
                    "voice_session_id": voice_session_id,
                    "provider_message_id": provider_message_id,
                    "sequence_hint": sequence,
                },
                provider_message_id=provider_message_id,
                source="elevenlabs-sdk",
            )
    except IntegrityError:
        existing = (
            await repo.get_message_by_provider_id(session_id, provider_message_id)
            if provider_message_id
            else None
        )
        if existing is not None:
            return {"id": str(existing["id"]), "duplicate": True}
        raise

    if voice["status"] == "connecting":
        await repo.set_voice_session_status(
            str(voice["id"]), "active", provider_conversation_id=provider_conversation_id
        )
    session = await _learn_from_voice(repo, ai, user_id, session_id, str(voice["npc_id"]), speaker, clean)
    return {"id": str(row["id"]), "duplicate": False, **({"session": session} if session else {})}


async def _learn_from_voice(
    repo: Repository, ai: OllamaCloudClient | None, user_id: str, session_id: str, npc_id: str, speaker: str, text: str
) -> dict[str, Any] | None:
    """A fact counts only once the colleague actually says it. (Unlike text chat, the voice agent has
    already answered by the time the learner's question arrives here, so keywords in the question
    would claim facts the colleague never gave.) Returns the new session view, else None."""
    if speaker != "npc" or ai is None:
        return None
    row, blueprint, state = await _load(repo, user_id, session_id, for_update=True)
    if row["status"] != "active":
        return None
    newly, events = reveal_facts(blueprint, state, npc_id, await facts_stated(ai, blueprint, state, npc_id, text))
    if not newly:
        return None
    await _persist_pending_events(repo, session_id, state, events)
    saved = await repo.save_session_state(
        session_id=session_id,
        expected_version=int(row["state_version"]),
        new_version=state.state_version,
        state=state.model_dump(),
    )
    return session_view(saved, blueprint, state) if saved else None


async def end_voice_session(
    repo: Repository,
    user_id: str,
    session_id: str,
    voice_session_id: str,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    voice = await _load_voice_session(repo, user_id, session_id, voice_session_id)
    if voice["status"] in {"ended", "failed", "expired"}:
        return {"id": str(voice["id"]), "status": voice["status"], "duplicate": True}
    updated = await repo.set_voice_session_status(
        str(voice["id"]), "ended", end_reason=reason, ended=True
    )
    return {"id": str(voice["id"]), "status": "ended", "duplicate": False, "record": bool(updated)}
