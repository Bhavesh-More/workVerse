"""Navigation target resolution tests (no network, no database)."""

from __future__ import annotations

from app.simulation.engine import apply_action, apply_disclosure, build_initial_state
from app.simulation.navigation import resolve_navigation
from app.simulation.templates import build_production_incident


def _bp():
    return build_production_incident(seed=7)


def test_initial_target_points_to_manager_for_impact() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    nav = resolve_navigation(bp, state)
    assert nav is not None
    assert nav["objective_id"] == "o_establish_impact"
    assert nav["target_type"] == "character"
    assert nav["target_id"] == "manager"


def test_target_advances_after_objective_completes() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "what is the customer impact?")
    nav = resolve_navigation(bp, state)
    assert nav is not None
    assert nav["objective_id"] == "o_gather_evidence"
    assert nav["target_type"] == "object"
    assert nav["target_id"] == "log_viewer"


def test_locked_action_guides_to_fact_source_first() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "customer impact?")
    apply_action(bp, state, "a_inspect_logs")
    # o_identify_risk's only action is gated on f_migration_ran, known by the teammate.
    nav = resolve_navigation(bp, state)
    assert nav is not None
    assert nav["objective_id"] == "o_identify_risk"
    assert nav["target_type"] == "character"
    assert nav["target_id"] == "teammate"


def test_target_moves_to_object_once_precondition_known() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "customer impact?")
    apply_action(bp, state, "a_inspect_logs")
    apply_disclosure(bp, state, "teammate", "did a migration ship?")
    nav = resolve_navigation(bp, state)
    assert nav is not None
    assert nav["objective_id"] == "o_identify_risk"
    assert nav["target_type"] == "object"
    assert nav["target_id"] == "migration_notes"


def test_text_deliverable_has_no_physical_route() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "customer impact?")
    apply_action(bp, state, "a_inspect_logs")
    apply_disclosure(bp, state, "teammate", "did a migration ship?")
    apply_action(bp, state, "a_check_migration_compat")
    apply_action(bp, state, "a_apply_rollback")
    nav = resolve_navigation(bp, state)
    assert nav is not None
    assert nav["objective_id"] == "o_communicate"
    assert nav["target_type"] == "none"


def test_completed_scenario_has_no_target() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "customer impact?")
    apply_action(bp, state, "a_inspect_logs")
    apply_disclosure(bp, state, "teammate", "did a migration ship?")
    apply_action(bp, state, "a_check_migration_compat")
    apply_action(bp, state, "a_apply_rollback")
    apply_action(bp, state, "a_send_status_update", {"text": "status update"})
    apply_action(bp, state, "a_document_followup")
    assert resolve_navigation(bp, state) is None


def test_navigation_never_completes_objectives() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    before = dict(state.objectives)
    resolve_navigation(bp, state)
    assert state.objectives == before
