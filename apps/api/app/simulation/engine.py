"""Deterministic simulation engine.

Only this module may commit consequential state changes. Model output is treated as a
proposal; ``apply_action`` re-validates every effect against the blueprint.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.schemas.runtime import SimulationState
from app.schemas.scenario import ActionDefinition, ScenarioBlueprint


@dataclass
class PendingEvent:
    event_type: str
    actor_type: str = "system"
    actor_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionResult:
    ok: bool
    reason: str | None = None
    code: str | None = None
    events: list[PendingEvent] = field(default_factory=list)
    newly_discovered_fact_ids: list[str] = field(default_factory=list)
    completed_objective_ids: list[str] = field(default_factory=list)
    blocked_by: str | None = None


def build_initial_state(blueprint: ScenarioBlueprint, scenario_version_id: str) -> SimulationState:
    objectives = {o.id: "active" for o in blueprint.objectives}
    tasks = {t.id: t.status for t in blueprint.tasks}
    character_knowledge = {c.id: list(c.initial_fact_ids) for c in blueprint.characters}
    available = [a.id for a in blueprint.actions if a.initially_available]
    facts: list[str] = []
    for fact in blueprint.facts:
        if fact.sensitivity == "public":
            facts.append(fact.id)
    state = SimulationState(
        scenario_version_id=scenario_version_id,
        family_slug=blueprint.family_slug,
        phase=str(blueprint.initial_state.get("phase", "investigate")),
        current_location_id=blueprint.initial_state.get(
            "start_location_id", blueprint.locations[0].id if blueprint.locations else ""
        ),
        active_character_id=None,
        objectives=objectives,
        tasks=tasks,
        facts_known=facts,
        character_knowledge=character_knowledge,
        incident=dict(blueprint.initial_state.get("incident", {})),
        available_actions=available,
        state_version=1,
        event_sequence=0,
    )
    return state


def _precondition_ok(blueprint: ScenarioBlueprint, state: SimulationState, cond) -> bool:
    if cond.kind == "fact_known":
        return cond.ref in state.facts_known
    if cond.kind == "action_done":
        return cond.ref in state.actions_done
    if cond.kind == "flag_equals":
        return state.flags.get(cond.ref) == cond.value
    if cond.kind == "objective_complete":
        return state.objectives.get(cond.ref) == "completed"
    return False


def is_action_available(state: SimulationState, action: ActionDefinition) -> bool:
    return action.initially_available or action.id in state.available_actions


def complete_fact_objectives(
    blueprint: ScenarioBlueprint, state: SimulationState
) -> tuple[list[str], list[PendingEvent]]:
    """Complete any objectives whose completed_by_facts are now all known."""
    completed: list[str] = []
    events: list[PendingEvent] = []
    for objective in blueprint.objectives:
        if (
            objective.completed_by_facts
            and state.objectives.get(objective.id) != "completed"
            and all(f in state.facts_known for f in objective.completed_by_facts)
        ):
            state.objectives[objective.id] = "completed"
            completed.append(objective.id)
            events.append(
                PendingEvent(
                    event_type="objective_completed",
                    payload={"objective_id": objective.id, "via": "fact"},
                )
            )
    return completed, events


def apply_action(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    action_id: str,
    payload: dict[str, Any] | None = None,
) -> ActionResult:
    payload = payload or {}
    action = blueprint.action(action_id)
    if action is None:
        return ActionResult(ok=False, code="unknown_action", reason=f"Unknown action '{action_id}'.")

    if not is_action_available(state, action):
        return ActionResult(
            ok=False, code="action_locked", reason=f"Action '{action_id}' is not available yet."
        )

    for cond in action.preconditions:
        if not _precondition_ok(blueprint, state, cond):
            return ActionResult(
                ok=False,
                code="precondition_failed",
                reason=cond.failure_message,
                blocked_by=cond.ref,
            )

    events: list[PendingEvent] = []
    newly: list[str] = []
    completed: list[str] = []

    for fact_id in action.effects.reveal_fact_ids:
        if fact_id not in state.facts_known and blueprint.fact(fact_id) is not None:
            state.facts_known.append(fact_id)
            newly.append(fact_id)
            events.append(
                PendingEvent(
                    event_type="fact_discovered",
                    actor_type="system",
                    payload={"fact_id": fact_id, "via_action": action_id},
                )
            )

    for objective_id in action.effects.complete_objective_ids:
        if blueprint.objective(objective_id) is not None and state.objectives.get(
            objective_id
        ) != "completed":
            state.objectives[objective_id] = "completed"
            completed.append(objective_id)
            events.append(
                PendingEvent(
                    event_type="objective_completed",
                    payload={"objective_id": objective_id, "via_action": action_id},
                )
            )

    for unlocked in action.effects.unlock_action_ids:
        if blueprint.action(unlocked) is not None and unlocked not in state.available_actions:
            state.available_actions.append(unlocked)
            events.append(
                PendingEvent(
                    event_type="action_unlocked", payload={"action_id": unlocked}
                )
            )

    for task_id, status in action.effects.set_task_status.items():
        if task_id in state.tasks:
            state.tasks[task_id] = status

    state.flags.update(action.effects.set_flag)

    if action.effects.advance_phase:
        state.phase = action.effects.advance_phase

    if action_id not in state.actions_done:
        state.actions_done.append(action_id)

    fact_completed, fact_events = complete_fact_objectives(blueprint, state)
    completed.extend(fact_completed)
    events.extend(fact_events)

    state.state_version += 1
    events.insert(
        0,
        PendingEvent(
            event_type="action_applied",
            actor_type="learner",
            payload={
                "action_id": action_id,
                "action_type": action.action_type,
                "blocked": False,
                "payload": {k: v for k, v in payload.items() if k != "text"},
            },
        ),
    )
    return ActionResult(
        ok=True, events=events, newly_discovered_fact_ids=newly, completed_objective_ids=completed
    )


def match_disclosures(
    blueprint: ScenarioBlueprint, state: SimulationState, character_id: str, message: str
) -> list[str]:
    """Return fact ids this character may reveal in response to ``message``."""
    character = blueprint.character(character_id)
    if character is None:
        return []
    text = message.lower()
    revealed: list[str] = []
    for rule in character.disclosure_rules:
        if any(k.lower() in text for k in rule.keywords):
            if all(a in state.actions_done for a in rule.requires_actions) and all(
                f in state.facts_known for f in rule.requires_facts
            ):
                if rule.fact_id not in revealed:
                    revealed.append(rule.fact_id)
    return revealed


def apply_disclosure(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    character_id: str,
    message: str,
) -> tuple[list[str], list[PendingEvent]]:
    facts = match_disclosures(blueprint, state, character_id, message)
    events: list[PendingEvent] = []
    newly: list[str] = []
    for fact_id in facts:
        if fact_id not in state.facts_known:
            state.facts_known.append(fact_id)
            newly.append(fact_id)
            events.append(
                PendingEvent(
                    event_type="fact_discovered",
                    actor_type="character",
                    actor_id=character_id,
                    payload={"fact_id": fact_id, "via": "conversation"},
                )
            )
        # A character aware of a fact retains it.
        if fact_id not in state.character_knowledge.get(character_id, []):
            state.character_knowledge.setdefault(character_id, []).append(fact_id)
    _, obj_events = complete_fact_objectives(blueprint, state)
    events.extend(obj_events)
    return newly, events


def completion_status(blueprint: ScenarioBlueprint, state: SimulationState) -> dict[str, Any]:
    required_objectives = [
        o.id for o in blueprint.objectives if o.required and o.id in blueprint.completion.required_objective_ids
    ]
    done_objectives = [o for o in required_objectives if state.objectives.get(o) == "completed"]
    missing_objectives = [o for o in required_objectives if state.objectives.get(o) != "completed"]
    missing_actions = [
        a for a in blueprint.completion.required_action_ids if a not in state.actions_done
    ]
    ready = not missing_objectives and not missing_actions
    return {
        "ready": ready,
        "required_objectives": required_objectives,
        "completed_objectives": done_objectives,
        "missing_objectives": missing_objectives,
        "missing_actions": missing_actions,
    }
