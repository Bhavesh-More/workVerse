"""Schemas for structured model outputs. All model output is untrusted and re-validated."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class IntentInterpretation(BaseModel):
    action_id: str | None = None
    confidence: float = 0.0
    rationale: str = ""


class EvidenceSuggestion(BaseModel):
    source_type: Literal["message", "event", "deliverable"]
    source_id: str
    quote: str | None = None
    interpretation: str = ""


class CriterionSuggestion(BaseModel):
    criterion_id: str
    status: Literal["scored", "insufficient_evidence"]
    rating: int | None = None
    rationale: str = ""
    recommendation: str = ""
    evidence: list[EvidenceSuggestion] = Field(default_factory=list)
    counterevidence: list[EvidenceSuggestion] = Field(default_factory=list)


class EvaluationSuggestion(BaseModel):
    summary: str = ""
    criteria: list[CriterionSuggestion] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ScenarioNarrative(BaseModel):
    """Bounded narrative variation for an approved template."""

    title: str
    briefing: str
    manager_greeting: str = ""
    teammate_greeting: str = ""
