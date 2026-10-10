"""Authentication helper endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.errors import AppError
from app.deps import SettingsDep
from app.schemas.api import RegisterRequest
from app.services.supabase_admin import create_confirmed_user

router = APIRouter(tags=["auth"])


@router.post("/auth/register", status_code=201)
async def register(settings: SettingsDep, body: RegisterRequest) -> dict:
    """Create a confirmed Supabase Auth user (development/demo convenience).

    Production deployments should use Supabase's email-confirmation flow; this endpoint
    exists so a learner can start practising immediately without outbound email. It only
    uses the server-side secret key and never returns it.
    """
    if settings.is_production and not settings.dev_auth_enabled:
        raise AppError(
            "Self-service registration is disabled in production.",
            code="registration_disabled",
            status_code=403,
        )
    user = await create_confirmed_user(
        settings, email=body.email, password=body.password, display_name=body.display_name
    )
    return {"user_id": user["id"], "email": user["email"], "created": True}
