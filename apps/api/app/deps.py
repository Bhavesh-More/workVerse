"""FastAPI dependencies: settings, database session/repository, auth principal, AI client."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.ollama_cloud import OllamaCloudClient
from app.core.config import Settings, get_settings
from app.core.errors import AuthError
from app.core.security import Principal, verify_token
from app.db.repository import Repository
from app.db.session import get_db
from app.services.ai_provider import get_ai_client


def settings_dep() -> Settings:
    return get_settings()


async def repo_dep(session: Annotated[AsyncSession, Depends(get_db)]) -> AsyncIterator[Repository]:
    yield Repository(session)


def current_principal(
    request: Request,
    settings: Annotated[Settings, Depends(settings_dep)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    principal = verify_token(token, settings)
    request.state.user_id = principal.user_id
    return principal


def ai_client_dep(settings: Annotated[Settings, Depends(settings_dep)]) -> OllamaCloudClient:
    return get_ai_client(settings)


CurrentUser = Annotated[Principal, Depends(current_principal)]
Repo = Annotated[Repository, Depends(repo_dep)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
AIDep = Annotated[OllamaCloudClient, Depends(ai_client_dep)]
