"""The signed-in user's notifications (polled by the web app for the bell and live popups)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, SettingsDep
from app.notifications import NotificationRepository, sync_inbox, view

router = APIRouter(tags=["notifications"])


async def notification_repo_dep(session: Annotated[AsyncSession, Depends(get_db)]) -> NotificationRepository:
    return NotificationRepository(session)


NRepo = Annotated[NotificationRepository, Depends(notification_repo_dep)]


class MarkBody(BaseModel):
    ids: list[str] | None = Field(default=None, max_length=200)  # None = all


@router.get("/notifications")
async def list_notifications(
    request: Request, principal: CurrentUser, nrepo: NRepo, settings: SettingsDep, limit: int = Query(default=30, ge=1, le=100)
) -> dict:
    await sync_inbox(
        nrepo,
        settings,
        principal.user_id,
        getattr(request.state, "clerk_user_id", None),
        principal.email if principal.dev else None,
    )
    items = await nrepo.list(principal.user_id, limit)
    return {"items": [view(n) for n in items], "unread": await nrepo.unread_count(principal.user_id)}


@router.post("/notifications/read")
async def mark_read(principal: CurrentUser, nrepo: NRepo, body: MarkBody) -> dict:
    await nrepo.mark(principal.user_id, "read_at", body.ids)
    return {"unread": await nrepo.unread_count(principal.user_id)}


@router.post("/notifications/popped")
async def mark_popped(principal: CurrentUser, nrepo: NRepo, body: MarkBody) -> dict:
    await nrepo.mark(principal.user_id, "popped_at", body.ids)
    return {"ok": True}
