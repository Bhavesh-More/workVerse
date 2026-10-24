"""Learner context and the personalised scenario plan built from it.

``LearnerContext`` is what the context builder distils from the learner's profile, CV, GitHub,
LinkedIn and portfolio. ``ScenarioSpec`` is the fixed template the scenario planner fills in:
it can only point at an entry of the approved incident library (track + incident id) and
re-tell it, so every generated scenario still runs on validated mechanics and the same rubric.
Both are validated here; anything the model returns outside these bounds is clipped or dropped.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

CONTEXT_VERSION = "learner-context-v1"
PLAN_VERSION = "scenario-plan-v1"

Track = Literal["backend", "frontend", "data", "product"]
Level = Literal["beginner", "early_career", "intermediate", "experienced"]
Difficulty = Literal["introductory", "standard", "challenging"]
# Rubric criterion ids of the production-incident family (templates._rubric).
Competency = Literal["diagnosis", "risk_decision", "communication", "ownership", "adaptation"]
SourceKind = Literal["cv", "linkedin_pdf", "github", "linkedin", "portfolio"]


def _clip(limit: int):
    def clip(value: object) -> str:
        return " ".join(str(value or "").split())[:limit]

    return clip


def _clip_list(item_limit: int, max_items: int):
    def clip(value: object) -> list[str]:
        items = value if isinstance(value, list) else []
        out: list[str] = []
        for item in items:
            text = " ".join(str(item or "").split())[:item_limit]
            if text and text.lower() not in {o.lower() for o in out}:
                out.append(text)
        return out[:max_items]

    return clip


class Project(BaseModel):
    name: str = ""
    summary: str = ""
    tech: list[str] = Field(default_factory=list)
    source: str = ""

    clip_name = field_validator("name", mode="before")(_clip(80))
    clip_summary = field_validator("summary", mode="before")(_clip(240))
    clip_tech = field_validator("tech", mode="before")(_clip_list(40, 8))
    clip_source = field_validator("source", mode="before")(_clip(20))


class LearnerContext(BaseModel):
    version: str = CONTEXT_VERSION
    headline: str = ""
    summary: str = ""
    inferred_level: Level = "early_career"
    tech_stack: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    growth_areas: list[str] = Field(default_factory=list)
    # Industries or product areas the learner cares about; used to pick believable companies.
    domains: list[str] = Field(default_factory=list)
    notable_projects: list[Project] = Field(default_factory=list)
    # Observable signals about how they work (team projects, open source, shipped to users...).
    work_signals: list[str] = Field(default_factory=list)
    suggested_tracks: list[Track] = Field(default_factory=list)
    sources_used: list[SourceKind] = Field(default_factory=list)

    clip_headline = field_validator("headline", mode="before")(_clip(140))
    clip_summary = field_validator("summary", mode="before")(_clip(700))
    clip_stack = field_validator("tech_stack", mode="before")(_clip_list(40, 16))
    clip_strengths = field_validator("strengths", mode="before")(_clip_list(140, 6))
    clip_growth = field_validator("growth_areas", mode="before")(_clip_list(140, 6))
    clip_domains = field_validator("domains", mode="before")(_clip_list(60, 6))
    clip_signals = field_validator("work_signals", mode="before")(_clip_list(140, 6))

    @field_validator("inferred_level", mode="before")
    @classmethod
    def _level(cls, value: object) -> str:
        return value if value in {"beginner", "early_career", "intermediate", "experienced"} else "early_career"

    @field_validator("notable_projects", mode="before")
    @classmethod
    def _projects(cls, value: object) -> list:
        return [p for p in value if isinstance(p, dict) and p.get("name")][:5] if isinstance(value, list) else []

    @field_validator("suggested_tracks", "sources_used", mode="before")
    @classmethod
    def _known_only(cls, value: object, info) -> list:
        allowed = (
            {"backend", "frontend", "data", "product"}
            if info.field_name == "suggested_tracks"
            else {"cv", "linkedin_pdf", "github", "linkedin", "portfolio"}
        )
        items = value if isinstance(value, list) else []
        return list(dict.fromkeys(v for v in items if v in allowed))


class ScenarioSpec(BaseModel):
    """One personalised scenario, ready for the scenario engine (scenario_service.create_instance)."""

    id: str = Field(min_length=1, max_length=40)
    template_slug: Literal["production-incident"] = "production-incident"
    track: Track
    incident: str = Field(min_length=1, max_length=40)  # "base" or a tracks.py variant id
    difficulty: Difficulty = "standard"
    # "major": a core situation of the learner's role. "custom": the situation they asked for.
    # "stretch": a neighbouring role's situation they are likely to meet.
    kind: Literal["major", "custom", "stretch"] = "major"
    title: str = Field(min_length=1, max_length=90)
    why: str = Field(default="", max_length=240)
    company: str = Field(min_length=1, max_length=40)
    product: str = Field(min_length=1, max_length=80)
    story: str = Field(default="", max_length=300)
    focus: list[Competency] = Field(default_factory=list, max_length=3)


class ScenarioPlan(BaseModel):
    version: str = PLAN_VERSION
    scenarios: list[ScenarioSpec] = Field(default_factory=list, max_length=6)
    custom_situation: str | None = None
    # How the learner's own situation was mapped onto the library (shown on the custom card).
    custom_note: str = ""
