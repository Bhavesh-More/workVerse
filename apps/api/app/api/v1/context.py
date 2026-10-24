"""Learner context endpoints: documents, source scraping, context + personalised scenario plan."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Body, File, UploadFile

from app.context.sources import MAX_DOCUMENT_BYTES
from app.core.errors import ValidationAppError
from app.deps import AIDep, CurrentUser, Repo, SettingsDep
from app.schemas.api import BuildContextRequest
from app.services import context_service

router = APIRouter(tags=["context"])


@router.get("/me/context")
async def get_context(principal: CurrentUser, repo: Repo) -> dict:
    return await context_service.get_view(repo, principal.user_id)


@router.post("/me/documents/{kind}", status_code=201)
async def upload_document(
    principal: CurrentUser,
    repo: Repo,
    kind: Literal["cv", "linkedin_pdf"],
    file: UploadFile = File(...),
) -> dict:
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationAppError("Files can be up to 5 MB.", code="file_too_large")
    return await context_service.upload_document(
        repo, principal.user_id, kind, file.filename or "document", data
    )


@router.delete("/me/documents/{kind}", status_code=204)
async def remove_document(
    principal: CurrentUser, repo: Repo, kind: Literal["cv", "linkedin_pdf"]
) -> None:
    await context_service.remove_document(repo, principal.user_id, kind)


@router.post("/me/sources/refresh")
async def refresh_sources(
    principal: CurrentUser, repo: Repo, settings: SettingsDep, body: BuildContextRequest = Body(default_factory=BuildContextRequest)
) -> dict:
    return await context_service.refresh_sources(repo, settings, principal.user_id, force=body.force)


@router.post("/me/context/build")
async def build_context(
    principal: CurrentUser,
    repo: Repo,
    ai: AIDep,
    settings: SettingsDep,
    body: BuildContextRequest = Body(default_factory=BuildContextRequest),
) -> dict:
    return await context_service.build(repo, ai, settings, principal.user_id, force=body.force)
