"""Real-time voice endpoints and the ElevenAgents custom-LLM bridge.

User endpoints are authenticated with the same Clerk principal as the rest of the app and
enforce ownership of the WorkVerse session. The bridge endpoint is authenticated separately
with the shared secret configured in the ElevenLabs Custom LLM settings.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Body, Request
from fastapi.responses import StreamingResponse

from app.core.errors import AIConfigError, AuthError, ConflictError, ValidationAppError
from app.core.voice_grant import verify_grant
from app.db.repository import Repository
from app.db.session import session_scope
from app.deps import AIDep, CurrentUser, Repo, SettingsDep, VoiceDep
from app.schemas.api import (
    EndVoiceSessionRequest,
    StartVoiceSessionRequest,
    VoiceMessageRequest,
)
from app.schemas.runtime import SimulationState
from app.services import voice_llm, voice_service
from app.services.scenario_service import load_blueprint
from app.services.session_service import _persist_pending_events
from app.simulation.engine import apply_disclosure

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])

MAX_BRIDGE_BODY_BYTES = 262_144


@router.post("/sessions/{session_id}/voice-sessions", status_code=201)
async def start_voice_session(
    principal: CurrentUser,
    repo: Repo,
    settings: SettingsDep,
    voice: VoiceDep,
    session_id: str,
    body: StartVoiceSessionRequest = Body(...),
) -> dict:
    return await voice_service.start_voice_session(
        repo=repo,
        voice_client=voice,
        settings=settings,
        user_id=principal.user_id,
        session_id=session_id,
        npc_id=body.npc_id,
        client_request_id=str(body.client_request_id) if body.client_request_id else None,
    )


@router.get("/sessions/{session_id}/voice-sessions/{voice_session_id}")
async def get_voice_session(
    principal: CurrentUser, repo: Repo, session_id: str, voice_session_id: str
) -> dict:
    return await voice_service.get_voice_session_view(
        repo, principal.user_id, session_id, voice_session_id
    )


@router.post("/sessions/{session_id}/voice-sessions/{voice_session_id}/messages", status_code=201)
async def ingest_voice_message(
    principal: CurrentUser,
    repo: Repo,
    session_id: str,
    voice_session_id: str,
    ai: AIDep,
    body: VoiceMessageRequest = Body(...),
) -> dict:
    return await voice_service.ingest_transcript_message(
        repo=repo,
        ai=ai,
        user_id=principal.user_id,
        session_id=session_id,
        voice_session_id=voice_session_id,
        speaker=body.speaker,
        text=body.text,
        provider_message_id=body.provider_message_id,
        provider_conversation_id=body.provider_conversation_id,
        sequence=body.sequence,
    )


@router.post("/sessions/{session_id}/voice-sessions/{voice_session_id}/end")
async def end_voice_session(
    principal: CurrentUser,
    repo: Repo,
    session_id: str,
    voice_session_id: str,
    body: EndVoiceSessionRequest = Body(default=EndVoiceSessionRequest()),
) -> dict:
    return await voice_service.end_voice_session(
        repo,
        principal.user_id,
        session_id,
        voice_session_id,
        reason=body.reason,
    )


async def _bridge_context(
    settings: SettingsDep, grant_token: str, eleven_messages: list[dict]
) -> list[dict[str, str]]:
    """Resolve the grant to authorized context, persist deterministic disclosure, return messages.

    No AI network call happens while the database session is open.
    """
    if not settings.voice_context_grant_secret:
        raise AIConfigError("Voice context grants are not configured.", code="voice_not_configured")
    grant = verify_grant(settings.voice_context_grant_secret, grant_token)
    async with session_scope() as db:
        repo = Repository(db)
        voice = await repo.get_voice_session(grant.voice_session_id)
        if (
            voice is None
            or str(voice["session_id"]) != grant.session_id
            or str(voice["user_id"]) != grant.user_id
            or str(voice["npc_id"]) != grant.npc_id
        ):
            raise AuthError("Voice context grant does not match a live voice session.")
        if voice["status"] in {"ended", "failed", "expired"}:
            raise ConflictError("This voice session has ended.", code="voice_session_ended")

        row = await repo.get_session(grant.session_id)
        if row is None or str(row["user_id"]) != grant.user_id:
            raise AuthError("Voice context grant does not match an owned session.")
        if row["status"] != "active":
            raise ConflictError("This session is not active.", code="session_not_active")

        blueprint, _ = await load_blueprint(repo, str(row["scenario_version_id"]))
        state = SimulationState.model_validate(row.get("state") or {})
        character = blueprint.character(grant.npc_id)
        if character is None:
            raise AuthError("Voice context grant references an unknown character.")

        latest = voice_llm.latest_user_message(eleven_messages)
        newly: list[str] = []
        if latest:
            newly, events = apply_disclosure(blueprint, state, grant.npc_id, latest)
            if newly:
                await _persist_pending_events(repo, grant.session_id, state, events)
                await repo.save_session_state(
                    session_id=grant.session_id,
                    expected_version=int(row["state_version"]),
                    new_version=state.state_version,
                    state=state.model_dump(),
                )

        return voice_llm.build_voice_messages(
            blueprint,
            state,
            character,
            eleven_messages,
            newly_revealed_fact_ids=newly,
            max_history=settings.voice_llm_max_history_messages,
            max_history_chars=settings.voice_llm_max_history_chars,
        )


# ElevenLabs Custom LLM treats the Server URL as an OpenAI-style base URL; accept the bare path
# and the /chat/completions forms so either dashboard entry works.
@router.post("/voice/llm")
@router.post("/voice/llm/chat/completions")
@router.post("/voice/llm/v1/chat/completions")
async def voice_llm_bridge(request: Request, settings: SettingsDep, ai: AIDep) -> StreamingResponse:
    voice_llm.verify_bridge_secret(settings, request.headers)

    raw = await request.body()
    if len(raw) > MAX_BRIDGE_BODY_BYTES:
        raise AIConfigError("Voice bridge request is too large.", code="payload_too_large")
    try:
        body = json.loads(raw or b"{}")
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValidationAppError("The bridge request was not valid JSON.") from exc
    if not isinstance(body, dict):
        raise ValidationAppError("The bridge request must be a JSON object.")

    messages = body.get("messages")
    if not isinstance(messages, list):
        raise ValidationAppError("The bridge request is missing a messages array.")
    voice_llm.validate_bridge_request(body, messages)

    grant_token = voice_llm.extract_grant(body, messages)
    if not grant_token:
        raise AuthError("Missing voice context grant.")

    out_messages = await _bridge_context(settings, grant_token, messages)
    stream = voice_llm.stream_response(
        out_messages,
        ai,
        model=settings.ollama_model,
        max_tokens=settings.voice_llm_max_output_tokens,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
