"""Scenario catalogue, generation and instance management."""

from __future__ import annotations

import logging
import random
from typing import Any

from app.agents.ollama_cloud import OllamaCloudClient
from app.core.errors import NotFoundError, ValidationAppError
from app.db.repository import Repository
from app.schemas.runtime import SimulationState
from app.schemas.scenario import ActionDefinition, ScenarioBlueprint
from app.simulation.engine import is_action_available
from app.simulation.templates import TEMPLATE_CATALOG, TEMPLATE_SLUG, build_production_incident
from app.simulation.validation import validate_blueprint

logger = logging.getLogger(__name__)

VALIDATOR_VERSION = "validator-v1"
PROMPT_VERSION = "prompts-v1"


def _precondition_reason(blueprint: ScenarioBlueprint, state: SimulationState, action: ActionDefinition) -> str | None:
    for cond in action.preconditions:
        met = False
        if cond.kind == "fact_known":
            met = cond.ref in state.facts_known
        elif cond.kind == "action_done":
            met = cond.ref in state.actions_done
        elif cond.kind == "flag_equals":
            met = state.flags.get(cond.ref) == cond.value
        elif cond.kind == "objective_complete":
            met = state.objectives.get(cond.ref) == "completed"
        if not met:
            return cond.failure_message
    return None


def world_view(blueprint: ScenarioBlueprint, state: SimulationState) -> dict[str, Any]:
    """Public, game-facing view of the world. Contains no hidden facts."""
    actions = []
    for action in blueprint.actions:
        unlocked = is_action_available(state, action)
        reason = _precondition_reason(blueprint, state, action)
        actions.append(
            {
                "id": action.id,
                "label": action.label,
                "description": action.description,
                "action_type": action.action_type,
                "kind": action.kind,
                "location_id": action.location_id,
                "target_id": action.target_id,
                "risk_level": action.risk_level,
                "requires_text": action.requires_text,
                "available": unlocked,
                "ready": unlocked and reason is None,
                "locked_reason": None if reason is None else reason,
            }
        )
    return {
        "locations": [
            {"id": loc.id, "name": loc.name, "kind": loc.kind, "description": loc.description}
            for loc in blueprint.locations
        ],
        "characters": [
            {
                "id": c.id,
                "name": c.name,
                "role": c.role,
                "sprite": c.sprite,
                "location_id": c.location_id,
                "greeting": c.greeting,
            }
            for c in blueprint.characters
        ],
        "objects": [
            {"id": o.id, "label": o.label, "location_id": o.location_id, "marker": o.marker}
            for o in blueprint.objects
        ],
        "actions": actions,
    }


async def ensure_seed_templates(repo: Repository) -> None:
    for entry in TEMPLATE_CATALOG:
        await repo.ensure_template(entry["slug"], entry["title"], entry["summary"], entry)


async def list_catalog(repo: Repository) -> list[dict[str, Any]]:
    rows = await repo.list_templates()
    if rows:
        return rows
    await ensure_seed_templates(repo)
    return await repo.list_templates()


def _build_blueprint(
    *,
    seed: int,
    difficulty: str,
    mode: str,
    role: str,
    variation_request: str,
    profile_goals: list[str] | None,
) -> ScenarioBlueprint:
    return build_production_incident(
        seed=seed,
        difficulty=difficulty,
        mode=mode,
        role=role,
        variation_request=variation_request,
        profile_goals=profile_goals,
    )


async def create_instance(
    *,
    repo: Repository,
    ai: OllamaCloudClient,
    user_id: str,
    profile: dict[str, Any] | None,
    template_slug: str = TEMPLATE_SLUG,
    mode: str = "quick",
    difficulty: str = "standard",
    learning_objectives: list[str] | None = None,
    variation_request: str = "",
) -> dict[str, Any]:
    template = await repo.get_template_by_slug(template_slug)
    if template is None:
        await ensure_seed_templates(repo)
        template = await repo.get_template_by_slug(template_slug)
    if template is None:
        raise NotFoundError("Scenario template not found.")

    role = (profile or {}).get("target_role") or "Junior Software Engineer"
    profile_goals = list(learning_objectives or []) or list((profile or {}).get("career_goals") or [])
    seed = random.randint(1, 2_000_000_000)

    blueprint = _build_blueprint(
        seed=seed,
        difficulty=difficulty,
        mode=mode,
        role=role,
        variation_request=variation_request,
        profile_goals=profile_goals,
    )

    # Scenario generation is deterministic so a session can start immediately. The hosted
    # model is reserved for dialogue and evaluation (the latency-sensitive path).
    generator_model: str | None = None

    report = validate_blueprint(blueprint)
    if not report.ok:
        logger.warning("generated_blueprint_invalid", extra={"event": "fallback"})
        blueprint = _build_blueprint(
            seed=0,
            difficulty=difficulty,
            mode=mode,
            role=role,
            variation_request=variation_request,
            profile_goals=profile_goals,
        )
        report = validate_blueprint(blueprint)
        if not report.ok:
            raise ValidationAppError(
                "Unable to produce a valid scenario. Please retry.", code="scenario_invalid"
            )

    rubric_snapshot = blueprint.rubric.model_dump()
    profile_snapshot = {
        "target_role": role,
        "career_goals": profile_goals,
        "experience_level": (profile or {}).get("experience_level"),
    }
    version_number = await repo.next_version_number(str(template["id"]))
    row = await repo.insert_scenario_version(
        template_id=str(template["id"]),
        version_number=version_number,
        created_by=user_id,
        difficulty=difficulty,
        mode=mode,
        variation_seed=str(seed),
        blueprint=blueprint.model_dump(),
        rubric_snapshot=rubric_snapshot,
        profile_snapshot=profile_snapshot,
        validation_report=report.__dict__,
        generator_provider="ollama" if generator_model else "deterministic",
        generator_model=generator_model,
        prompt_version=PROMPT_VERSION,
        validator_version=VALIDATOR_VERSION,
    )

    return {
        "scenario_instance_id": str(row["id"]),
        "template_id": str(template["id"]),
        "scenario_version": row["version_number"],
        "status": "validated",
        "prebrief": prebrief(blueprint),
        "world": world_view(blueprint, _empty_state(blueprint, str(row["id"]))),
        "validation_summary": {
            "schema_valid": True,
            "objective_coverage": True,
            "reachable_terminal_state": True,
            "warnings": report.warnings,
        },
    }


def _empty_state(blueprint: ScenarioBlueprint, version_id: str) -> SimulationState:
    from app.simulation.engine import build_initial_state

    return build_initial_state(blueprint, version_id)


def prebrief(blueprint: ScenarioBlueprint) -> dict[str, Any]:
    return {
        "title": blueprint.title,
        "role": blueprint.role,
        "difficulty": blueprint.difficulty,
        "estimated_minutes": blueprint.estimated_minutes,
        "briefing": blueprint.briefing,
        "objectives": [o.label for o in blueprint.objectives if o.required],
        "competency_goals": blueprint.competency_goals,
        "controls": [
            "Move with WASD or arrow keys; press E near a highlight to interact",
            "Use the quick-action panel to interact without walking",
            "Open a character to chat at any time",
        ],
        "incident": blueprint.initial_state.get("incident", {}),
        "people": [
            {
                "id": c.id,
                "name": c.name,
                "role": c.role,
                "location": next((loc.name for loc in blueprint.locations if loc.id == c.location_id), c.location_id),
                "knows_about": bool(c.disclosure_rules),
            }
            for c in blueprint.characters
        ],
        "assessed": [
            {"id": c.id, "name": c.name, "description": c.description, "great": c.anchors.get("4", "")}
            for c in blueprint.rubric.criteria
        ],
        "tips": [
            "Talk like you would on a real call: one short question at a time.",
            "Ask before you act — the people around you hold facts the consoles don't.",
            "Check that a rollback is safe before you press it.",
            "Your status update should say impact, cause, action, next update time and owner.",
        ],
    }


async def get_instance(repo: Repository, user_id: str, instance_id: str) -> dict[str, Any]:
    row = await repo.get_scenario_version(instance_id)
    if row is None or str(row.get("created_by")) != str(user_id):
        raise NotFoundError("Scenario instance not found.")
    blueprint = ScenarioBlueprint.model_validate(row["blueprint"])
    state = _empty_state(blueprint, instance_id)
    return {
        "scenario_instance_id": str(row["id"]),
        "template_id": str(row["template_id"]),
        "scenario_version": row["version_number"],
        "status": row["status"],
        "prebrief": prebrief(blueprint),
        "world": world_view(blueprint, state),
    }


async def load_blueprint(repo: Repository, version_id: str) -> tuple[ScenarioBlueprint, dict[str, Any]]:
    row = await repo.get_scenario_version(version_id)
    if row is None:
        raise NotFoundError("Scenario version not found.")
    return ScenarioBlueprint.model_validate(row["blueprint"]), row
