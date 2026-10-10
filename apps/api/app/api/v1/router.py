"""Aggregate v1 API router."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth, profile, scenarios, sessions

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(profile.router)
api_router.include_router(scenarios.router)
api_router.include_router(sessions.router)
