"""Authoritative session lifecycle: start, view, actions, completion."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.ollama_cloud import OllamaCloudClient
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.db.repository import Repository
from app.schemas.runtime import SimulationState
from app.services.scenario_service import load_blueprint, world_view
from app.simulation.engine import (
    PendingEvent,
    apply_action,
    build_initial_state,
    completion_status,
)
from app.simulation.navigation import resolve_navigation

logger = logging.getLogger(__name__)
MAX_DELIVERABLE_CHARS = 100_000


def _state_from_row(row: dict[str, Any]) -> SimulationState:
    return SimulationState.model_validate(row.get("state") or {})


async def _load(
    repo: Repository, user_id: str, session_id: str, *, for_update: bool = False
) -> tuple[dict[str, Any], Any, SimulationState]:
    # Optimistic concurrency (state_version) is used instead of a long-lived row lock so
    # that a database transaction is never held open across an AI network call.
    row = await repo.get_session(session_id)
    if row is None:
        raise NotFoundError("Session not found.")
    if str(row["user_id"]) != str(user_id):
        raise ForbiddenError("You do not have access to this session.")
    blueprint, _ = await load_blueprint(repo, str(row["scenario_version_id"]))
    return row, blueprint, _state_from_row(row)


def session_view(row: dict[str, Any], blueprint: Any, state: SimulationState) -> dict[str, Any]:
    label_by_id = {o.id: o.label for o in blueprint.objectives}
    objectives = [
        {
            "id": oid,
            "label": label_by_id.get(oid, oid),
            "status": status,
            "required": next(
                (o.required for o in blueprint.objectives if o.id == oid), True
            ),
        }
        for oid, status in state.objectives.items()
    ]
    known_facts = [
        {"id": fid, "label": blueprint.fact(fid).label, "detail": blueprint.fact(fid).detail}
        for fid in state.facts_known
        if blueprint.fact(fid) is not None
    ]
    return {
        "id": str(row["id"]),
        "status": row["status"],
        "state_version": int(row["state_version"]),
        "current_location_id": state.current_location_id,
        "active_character_id": state.active_character_id,
        "phase": state.phase,
        "objectives": objectives,
        "tasks": state.tasks,
        "facts_known": known_facts,
        "incident": state.incident,
        "available_locations": [loc.id for loc in blueprint.locations],
        "world": world_view(blueprint, state),
        "navigation": resolve_navigation(blueprint, state),
        "completion": completion_status(blueprint, state),
        "completed": bool(state.completed),
    }


async def start_session(
    *,
    repo: Repository,
    user_id: str,
    scenario_instance_id: str,
    mode: str = "quick",
    client_create_key: str | None = None,
) -> dict[str, Any]:
    version_row = await repo.get_scenario_version(scenario_instance_id)
    if version_row is None or str(version_row.get("created_by")) != str(user_id):
        raise NotFoundError("Scenario instance not found.")
    blueprint, _ = await load_blueprint(repo, scenario_instance_id)

    if client_create_key:
        existing = await repo.list_sessions(user_id, limit=200)
        for s in existing:
            if str(s["scenario_version_id"]) == str(scenario_instance_id) and s["status"] == "active":
                row = await repo.get_session(str(s["id"]))
                if row is not None:
                    state = _state_from_row(row)
                    return session_view(row, blueprint, state)

    state = build_initial_state(blueprint, scenario_instance_id)
    state.event_sequence = 1
    row = await repo.create_session(
        user_id=user_id,
        scenario_version_id=scenario_instance_id,
        mode=mode,
        state=state.model_dump(),
        client_create_key=client_create_key,
    )
    await repo.insert_event(
        session_id=str(row["id"]),
        sequence_number=1,
        event_type="session_started",
        actor_type="system",
        actor_id=None,
        payload={"scenario_version_id": scenario_instance_id, "mode": mode},
        state_version_after=1,
    )
    return session_view(row, blueprint, state)


async def get_session_view(repo: Repository, user_id: str, session_id: str) -> dict[str, Any]:
    row, blueprint, state = await _load(repo, user_id, session_id)
    return session_view(row, blueprint, state)


async def list_sessions(repo: Repository, user_id: str) -> list[dict[str, Any]]:
    rows = await repo.list_sessions(user_id)
    results = []
    for row in rows:
        blueprint, _ = await load_blueprint(repo, str(row["scenario_version_id"]))
        results.append(
            {
                "id": str(row["id"]),
                "status": row["status"],
                "mode": row["mode"],
                "difficulty": row["difficulty"],
                "title": blueprint.title,
                "state_version": int(row["state_version"]),
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
                "created_at": row["created_at"],
            }
        )
    return results


async def list_events(repo: Repository, user_id: str, session_id: str) -> list[dict[str, Any]]:
    await _load(repo, user_id, session_id)
    events = await repo.list_events(session_id)
    for e in events:
        e["id"] = str(e["id"])
        e["session_id"] = str(e["session_id"])
        e["created_at"] = e["created_at"].isoformat() if e.get("created_at") else None
    return events


async def list_messages(repo: Repository, user_id: str, session_id: str) -> list[dict[str, Any]]:
    await _load(repo, user_id, session_id)
    messages = await repo.list_messages(session_id)
    for m in messages:
        m["id"] = str(m["id"])
        m["session_id"] = str(m["session_id"])
        m["created_at"] = m["created_at"].isoformat() if m.get("created_at") else None
    return messages


async def _persist_pending_events(
    repo: Repository,
    session_id: str,
    state: SimulationState,
    events: list[PendingEvent],
    *,
    idempotency_key: str | None = None,
) -> list[dict[str, Any]]:
    persisted: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        state.event_sequence += 1
        row = await repo.insert_event(
            session_id=session_id,
            sequence_number=state.event_sequence,
            event_type=event.event_type,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            payload=event.payload,
            state_version_after=state.state_version,
            idempotency_key=idempotency_key if index == 0 else None,
        )
        persisted.append({"id": str(row["id"]), "type": event.event_type})
    return persisted


async def apply_world_action(
    *,
    repo: Repository,
    user_id: str,
    session_id: str,
    client_action_id: str,
    expected_state_version: int,
    action_id: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    row, blueprint, state = await _load(repo, user_id, session_id, for_update=True)

    # Idempotency: a repeated client action id must not duplicate state changes.
    existing_event = await repo.find_event_by_idempotency(session_id, client_action_id)
    if existing_event is not None:
        return {
            "accepted": True,
            "duplicate": True,
            "state_version": int(row["state_version"]),
            "session": session_view(row, blueprint, state),
        }

    if row["status"] != "active":
        raise ConflictError("This session is not active.", code="session_not_active")
    if int(expected_state_version) != int(row["state_version"]):
        raise ConflictError(
            "The session state changed. Refresh and try again.",
            code="session_version_conflict",
            details={"current_state_version": int(row["state_version"])},
        )

    result = apply_action(blueprint, state, action_id, payload)
    if not result.ok:
        state.event_sequence += 1
        await repo.insert_event(
            session_id=session_id,
            sequence_number=state.event_sequence,
            event_type="decision_rejected",
            actor_type="learner",
            actor_id=None,
            idempotency_key=client_action_id,
            payload={
                "action_id": action_id,
                "code": result.code,
                "reason": result.reason,
                "idempotency_key": client_action_id,
            },
            state_version_after=int(row["state_version"]),
        )
        await repo.set_session_status(session_id, row["status"])
        raise ValidationAppError(
            result.reason or "Action not allowed.",
            code="action_rejected",
            details={"action_id": action_id, "blocked_by": result.blocked_by},
        )

    action = blueprint.action(action_id)
    deliverable_id: str | None = None
    text = str(payload.get("text", "")).strip()
    if text and action is not None and action.action_type in ("communicate", "submit"):
        text = text[:MAX_DELIVERABLE_CHARS]
        deliverable = await repo.insert_deliverable(
            session_id=session_id,
            user_id=user_id,
            task_id=action.id,
            inline_text=text,
            result_metadata={"action_id": action.id},
        )
        deliverable_id = str(deliverable["id"])
        seq = await repo.next_message_sequence(session_id)
        await repo.insert_message(
            session_id=session_id,
            sequence_number=seq,
            turn_id=None,
            client_turn_id=None,
            speaker_type="learner",
            character_id=None,
            content=text,
            metadata={"kind": "status_update", "deliverable_id": deliverable_id},
        )
        result.events.append(
            PendingEvent(
                event_type="deliverable_submitted",
                actor_type="learner",
                payload={"task_id": action.id, "deliverable_id": deliverable_id},
            )
        )

    persisted = await _persist_pending_events(
        repo, session_id, state, result.events, idempotency_key=client_action_id
    )
    saved = await repo.save_session_state(
        session_id=session_id,
        expected_version=int(row["state_version"]),
        new_version=state.state_version,
        state=state.model_dump(),
    )
    if saved is None:
        raise ConflictError(
            "The session state changed while processing. Please retry.",
            code="session_version_conflict",
        )

    return {
        "accepted": True,
        "duplicate": False,
        "state_version": state.state_version,
        "state_delta": {
            "current_location_id": state.current_location_id,
            "newly_discovered_fact_ids": result.newly_discovered_fact_ids,
            "completed_objective_ids": result.completed_objective_ids,
            "flags": state.flags,
        },
        "events": persisted,
        "session": session_view(saved, blueprint, state),
    }


async def complete_session(
    *,
    repo: Repository,
    ai: OllamaCloudClient,
    user_id: str,
    session_id: str,
    expected_state_version: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    row, blueprint, state = await _load(repo, user_id, session_id, for_update=True)

    existing = await repo.get_evaluation(session_id)
    if existing is not None and existing["status"] == "completed":
        return {"status": "completed", "evaluation": await _evaluation_view(repo, existing, blueprint)}

    status_info = completion_status(blueprint, state)
    if not status_info["ready"] and not force:
        raise ConflictError(
            "Not all required objectives are complete yet.",
            code="objectives_incomplete",
            details=status_info,
        )

    state.completed = True
    state.state_version += 1
    state.event_sequence += 1
    await repo.insert_event(
        session_id=session_id,
        sequence_number=state.event_sequence,
        event_type="session_completed",
        actor_type="system",
        actor_id=None,
        payload={"forced": force, "missing_objectives": status_info["missing_objectives"]},
        state_version_after=state.state_version,
    )
    from datetime import UTC, datetime

    await repo.save_session_state(
        session_id=session_id,
        expected_version=int(row["state_version"]),
        new_version=state.state_version,
        state=state.model_dump(),
        status="completed",
        ended_at=datetime.now(UTC),
    )

    from app.evaluation.evaluator import generate_evaluation

    evaluation = await generate_evaluation(
        repo=repo,
        ai=ai,
        session_id=session_id,
        blueprint=blueprint,
        state=state,
    )
    return {"status": "completed", "evaluation": evaluation}


async def _evaluation_view(repo: Repository, evaluation_row: dict[str, Any], blueprint: Any) -> dict[str, Any]:
    from app.evaluation.evaluator import evaluation_view

    return await evaluation_view(repo, evaluation_row, blueprint)
