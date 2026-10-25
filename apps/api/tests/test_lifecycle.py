"""Company assessment lifecycle: stage, allowed actions and ordering."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.company import analytics, lifecycle

NOW = datetime(2026, 10, 25, 12, tzinfo=UTC)
LATER = NOW + timedelta(days=2)
EARLIER = NOW - timedelta(hours=1)


def row(**kw):
    return {"status": "pending", "assessment_status": "active", "due_at": LATER, "session_id": None, "created_at": NOW, **kw}


def test_pending_invitation_can_be_accepted_or_declined_but_not_started():
    st = lifecycle.stage(row(), NOW)
    assert st["stage"] == "invited" and st["can_accept"] and st["can_decline"]
    assert not st["can_start"]


def test_accepting_makes_it_ready_but_never_starts_it():
    st = lifecycle.stage(row(status="accepted"), NOW)
    assert st["stage"] == "ready" and st["can_start"] and st["attempt"] == "none"


def test_attempt_states_follow_the_session_and_evaluation():
    base = row(status="accepted", session_id="s1")
    assert lifecycle.stage({**base, "session_status": "active"}, NOW)["stage"] == "in_progress"
    assert lifecycle.stage({**base, "session_status": "completed"}, NOW)["stage"] == "submitted"
    assert lifecycle.stage({**base, "session_status": "completed", "evaluation_status": "completed"}, NOW)["stage"] == "evaluated"


def test_deadline_rules():
    assert lifecycle.stage(row(due_at=EARLIER), NOW)["stage"] == "expired"
    missed = lifecycle.stage(row(status="accepted", due_at=EARLIER), NOW)
    assert missed["stage"] == "missed" and not missed["can_start"]
    late = lifecycle.stage(row(status="accepted", due_at=EARLIER, session_id="s", session_status="active"), NOW)
    assert late["stage"] == "in_progress" and late["can_continue"] and "deadline" in late["note"]
    # A moved deadline applies immediately (derived, not stored).
    assert lifecycle.stage(row(status="accepted", due_at=None), NOW)["stage"] == "ready"


def test_withdrawals_and_declines():
    assert lifecycle.stage(row(status="revoked"), NOW)["stage"] == "withdrawn"
    assert lifecycle.stage(row(assessment_status="closed"), NOW)["stage"] == "expired"
    assert lifecycle.stage(row(status="accepted", assessment_status="closed"), NOW)["stage"] == "withdrawn"
    assert lifecycle.stage(row(status="declined"), NOW)["stage"] == "declined"
    # Finished work stays visible after a withdrawal.
    done = row(status="accepted", assessment_status="closed", session_id="s", session_status="completed", evaluation_status="completed")
    assert lifecycle.stage(done, NOW)["stage"] == "evaluated"


def test_sorting_puts_actions_first_then_nearest_deadline():
    rows = [
        row(status="accepted", session_id="s", session_status="completed"),
        row(status="accepted", due_at=NOW + timedelta(days=5)),
        row(),
        row(status="accepted", due_at=NOW + timedelta(hours=3)),
    ]
    ordered = sorted(rows, key=lambda r: lifecycle.sort_key(r, lifecycle.stage(r, NOW)))
    assert [lifecycle.stage(r, NOW)["stage"] for r in ordered] == ["invited", "ready", "ready", "submitted"]
    assert ordered[1]["due_at"] < ordered[2]["due_at"]


def test_company_side_statuses():
    a = {"status": "active", "due_at": datetime(2100, 1, 1, tzinfo=UTC)}  # analytics reads the real clock
    assert analytics.candidate_status(row(status="accepted"), a) == "accepted"
    assert analytics.candidate_status(row(status="declined"), a) == "declined"
    assert analytics.candidate_status(row(status="revoked"), a) == "revoked"
    assert analytics.candidate_status(row(status="accepted", session_id="s", session_status="completed"), a) == "submitted"
    assert analytics.candidate_status(row(email_status="sent"), {"status": "active", "due_at": datetime(2020, 1, 1, tzinfo=UTC)}) == "expired"
