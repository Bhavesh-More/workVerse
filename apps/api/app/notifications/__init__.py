"""In-app notifications: delivery to profiles, or to an email until someone with it signs in.

A notification addressed by email is claimed by the first profile whose *verified* Clerk email
matches it (checked once per process per profile, then cached on profiles.email), so an invite
reaches a candidate who signs up after it was sent. Clients poll; `popped_at` records that the
live popup was shown so it isn't shown again on another tab or device.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.repository import _row, _rows

logger = logging.getLogger(__name__)
_email_checked: set[str] = set()  # profile ids whose email was resolved this process


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        kind: str,
        title: str,
        body: str = "",
        link: str | None = None,
        data: dict[str, Any] | None = None,
        profile_id: str | None = None,
        email: str | None = None,
    ) -> dict[str, Any]:
        if profile_id is None and email:
            known = await self.profile_by_email(email)
            profile_id = str(known["id"]) if known else None
        return _row(  # type: ignore[return-value]
            await self.session.execute(
                text(
                    "insert into public.notifications (recipient_profile_id, recipient_email, kind, title, body, link, data) "
                    "values (:pid, :email, :kind, :title, :body, :link, cast(:data as jsonb)) returning *"
                ),
                {
                    "pid": profile_id,
                    "email": email.lower() if email else None,
                    "kind": kind,
                    "title": title[:200],
                    "body": body[:1000],
                    "link": link,
                    "data": json.dumps(data or {}),
                },
            )
        )

    async def profile_by_email(self, email: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select id from public.profiles where lower(email) = lower(:e) limit 1"), {"e": email}
            )
        )

    async def profile_email(self, profile_id: str) -> str | None:
        row = _row(await self.session.execute(text("select email from public.profiles where id = :id"), {"id": profile_id}))
        return (row or {}).get("email")

    async def set_profile_email(self, profile_id: str, email: str) -> None:
        await self.session.execute(
            text("update public.profiles set email = :e where id = :id"), {"e": email.lower(), "id": profile_id}
        )

    async def claim(self, profile_id: str, email: str) -> int:
        res = await self.session.execute(
            text(
                "update public.notifications set recipient_profile_id = :pid "
                "where recipient_profile_id is null and lower(recipient_email) = lower(:e)"
            ),
            {"pid": profile_id, "e": email},
        )
        return res.rowcount or 0  # type: ignore[attr-defined]

    async def list(self, profile_id: str, limit: int = 30) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select * from public.notifications where recipient_profile_id = :pid "
                    "order by created_at desc limit :lim"
                ),
                {"pid": profile_id, "lim": limit},
            )
        )

    async def unread_count(self, profile_id: str) -> int:
        row = _row(
            await self.session.execute(
                text("select count(*) as n from public.notifications where recipient_profile_id = :pid and read_at is null"),
                {"pid": profile_id},
            )
        )
        return int((row or {}).get("n") or 0)

    async def mark(self, profile_id: str, column: str, ids: list[str] | None) -> None:
        assert column in ("read_at", "popped_at")
        if ids is None:
            sql = f"update public.notifications set {column} = coalesce({column}, now()) where recipient_profile_id = :pid"
            params: dict[str, Any] = {"pid": profile_id}
        else:
            sql = (
                f"update public.notifications set {column} = coalesce({column}, now()) "
                "where recipient_profile_id = :pid and id = any(cast(:ids as uuid[]))"
            )
            params = {"pid": profile_id, "ids": ids}
        await self.session.execute(text(sql), params)


async def verified_clerk_email(settings: Settings, clerk_user_id: str) -> str | None:
    """The user's primary email from Clerk, only if Clerk has verified it."""
    key = settings.clerk_secret_key.strip()
    if not key or not clerk_user_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"https://api.clerk.com/v1/users/{clerk_user_id}", headers={"Authorization": f"Bearer {key}"})
        if r.status_code != 200:
            return None
        u = r.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("clerk_email_lookup_failed")
        return None
    for e in u.get("email_addresses") or []:
        if e.get("id") == u.get("primary_email_address_id") and (e.get("verification") or {}).get("status") == "verified":
            return str(e.get("email_address") or "").lower() or None
    return None


async def sync_inbox(nrepo: NotificationRepository, settings: Settings, profile_id: str, clerk_user_id: str | None, dev_email: str | None) -> None:
    """Learn the profile's verified email once, then claim anything sent to it before sign-up."""
    email = await nrepo.profile_email(profile_id)
    if email is None and profile_id not in _email_checked:
        _email_checked.add(profile_id)
        email = dev_email or (await verified_clerk_email(settings, clerk_user_id or ""))
        if email:
            await nrepo.set_profile_email(profile_id, email)
    if email:
        await nrepo.claim(profile_id, email)


def view(n: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(n["id"]),
        "kind": n["kind"],
        "title": n["title"],
        "body": n["body"],
        "link": n.get("link"),
        "data": n.get("data") or {},
        "read": n.get("read_at") is not None,
        "popped": n.get("popped_at") is not None,
        "created_at": n["created_at"].isoformat(),
    }


async def notify_company(session: AsyncSession, session_id: str, kind: str, score: float | None = None) -> None:
    """Tell the company owner a candidate started or finished their assessment (no-op otherwise)."""
    row = _row(
        await session.execute(
            text(
                "select i.id as invite_id, i.email, i.candidate_name, p.display_name, a.id as assessment_id, "
                " a.title as assessment_title, c.owner_profile_id "
                "from public.assessment_invites i join public.assessments a on a.id = i.assessment_id "
                "join public.companies c on c.id = a.company_id "
                "left join public.profiles p on p.id = i.profile_id where i.session_id = :sid"
            ),
            {"sid": session_id},
        )
    )
    if row is None:
        return
    who = row.get("candidate_name") or row.get("display_name") or row["email"]
    if kind == "candidate_started":
        title, body = f"{who} started {row['assessment_title']}", "They're in the office now. Their report appears when they finish."
    else:
        title = f"{who} finished {row['assessment_title']}"
        body = f"Score {round(score)}/100. Open their report." if score is not None else "Their report is ready."
    await NotificationRepository(session).create(
        kind=kind,
        title=title,
        body=body,
        link=f"/company/assessments/{row['assessment_id']}/candidates/{row['invite_id']}",
        data={"assessment_id": str(row["assessment_id"]), "invite_id": str(row["invite_id"]), "score": score},
        profile_id=str(row["owner_profile_id"]),
    )
