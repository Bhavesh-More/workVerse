"""Session lifecycle, world actions, conversation turns and evaluation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Body
from sqlalchemy import text

from app.core.errors import ConflictError, NotFoundError
from app.deps import AIDep, CurrentUser, Repo
from app.evaluation.evaluator import evaluation_view
from app.schemas.api import ActionRequest, CompleteRequest, StartSessionRequest, TurnRequest
from app.services import chat_service, scenario_service, session_service

router = APIRouter(tags=["sessions"])


@router.post("/sessions", status_code=201)
async def start_session(principal: CurrentUser, repo: Repo, body: StartSessionRequest) -> dict:
    return await session_service.start_session(
        repo=repo,
        user_id=principal.user_id,
        scenario_instance_id=str(body.scenario_instance_id),
        mode=body.mode,
    )


@router.get("/sessions")
async def list_sessions(principal: CurrentUser, repo: Repo) -> dict:
    return {"items": await session_service.list_sessions(repo, principal.user_id)}


@router.get("/sessions/{session_id}")
async def get_session(principal: CurrentUser, repo: Repo, session_id: str) -> dict:
    return await session_service.get_session_view(repo, principal.user_id, session_id)


@router.get("/sessions/{session_id}/state")
async def get_state(principal: CurrentUser, repo: Repo, session_id: str) -> dict:
    return await session_service.get_session_view(repo, principal.user_id, session_id)


@router.post("/sessions/{session_id}/actions")
async def submit_action(
    principal: CurrentUser, repo: Repo, session_id: str, body: ActionRequest = Body(...)
) -> dict:
    return await session_service.apply_world_action(
        repo=repo,
        user_id=principal.user_id,
        session_id=session_id,
        client_action_id=str(body.client_action_id),
        expected_state_version=body.expected_state_version,
        action_id=body.type,
        payload=body.payload,
    )


@router.post("/sessions/{session_id}/characters/{character_id}/skip")
async def skip_character(principal: CurrentUser, repo: Repo, session_id: str, character_id: str) -> dict:
    return await session_service.skip_character(
        repo=repo, user_id=principal.user_id, session_id=session_id, character_id=character_id
    )


@router.post("/sessions/{session_id}/turns")
async def submit_turn(
    principal: CurrentUser, repo: Repo, ai: AIDep, session_id: str, body: TurnRequest = Body(...)
) -> dict:
    return await chat_service.handle_turn(
        repo=repo,
        ai=ai,
        user_id=principal.user_id,
        session_id=session_id,
        client_turn_id=str(body.client_turn_id),
        expected_state_version=body.expected_state_version,
        character_id=body.character_id,
        message=body.message,
        modality=body.modality,
    )


@router.get("/sessions/{session_id}/transcript")
async def transcript(principal: CurrentUser, repo: Repo, session_id: str) -> dict:
    return {"items": await session_service.list_messages(repo, principal.user_id, session_id)}


@router.get("/sessions/{session_id}/events")
async def events(principal: CurrentUser, repo: Repo, session_id: str) -> dict:
    return {"items": await session_service.list_events(repo, principal.user_id, session_id)}


@router.post("/sessions/{session_id}/complete")
async def complete(
    principal: CurrentUser, repo: Repo, ai: AIDep, session_id: str, body: CompleteRequest = Body(...)
) -> dict:
    return await session_service.complete_session(
        repo=repo,
        ai=ai,
        user_id=principal.user_id,
        session_id=session_id,
        expected_state_version=body.expected_state_version,
        force=body.force,
    )


@router.get("/sessions/{session_id}/evaluation")
async def get_evaluation(principal: CurrentUser, repo: Repo, session_id: str) -> dict:
    row, blueprint, _ = await session_service._load(repo, principal.user_id, session_id)
    evaluation = await repo.get_evaluation(session_id)
    if evaluation is None:
        raise NotFoundError("No evaluation is available for this session yet.")
    return await evaluation_view(repo, evaluation, blueprint)


@router.post("/sessions/{session_id}/evaluate")
async def evaluate(principal: CurrentUser, repo: Repo, ai: AIDep, session_id: str) -> dict:
    return await session_service.evaluate_session(
        repo=repo, ai=ai, user_id=principal.user_id, session_id=session_id
    )


@router.post("/sessions/{session_id}/retry", status_code=201)
async def retry(
    principal: CurrentUser, repo: Repo, ai: AIDep, session_id: str
) -> dict:
    row = await repo.get_session(session_id)
    if row is None or str(row["user_id"]) != str(principal.user_id):
        raise NotFoundError("Session not found.")
    # A company assessment is a single submission; practice retries come from Practice.
    linked = await repo.session.execute(text("select 1 from public.assessment_invites where session_id = :sid"), {"sid": session_id})
    if linked.first() is not None:
        raise ConflictError("Company assessments can't be retried.", code="assessment_no_retry")
    version_row = await repo.get_scenario_version(str(row["scenario_version_id"]))
    if version_row is None:
        raise NotFoundError("Scenario version not found.")
    template_id = str(version_row["template_id"])
    templates = await repo.list_templates()
    slug = next((t["slug"] for t in templates if str(t["id"]) == template_id), "production-incident")

    profile = await repo.get_profile(principal.user_id)
    instance = await scenario_service.create_instance(
        repo=repo,
        ai=ai,
        user_id=principal.user_id,
        profile=profile,
        template_slug=slug,
        mode=row["mode"],
        difficulty=version_row["difficulty"],
    )
    new_session = await session_service.start_session(
        repo=repo,
        user_id=principal.user_id,
        scenario_instance_id=instance["scenario_instance_id"],
        mode=row["mode"],
    )
    return {
        "scenario_instance_id": instance["scenario_instance_id"],
        "session": new_session,
        "prebrief": instance["prebrief"],
    }
