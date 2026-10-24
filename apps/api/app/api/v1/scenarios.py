"""Scenario catalogue and instance endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Body

from app.deps import AIDep, CurrentUser, Repo
from app.schemas.api import CreateInstanceRequest
from app.services import scenario_service

router = APIRouter(tags=["scenarios"])


@router.get("/scenario-templates")
async def list_templates(principal: CurrentUser, repo: Repo) -> dict:
    profile = await repo.get_profile(principal.user_id)
    rows = await scenario_service.list_catalog(repo, role=(profile or {}).get("target_role"))
    return {
        "items": [
            {
                "id": str(r["id"]),
                "slug": r["slug"],
                "title": r["title"],
                "summary": r["summary"],
                "categories": r["categories"],
                "target_roles": r["target_roles"],
                "supported_modes": r["supported_modes"],
                "estimated_minutes": r["estimated_minutes"],
                "difficulty_options": ["introductory", "standard", "challenging"],
                **{
                    k: r[k]
                    for k in ("story", "you_will", "people", "skills", "report", "track", "track_label")
                    if k in r
                },
            }
            for r in rows
        ]
    }


@router.post("/scenario-instances", status_code=201)
async def create_instance(
    principal: CurrentUser, repo: Repo, ai: AIDep, body: CreateInstanceRequest = Body(...)
) -> dict:
    profile = await repo.get_profile(principal.user_id)
    return await scenario_service.create_instance(
        repo=repo,
        ai=ai,
        user_id=principal.user_id,
        profile=profile,
        template_slug=body.template_slug,
        mode=body.mode,
        difficulty=body.difficulty,
        learning_objectives=body.learning_objectives,
        incident=body.incident,
        variation_request=body.variation_request,
    )


@router.get("/scenario-instances/{instance_id}")
async def get_instance(principal: CurrentUser, repo: Repo, instance_id: str) -> dict:
    return await scenario_service.get_instance(repo, principal.user_id, instance_id)
