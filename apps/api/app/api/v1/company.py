"""Company portal: company profile + SMTP, judge defaults, topics, assessments, invites, reports.

Plus the candidate side of an invite: a public preview by token and an authenticated accept that
starts the candidate's simulation with the topic's judges.
"""

from __future__ import annotations

import csv
import io
import re
import secrets
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.company import analytics, judges
from app.company.report_pdf import build_pdf
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.db.company_repository import CompanyRepository
from app.db.session import get_db
from app.deps import AIDep, CurrentUser, Repo, SettingsDep
from app.services import mailer, scenario_service, session_service

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
        "judge_defaults": c.get("judge_defaults") or {},
        "judge_roster": c.get("judge_roster"),
        "world_mode": c.get("world_mode"),
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


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    smtp: SmtpSettings | None = None
    judge_defaults: dict[str, Any] | None = None
    judge_roster: list[Any] | None = None


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


def _topic_data(body: TopicBody) -> dict[str, Any]:
    if bad := judges.bad_names(body.judges):
        raise ValidationAppError("Pick judge names from the existing cast.", code="invalid_judge_name", details={"names": bad})
    incidents = {i["id"] for t in judges.catalog()["tracks"] if t["id"] == body.track for i in t["incidents"]}
    return {
        "title": body.title.strip(),
        "description": body.description.strip(),
        "track": body.track,
        "incident": body.incident if body.incident in incidents else None,
        "difficulty": body.difficulty,
        "judges": judges.clean_judges(body.judges),
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
    return _topic_view(await crepo.insert_topic(str(company["id"]), _topic_data(body)))


@router.get("/company/topics/{topic_id}")
async def get_topic(principal: CurrentUser, crepo: CRepo, topic_id: str) -> dict:
    company = await _company(principal, crepo)
    topic = await crepo.get_topic(str(company["id"]), topic_id)
    if topic is None:
        raise NotFoundError("Topic not found.")
    return _topic_view(topic)


@router.put("/company/topics/{topic_id}")
async def update_topic(principal: CurrentUser, crepo: CRepo, topic_id: str, body: TopicBody) -> dict:
    company = await _company(principal, crepo)
    topic = await crepo.update_topic(str(company["id"]), topic_id, _topic_data(body))
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


# ---- assessments ----------------------------------------------------------------
class AssessmentCreate(BaseModel):
    topic_id: str
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(default="", max_length=2000)


def _assessment_view(a: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(a["id"]),
        "title": a["title"],
        "message": a.get("message") or "",
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
async def create_assessment(principal: CurrentUser, crepo: CRepo, body: AssessmentCreate) -> dict:
    company = await _company(principal, crepo)
    if await crepo.get_topic(str(company["id"]), body.topic_id) is None:
        raise NotFoundError("Topic not found.")
    row = await crepo.insert_assessment(str(company["id"]), body.topic_id, body.title.strip(), body.message.strip())
    return _assessment_view(row)


async def _assessment_bundle(principal: Any, crepo: CompanyRepository, assessment_id: str) -> tuple[dict, dict, list, dict]:
    company = await _company(principal, crepo)
    a = await crepo.get_assessment(str(company["id"]), assessment_id)
    if a is None:
        raise NotFoundError("Assessment not found.")
    rows = analytics.candidates(await crepo.list_invites(assessment_id), await crepo.invite_item_scores(assessment_id))
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


class StatusBody(BaseModel):
    status: Literal["active", "closed"]


@router.patch("/company/assessments/{assessment_id}")
async def set_status(principal: CurrentUser, crepo: CRepo, assessment_id: str, body: StatusBody) -> dict:
    company = await _company(principal, crepo)
    await crepo.set_assessment_status(str(company["id"]), assessment_id, body.status)
    return {"status": body.status}


_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


class InviteEntry(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    name: str | None = Field(default=None, max_length=120)


class InviteBody(BaseModel):
    candidates: list[InviteEntry] = Field(min_length=1, max_length=500)
    resend: bool = False


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
    if a["status"] != "active":
        raise ConflictError("This assessment is closed.", code="assessment_closed")
    invalid, to_send, skipped = [], [], []
    seen: set[str] = set()
    for entry in body.candidates:
        email = entry.email.strip().lower()
        if not _EMAIL.match(email):
            invalid.append(entry.email)
            continue
        if email in seen:
            continue
        seen.add(email)
        inv, created = await crepo.upsert_invite(assessment_id, email, (entry.name or "").strip() or None, secrets.token_urlsafe(24))
        if created or body.resend or inv["email_status"] != "sent":
            to_send.append(inv)
        else:
            skipped.append(email)
    errors = await _send_invites(settings, company, a, to_send, crepo)
    return {
        "sent": sum(1 for e in errors.values() if e is None),
        "failed": [{"email": inv["email"], "error": errors[str(inv["id"])]} for inv in to_send if errors[str(inv["id"])]],
        "invalid": invalid,
        "already_invited": skipped,
    }


@router.post("/company/assessments/{assessment_id}/invites/{invite_id}/resend")
async def resend(principal: CurrentUser, crepo: CRepo, settings: SettingsDep, assessment_id: str, invite_id: str) -> dict:
    company = await _company(principal, crepo)
    a = await crepo.get_assessment(str(company["id"]), assessment_id)
    inv = await crepo.get_invite(assessment_id, invite_id) if a else None
    if inv is None:
        raise NotFoundError("Invite not found.")
    err = (await _send_invites(settings, company, a, [inv], crepo))[invite_id]
    return {"ok": err is None, "error": err}


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
    out: dict[str, Any] = {"candidate": row, "summary": sm, "evaluation": None, "transcript": [], "people": []}
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
        for r in analytics.candidates(await crepo.list_invites(aid), await crepo.invite_item_scores(aid)):
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


@router.get("/company/assessments/{assessment_id}/report.pdf")
async def report_pdf(principal: CurrentUser, crepo: CRepo, assessment_id: str) -> Response:
    import asyncio

    company, a, rows, sm = await _assessment_bundle(principal, crepo, assessment_id)
    pdf = await asyncio.to_thread(build_pdf, company=company["name"], assessment=a, rows=rows, sm=sm)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_slug(a["title"])}-report.pdf"'},
    )


# ---- candidate side of an invite -----------------------------------------------
def _invite_preview(inv: dict[str, Any]) -> dict[str, Any]:
    return {
        "company": inv["company_name"],
        "assessment": inv["assessment_title"],
        "message": inv.get("message") or "",
        "topic": inv["topic_title"],
        "description": inv.get("topic_description") or "",
        "difficulty": inv["difficulty"],
        "email": inv["email"],
        "candidate_name": inv.get("candidate_name"),
        "open": inv["assessment_status"] == "active",
        "started": bool(inv.get("session_id")),
    }


@router.get("/invites/{token}")
async def invite_preview(crepo: CRepo, token: str) -> dict:
    """Public: what the invite is for, so the candidate knows before signing in."""
    inv = await crepo.get_invite_by_token(token)
    if inv is None:
        raise NotFoundError("This invite link is not valid.", code="invite_not_found")
    await crepo.mark_invite_opened(str(inv["id"]))
    return _invite_preview(inv)


@router.post("/invites/{token}/accept")
async def accept_invite(principal: CurrentUser, crepo: CRepo, repo: Repo, ai: AIDep, token: str) -> dict:
    inv = await crepo.get_invite_by_token(token)
    if inv is None:
        raise NotFoundError("This invite link is not valid.", code="invite_not_found")
    if inv.get("profile_id") and str(inv["profile_id"]) != str(principal.user_id):
        raise ForbiddenError("This invite was already used by another account.", code="invite_claimed")
    if inv.get("session_id"):
        session = await repo.get_session(str(inv["session_id"]))
        if session is not None:
            return {"session_id": str(session["id"]), "scenario_instance_id": str(session["scenario_version_id"]), "status": session["status"]}
    if inv["assessment_status"] != "active":
        raise ConflictError("This assessment is closed.", code="assessment_closed")
    company = await crepo.get_company(str(inv["company_id"]))
    topic = await crepo.get_topic(str(inv["company_id"]), str(inv["topic_id"]))
    if company is None or topic is None:
        raise NotFoundError("This assessment is no longer available.")
    profile = await repo.get_profile(principal.user_id)
    from app.api.v1.workplace import published_world_for

    instance = await scenario_service.create_instance(
        repo=repo,
        ai=ai,
        user_id=principal.user_id,
        profile=profile,
        topic=topic,
        company=company,
        world=await published_world_for(crepo, company),
    )
    session = await session_service.start_session(
        repo=repo, user_id=principal.user_id, scenario_instance_id=instance["scenario_instance_id"], mode="quick"
    )
    if await crepo.claim_invite(str(inv["id"]), principal.user_id, str(session["id"])) is None:
        raise ForbiddenError("This invite was already used by another account.", code="invite_claimed")
    return {"session_id": str(session["id"]), "scenario_instance_id": instance["scenario_instance_id"], "status": "active"}


@router.get("/sessions/{session_id}/assessment")
async def session_assessment(principal: CurrentUser, crepo: CRepo, repo: Repo, session_id: str) -> dict:
    """Which company assessment (if any) a candidate's session belongs to, for the debrief banner."""
    row = await repo.get_session(session_id)
    if row is None or str(row["user_id"]) != str(principal.user_id):
        raise NotFoundError("Session not found.")
    inv = await crepo.invite_for_session(session_id)
    return {"assessment": {"company": inv["company_name"], "title": inv["assessment_title"]} if inv else None}
