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
from app.services.session_service import _load
from app.simulation.tracks import gender_of

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
    row, blueprint, _state = await _load(repo, user_id, session_id)
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
    agent_id = settings.agent_for_npc(npc_id, gender_of(character.name))
    if not agent_id or not voice_client.configured:
        raise AIConfigError(
            "Voice is not configured. Set ELEVENLABS_API_KEY and an agent id for this character.",
            code="voice_not_configured",
        )

    voice = await repo.get_active_voice_session(session_id, npc_id)
    created_here = False
    if voice is None:
        voice = await repo.create_voice_session(
            session_id=session_id,
            user_id=user_id,
            npc_id=npc_id,
            agent_config_key=agent_id,
            metadata={"client_request_id": client_request_id} if client_request_id else {},
        )
        created_here = True
        if voice is None:  # lost a race against a concurrent start
            voice = await repo.get_active_voice_session(session_id, npc_id)
            if voice is None:
                raise ConflictError(
                    "Could not create a voice session.", code="voice_session_conflict"
                )

    voice_session_id = str(voice["id"])
    try:
        token = await voice_client.create_conversation_token(agent_id)
    except Exception:
        if created_here:
            await repo.set_voice_session_status(
                voice_session_id, "failed", end_reason="token_mint_failed", ended=True
            )
            await repo.session.commit()
        raise

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
    }


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
    return {"id": str(row["id"]), "duplicate": False}


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
