"""Company portal: company profile + SMTP, judge defaults, topics, assessments, invites, reports.

Plus the candidate side of an invite: a public preview by token and an authenticated accept that
starts the candidate's simulation with the topic's judges.
"""

from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.company import analytics, judges, lifecycle
from app.company.judges import MAX_JUDGES
from app.company.report_pdf import build_pdf
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.db.company_repository import CompanyRepository
from app.db.session import get_db
from app.deps import CurrentUser, Repo, SettingsDep
from app.notifications import NotificationRepository
from app.services import mailer, scenario_service

router = APIRouter(tags=["company"])


async def company_repo_dep(session: Annotated[AsyncSession, Depends(get_db)]) -> CompanyRepository:
    return CompanyRepository(session)


CRepo = Annotated[CompanyRepository, Depends(company_repo_dep)]


async def _company(principal: CurrentUser, crepo: CompanyRepository) -> dict[str, Any]:
    company = await crepo.get_company_for_owner(principal.user_id)
    if company is None:
        raise NotFoundError("Create your company first.", code="company_required")
    return company


def _company_view(c: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(c["id"]),
        "name": c["name"],
        "smtp": mailer.public_smtp(c.get("smtp")),
        # Whether email can actually be sent (the company's SMTP, or the app's own).
        "smtp_ready": mailer.smtp_config(c.get("smtp"), get_settings()) is not None,
        "judge_defaults": c.get("judge_defaults") or {},
        "judge_roster": c.get("judge_roster"),
        "world_mode": c.get("world_mode"),
        "profile": {k: c.get(col) or "" for k, col in PROFILE_FIELDS.items()},
        "created_at": c["created_at"].isoformat(),
    }


# ---- company --------------------------------------------------------------------
class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SmtpSettings(BaseModel):
    host: str = Field(default="", max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    username: str = Field(default="", max_length=255)
    # Omitted/None keeps the stored password; "" clears it.
    password: str | None = Field(default=None, max_length=500)
    from_email: str = Field(default="", max_length=320)
    from_name: str = Field(default="", max_length=120)
    security: Literal["starttls", "ssl", "none"] = "starttls"


# Profile shown to invited candidates: API key -> column. All optional.
PROFILE_FIELDS = {"tagline": "tagline", "about": "about", "mission": "mission", "vision": "vision", "values": "company_values", "industry": "industry", "website": "website"}


class CompanyProfile(BaseModel):
    tagline: str = Field(default="", max_length=160)
    about: str = Field(default="", max_length=1200)
    mission: str = Field(default="", max_length=600)
    vision: str = Field(default="", max_length=600)
    values: str = Field(default="", max_length=600)
    industry: str = Field(default="", max_length=80)
    website: str = Field(default="", max_length=200)


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    smtp: SmtpSettings | None = None
    judge_defaults: dict[str, Any] | None = None
    judge_roster: list[Any] | None = None
    profile: CompanyProfile | None = None


@router.get("/company")
async def get_company(principal: CurrentUser, crepo: CRepo) -> dict:
    company = await crepo.get_company_for_owner(principal.user_id)
    return {"company": _company_view(company) if company else None}


@router.post("/company", status_code=201)
async def create_company(principal: CurrentUser, crepo: CRepo, body: CompanyCreate) -> dict:
    return {"company": _company_view(await crepo.create_company(principal.user_id, body.name.strip()))}


@router.patch("/company")
async def update_company(principal: CurrentUser, crepo: CRepo, body: CompanyUpdate) -> dict:
    company = await _company(principal, crepo)
    fields: dict[str, Any] = {}
    if body.name is not None:
        fields["name"] = body.name.strip()
    if body.smtp is not None:
        smtp = body.smtp.model_dump()
        if smtp["password"] is None:
            smtp["password"] = (company.get("smtp") or {}).get("password", "")
        fields["smtp"] = smtp
    if body.judge_defaults is not None:
        if bad := judges.bad_names(body.judge_defaults):
            raise ValidationAppError("Pick judge names from the existing cast.", code="invalid_judge_name", details={"names": bad})
        fields["judge_defaults"] = judges.clean_judges(body.judge_defaults)
    if body.profile is not None:
        p = body.profile.model_dump()
        site = p["website"].strip()
        if site and not re.match(r"^https?://[^\s]+\.[^\s]+$", site):
            if re.match(r"^[^\s/]+\.[^\s]+$", site):
                site = f"https://{site}"
            else:
                raise ValidationAppError("Enter a website like https://example.com.", code="invalid_website")
        p["website"] = site
        fields.update({col: (p[k].strip() or None) for k, col in PROFILE_FIELDS.items()})
    if body.judge_roster is not None:
        try:
            fields["judge_roster"] = judges.clean_roster(body.judge_roster)
        except ValueError as exc:
            raise ValidationAppError(str(exc), code="invalid_judges") from exc
    return {"company": _company_view(await crepo.update_company(str(company["id"]), fields))}


class SmtpTest(BaseModel):
    to: str = Field(min_length=3, max_length=320)


@router.post("/company/smtp/test")
async def smtp_test(principal: CurrentUser, crepo: CRepo, settings: SettingsDep, body: SmtpTest) -> dict:
    company = await _company(principal, crepo)
    cfg = mailer.smtp_config(company.get("smtp"), settings)
    if cfg is None:
        raise ValidationAppError("Add your SMTP settings first.", code="smtp_not_configured")
    [err] = await mailer.send_all(cfg, [mailer.test_email(cfg, body.to, company["name"])])
    return {"ok": err is None, "error": err}


@router.get("/company/judges/catalog")
async def judge_catalog(principal: CurrentUser) -> dict:
    return judges.catalog()


# ---- topics ---------------------------------------------------------------------
class TopicBody(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    track: Literal["backend", "frontend", "data", "product"] = "backend"
    incident: str | None = Field(default=None, max_length=40)
    difficulty: Literal["introductory", "standard", "challenging"] = "standard"
    judges: dict[str, Any] = Field(default_factory=dict)
    # Roster companies: which judges take part (None = all of them).
    judge_ids: list[str] | None = Field(default=None, max_length=MAX_JUDGES)


def _topic_data(body: TopicBody, company: dict[str, Any]) -> dict[str, Any]:
    incidents = {i["id"] for t in judges.catalog()["tracks"] if t["id"] == body.track for i in t["incidents"]}
    roster = company.get("judge_roster")
    if roster:
        try:
            selection = judges.clean_topic_selection(body.judge_ids, roster)
        except ValueError as exc:
            raise ValidationAppError(str(exc), code="no_judges") from exc
        tuned = judges.clean_topic_judges(body.judges, roster)
    else:
        if bad := judges.bad_names(body.judges):
            raise ValidationAppError("Pick judge names from the existing cast.", code="invalid_judge_name", details={"names": bad})
        selection, tuned = None, judges.clean_judges(body.judges)
    return {
        "judge_ids": selection,
        "title": body.title.strip(),
        "description": body.description.strip(),
        "track": body.track,
        "incident": body.incident if body.incident in incidents else None,
        "difficulty": body.difficulty,
        "judges": tuned,
    }


def _topic_view(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(t["id"]),
        "title": t["title"],
        "description": t["description"],
        "track": t["track"],
        "incident": t.get("incident"),
        "difficulty": t["difficulty"],
        "judges": t.get("judges") or {},
        "judge_ids": t.get("judge_ids"),
        "assessment_count": int(t.get("assessment_count") or 0),
        "created_at": t["created_at"].isoformat(),
    }


@router.get("/company/topics")
async def list_topics(principal: CurrentUser, crepo: CRepo) -> dict:
    company = await _company(principal, crepo)
    return {"items": [_topic_view(t) for t in await crepo.list_topics(str(company["id"]))]}


@router.post("/company/topics", status_code=201)
async def create_topic(principal: CurrentUser, crepo: CRepo, body: TopicBody) -> dict:
    company = await _company(principal, crepo)
    return _topic_view(await crepo.insert_topic(str(company["id"]), _topic_data(body, company)))


@router.get("/company/topics/{topic_id}")
async def get_topic(principal: CurrentUser, crepo: CRepo, topic_id: str) -> dict:
    company = await _company(principal, crepo)
    topic = await crepo.get_topic(str(company["id"]), topic_id)
    if topic is None:
        raise NotFoundError("Topic not found.")
    return _topic_view(topic)


@router.get("/company/topics/{topic_id}/preview")
async def preview_topic(principal: CurrentUser, crepo: CRepo, topic_id: str) -> dict:
    """What candidates will get from this topic: the same deterministic scenario build a run uses
    (fixed seed, nothing saved), so the company can check it before assigning it."""
    company = await _company(principal, crepo)
    topic = await crepo.get_topic(str(company["id"]), topic_id)
    if topic is None:
        raise NotFoundError("Topic not found.")
    from app.services.scenario_service import TRACK_ROLES, _build_blueprint
    from app.simulation.validation import validate_blueprint

    bp = _build_blueprint(
        seed=0, difficulty=topic.get("difficulty") or "standard", mode="quick",
        role=TRACK_ROLES.get(topic.get("track") or "backend", "Backend Engineer"),
        variation_request="", profile_goals=[], incident=topic.get("incident"),
    )
    judges.apply_topic(bp, topic, company)
    report = validate_blueprint(bp)
    return {
        "valid": report.ok,
        "title": bp.title,
        "briefing": bp.briefing,
        "role": TRACK_ROLES.get(topic.get("track") or "backend", "Backend Engineer"),
        "team": [{"name": c.name, "role": c.role} for c in bp.characters],
        "objectives": [o.label for o in bp.objectives if o.required],
        "tools": [o.label for o in bp.objects if o.location_id == "engineering_workspace"][:8],
        "skills": [{"id": k, "name": n, "description": d} for k, (n, d) in analytics.SKILLS.items()],
        "estimated_minutes": 15,
    }


@router.put("/company/topics/{topic_id}")
async def update_topic(principal: CurrentUser, crepo: CRepo, topic_id: str, body: TopicBody) -> dict:
    company = await _company(principal, crepo)
    topic = await crepo.update_topic(str(company["id"]), topic_id, _topic_data(body, company))
    if topic is None:
        raise NotFoundError("Topic not found.")
    return _topic_view(topic)


@router.delete("/company/topics/{topic_id}", status_code=204)
async def delete_topic(principal: CurrentUser, crepo: CRepo, topic_id: str) -> Response:
    company = await _company(principal, crepo)
    topics = {str(t["id"]): t for t in await crepo.list_topics(str(company["id"]))}
    if int((topics.get(topic_id) or {}).get("assessment_count") or 0):
        raise ConflictError("This topic is used by an assessment and can't be deleted.", code="topic_in_use")
    await crepo.delete_topic(str(company["id"]), topic_id)
    return Response(status_code=204)


_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


class InviteEntry(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    name: str | None = Field(default=None, max_length=120)


Channel = Literal["app", "email", "both"]


class InviteBody(BaseModel):
    candidates: list[InviteEntry] = Field(min_length=1, max_length=500)
    resend: bool = False
    # "app": a notification inside WorkVerse (and a live popup if they're online); "email": the
    # company's SMTP; "both". The API default stays email for existing integrations.
    channel: Channel = "email"


# ---- assessments ----------------------------------------------------------------
class AssessmentFields(BaseModel):
    description: str = Field(default="", max_length=2000)
    expectations: str = Field(default="", max_length=2000)
    instructions: str = Field(default="", max_length=3000)
    skills: list[str] = Field(default_factory=list, max_length=10)
    # One deadline for everyone, as an absolute instant; timezone is how the company sees it.
    due_at: datetime | None = None
    timezone: str | None = Field(default=None, max_length=64)


class AssessmentCreate(AssessmentFields):
    topic_id: str
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(default="", max_length=2000)
    # Publish in one step: invite these people over `channel` (the wizard's final confirmation).
    candidates: list[InviteEntry] = Field(default_factory=list, max_length=500)
    channel: Channel = "email"
    # Makes publishing idempotent: a retry or double click returns the same assessment.
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


def _clean_fields(body: AssessmentFields | Any, fields: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in ("description", "expectations", "instructions"):
        if k in fields:
            out[k] = (getattr(body, k) or "").strip()
    if "skills" in fields:
        out["skills"] = [s for s in dict.fromkeys(body.skills) if s in analytics.SKILLS]
    if "timezone" in fields:
        tz = (body.timezone or "").strip() or None
        if tz:
            try:
                ZoneInfo(tz)
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise ValidationAppError("Unknown timezone.", code="invalid_timezone") from exc
        out["timezone"] = tz
    if "due_at" in fields:
        due = body.due_at
        if due is not None and due.tzinfo is None:
            raise ValidationAppError("The due date needs a timezone.", code="invalid_due_at")
        out["due_at"] = due
    return out


def _assessment_view(a: dict[str, Any]) -> dict[str, Any]:
    due = a.get("due_at")
    return {
        "id": str(a["id"]),
        "title": a["title"],
        "message": a.get("message") or "",
        "description": a.get("description") or "",
        "expectations": a.get("expectations") or "",
        "instructions": a.get("instructions") or "",
        "skills": a.get("skills") or [],
        "due_at": due.isoformat() if due else None,
        "timezone": a.get("timezone"),
        "past_due": bool(due and due <= datetime.now(UTC)),
        "closed_at": a["closed_at"].isoformat() if a.get("closed_at") else None,
        "status": a["status"],
        "topic_id": str(a["topic_id"]),
        "topic_title": a.get("topic_title"),
        "track": a.get("track"),
        "invited": int(a.get("invited") or 0),
        "opened": int(a.get("opened") or 0),
        "started": int(a.get("started") or 0),
        "completed": int(a.get("completed") or 0),
        "avg_score": round(float(a["avg_score"]), 1) if a.get("avg_score") is not None else None,
        "created_at": a["created_at"].isoformat(),
    }


@router.get("/company/assessments")
async def list_assessments(principal: CurrentUser, crepo: CRepo) -> dict:
    company = await _company(principal, crepo)
    return {"items": [_assessment_view(a) for a in await crepo.list_assessments(str(company["id"]))]}


@router.post("/company/assessments", status_code=201)
async def create_assessment(principal: CurrentUser, crepo: CRepo, settings: SettingsDep, body: AssessmentCreate) -> dict:
    """Create (and, with candidates, publish) an assessment. Retrying with the same
    client_request_id returns the first result instead of creating a second assessment."""
    company = await _company(principal, crepo)
    if await crepo.get_topic(str(company["id"]), body.topic_id) is None:
        raise NotFoundError("Topic not found.")
    extra = _clean_fields(body, {"description", "expectations", "instructions", "skills", "due_at", "timezone"})
    if extra.get("due_at") and extra["due_at"] <= datetime.now(UTC):
        raise ValidationAppError("The due date is in the past.", code="due_in_past")
    row = await crepo.insert_assessment(
        str(company["id"]), body.topic_id, body.title.strip(), body.message.strip(), {**extra, "client_request_id": body.client_request_id}
    )
    created = row.pop("_created", True)
    delivery = None
    if created and body.candidates:
        a = await crepo.get_assessment(str(company["id"]), str(row["id"]))
        delivery = await _invite_people(settings, company, a, crepo, body.candidates, body.channel, resend=False)  # type: ignore[arg-type]
    return {**_assessment_view(row), "created": created, "delivery": delivery}


async def _assessment_bundle(principal: Any, crepo: CompanyRepository, assessment_id: str) -> tuple[dict, dict, list, dict]:
    company = await _company(principal, crepo)
    a = await crepo.get_assessment(str(company["id"]), assessment_id)
    if a is None:
        raise NotFoundError("Assessment not found.")
    rows = analytics.candidates(await crepo.list_invites(assessment_id), await crepo.invite_item_scores(assessment_id), a)
    return company, a, rows, analytics.summary(rows)


@router.get("/company/assessments/{assessment_id}")
async def get_assessment(principal: CurrentUser, crepo: CRepo, settings: SettingsDep, assessment_id: str) -> dict:
    company, a, rows, sm = await _assessment_bundle(principal, crepo, assessment_id)
    return {
        "assessment": {**_assessment_view(a), "topic_description": a.get("topic_description")},
        "candidates": rows,
        "summary": sm,
        "skills": [{"id": k, "name": n, "description": d} for k, (n, d) in analytics.SKILLS.items()],
        "smtp_ready": mailer.smtp_config(company.get("smtp"), settings) is not None,
    }


class AssessmentPatch(AssessmentFields):
    status: Literal["active", "closed"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    message: str | None = Field(default=None, max_length=2000)


async def _tell_candidates(crepo: CompanyRepository, assessment_id: str, kind: str, title: str, body: str, key: str, stages: set[str]) -> int:
    """Notify everyone whose assignment is in `stages` (once per event via the dedupe key)."""
    nrepo = NotificationRepository(crepo.session)
    company_rows = await crepo.list_invites(assessment_id)
    sent = 0
    for inv in company_rows:
        st = lifecycle.stage({**inv, "assessment_status": "active", "due_at": None})["stage"]
        if st not in stages:
            continue
        n = await nrepo.create(
            kind=kind, title=title, body=body, link=f"/assessments/{inv['id']}",
            data={"invite_id": str(inv["id"]), "assessment_id": assessment_id},
            profile_id=str(inv["profile_id"]) if inv.get("profile_id") else None,
            email=None if inv.get("profile_id") else inv["email"],
            dedupe_key=f"{key}:{inv['id']}",
        )
        sent += n is not None
    return sent


@router.patch("/company/assessments/{assessment_id}")
async def update_assessment(principal: CurrentUser, crepo: CRepo, assessment_id: str, body: AssessmentPatch) -> dict:
    """Edit details or the deadline, or withdraw/reopen. People who still have work to do hear
    about a changed deadline or a withdrawal; finished work is never touched."""
    company = await _company(principal, crepo)
    before = await crepo.get_assessment(str(company["id"]), assessment_id)
    if before is None:
        raise NotFoundError("Assessment not found.")
    sent = body.model_fields_set
    fields = _clean_fields(body, sent & {"description", "expectations", "instructions", "skills", "due_at", "timezone"})
    if "title" in sent and body.title:
        fields["title"] = body.title.strip()
    if "message" in sent:
        fields["message"] = (body.message or "").strip()
    if "due_at" in fields and fields["due_at"] and fields["due_at"] <= datetime.now(UTC):
        raise ValidationAppError("The new due date is in the past.", code="due_in_past")
    after = await crepo.update_assessment(str(company["id"]), assessment_id, fields)
    assert after is not None
    if "due_at" in fields and fields["due_at"] != before.get("due_at"):
        due = fields["due_at"]
        when = due.astimezone(ZoneInfo(after.get("timezone") or "UTC")).strftime("%a %d %b, %H:%M") + f" ({after.get('timezone') or 'UTC'})" if due else "no deadline"
        await _tell_candidates(
            crepo, assessment_id, "due_changed", f"New deadline for {after['title']}",
            f"{company['name']} changed the deadline to {when}.", f"due:{int(due.timestamp()) if due else 0}",
            {"invited", "ready", "in_progress"},
        )
    if body.status and body.status != before["status"]:
        await crepo.set_assessment_status(str(company["id"]), assessment_id, body.status)
        if body.status == "closed":
            await _tell_candidates(
                crepo, assessment_id, "assessment_withdrawn", f"{after['title']} was withdrawn",
                f"{company['name']} closed this assessment, so it can no longer be started.", "withdrawn",
                {"invited", "ready"},
            )
        after = await crepo.get_assessment(str(company["id"]), assessment_id)
    return {"status": after["status"], "assessment": _assessment_view(after)}  # type: ignore[index]


def _due_text(a: dict) -> str:
    tz = a.get("timezone") or "UTC"
    return a["due_at"].astimezone(ZoneInfo(tz)).strftime("%a %d %b %Y, %H:%M") + f" ({tz})"


def _delivered(inv: dict) -> bool:
    return inv.get("email_status") == "sent" or inv.get("notified_at") is not None


async def _deliver(
    settings: Any, company: dict, a: dict, invites: list[dict], crepo: CompanyRepository, channel: str
) -> tuple[dict[str, str | None], list[str], dict[str, str]]:
    """Deliver invites over `channel`. Returns ({invite id: error or None}, emails without an account
    yet, {email: error} for emails that failed). An invite counts as delivered when any channel
    worked; a failed email is still reported, never hidden behind the in-app success."""
    errors: dict[str, str | None] = {}
    waiting: list[str] = []
    email_failed: dict[str, str] = {}
    if channel in ("app", "both"):
        nrepo = NotificationRepository(crepo.session)
        for inv in invites:
            n = await nrepo.create(
                kind="assessment_invite",
                title=f"{company['name']} invited you to an assessment",
                body=(f"{a['title']}." + (f" Due {_due_text(a)}." if a.get("due_at") else "") + f" {(a.get('message') or '').strip()}").strip()[:1000],
                # Opens the invitation review in Company assessments; never the test itself.
                link=f"/assessments/{inv['id']}",
                data={"assessment_id": str(a["id"]), "invite_id": str(inv["id"]), "company": company["name"], "assessment": a["title"]},
                email=inv["email"],
            )
            await crepo.mark_invite_notified(str(inv["id"]), channel)
            errors[str(inv["id"])] = None
            if n is not None and n["recipient_profile_id"] is None:
                waiting.append(inv["email"])
    if channel in ("email", "both"):
        mail = await _send_invites(settings, company, a, invites, crepo)
        by_id = {str(inv["id"]): inv["email"] for inv in invites}
        for iid, err in mail.items():
            if channel == "email" or err is None:
                errors[iid] = err
            if err:
                email_failed[by_id[iid]] = err
    return errors, waiting, email_failed


async def _send_invites(settings: Any, company: dict, a: dict, invites: list[dict], crepo: CompanyRepository) -> dict[str, str | None]:
    cfg = mailer.smtp_config(company.get("smtp"), settings)
    if cfg is None:
        for inv in invites:
            await crepo.mark_invite_email(str(inv["id"]), False, "SMTP is not configured. Add it in Settings.")
        return {str(inv["id"]): "SMTP is not configured." for inv in invites}
    msgs = [
        mailer.invite_email(
            cfg,
            to=inv["email"],
            candidate_name=inv.get("candidate_name"),
            company=company["name"],
            assessment=a["title"],
            message=a.get("message") or "",
            link=f"{settings.web_base_url.rstrip('/')}/invite/{inv['token']}",
            due=_due_text(a) if a.get("due_at") else None,
        )
        for inv in invites
    ]
    errors = await mailer.send_all(cfg, msgs)
    for inv, err in zip(invites, errors, strict=True):
        await crepo.mark_invite_email(str(inv["id"]), err is None, err)
    return {str(inv["id"]): err for inv, err in zip(invites, errors, strict=True)}


@router.post("/company/assessments/{assessment_id}/invites")
async def invite(principal: CurrentUser, crepo: CRepo, settings: SettingsDep, assessment_id: str, body: InviteBody) -> dict:
    company = await _company(principal, crepo)
    a = await crepo.get_assessment(str(company["id"]), assessment_id)
    if a is None:
        raise NotFoundError("Assessment not found.")
    return await _invite_people(settings, company, a, crepo, body.candidates, body.channel, resend=body.resend)


async def _invite_people(settings: Any, company: dict, a: dict, crepo: CompanyRepository, people: list[InviteEntry], channel: str, *, resend: bool) -> dict:
    """Create (or reopen) invitations and deliver them. Reports exactly what happened per person."""
    if a["status"] != "active":
        raise ConflictError("This assessment is closed.", code="assessment_closed")
    if a.get("due_at") and a["due_at"] <= datetime.now(UTC):
        raise ConflictError("The deadline has passed. Move the due date before inviting more people.", code="assessment_past_due")
    assessment_id = str(a["id"])
    invalid, to_send, skipped = [], [], []
    seen: set[str] = set()
    for entry in people:
        email = entry.email.strip().lower()
        if not _EMAIL.match(email):
            invalid.append(entry.email)
            continue
        if email in seen:
            continue
        seen.add(email)
        inv, created = await crepo.upsert_invite(assessment_id, email, (entry.name or "").strip() or None, secrets.token_urlsafe(24))
        if not created and inv.get("status") in ("declined", "revoked") and not inv.get("session_id"):
            # Inviting someone again (a correction, or they changed their mind) reopens it.
            inv = await crepo.reopen_invite(str(inv["id"])) or inv
            to_send.append(inv)
        elif created or resend or not _delivered(inv):
            to_send.append(inv)
        else:
            skipped.append(email)
    errors, waiting, email_failed = await _deliver(settings, company, a, to_send, crepo, channel)
    return {
        "sent": sum(1 for e in errors.values() if e is None),
        "failed": [{"email": inv["email"], "error": errors[str(inv["id"])]} for inv in to_send if errors[str(inv["id"])]],
        "invalid": invalid,
        "already_invited": skipped,
        "channel": channel,
        "awaiting_signup": waiting,
        "email_failed": [{"email": e, "error": err} for e, err in email_failed.items()],
    }


@router.post("/company/assessments/{assessment_id}/invites/{invite_id}/resend")
async def resend(principal: CurrentUser, crepo: CRepo, settings: SettingsDep, assessment_id: str, invite_id: str) -> dict:
    company = await _company(principal, crepo)
    a = await crepo.get_assessment(str(company["id"]), assessment_id)
    inv = await crepo.get_invite(assessment_id, invite_id) if a else None
    if inv is None:
        raise NotFoundError("Invite not found.")
    errors, _, _ = await _deliver(settings, company, a, [inv], crepo, inv.get("channel") or "email")
    err = errors[invite_id]
    return {"ok": err is None, "error": err}


@router.post("/company/assessments/{assessment_id}/invites/{invite_id}/revoke")
async def revoke(principal: CurrentUser, crepo: CRepo, assessment_id: str, invite_id: str) -> dict:
    """Withdraw one person's invitation (before they start). They're told; history is kept."""
    company = await _company(principal, crepo)
    a = await crepo.get_assessment(str(company["id"]), assessment_id)
    if a is None:
        raise NotFoundError("Assessment not found.")
    inv = await crepo.revoke_invite(assessment_id, invite_id)
    if inv is None:
        raise ConflictError("Only an invitation that hasn't been started can be withdrawn.", code="invite_not_revocable")
    await NotificationRepository(crepo.session).create(
        kind="assessment_withdrawn", title=f"{a['title']} was withdrawn",
        body=f"{company['name']} withdrew your invitation to this assessment.", link=f"/assessments/{invite_id}",
        data={"invite_id": invite_id, "assessment_id": assessment_id},
        profile_id=str(inv["profile_id"]) if inv.get("profile_id") else None,
        email=None if inv.get("profile_id") else inv["email"], dedupe_key=f"revoked:{invite_id}",
    )
    return {"ok": True}


@router.delete("/company/assessments/{assessment_id}/invites/{invite_id}", status_code=204)
async def remove_invite(principal: CurrentUser, crepo: CRepo, assessment_id: str, invite_id: str) -> Response:
    company = await _company(principal, crepo)
    if await crepo.get_assessment(str(company["id"]), assessment_id) is None:
        raise NotFoundError("Assessment not found.")
    await crepo.delete_invite(assessment_id, invite_id)
    return Response(status_code=204)


@router.get("/company/assessments/{assessment_id}/candidates/{invite_id}")
async def candidate_report(principal: CurrentUser, crepo: CRepo, repo: Repo, assessment_id: str, invite_id: str) -> dict:
    """The candidate's full evaluation (the same report they see), for the company."""
    _, _, rows, sm = await _assessment_bundle(principal, crepo, assessment_id)
    row = next((r for r in rows if r["id"] == invite_id), None)
    if row is None:
        raise NotFoundError("Candidate not found.")
    return {"summary": sm, **(await _candidate_detail(repo, row))}


async def _candidate_detail(repo: Any, row: dict[str, Any]) -> dict[str, Any]:
    """A candidate's row plus their evaluation, the people they met and the transcript."""
    out: dict[str, Any] = {"candidate": row, "evaluation": None, "transcript": [], "people": []}
    if row["session_id"]:
        from app.evaluation.evaluator import evaluation_view

        session = await repo.get_session(row["session_id"])
        blueprint, _ = await scenario_service.load_blueprint(repo, str(session["scenario_version_id"]))
        names = {c.id: c.name for c in blueprint.characters}
        out["people"] = [{"id": c.id, "name": c.name, "role": c.role} for c in blueprint.characters]
        evaluation = await repo.get_evaluation(row["session_id"])
        if evaluation is not None and evaluation["status"] == "completed":
            out["evaluation"] = await evaluation_view(repo, evaluation, blueprint)
        out["transcript"] = [
            {
                "id": str(m["id"]),
                "speaker": "candidate" if m["speaker_type"] == "learner" else names.get(m.get("character_id") or "", m["speaker_type"]),
                "character_id": m.get("character_id"),
                "content": m["content"],
                "created_at": m["created_at"].isoformat(),
            }
            for m in await repo.list_messages(row["session_id"])
        ]
    return out


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "assessment"


def _csv_response(rows: list[dict[str, Any]], filename: str, *, with_assessment: bool = False) -> Response:
    """Results as CSV, best score first; `with_assessment` adds which round each row came from."""
    buf = io.StringIO()
    w = csv.writer(buf)
    skill_names = [n for n, _ in analytics.SKILLS.values()]
    w.writerow(
        ["Rank", *(["Assessment"] if with_assessment else []), "Name", "Email", "Status", "Overall score (0-100)", "Band", "Suggested next step",
         *[f"{n} (0-100)" for n in skill_names],
         "Strengths", "Areas to probe", "Summary", "Minutes", "Messages", "Questions %", "Avg words per message", "Key checks done", "Invited at", "Completed at"]
    )
    ordered = sorted(rows, key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    for i, r in enumerate(ordered, 1):
        b = r["band"] or {}
        w.writerow(
            [
                i if r["score"] is not None else "",
                *([r["assessment_title"]] if with_assessment else []),
                r["name"],
                r["email"],
                r["status_label"],
                r["score"] if r["score"] is not None else "",
                b.get("label", ""),
                b.get("advice", ""),
                *[r["skills"].get(k, "") if r["skills"].get(k) is not None else "" for k in analytics.SKILLS],
                "; ".join(r["strengths"]),
                "; ".join(f"{g['skill']}: {g['advice']}" if g["advice"] else g["skill"] for g in r["gaps"]),
                r["summary"] or "",
                r["minutes"] if r["minutes"] is not None else "",
                r["messages"] if r["messages"] is not None else "",
                round(100 * r["question_ratio"]) if r["question_ratio"] is not None else "",
                r["avg_words"] if r["avg_words"] is not None else "",
                f"{r['checks_passed']}/{r['checks_total']}" if r["checks_total"] else "",
                r["sent_at"] or "",
                r["completed_at"] or "",
            ]
        )
    # BOM so Excel opens UTF-8 names correctly.
    return Response(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/company/assessments/{assessment_id}/report.csv")
async def report_csv(principal: CurrentUser, crepo: CRepo, assessment_id: str) -> Response:
    _, a, rows, _ = await _assessment_bundle(principal, crepo, assessment_id)
    return _csv_response(rows, f"{_slug(a['title'])}-results.csv")


async def _all_candidates(principal: Any, crepo: CompanyRepository) -> tuple[dict, list[dict[str, Any]]]:
    """Everyone invited to any of the company's assessments, tagged with the assessment."""
    company = await _company(principal, crepo)
    rows: list[dict[str, Any]] = []
    for a in await crepo.list_assessments(str(company["id"])):
        aid = str(a["id"])
        for r in analytics.candidates(await crepo.list_invites(aid), await crepo.invite_item_scores(aid), a):
            rows.append({**r, "assessment_id": aid, "assessment_title": a["title"], "topic_title": a["topic_title"]})
    return company, rows


@router.get("/company/candidates")
async def all_candidates(principal: CurrentUser, crepo: CRepo) -> dict:
    _, rows = await _all_candidates(principal, crepo)
    return {
        "candidates": rows,
        "summary": analytics.summary(rows),
        "skills": [{"id": k, "name": n, "description": d} for k, (n, d) in analytics.SKILLS.items()],
    }


@router.get("/company/candidates.csv")
async def all_candidates_csv(principal: CurrentUser, crepo: CRepo) -> Response:
    company, rows = await _all_candidates(principal, crepo)
    return _csv_response(rows, f"{_slug(company['name'])}-all-candidates.csv", with_assessment=True)


@router.get("/company/candidates.pdf")
async def all_candidates_pdf(principal: CurrentUser, crepo: CRepo) -> Response:
    import asyncio

    company, rows = await _all_candidates(principal, crepo)
    rounds = len({r["assessment_id"] for r in rows})
    pdf = await asyncio.to_thread(
        build_pdf,
        company=company["name"],
        assessment={"title": "All candidates", "topic_title": f"{rounds} assessment{'s' if rounds != 1 else ''}"},
        rows=rows,
        sm=analytics.summary(rows),
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_slug(company["name"])}-all-candidates.pdf"'},
    )


@router.get("/company/assessments/{assessment_id}/candidate-reports.pdf")
async def candidate_reports_pdf(
    principal: CurrentUser,
    crepo: CRepo,
    repo: Repo,
    assessment_id: str,
    kind: Literal["summary", "detailed"] = "summary",
    ids: str = "",
) -> Response:
    """Per-candidate reports: a one-page visual summary or the in-detail review, for the selected
    candidates (comma-separated invite ids; empty = everyone who completed), best score first."""
    import asyncio

    from app.company.candidate_report import build_candidate_pdf

    company, a, rows, sm = await _assessment_bundle(principal, crepo, assessment_id)
    wanted = {i for i in ids.split(",") if i.strip()}
    done = sorted((r for r in rows if r["status"] == "completed"), key=lambda r: -(r["score"] or 0))
    rank = {r["id"]: i for i, r in enumerate(done, 1)}
    picked = [r for r in done if not wanted or r["id"] in wanted]
    if wanted - {r["id"] for r in rows}:
        raise NotFoundError("Some selected candidates aren't part of this assessment.", code="candidate_not_found")
    if not picked:
        raise ConflictError("None of the selected candidates has finished yet, so there's no report to build.", code="no_completed_candidates")
    candidates = []
    for r in picked:
        detail = await _candidate_detail(repo, r)
        candidates.append({"row": r, "evaluation": detail["evaluation"], "transcript": detail["transcript"], "rank": rank[r["id"]], "ranked": len(done)})
    cohort = {s["id"]: s["average"] for s in sm["skills"]}
    pdf = await asyncio.to_thread(build_candidate_pdf, kind=kind, company=company["name"], assessment=a, candidates=candidates, cohort=cohort)
    who = _slug(picked[0]["name"]) if len(picked) == 1 else f"{len(picked)}-candidates"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{who}-{"summary" if kind == "summary" else "detailed-review"}.pdf"'},
    )


@router.get("/company/assessments/{assessment_id}/report.pdf")
async def report_pdf(
    principal: CurrentUser, crepo: CRepo, assessment_id: str, kind: Literal["summary", "detailed"] = "detailed"
) -> Response:
    """The whole assessment: a one-page group summary, or the detailed group overview."""
    import asyncio

    from app.company.cohort_report import build_cohort_summary

    company, a, rows, sm = await _assessment_bundle(principal, crepo, assessment_id)
    builder = build_cohort_summary if kind == "summary" else build_pdf
    pdf = await asyncio.to_thread(builder, company=company["name"], assessment=a, rows=rows, sm=sm)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_slug(a["title"])}-group-{"summary" if kind == "summary" else "overview"}.pdf"'},
    )


# ---- candidate side of an invite -----------------------------------------------
def _invite_preview(inv: dict[str, Any]) -> dict[str, Any]:
    """Public summary for the emailed link: enough to recognise the invitation before signing in."""
    st = lifecycle.stage(inv)
    due = inv.get("due_at")
    return {
        "company": inv["company_name"],
        "tagline": inv.get("tagline") or "",
        "assessment": inv["assessment_title"],
        "description": inv.get("assessment_description") or inv.get("topic_description") or "",
        "message": inv.get("message") or "",
        "due_at": due.isoformat() if due else None,
        "timezone": inv.get("timezone"),
        "email": inv["email"],
        "candidate_name": inv.get("candidate_name"),
        "stage": st["stage"],
        "label": st["label"],
        "note": st["note"],
        "open": st["stage"] not in ("expired", "withdrawn", "declined", "missed"),
    }


@router.get("/invites/{token}")
async def invite_preview(crepo: CRepo, token: str) -> dict:
    """Public: what the invite is for, so the candidate knows before signing in."""
    inv = await crepo.get_invite_by_token(token)
    if inv is None:
        raise NotFoundError("This invite link is not valid.", code="invite_not_found")
    await crepo.mark_invite_opened(str(inv["id"]))
    return _invite_preview(inv)


@router.get("/sessions/{session_id}/assessment")
async def session_assessment(principal: CurrentUser, crepo: CRepo, repo: Repo, session_id: str) -> dict:
    """Which company assessment (if any) a candidate's session belongs to, for the debrief banner."""
    row = await repo.get_session(session_id)
    if row is None or str(row["user_id"]) != str(principal.user_id):
        raise NotFoundError("Session not found.")
    inv = await crepo.invite_for_session(session_id)
    return {"assessment": {"company": inv["company_name"], "title": inv["assessment_title"], "invite_id": str(inv["id"])} if inv else None}
