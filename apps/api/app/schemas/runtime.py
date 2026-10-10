"""Authoritative runtime session state."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SimulationState(BaseModel):
    schema_version: int = 1
    scenario_version_id: str = ""
    family_slug: str = ""
    phase: str = "investigate"
    current_location_id: str = ""
    active_character_id: str | None = None
    objectives: dict[str, str] = Field(default_factory=dict)  # id -> active|completed
    tasks: dict[str, str] = Field(default_factory=dict)  # id -> locked|available|completed
    facts_known: list[str] = Field(default_factory=list)
    flags: dict[str, str] = Field(default_factory=dict)
    incident: dict[str, Any] = Field(default_factory=dict)
    character_knowledge: dict[str, list[str]] = Field(default_factory=dict)
    actions_done: list[str] = Field(default_factory=list)
    available_actions: list[str] = Field(default_factory=list)
    state_version: int = 1
    event_sequence: int = 0
    completed: bool = False

    def knows_fact(self, fact_id: str) -> bool:
        return fact_id in self.facts_known
