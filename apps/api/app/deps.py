"""FastAPI dependencies: settings, database session/repository, auth principal, AI client."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.elevenlabs_cloud import ElevenLabsClient
from app.agents.ollama_cloud import OllamaCloudClient
from app.core.config import Settings, get_settings
from app.core.errors import AuthError
from app.core.security import Principal, verify_token
from app.db.repository import Repository
from app.db.session import get_db
from app.services.ai_provider import get_ai_client
from app.services.voice_provider import get_voice_client


def settings_dep() -> Settings:
    return get_settings()


async def repo_dep(session: Annotated[AsyncSession, Depends(get_db)]) -> AsyncIterator[Repository]:
    yield Repository(session)


# ponytail: per-process dict, one small entry per user ever seen; swap for an LRU if the
# user count gets large. Profiles are never deleted, so entries can't go stale.
_profile_ids: dict[str, str] = {}


async def current_principal(
    request: Request,
    settings: Annotated[Settings, Depends(settings_dep)],
    repo: Annotated[Repository, Depends(repo_dep)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    clerk_principal = verify_token(token, settings)

    # Map the Clerk subject to the internal profile (created on first authenticated request).
    # The mapping never changes, so it is remembered per process: no DB round trip per request.
    profile_id = _profile_ids.get(clerk_principal.user_id)
    if profile_id is None:
        profile = await repo.ensure_profile_for_clerk(clerk_principal.user_id)
        profile_id = _profile_ids[clerk_principal.user_id] = str(profile["id"])
    request.state.user_id = profile_id
    request.state.clerk_user_id = clerk_principal.user_id
    return Principal(
        user_id=profile_id,
        email=clerk_principal.email,
        role=clerk_principal.role,
        dev=clerk_principal.dev,
    )


def ai_client_dep(settings: Annotated[Settings, Depends(settings_dep)]) -> OllamaCloudClient:
    return get_ai_client(settings)


def voice_client_dep(settings: Annotated[Settings, Depends(settings_dep)]) -> ElevenLabsClient:
    return get_voice_client(settings)


CurrentUser = Annotated[Principal, Depends(current_principal)]
Repo = Annotated[Repository, Depends(repo_dep)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
AIDep = Annotated[OllamaCloudClient, Depends(ai_client_dep)]
VoiceDep = Annotated[ElevenLabsClient, Depends(voice_client_dep)]
