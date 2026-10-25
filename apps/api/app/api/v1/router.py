"""Aggregate v1 API router."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import context, profile, scenarios, sessions, voice

api_router = APIRouter()
api_router.include_router(profile.router)
api_router.include_router(context.router)
api_router.include_router(scenarios.router)
api_router.include_router(sessions.router)
api_router.include_router(voice.router)
