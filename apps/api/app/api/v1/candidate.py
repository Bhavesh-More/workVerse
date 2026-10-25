"""Company assessments, candidate side: invitations grouped by company, the briefing, and the
explicit steps accept -> start. Nothing here starts a test except POST .../start.

Access: an invitation is visible to the profile it is linked to, or (while unlinked) to whoever
has its address as a verified email. Anything else is a 404, never a 403, so ids can't be probed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.company import CRepo
from app.company import lifecycle
from app.company.analytics import SKILLS
from app.company.judges import ROLE_LABELS, avatar_portrait
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.db.session import get_db
from app.deps import AIDep, CurrentUser, Repo, SettingsDep
from app.notifications import (
    NotificationRepository,
    notify_company,
    notify_company_response,
    resolve_email,
)
from app.services import scenario_service, session_service
from app.simulation.tracks import TRACKS

router = APIRouter(tags=["candidate-assessments"])

ESTIMATED_MINUTES = 15


async def _nrepo(session: Annotated[AsyncSession, Depends(get_db)]) -> NotificationRepository:
    return NotificationRepository(session)


NRepo = Annotated[NotificationRepository, Depends(_nrepo)]


async def _email(request: Request, principal: Any, nrepo: NotificationRepository, settings: Any) -> str | None:
    return await resolve_email(
        nrepo, settings, principal.user_id, getattr(request.state, "clerk_user_id", None), principal.email if principal.dev else None
    )


def _iso(v: Any) -> str | None:
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else v


def company_profile(row: dict[str, Any]) -> dict[str, Any]:
    """What a company shares with invited candidates (only fields it filled in)."""
    return {
        "id": str(row["company_id"]),
        "name": row["company_name"],
        "tagline": row.get("tagline") or "",
        "about": row.get("about") or "",
        "mission": row.get("mission") or "",
        "vision": row.get("vision") or "",
        "values": row.get("company_values") or "",
        "industry": row.get("industry") or "",
        "website": row.get("website") or "",
    }


def _team(row: dict[str, Any]) -> list[dict[str, Any]]:
    """The AI colleagues in this assessment (the company's judges picked for the topic)."""
    roster = row.get("judge_roster") or []
    ids = row.get("judge_ids")
    return [
        {"name": j["name"], "role": ROLE_LABELS.get(j["role"], j["role"]), "portrait": avatar_portrait(j.get("avatar"))}
        for j in roster
        if ids is None or j["id"] in ids
    ]


def assignment(row: dict[str, Any], now: datetime, *, full: bool = False) -> dict[str, Any]:
    st = lifecycle.stage(row, now)
    out: dict[str, Any] = {
        "id": str(row["id"]),
        "assessment_id": str(row["assessment_id"]),
        "company_id": str(row["company_id"]),
        "company_name": row["company_name"],
        "title": row["title"],
        "description": row.get("description") or row.get("topic_description") or "",
        "skills": [{"id": s, "name": SKILLS[s][0]} for s in (row.get("skills") or []) if s in SKILLS],
        "due_at": _iso(row.get("due_at")),
        "timezone": row.get("timezone"),
        "invited_at": _iso(row.get("sent_at") or row.get("created_at")),
        "accepted_at": _iso(row.get("accepted_at")),
        "started_at": _iso(row.get("started_at")),
        "submitted_at": _iso(row.get("ended_at")) if st["attempt"] in ("submitted", "evaluated") else None,
        "session_id": str(row["session_id"]) if row.get("session_id") else None,
        "estimated_minutes": ESTIMATED_MINUTES,
        "state": st,
    }
    if full:
        track = TRACKS.get(row.get("track") or "backend", TRACKS["backend"])
        out |= {
            "expectations": row.get("expectations") or "",
            "instructions": row.get("instructions") or "",
            "message": row.get("message") or "",
            "skills": [{"id": s, "name": SKILLS[s][0], "description": SKILLS[s][1]} for s in (row.get("skills") or []) if s in SKILLS]
            or [{"id": k, "name": v[0], "description": v[1]} for k, v in SKILLS.items()],
            "skills_chosen": bool(row.get("skills")),
            "scenario": {
                "title": row.get("topic_title") or "",
                "summary": row.get("topic_description") or "",
                "kind": track["label"],
                "difficulty": row.get("difficulty") or "standard",
            },
            "team": _team(row),
            "sent_to": row["email"],
            "declined_at": _iso(row.get("declined_at")),
            "revoked_at": _iso(row.get("revoked_at")),
            "company": company_profile(row),
            "timed": False,
        }
    return out


def _sorted(rows: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: lifecycle.sort_key(r, lifecycle.stage(r, now)))


def _companies(rows: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for r in _sorted(rows, now):
        st = lifecycle.stage(r, now)
        g = groups.setdefault(
            str(r["company_id"]),
            {**company_profile(r), "total": 0, "pending": 0, "attention": 0, "active": 0, "done": 0, "next_due": None, "next_title": None, "top_stage": st["stage"]},
        )
        g["total"] += 1
        g["pending"] += st["stage"] == "invited"
        g["attention"] += st["stage"] in ("invited", "in_progress", "ready")
        g["active"] += st["stage"] in ("invited", "in_progress", "ready")
        g["done"] += st["stage"] in ("submitted", "evaluated")
        due = lifecycle._aware(r.get("due_at"))
        if due and due > now and st["stage"] in ("invited", "ready", "in_progress") and (g["next_due"] is None or due.isoformat() < g["next_due"]):
            g["next_due"], g["next_title"] = due.isoformat(), r["title"]
    return sorted(groups.values(), key=lambda g: (-g["attention"], g["next_due"] or "9999", g["name"].lower()))


@router.get("/me/company-assessments")
async def overview(request: Request, principal: CurrentUser, crepo: CRepo, nrepo: NRepo, settings: SettingsDep) -> dict:
    email = await _email(request, principal, nrepo, settings)
    now = datetime.now(UTC)
    rows = await crepo.candidate_invites(principal.user_id, email)
    return {
        "companies": _companies(rows, now),
        "assignments": [assignment(r, now) for r in _sorted(rows, now)],
        "now": now.isoformat(),
    }


@router.get("/me/company-assessments/companies/{company_id}")
async def company_view(request: Request, principal: CurrentUser, crepo: CRepo, nrepo: NRepo, settings: SettingsDep, company_id: str) -> dict:
    email = await _email(request, principal, nrepo, settings)
    now = datetime.now(UTC)
    rows = [r for r in await crepo.candidate_invites(principal.user_id, email) if str(r["company_id"]) == company_id]
    if not rows:
        raise NotFoundError("No assessments from this company.", code="company_not_found")
    return {"company": company_profile(rows[0]), "assignments": [assignment(r, now) for r in _sorted(rows, now)], "now": now.isoformat()}


async def _mine(request: Request, principal: Any, crepo: Any, nrepo: NotificationRepository, settings: Any, invite_id: str, *, lock: bool = False) -> dict[str, Any]:
    try:
        uuid.UUID(invite_id)
    except ValueError as exc:
        raise NotFoundError("Assessment not found.", code="assignment_not_found") from exc
    email = await _email(request, principal, nrepo, settings)
    row = await crepo.candidate_invite(invite_id, principal.user_id, email, lock=lock)
    if row is None:
        raise NotFoundError("Assessment not found.", code="assignment_not_found")
    return row


@router.get("/me/company-assessments/{invite_id}")
async def briefing(request: Request, principal: CurrentUser, crepo: CRepo, nrepo: NRepo, settings: SettingsDep, invite_id: str) -> dict:
    """The full briefing. Read-only: viewing never accepts or starts anything."""
    row = await _mine(request, principal, crepo, nrepo, settings, invite_id)
    return {"assignment": assignment(row, datetime.now(UTC), full=True)}


@router.post("/me/company-assessments/{invite_id}/accept")
async def accept(request: Request, principal: CurrentUser, crepo: CRepo, nrepo: NRepo, settings: SettingsDep, invite_id: str) -> dict:
    """Accept: the assessment joins Company assessments. Idempotent; never starts the test."""
    row = await _mine(request, principal, crepo, nrepo, settings, invite_id, lock=True)
    st = lifecycle.stage(row, datetime.now(UTC))
    if row["status"] == "accepted":
        return {"assignment": assignment(row, datetime.now(UTC), full=True), "changed": False}
    if not st["can_accept"]:
        raise ConflictError(st["note"] or "This invitation can no longer be accepted.", code=f"invitation_{st['stage']}")
    await crepo.accept_invite(invite_id, principal.user_id)
    await notify_company_response(crepo.session, invite_id, "invite_accepted")
    await nrepo.mark_for_invite(principal.user_id, invite_id)
    row = await _mine(request, principal, crepo, nrepo, settings, invite_id)
    return {"assignment": assignment(row, datetime.now(UTC), full=True), "changed": True}


class DeclineBody(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


@router.post("/me/company-assessments/{invite_id}/decline")
async def decline(request: Request, principal: CurrentUser, crepo: CRepo, nrepo: NRepo, settings: SettingsDep, invite_id: str, body: DeclineBody) -> dict:
    row = await _mine(request, principal, crepo, nrepo, settings, invite_id, lock=True)
    if row["status"] == "declined":
        return {"assignment": assignment(row, datetime.now(UTC), full=True), "changed": False}
    if not lifecycle.stage(row, datetime.now(UTC))["can_decline"]:
        raise ConflictError("Only a pending invitation can be declined.", code="invitation_not_pending")
    await crepo.decline_invite(invite_id, principal.user_id, (body.reason or "").strip() or None)
    await notify_company_response(crepo.session, invite_id, "invite_declined")
    await nrepo.mark_for_invite(principal.user_id, invite_id)
    row = await _mine(request, principal, crepo, nrepo, settings, invite_id)
    return {"assignment": assignment(row, datetime.now(UTC), full=True), "changed": True}


@router.post("/me/company-assessments/{invite_id}/start")
async def start(request: Request, principal: CurrentUser, crepo: CRepo, repo: Repo, ai: AIDep, nrepo: NRepo, settings: SettingsDep, invite_id: str) -> dict:
    """The one deliberate step that creates the attempt. Repeats return the same attempt."""
    row = await _mine(request, principal, crepo, nrepo, settings, invite_id, lock=True)
    st = lifecycle.stage(row, datetime.now(UTC))
    if row.get("session_id"):
        session = await repo.get_session(str(row["session_id"]))
        if session is not None:
            return {"session_id": str(session["id"]), "scenario_instance_id": str(session["scenario_version_id"]), "status": session["status"], "resumed": True}
    if st["stage"] == "invited":
        raise ConflictError("Accept the invitation before starting.", code="invitation_not_accepted")
    if not st["can_start"]:
        raise ConflictError(st["note"] or "This assessment can't be started.", code=f"assessment_{st['stage']}")
    if row.get("profile_id") and str(row["profile_id"]) != str(principal.user_id):
        raise ForbiddenError("This invitation belongs to another account.", code="invite_claimed")
    company = await crepo.get_company(str(row["company_id"]))
    topic = await crepo.get_topic(str(row["company_id"]), str(row["topic_id"]))
    if company is None or topic is None:
        raise NotFoundError("This assessment is no longer available.")
    from app.api.v1.workplace import published_world_for

    profile = await repo.get_profile(principal.user_id)
    instance = await scenario_service.create_instance(
        repo=repo, ai=ai, user_id=principal.user_id, profile=profile, topic=topic, company=company,
        world=await published_world_for(crepo, company),
    )
    session = await session_service.start_session(repo=repo, user_id=principal.user_id, scenario_instance_id=instance["scenario_instance_id"], mode="quick")
    await crepo.set_invite_session(invite_id, str(session["id"]))
    await notify_company(crepo.session, str(session["id"]), "candidate_started")
    return {"session_id": str(session["id"]), "scenario_instance_id": instance["scenario_instance_id"], "status": "active", "resumed": False}


@router.post("/invites/{token}/claim")
async def claim(principal: CurrentUser, crepo: CRepo, token: str) -> dict:
    """The emailed link, signed in: link the invitation to this account and say where it lives.
    Opening the link never accepts or starts the assessment."""
    inv = await crepo.get_invite_by_token(token)
    if inv is None:
        raise NotFoundError("This invite link is not valid.", code="invite_not_found")
    if await crepo.link_invite(str(inv["id"]), principal.user_id) is None:
        raise ForbiddenError(
            "This invitation is already linked to a different WorkVerse account. Sign in with that account to see it.",
            code="invite_claimed",
        )
    return {"invite_id": str(inv["id"])}
