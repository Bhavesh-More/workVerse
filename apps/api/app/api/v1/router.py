"""Aggregate v1 API router."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import company, profile, scenarios, sessions, voice, workplace

api_router = APIRouter()
api_router.include_router(profile.router)
api_router.include_router(scenarios.router)
api_router.include_router(sessions.router)
api_router.include_router(voice.router)
api_router.include_router(company.router)
api_router.include_router(workplace.router)
