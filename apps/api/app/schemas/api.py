"""API request models."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: str | None = Field(default=None, max_length=120)


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    education_summary: str | None = Field(default=None, max_length=3000)
    experience_summary: str | None = Field(default=None, max_length=5000)
    target_role: str | None = Field(default=None, max_length=160)
    career_goals: list[str] | None = Field(default=None, max_length=20)
    preferred_stack: list[str] | None = Field(default=None, max_length=40)
    experience_level: Literal[
        "beginner", "early_career", "intermediate", "experienced", "unspecified"
    ] | None = None


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    level_self_reported: Literal[
        "beginner", "basic", "intermediate", "advanced", "unspecified"
    ] | None = None


class CreateInstanceRequest(BaseModel):
    template_id: str | None = None
    template_slug: str = "production-incident"
    mode: Literal["quick", "project"] = "quick"
    difficulty: Literal["introductory", "standard", "challenging"] = "standard"
    learning_objectives: list[str] = Field(default_factory=list, max_length=10)
    variation_request: str = Field(default="", max_length=500)


class StartSessionRequest(BaseModel):
    scenario_instance_id: UUID
    mode: Literal["quick", "project"] = "quick"


class ActionRequest(BaseModel):
    client_action_id: UUID
    expected_state_version: int = Field(ge=1)
    type: str = Field(min_length=1, max_length=160)
    target_id: str | None = Field(default=None, max_length=160)
    payload: dict[str, Any] = Field(default_factory=dict)


class TurnRequest(BaseModel):
    client_turn_id: UUID
    expected_state_version: int = Field(ge=1)
    character_id: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=4000)
    modality: Literal["text", "voice_transcript"] = "text"


class CompleteRequest(BaseModel):
    expected_state_version: int | None = Field(default=None, ge=1)
    force: bool = False
