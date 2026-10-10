"""Profile service."""

from __future__ import annotations

from typing import Any

from app.db.repository import Repository


async def get_me(repo: Repository, user_id: str, email: str | None = None) -> dict[str, Any]:
    profile = await repo.get_profile(user_id)
    if profile is None:
        await repo.ensure_profile(user_id, None)
        profile = await repo.get_profile(user_id)
    profile["id"] = str(profile["id"])
    profile["email"] = email
    profile["skills"] = await repo.list_skills(user_id)
    return profile


async def update_me(repo: Repository, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    await repo.ensure_profile(user_id, fields.get("display_name"))
    profile = await repo.update_profile(user_id, fields)
    profile["id"] = str(profile["id"])
    profile["skills"] = await repo.list_skills(user_id)
    return profile
