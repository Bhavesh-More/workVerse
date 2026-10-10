"""Minimal Supabase Admin API client (server-side only).

Used to create a confirmed user during development/demo sign-up so that a learner can log
in immediately without depending on outbound email delivery. The secret key never leaves
the backend.
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ConflictError, UpstreamError

logger = logging.getLogger(__name__)


async def create_confirmed_user(
    settings: Settings, *, email: str, password: str, display_name: str | None = None
) -> dict[str, str]:
    if not (settings.supabase_url and settings.supabase_secret_key):
        raise AppError(
            "Sign-up is not configured on the server.", code="supabase_not_configured", status_code=503
        )
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": "application/json",
    }
    body = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"display_name": display_name} if display_name else {},
    }
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.post(url, headers=headers, json=body)
        except httpx.HTTPError as exc:
            raise UpstreamError("Unable to reach the authentication service.") from exc
    if resp.status_code in (200, 201):
        data = resp.json()
        return {"id": str(data.get("id")), "email": data.get("email", email)}
    if resp.status_code in (409, 422):
        raise ConflictError("An account with this email already exists.", code="email_taken")
    logger.warning("supabase_admin_error", extra={"event": str(resp.status_code)})
    raise UpstreamError("The authentication service rejected the request.")
