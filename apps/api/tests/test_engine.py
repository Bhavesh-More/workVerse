"""Deterministic simulation engine tests (no network, no database)."""

from __future__ import annotations

from app.simulation.engine import (
    apply_action,
    apply_disclosure,
    build_initial_state,
    completion_status,
    match_disclosures,
)
from app.simulation.templates import build_production_incident


def _bp():
    return build_production_incident(seed=11)


def test_initial_state_starts_public_only() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    assert state.facts_known == ["f_initial_5xx"]
    assert state.state_version == 1


def test_unsafe_rollback_is_blocked_before_compat_check() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    result = apply_action(bp, state, "a_apply_rollback")
    assert not result.ok
    assert result.code == "precondition_failed"
    assert "a_apply_rollback" not in state.actions_done
    assert state.state_version == 1


def test_unknown_action_rejected() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    result = apply_action(bp, state, "a_does_not_exist")
    assert not result.ok
    assert result.code == "unknown_action"


def test_manager_cannot_reveal_teammate_scoped_fact() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    revealed = match_disclosures(bp, state, "manager", "tell me about the database migration")
    assert "f_migration_ran" not in revealed
    assert "f_migration_incompatible" not in revealed


def test_teammate_reveals_migration_fact_on_question() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    revealed = match_disclosures(bp, state, "teammate", "did the deploy include a migration?")
    assert "f_migration_ran" in revealed


def test_disclosure_completes_fact_objective() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "what is the customer impact?")
    assert state.objectives["o_establish_impact"] == "completed"


def test_full_reference_path_completes_scenario() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    apply_disclosure(bp, state, "manager", "customer impact?")
    apply_disclosure(bp, state, "teammate", "did a migration ship?")
    for action_id in (
        "a_inspect_logs",
        "a_inspect_deploy",
        "a_check_migration_compat",
        "a_apply_forward_fix",
    ):
        assert apply_action(bp, state, action_id).ok
    assert apply_action(bp, state, "a_send_status_update", {"text": "status"}).ok
    assert completion_status(bp, state)["ready"] is True


def test_forward_fix_requires_knowing_incompatibility() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    result = apply_action(bp, state, "a_apply_forward_fix")
    assert not result.ok
    assert result.code == "precondition_failed"


def test_restart_service_is_a_distractor_that_does_not_mitigate() -> None:
    bp = _bp()
    state = build_initial_state(bp, "sv")
    result = apply_action(bp, state, "a_restart_service")
    assert result.ok
    assert state.objectives["o_choose_mitigation"] != "completed"
