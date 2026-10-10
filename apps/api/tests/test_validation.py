"""Blueprint validation and solvability tests."""

from __future__ import annotations

from app.simulation.templates import build_production_incident
from app.simulation.validation import validate_blueprint


def test_default_template_is_valid() -> None:
    for seed in (1, 42, 777, 123456):
        blueprint = build_production_incident(seed=seed)
        report = validate_blueprint(blueprint)
        assert report.ok, report.errors


def test_duplicate_action_id_is_rejected() -> None:
    blueprint = build_production_incident(seed=1)
    blueprint.actions[1].id = blueprint.actions[0].id
    report = validate_blueprint(blueprint)
    assert not report.ok
    assert any("Duplicate actions ids" in e for e in report.errors)


def test_unknown_character_location_is_rejected() -> None:
    blueprint = build_production_incident(seed=1)
    blueprint.characters[0].location_id = "nonexistent_room"
    report = validate_blueprint(blueprint)
    assert not report.ok
    assert any("unknown location" in e for e in report.errors)


def test_required_fact_without_discovery_is_rejected() -> None:
    blueprint = build_production_incident(seed=1)
    # Remove every discovery mechanism for a hidden fact.
    target = "f_error_logs"
    for fact in blueprint.facts:
        if fact.id == target:
            fact.discovered_by_actions = []
            fact.initially_known_by = []
    for character in blueprint.characters:
        character.disclosure_rules = [r for r in character.disclosure_rules if r.fact_id != target]
    report = validate_blueprint(blueprint)
    assert not report.ok
    assert any("no permitted discovery mechanism" in e for e in report.errors)


def test_unreachable_required_objective_is_rejected() -> None:
    blueprint = build_production_incident(seed=1)
    for action in blueprint.actions:
        action.effects.complete_objective_ids = [
            o for o in action.effects.complete_objective_ids if o != "o_choose_mitigation"
        ]
    report = validate_blueprint(blueprint)
    assert not report.ok
    assert any("unreachable" in e for e in report.errors)


def test_missing_evidence_mapping_is_rejected() -> None:
    blueprint = build_production_incident(seed=1)
    blueprint.metadata["evidence_map"].pop("communication")
    report = validate_blueprint(blueprint)
    assert not report.ok
    assert any("no evidence source mapping" in e for e in report.errors)


def test_reference_path_reaches_completion() -> None:
    blueprint = build_production_incident(seed=3)
    report = validate_blueprint(blueprint)
    assert report.ok
    assert "No reference path completes" not in " ".join(report.warnings)
