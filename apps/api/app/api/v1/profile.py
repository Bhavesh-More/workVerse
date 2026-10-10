"""Profile and progress endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Body

from app.deps import CurrentUser, Repo
from app.schemas.api import ProfileUpdate, SkillCreate
from app.services import profile_service

router = APIRouter(tags=["profile"])


@router.get("/me")
async def get_me(principal: CurrentUser, repo: Repo) -> dict:
    return await profile_service.get_me(repo, principal.user_id, principal.email)


@router.patch("/me")
async def patch_me(principal: CurrentUser, repo: Repo, body: ProfileUpdate = Body(...)) -> dict:
    fields = body.model_dump(exclude_unset=True)
    return await profile_service.update_me(repo, principal.user_id, fields)


@router.get("/me/skills")
async def list_skills(principal: CurrentUser, repo: Repo) -> dict:
    return {"items": await repo.list_skills(principal.user_id)}


@router.post("/me/skills", status_code=201)
async def add_skill(principal: CurrentUser, repo: Repo, body: SkillCreate) -> dict:
    return await repo.add_skill(principal.user_id, body.name, body.level_self_reported)


@router.delete("/me/skills/{skill_id}", status_code=204)
async def delete_skill(principal: CurrentUser, repo: Repo, skill_id: str) -> None:
    await repo.delete_skill(principal.user_id, skill_id)


@router.get("/progress")
async def progress(principal: CurrentUser, repo: Repo) -> dict:
    sessions = await repo.list_sessions(principal.user_id)
    evaluations = await repo.user_progress(principal.user_id)
    return {
        "sessions": [
            {
                "id": str(s["id"]),
                "status": s["status"],
                "difficulty": s["difficulty"],
                "created_at": s["created_at"],
            }
            for s in sessions
        ],
        "evaluations": [
            {
                "session_id": str(e["session_id"]),
                "overall_score": float(e["overall_score"])
                if e["overall_score"] is not None
                else None,
                "rubric_version": e["rubric_version"],
                "difficulty": e["difficulty"],
                "completed_at": e["completed_at"],
            }
            for e in evaluations
        ],
    }


@router.get("/progress/competencies")
async def competencies(principal: CurrentUser, repo: Repo) -> dict:
    rows = await repo.competency_trends(principal.user_id)
    return {
        "items": [
            {
                "criterion_id": r["criterion_id"],
                "criterion_name": r["criterion_name"],
                "attempts": int(r["attempts"]),
                "average_score": round(float(r["avg_score"]), 2) if r["avg_score"] is not None else None,
                "score_max": int(r["score_max"]),
                "rubric_version": r["rubric_version"],
                "sufficient_data": int(r["attempts"]) >= 2,
            }
            for r in rows
        ]
    }
