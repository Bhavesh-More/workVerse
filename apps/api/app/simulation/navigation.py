"""Task-aware navigation target resolution.

Derives, from the authoritative simulation state, the single next destination the
learner should walk to for their current actionable objective. This is guidance
only: it never mutates state, never completes objectives and never reveals hidden
facts. It resolves destinations to existing world entities (characters, interactive
objects, locations) so the client never invents coordinates of its own.

When the next action is blocked by a precondition, the resolver walks the
dependency backwards and points at wherever that missing fact/flag/action can be
obtained — this is what makes multi-step chains navigate to the correct place.
"""

from __future__ import annotations

from typing import Any

from app.schemas.runtime import SimulationState
from app.schemas.scenario import ActionDefinition, Objective, ScenarioBlueprint
from app.simulation.engine import is_action_available


def _preconditions_met(
    blueprint: ScenarioBlueprint, state: SimulationState, action: ActionDefinition
) -> bool:
    for cond in action.preconditions:
        if cond.kind == "fact_known":
            ok = cond.ref in state.facts_known
        elif cond.kind == "action_done":
            ok = cond.ref in state.actions_done
        elif cond.kind == "flag_equals":
            ok = state.flags.get(cond.ref) == cond.value
        elif cond.kind == "objective_complete":
            ok = state.objectives.get(cond.ref) == "completed"
        else:
            ok = False
        if not ok:
            return False
    return True


def _target(
    objective: Objective,
    action: ActionDefinition | None,
    *,
    target_type: str,
    target_id: str | None,
    location_id: str | None,
    ready: bool,
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "objective_id": objective.id,
        "objective_label": objective.label,
        "action_id": action.id if action else None,
        "action_label": action.label if action else None,
        "target_type": target_type,
        "target_id": target_id,
        "location_id": location_id,
        "ready": ready,
        "reason": reason,
    }


def _has_destination(action: ActionDefinition) -> bool:
    return bool(action.actor_id or action.target_id or action.location_id)


def _action_target(
    objective: Objective, action: ActionDefinition, *, ready: bool
) -> dict[str, Any]:
    if action.actor_id:
        return _target(
            objective,
            action,
            target_type="character",
            target_id=action.actor_id,
            location_id=action.location_id,
            ready=ready,
        )
    if action.target_id:
        return _target(
            objective,
            action,
            target_type="object",
            target_id=action.target_id,
            location_id=action.location_id,
            ready=ready,
        )
    if action.location_id:
        return _target(
            objective,
            action,
            target_type="location",
            target_id=action.location_id,
            location_id=action.location_id,
            ready=ready,
        )
    # A text deliverable handled in the side panel has no physical destination.
    return _target(
        objective,
        action,
        target_type="none",
        target_id=None,
        location_id=None,
        ready=ready,
        reason="Complete this step from the side panel.",
    )


def _action_sets_flag(
    blueprint: ScenarioBlueprint, flag: str, value: str | None
) -> ActionDefinition | None:
    for action in blueprint.actions:
        if action.effects.set_flag.get(flag) == value:
            return action
    return None


def _fact_target(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    fact_id: str,
    objective: Objective,
    visited: set[str],
) -> dict[str, Any] | None:
    if fact_id in visited:
        return None
    visited.add(fact_id)
    # A character who already holds the fact is the fastest source.
    for character in blueprint.characters:
        if fact_id in character.initial_fact_ids or any(
            rule.fact_id == fact_id for rule in character.disclosure_rules
        ):
            return _target(
                objective,
                None,
                target_type="character",
                target_id=character.id,
                location_id=character.location_id,
                ready=True,
            )
    # Otherwise an action reveals it — guide to that action, or to whatever it needs first.
    for action in blueprint.actions:
        if fact_id in action.effects.reveal_fact_ids and action.id not in state.actions_done:
            if not is_action_available(state, action):
                continue
            if _preconditions_met(blueprint, state, action):
                return _action_target(objective, action, ready=True)
            nested = _precondition_target(blueprint, state, action, objective, visited)
            return nested or _action_target(objective, action, ready=False)
    return None


def _precondition_target(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    action: ActionDefinition,
    objective: Objective,
    visited: set[str],
) -> dict[str, Any] | None:
    for cond in action.preconditions:
        if cond.kind == "fact_known":
            if cond.ref not in state.facts_known:
                return _fact_target(blueprint, state, cond.ref, objective, visited)
        elif cond.kind == "action_done":
            if cond.ref not in state.actions_done:
                dep = blueprint.action(cond.ref)
                if dep is not None:
                    return _action_target(
                        objective, dep, ready=_preconditions_met(blueprint, state, dep)
                    )
        elif cond.kind == "flag_equals":
            if state.flags.get(cond.ref) != cond.value:
                dep = _action_sets_flag(blueprint, cond.ref, cond.value)
                if dep is not None and dep.id not in state.actions_done:
                    return _action_target(
                        objective, dep, ready=_preconditions_met(blueprint, state, dep)
                    )
        elif cond.kind == "objective_complete":
            if state.objectives.get(cond.ref) != "completed":
                dep_obj = blueprint.objective(cond.ref)
                if dep_obj is not None:
                    return _objective_target(blueprint, state, dep_obj, visited)
    return None


def _objective_target(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    objective: Objective,
    visited: set[str],
) -> dict[str, Any] | None:
    if state.objectives.get(objective.id) == "completed":
        return None
    # Facts first: they are usually learned from a character.
    for fact_id in objective.completed_by_facts:
        if fact_id not in state.facts_known:
            target = _fact_target(blueprint, state, fact_id, objective, visited)
            if target is not None:
                return target

    candidates = [
        action
        for action in (blueprint.action(aid) for aid in objective.completed_by_actions)
        if action is not None and action.id not in state.actions_done
    ]
    # Prefer actions that have a physical destination and are already unlocked.
    candidates.sort(key=lambda a: (0 if _has_destination(a) else 1, not a.initially_available))

    for action in candidates:
        if is_action_available(state, action) and _preconditions_met(blueprint, state, action):
            return _action_target(objective, action, ready=True)
    # Every available option is locked: navigate to whatever is missing.
    for action in candidates:
        if is_action_available(state, action):
            target = _precondition_target(blueprint, state, action, objective, visited)
            if target is not None:
                return target
    for action in candidates:
        target = _precondition_target(blueprint, state, action, objective, visited)
        if target is not None:
            return target
    return None


def _next_objective(blueprint: ScenarioBlueprint, state: SimulationState) -> Objective | None:
    return next(
        (
            o
            for o in blueprint.objectives
            if o.required and state.objectives.get(o.id) != "completed"
        ),
        None,
    ) or next(
        (o for o in blueprint.objectives if state.objectives.get(o.id) != "completed"), None
    )


def resolve_navigation(
    blueprint: ScenarioBlueprint, state: SimulationState
) -> dict[str, Any] | None:
    """Return the current navigation target for the active task, or ``None``."""
    objective = _next_objective(blueprint, state)
    if objective is None:
        return None
    return _objective_target(blueprint, state, objective, set())
