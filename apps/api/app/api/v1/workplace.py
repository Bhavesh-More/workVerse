"""Company workplace: default-vs-custom choice, setup wizard progress, team members, and the
company's world (versioned draft + published copy)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, ValidationError

from app import world as W
from app.api.v1.company import CRepo, _company
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.deps import CurrentUser

router = APIRouter(tags=["workplace"])


def _members(company: dict[str, Any]) -> list[W.Member]:
    out = []
    for m in company.get("team_members") or []:
        try:
            out.append(W.Member.model_validate(m))
        except ValidationError:
            continue
    return out


def _view(company: dict[str, Any], world: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "mode": company.get("world_mode"),
        "setup": company.get("world_setup") or {},
        "members": [m.model_dump() for m in _members(company)],
        "world": None
        if world is None
        else {
            "draft": world["draft"],
            "draft_version": world["draft_version"],
            "published": world.get("published") is not None,
            "published_version": world.get("published_version"),
            "published_at": world["published_at"].isoformat() if world.get("published_at") else None,
            "updated_at": world["updated_at"].isoformat() if world.get("updated_at") else None,
        },
    }


def _parse(raw: Any) -> W.WorldDoc:
    try:
        return W.parse_doc(raw)
    except ValidationError as exc:
        # Pydantic error dicts may carry exception objects; keep just the readable parts.
        problems = [{"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", "")} for e in exc.errors()]
        raise ValidationAppError("This world can't be saved: it has invalid data.", code="invalid_world", details={"errors": problems[:20]})


@router.get("/company/workplace")
async def get_workplace(principal: CurrentUser, crepo: CRepo) -> dict:
    company = await _company(principal, crepo)
    return _view(company, await crepo.get_world(str(company["id"])))


class WorkplacePatch(BaseModel):
    mode: Literal["default", "custom"] | None = None
    setup: dict[str, Any] | None = None
    members: list[dict[str, Any]] | None = Field(default=None, max_length=40)


@router.patch("/company/workplace")
async def patch_workplace(principal: CurrentUser, crepo: CRepo, body: WorkplacePatch) -> dict:
    company = await _company(principal, crepo)
    cid = str(company["id"])
    world = await crepo.get_world(cid)
    fields: dict[str, Any] = {}
    if body.mode is not None:
        if body.mode == "custom" and (world is None or world.get("published") is None):
            raise ConflictError("Publish your world before switching to it.", code="world_not_published")
        fields["world_mode"] = body.mode
    if body.setup is not None:
        if len(str(body.setup)) > 4000:
            raise ValidationAppError("Setup data is too large.", code="setup_too_large")
        fields["world_setup"] = body.setup
    if body.members is not None:
        try:
            members = [W.Member.model_validate(m) for m in body.members]
        except ValidationError:
            raise ValidationAppError("Each team member needs a name and a valid look.", code="invalid_member")
        if len({m.id for m in members}) != len(members):
            raise ValidationAppError("Team member ids must be unique.", code="invalid_member")
        fields["team_members"] = [m.model_dump() for m in members]
    company = await crepo.update_workplace(cid, fields)
    return _view(company, world)


class DraftBody(BaseModel):
    doc: dict[str, Any]
    base_version: int = Field(ge=0)


@router.put("/company/workplace/draft")
async def save_draft(principal: CurrentUser, crepo: CRepo, body: DraftBody) -> dict:
    """Autosave target. base_version 0 creates the world; otherwise it must match the stored
    version, so a stale tab gets a 409 instead of silently overwriting newer work."""
    company = await _company(principal, crepo)
    cid = str(company["id"])
    doc = _parse(body.doc).model_dump(exclude_none=True)
    world = await crepo.get_world(cid)
    if world is None:
        if body.base_version != 0:
            raise ConflictError("This world was removed. Reload to start again.", code="world_missing")
        world = await crepo.create_world(cid, doc)
        return {"draft_version": world["draft_version"], "saved_at": world["updated_at"].isoformat()}
    if body.base_version == 0:
        raise ConflictError("A world already exists for your company. Reload to keep editing it.", code="world_exists", details={"current_version": world["draft_version"]})
    saved = await crepo.save_draft(cid, doc, body.base_version)
    if saved is None:
        raise ConflictError(
            "Someone saved a newer version of this world (maybe in another tab).",
            code="world_version_conflict",
            details={"current_version": world["draft_version"]},
        )
    return {"draft_version": saved["draft_version"], "saved_at": saved["updated_at"].isoformat()}


class PublishBody(BaseModel):
    base_version: int = Field(ge=1)
    activate: bool = True


@router.post("/company/workplace/publish")
async def publish(principal: CurrentUser, crepo: CRepo, body: PublishBody) -> dict:
    company = await _company(principal, crepo)
    cid = str(company["id"])
    world = await crepo.get_world(cid)
    if world is None:
        raise NotFoundError("Create your world first.", code="world_missing")
    if world["draft_version"] != body.base_version:
        raise ConflictError("Save your latest changes before publishing.", code="world_version_conflict", details={"current_version": world["draft_version"]})
    doc = _parse(world["draft"])
    errors = W.publish_errors(doc, _members(company))
    if errors:
        raise ValidationAppError("Fix these problems before publishing.", code="world_has_errors", details={"issues": errors})
    out = await crepo.publish_world(cid, body.base_version)
    if out is None:
        raise ConflictError("The world changed while publishing. Try again.", code="world_version_conflict")
    if body.activate:
        company = await crepo.update_workplace(cid, {"world_mode": "custom"})
    return _view(company, await crepo.get_world(cid))


@router.post("/company/workplace/revert")
async def revert(principal: CurrentUser, crepo: CRepo) -> dict:
    company = await _company(principal, crepo)
    cid = str(company["id"])
    if await crepo.revert_draft(cid) is None:
        raise ConflictError("There's no published version to go back to.", code="world_not_published")
    return _view(company, await crepo.get_world(cid))


async def published_world_for(crepo: Any, company: dict[str, Any]) -> dict[str, Any] | None:
    """The world candidates of this company should get: the published custom world when the
    company uses custom mode, otherwise None (the default office)."""
    if company.get("world_mode") != "custom":
        return None
    world = await crepo.get_world(str(company["id"]))
    if not world or world.get("published") is None:
        return None
    return {"doc": world["published"], "members": [m.model_dump() for m in _members(company)], "version": world["published_version"]}
