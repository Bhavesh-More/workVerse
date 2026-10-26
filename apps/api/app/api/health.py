"""Health endpoints (not versioned)."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_sessionmaker

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
async def ready() -> dict:
    settings = get_settings()
    checks = {
        "database": "unknown",
        "llm_configured": bool(settings.ollama_key_pool),
        "voice_configured": bool(settings.voice_configured),
        "voice_llm_bridge_configured": bool(settings.voice_llm_bridge_configured),
    }
    status = "ready"
    try:
        maker = get_sessionmaker()
        async with maker() as session:
            await session.execute(text("select 1"))
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "unavailable"
        status = "degraded"
    return {"status": status, "checks": checks}


@router.get("/health")
async def health() -> dict:
    return await live()
