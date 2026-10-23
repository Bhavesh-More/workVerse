"""Evidence Ledger + conversation analysis tests."""

from __future__ import annotations

from app.evaluation.evaluator import _validate_coaching
from app.evaluation.ledger import (
    build_ledger,
    conversation_stats,
    is_question,
    say_next_time,
    update_checklist,
)
from app.schemas.ai import CoachingSuggestion, EvaluationSuggestion
from app.schemas.runtime import SimulationState
from app.simulation.templates import build_production_incident


def _session():
    bp = build_production_incident(seed=3)
    state = SimulationState(
        actions_done=["a_inspect_logs", "a_check_migration_compat", "a_apply_rollback", "a_send_status_update"],
        facts_known=["f_migration_ran", "f_business_impact"],
        flags={"mitigation": "rollback"},
    )
    events = [
        {"id": "e1", "event_type": "action_applied", "payload": {"action_id": "a_inspect_logs"}},
        {"id": "e2", "event_type": "action_applied", "payload": {"action_id": "a_check_migration_compat"}},
        {"id": "e3", "event_type": "fact_discovered", "payload": {"fact_id": "f_migration_ran"}},
    ]
    update = "Impact: 24% of checkout failing. Cause: migration. We rolled back. Next update at 3:15pm. I'm the owner."
    messages = [
        {"id": "m1", "speaker_type": "learner", "character_id": "teammate", "content": "Did the deploy include a migration?"},
        {"id": "m2", "speaker_type": "character", "character_id": "teammate", "content": "Yes, one schema change."},
        {"id": "m3", "speaker_type": "learner", "character_id": "manager", "content": " ".join(["word"] * 50)},
        {"id": "m4", "speaker_type": "learner", "character_id": None, "content": update},
    ]
    deliverables = [{"id": "d1", "inline_text": update}]
    return bp, state, messages, events, deliverables


def test_ledger_links_passed_checks_to_records_and_flags_misses() -> None:
    bp, state, messages, events, deliverables = _session()
    ledger = build_ledger(bp, state, messages, events, deliverables)
    assert set(ledger) == {c.id for c in bp.rubric.criteria}
    diag = {c["id"]: c for c in ledger["diagnosis"]}
    assert diag["logs"]["passed"] and diag["logs"]["source_id"] == "e1"
    assert not diag["metrics"]["passed"] and diag["metrics"]["source_id"] is None
    risk = {c["id"]: c for c in ledger["risk_decision"]}
    assert risk["compat_first"]["passed"]
    comm = {c["id"]: c for c in ledger["communication"]}
    assert all(comm[k]["passed"] for k in ("update_sent", "update_impact", "update_cause", "update_action", "update_next_update", "update_owner"))
    assert comm["update_sent"]["source_id"] == "d1"
    tips = say_next_time(ledger, bp)
    assert any(t["say"].startswith("Did CI") for t in tips) and len(tips) <= 4


def test_conversation_stats_excludes_status_update_and_flags_long_turns() -> None:
    bp, _, messages, _, deliverables = _session()
    stats = conversation_stats(bp, messages, deliverables)
    assert stats["learner_turns"] == 2
    assert stats["questions"] == 1
    assert stats["long_turns"] == 1
    assert {p["character_id"] for p in stats["people"]} == {"teammate", "manager"}


def test_update_checklist_detects_missing_parts() -> None:
    checks = {c["id"]: c["passed"] for c in update_checklist("We are looking into it.")}
    assert not checks["impact"] and not checks["next_update"]
    assert is_question("how bad is it")


def test_coaching_only_keeps_real_learner_messages() -> None:
    _, _, messages, _, _ = _session()
    s = EvaluationSuggestion(
        coaching=[
            CoachingSuggestion(message_id="m3", better="How bad is it?", why="Shorter"),
            CoachingSuggestion(message_id="m2", better="npc message", why="x"),
            CoachingSuggestion(message_id="ghost", better="x", why="x"),
        ]
    )
    out = _validate_coaching(s, messages)
    assert [c["message_id"] for c in out] == ["m3"]
    assert out[0]["original"] == messages[2]["content"]
