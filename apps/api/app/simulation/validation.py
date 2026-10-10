"""Deterministic scenario blueprint validation and solvability analysis."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.scenario import ScenarioBlueprint


@dataclass
class ValidationReport:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    closure_facts: list[str] = field(default_factory=list)
    closure_objectives: list[str] = field(default_factory=list)

    def add(self, error: str) -> None:
        self.errors.append(error)
        self.ok = False


def _duplicates(items: list[str]) -> list[str]:
    seen: set[str] = set()
    dups: set[str] = set()
    for i in items:
        if i in seen:
            dups.add(i)
        seen.add(i)
    return sorted(dups)


def compute_closure(blueprint: ScenarioBlueprint) -> tuple[set[str], set[str], set[str], set[str]]:
    """Fixed-point reachability over actions.

    Returns (facts_known, objectives_completed, actions_done, flags).
    """
    known: set[str] = {f.id for f in blueprint.facts if f.sensitivity == "public"}
    known.update(fid for c in blueprint.characters for fid in c.initial_fact_ids)
    actions_done: set[str] = set()
    objectives: set[str] = set()
    flags: dict[str, str] = {}
    available: set[str] = {a.id for a in blueprint.actions if a.initially_available}

    changed = True
    while changed:
        changed = False
        for action in blueprint.actions:
            if action.id in actions_done or action.id not in available:
                continue
            ok = True
            for cond in action.preconditions:
                if cond.kind == "fact_known" and cond.ref not in known:
                    ok = False
                elif cond.kind == "action_done" and cond.ref not in actions_done:
                    ok = False
                elif cond.kind == "flag_equals" and flags.get(cond.ref) != cond.value:
                    ok = False
                elif cond.kind == "objective_complete" and cond.ref not in objectives:
                    ok = False
                if not ok:
                    break
            if not ok:
                continue
            actions_done.add(action.id)
            changed = True
            for fact_id in action.effects.reveal_fact_ids:
                if fact_id not in known:
                    known.add(fact_id)
                    changed = True
            for obj_id in action.effects.complete_objective_ids:
                objectives.add(obj_id)
            for unlocked in action.effects.unlock_action_ids:
                available.add(unlocked)
            flags.update(action.effects.set_flag)

    # Character disclosures expand reachable facts once prerequisites are satisfiable.
    for character in blueprint.characters:
        for rule in character.disclosure_rules:
            if all(a in actions_done for a in rule.requires_actions) and all(
                f in known for f in rule.requires_facts
            ):
                known.add(rule.fact_id)

    # Objectives completed by discovering facts.
    for objective in blueprint.objectives:
        if objective.completed_by_facts and all(f in known for f in objective.completed_by_facts):
            objectives.add(objective.id)

    return known, objectives, actions_done, set(flags.keys())


def validate_blueprint(blueprint: ScenarioBlueprint) -> ValidationReport:
    report = ValidationReport(ok=True)

    # SV-002 unique ids
    for name, ids in (
        ("facts", [f.id for f in blueprint.facts]),
        ("actions", [a.id for a in blueprint.actions]),
        ("characters", [c.id for c in blueprint.characters]),
        ("objectives", [o.id for o in blueprint.objectives]),
        ("locations", [loc.id for loc in blueprint.locations]),
        ("objects", [o.id for o in blueprint.objects]),
        ("tasks", [t.id for t in blueprint.tasks]),
        ("criteria", [c.id for c in blueprint.rubric.criteria]),
    ):
        dups = _duplicates(ids)
        if dups:
            report.add(f"Duplicate {name} ids: {dups}")

    fact_ids = {f.id for f in blueprint.facts}
    action_ids = {a.id for a in blueprint.actions}
    character_ids = {c.id for c in blueprint.characters}
    objective_ids = {o.id for o in blueprint.objectives}
    location_ids = blueprint.location_ids()
    object_ids = {o.id for o in blueprint.objects}
    task_ids = {t.id for t in blueprint.tasks}

    for obj in blueprint.objects:
        if obj.location_id not in location_ids:
            report.add(f"Object '{obj.id}' references unknown location '{obj.location_id}'.")

    # SV-003 reference integrity
    for c in blueprint.characters:
        if c.location_id not in location_ids:
            report.add(f"Character '{c.id}' references unknown location '{c.location_id}'.")
        for fid in c.initial_fact_ids:
            if fid not in fact_ids:
                report.add(f"Character '{c.id}' references unknown fact '{fid}'.")
        for rule in c.disclosure_rules:
            if rule.fact_id not in fact_ids:
                report.add(f"Disclosure rule references unknown fact '{rule.fact_id}'.")
            for ref in rule.requires_actions:
                if ref not in action_ids:
                    report.add(f"Disclosure rule for '{rule.fact_id}' requires unknown action '{ref}'.")
            for ref in rule.requires_facts:
                if ref not in fact_ids:
                    report.add(f"Disclosure rule for '{rule.fact_id}' requires unknown fact '{ref}'.")

    for a in blueprint.actions:
        if a.location_id and a.location_id not in location_ids:
            report.add(f"Action '{a.id}' references unknown location '{a.location_id}'.")
        if a.target_id:
            valid_targets = location_ids | character_ids | fact_ids | action_ids | object_ids
            if a.target_id not in valid_targets:
                report.add(f"Action '{a.id}' references unknown target '{a.target_id}'.")
        if a.actor_id and a.actor_id not in character_ids:
            report.add(f"Action '{a.id}' references unknown actor '{a.actor_id}'.")
        for fid in a.effects.reveal_fact_ids:
            if fid not in fact_ids:
                report.add(f"Action '{a.id}' reveals unknown fact '{fid}'.")
        for oid in a.effects.complete_objective_ids:
            if oid not in objective_ids:
                report.add(f"Action '{a.id}' completes unknown objective '{oid}'.")
        for uid in a.effects.unlock_action_ids:
            if uid not in action_ids:
                report.add(f"Action '{a.id}' unlocks unknown action '{uid}'.")
        for tid in a.effects.set_task_status:
            if tid not in task_ids:
                report.add(f"Action '{a.id}' sets unknown task '{tid}'.")
        for cond in a.preconditions:
            if cond.kind in ("fact_known",) and cond.ref not in fact_ids:
                report.add(f"Action '{a.id}' precondition references unknown fact '{cond.ref}'.")
            if cond.kind == "action_done" and cond.ref not in action_ids:
                report.add(f"Action '{a.id}' precondition references unknown action '{cond.ref}'.")
            if cond.kind == "objective_complete" and cond.ref not in objective_ids:
                report.add(f"Action '{a.id}' precondition references unknown objective '{cond.ref}'.")

    for o in blueprint.objectives:
        for ref in o.completed_by_actions:
            if ref not in action_ids:
                report.add(f"Objective '{o.id}' references unknown action '{ref}'.")
        for ref in o.completed_by_facts:
            if ref not in fact_ids:
                report.add(f"Objective '{o.id}' references unknown fact '{ref}'.")
        if o.required and not (o.completed_by_actions or o.completed_by_facts):
            report.add(f"Objective '{o.id}' is required but has no observable completion source.")

    for ref in blueprint.completion.required_objective_ids:
        if ref not in objective_ids:
            report.add(f"Completion contract references unknown objective '{ref}'.")
    for ref in blueprint.completion.required_action_ids:
        if ref not in action_ids:
            report.add(f"Completion contract references unknown action '{ref}'.")

    for path in blueprint.reference_paths:
        for step in path.steps:
            if step not in action_ids:
                report.add(f"Reference path '{path.id}' references unknown action '{step}'.")

    # SV-008 precondition completeness for consequential actions
    for a in blueprint.actions:
        if a.kind in ("decision", "mitigation", "communication", "completion") and not a.preconditions:
            report.warnings.append(
                f"Consequential action '{a.id}' ({a.kind}) declares no preconditions."
            )

    # SV-005 rubric coverage via metadata.evidence_map
    evidence_map = blueprint.metadata.get("evidence_map", {})
    for criterion in blueprint.rubric.criteria:
        sources = evidence_map.get(criterion.id)
        if not sources:
            report.add(f"Rubric criterion '{criterion.id}' has no evidence source mapping.")

    # SV-006 knowledge permissions
    for fact in blueprint.facts:
        if (
            fact.sensitivity in ("internal", "restricted")
            and not fact.discovered_by_actions
            and not fact.initially_known_by
            and not any(
                rule.fact_id == fact.id
                for c in blueprint.characters
                for rule in c.disclosure_rules
            )
        ):
            report.add(f"Fact '{fact.id}' has no permitted discovery mechanism.")

    # SV-009 bounds
    if blueprint.estimated_minutes <= 0:
        report.add("estimated_minutes must be positive.")
    if not blueprint.locations:
        report.add("Scenario must define at least one location.")
    if not blueprint.characters:
        report.add("Scenario must define at least one character.")

    # SV-007 / solvability
    known, objectives, actions_done, _ = compute_closure(blueprint)
    report.closure_facts = sorted(known)
    report.closure_objectives = sorted(objectives)

    unreachable_facts = sorted(fact_ids - known)
    if unreachable_facts:
        report.add(f"Facts not reachable through any permitted action: {unreachable_facts}")

    required = {o.id for o in blueprint.objectives if o.required}
    unreachable_objectives = sorted(required - objectives)
    if unreachable_objectives:
        report.add(f"Required objectives unreachable: {unreachable_objectives}")

    missing_actions = sorted(set(blueprint.completion.required_action_ids) - actions_done)
    if missing_actions:
        report.add(f"Completion actions not reachable: {missing_actions}")

    if not blueprint.reference_paths:
        report.warnings.append("No reference solution path was provided.")
    else:
        required_set = set(blueprint.completion.required_objective_ids)
        if not any(required_set <= _simulate_path(blueprint, path.steps)[1] for path in blueprint.reference_paths):
            report.warnings.append("No reference path completes every required objective.")

    return report


def _simulate_path(blueprint: ScenarioBlueprint, steps: list[str]) -> tuple[set[str], set[str]]:
    facts: set[str] = {f.id for f in blueprint.facts if f.sensitivity == "public"}
    facts.update(fid for c in blueprint.characters for fid in c.initial_fact_ids)
    objectives: set[str] = set()
    for step in steps:
        action = blueprint.action(step)
        if action:
            facts.update(action.effects.reveal_fact_ids)
            objectives.update(action.effects.complete_objective_ids)
    for objective in blueprint.objectives:
        if objective.completed_by_facts and all(f in facts for f in objective.completed_by_facts):
            objectives.add(objective.id)
    return facts, objectives
