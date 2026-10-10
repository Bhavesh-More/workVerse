"""Scenario blueprint domain models (validated, versioned, immutable once persisted)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Difficulty = Literal["introductory", "standard", "challenging"]
Mode = Literal["quick", "project"]
SpriteId = Literal["blonde_man", "blue_haired_woman", "cat_brown", "cat_brown2", "cat_white"]


class Fact(BaseModel):
    id: str
    label: str
    detail: str
    sensitivity: Literal["public", "internal", "restricted"] = "internal"
    initially_known_by: list[str] = Field(default_factory=list)
    discovered_by_actions: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class DisclosureRule(BaseModel):
    fact_id: str
    keywords: list[str] = Field(default_factory=list)
    requires_actions: list[str] = Field(default_factory=list)
    requires_facts: list[str] = Field(default_factory=list)


class CharacterBlueprint(BaseModel):
    id: str
    name: str
    role: str
    style: str
    goals: list[str] = Field(default_factory=list)
    location_id: str
    sprite: SpriteId = "blonde_man"
    initial_fact_ids: list[str] = Field(default_factory=list)
    disclosure_rules: list[DisclosureRule] = Field(default_factory=list)
    greeting: str = ""


class Objective(BaseModel):
    id: str
    label: str
    description: str = ""
    required: bool = True
    completed_by_actions: list[str] = Field(default_factory=list)
    completed_by_facts: list[str] = Field(default_factory=list)


class Effect(BaseModel):
    reveal_fact_ids: list[str] = Field(default_factory=list)
    complete_objective_ids: list[str] = Field(default_factory=list)
    unlock_action_ids: list[str] = Field(default_factory=list)
    set_task_status: dict[str, str] = Field(default_factory=dict)
    set_flag: dict[str, str] = Field(default_factory=dict)
    advance_phase: str | None = None


class Precondition(BaseModel):
    kind: Literal["fact_known", "action_done", "flag_equals", "objective_complete"]
    ref: str
    value: str | None = None
    failure_message: str = "The preconditions for this action are not met."


class ActionDefinition(BaseModel):
    id: str
    label: str
    description: str = ""
    action_type: Literal[
        "navigate", "inspect", "ask", "mitigate", "communicate", "submit", "complete"
    ]
    kind: Literal["investigation", "decision", "communication", "navigation", "completion", "mitigation"]
    location_id: str | None = None
    target_id: str | None = None
    actor_id: str | None = None
    preconditions: list[Precondition] = Field(default_factory=list)
    effects: Effect = Field(default_factory=Effect)
    risk_level: Literal["none", "low", "high"] = "none"
    initially_available: bool = True
    requires_text: bool = False


class LocationDef(BaseModel):
    id: str
    name: str
    kind: Literal["room", "corridor"] = "room"
    description: str = ""
    order: int = 0


class TaskDef(BaseModel):
    id: str
    label: str
    status: Literal["locked", "available", "completed"] = "available"


class InteractiveObject(BaseModel):
    id: str
    label: str
    location_id: str
    marker: str = "console"



class RubricCriterion(BaseModel):
    id: str
    name: str
    description: str
    evidence_hint: str = ""
    anchors: dict[str, str]

    @field_validator("anchors")
    @classmethod
    def _require_zero_to_four(cls, value: dict[str, str]) -> dict[str, str]:
        missing = [str(i) for i in range(5) if str(i) not in value]
        if missing:
            raise ValueError(f"anchors must define levels 0-4; missing {missing}")
        return value


class Rubric(BaseModel):
    version: str
    scale_max: int = 4
    criteria: list[RubricCriterion]


class CompletionContract(BaseModel):
    required_objective_ids: list[str] = Field(default_factory=list)
    required_action_ids: list[str] = Field(default_factory=list)
    summary_template: str = ""


class ReferencePath(BaseModel):
    id: str
    steps: list[str]
    is_preferred: bool = False


class ScenarioBlueprint(BaseModel):
    schema_version: int = 1
    family_slug: str
    version: int = 1
    title: str
    briefing: str
    role: str
    difficulty: Difficulty = "standard"
    mode: Mode = "quick"
    estimated_minutes: int = 10
    competency_goals: list[str] = Field(default_factory=list)
    locations: list[LocationDef]
    characters: list[CharacterBlueprint]
    facts: list[Fact]
    objectives: list[Objective]
    actions: list[ActionDefinition]
    objects: list[InteractiveObject] = Field(default_factory=list)
    tasks: list[TaskDef] = Field(default_factory=list)
    rubric: Rubric
    completion: CompletionContract
    reference_paths: list[ReferencePath] = Field(default_factory=list)
    initial_state: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict)

    # ---- convenience lookups -------------------------------------------------
    def action(self, action_id: str) -> ActionDefinition | None:
        return next((a for a in self.actions if a.id == action_id), None)

    def character(self, character_id: str) -> CharacterBlueprint | None:
        return next((c for c in self.characters if c.id == character_id), None)

    def fact(self, fact_id: str) -> Fact | None:
        return next((f for f in self.facts if f.id == fact_id), None)

    def objective(self, objective_id: str) -> Objective | None:
        return next((o for o in self.objectives if o.id == objective_id), None)

    def location_ids(self) -> set[str]:
        return {loc.id for loc in self.locations}
