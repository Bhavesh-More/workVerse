"""Conversation turn orchestration: deterministic disclosure + hosted model dialogue."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.ollama_cloud import OllamaCloudClient
from app.agents.prompts import build_character_messages, build_intent_messages
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.db.repository import Repository
from app.schemas.ai import IntentInterpretation
from app.services.fact_check import facts_stated
from app.services.session_service import _load, _persist_pending_events, session_view
from app.simulation.engine import apply_disclosure, reveal_facts

logger = logging.getLogger(__name__)

MAX_CONTEXT_CHARS = 1200
ACTION_HINTS = (
    "roll back",
    "rollback",
    "revert",
    "forward fix",
    "hotfix",
    "migration",
    "compat",
    "restart",
    "status update",
    "send update",
    "follow up",
    "follow-up",
    "inspect",
    "logs",
    "deploy",
    "runbook",
    "metrics",
    "pipeline",
    "backfill",
    "patch",
    "flag",
    "turn off",
    "release",
    "checklist",
    "playbook",
)


async def handle_turn(
    *,
    repo: Repository,
    ai: OllamaCloudClient,
    user_id: str,
    session_id: str,
    client_turn_id: str,
    expected_state_version: int,
    character_id: str,
    message: str,
    modality: str = "text",
) -> dict[str, Any]:
    row, blueprint, state = await _load(repo, user_id, session_id, for_update=True)

    character = blueprint.character(character_id)
    if character is None:
        raise ValidationAppError(f"Unknown character '{character_id}'.", code="unknown_character")

    if row["status"] != "active":
        raise ConflictError("This session is not active.", code="session_not_active")

    # Idempotency: if this turn already produced a character reply, return it.
    existing_learner = await repo.get_message_by_client_turn(session_id, client_turn_id)
    if existing_learner is not None:
        messages = await repo.list_messages(session_id)
        reply = next(
            (
                m
                for m in messages
                if m["speaker_type"] == "character"
                and str(m.get("turn_id") or "") == client_turn_id
            ),
            None,
        )
        if reply is not None:
            return {
                "turn_id": client_turn_id,
                "duplicate": True,
                "state_version": int(row["state_version"]),
                "assistant_message_id": str(reply["id"]),
                "character_id": character_id,
                "message": reply["content"],
                "suggested_actions": [],
                "newly_discovered_facts": [],
                "session": session_view(row, blueprint, state),
            }

    if int(expected_state_version) != int(row["state_version"]):
        raise ConflictError(
            "The session state changed. Refresh and try again.",
            code="session_version_conflict",
            details={"current_state_version": int(row["state_version"])},
        )

    if existing_learner is None:
        seq = await repo.next_message_sequence(session_id)
        await repo.insert_message(
            session_id=session_id,
            sequence_number=seq,
            turn_id=client_turn_id,
            client_turn_id=client_turn_id,
            speaker_type="learner",
            character_id=character_id,
            content=message[:MAX_CONTEXT_CHARS],
            modality=modality,
            metadata={},
        )

    # Deterministic information disclosure (committed only if generation succeeds).
    newly_revealed, disclosure_events = apply_disclosure(blueprint, state, character_id, message)

    recent = await repo.list_messages(session_id)
    recent_messages = _to_model_messages(recent, character_id)
    prompt = build_character_messages(
        blueprint, state, character, recent_messages, message, newly_revealed
    )

    result = await ai.chat(prompt, max_tokens=160, temperature=0.7)

    # Persist assistant message
    seq = await repo.next_message_sequence(session_id)
    assistant = await repo.insert_message(
        session_id=session_id,
        sequence_number=seq,
        turn_id=client_turn_id,
        client_turn_id=None,
        speaker_type="character",
        character_id=character_id,
        content=result.content.strip()[:5000],
        metadata={
            "model": result.model,
            "latency_ms": result.latency_ms,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
        },
    )

    # Facts the colleague volunteered in the reply count too, not only ones the question keyed.
    told, told_events = reveal_facts(
        blueprint, state, character_id, await facts_stated(ai, blueprint, state, character_id, result.content)
    )
    newly_revealed += told
    disclosure_events += told_events

    state.active_character_id = character_id
    persisted = await _persist_pending_events(repo, session_id, state, disclosure_events)
    saved = await repo.save_session_state(
        session_id=session_id,
        expected_version=int(row["state_version"]),
        new_version=state.state_version,
        state=state.model_dump(),
    )
    if saved is None:
        raise ConflictError("The session changed while generating a reply.", code="session_version_conflict")

    suggested = await _suggest_actions(ai, blueprint, state, message)

    return {
        "turn_id": client_turn_id,
        "duplicate": False,
        "state_version": state.state_version,
        "assistant_message_id": str(assistant["id"]),
        "character_id": character_id,
        "message": assistant["content"],
        "suggested_actions": suggested,
        "newly_discovered_facts": newly_revealed,
        "events": persisted,
        "session": session_view(saved, blueprint, state),
    }


def _to_model_messages(messages: list[dict[str, Any]], character_id: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for m in messages:
        # Only this character's thread: questions asked to someone else were never heard here.
        if m["speaker_type"] == "learner" and m.get("character_id") == character_id:
            out.append({"role": "user", "content": m["content"][:MAX_CONTEXT_CHARS]})
        elif m["speaker_type"] == "character" and m.get("character_id") == character_id:
            out.append({"role": "assistant", "content": m["content"][:MAX_CONTEXT_CHARS]})
    return out


async def _suggest_actions(
    ai: OllamaCloudClient, blueprint: Any, state: Any, message: str
) -> list[dict[str, str]]:
    text = message.lower()
    if not any(hint in text for hint in ACTION_HINTS):
        return []
    try:
        data = await ai.chat_json(build_intent_messages(blueprint, state, message), max_tokens=120)
        parsed = IntentInterpretation.model_validate(data)
    except Exception:  # noqa: BLE001 - suggestions are best-effort
        return []
    if not parsed.action_id:
        return []
    action = blueprint.action(parsed.action_id)
    if action is None:
        return []
    if action.id not in state.available_actions and not action.initially_available:
        return []
    return [
        {
            "id": action.id,
            "label": action.label,
            "action_type": action.action_type,
            "confidence": str(round(parsed.confidence, 2)),
        }
    ]


async def ensure_session_owned(repo: Repository, user_id: str, session_id: str) -> None:
    row = await repo.get_session(session_id)
    if row is None or str(row["user_id"]) != str(user_id):
        raise NotFoundError("Session not found.")
