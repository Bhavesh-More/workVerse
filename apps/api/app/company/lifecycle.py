"""Company assessment lifecycle, as the candidate and the company see it.

Three independent facts describe an assignment, and the visible stage is derived from them:

- invitation (assessment_invites.status): pending -> accepted | declined; the company can
  revoke a pending or accepted invitation.
- attempt (the simulation session, created only by an explicit start): none -> in_progress
  -> submitted -> evaluated (once the evaluation is ready).
- availability: the assessment may be withdrawn (closed) by the company, and its optional due
  date may pass. Both are read live, so a changed deadline applies without rewriting history.

Policies (documented in the README):
- Accepting never starts anything. Starting needs an accepted, unwithdrawn invitation before the
  due date. An attempt already in progress can still be finished after the deadline or a
  withdrawal (the candidate isn't cut off mid-task); the company sees it as late.
- After the due date a pending invitation expires (it can't be accepted) and an accepted but
  unstarted one is "missed".
- Submitted work stays visible whatever happens to the assessment afterwards.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

# stage -> (label, tone, sort priority). Lower priority = needs attention sooner.
STAGES: dict[str, tuple[str, str, int]] = {
    "invited": ("Invitation", "attention", 0),
    "in_progress": ("In progress", "active", 1),
    "ready": ("Ready to start", "ready", 2),
    "submitted": ("Submitted", "done", 3),
    "evaluated": ("Completed", "done", 4),
    "missed": ("Deadline passed", "muted", 5),
    "expired": ("Expired", "muted", 6),
    "declined": ("Declined", "muted", 7),
    "withdrawn": ("Withdrawn", "muted", 8),
}


def _aware(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, str):
        v = datetime.fromisoformat(v)
    return v if v.tzinfo else v.replace(tzinfo=UTC)


def attempt_of(inv: dict[str, Any]) -> str:
    if not inv.get("session_id"):
        return "none"
    if inv.get("evaluation_status") == "completed":
        return "evaluated"
    if inv.get("session_status") in ("processing", "completed"):
        return "submitted"
    return "in_progress"


def stage(inv: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Stage, label and allowed actions for one assignment (an invite row joined with its
    assessment status/due date and its session/evaluation status)."""
    now = now or datetime.now(UTC)
    invitation = inv.get("status") or "pending"
    attempt = attempt_of(inv)
    withdrawn = inv.get("assessment_status", "active") != "active"
    due = _aware(inv.get("due_at"))
    past_due = bool(due and now >= due)

    if invitation == "revoked":
        st = "withdrawn"
    elif attempt == "evaluated":
        st = "evaluated"
    elif attempt == "submitted":
        st = "submitted"
    elif attempt == "in_progress":
        st = "in_progress"
    elif invitation == "declined":
        st = "declined"
    elif invitation == "pending":
        st = "expired" if (withdrawn or past_due) else "invited"
    else:  # accepted, not started
        st = "withdrawn" if withdrawn else ("missed" if past_due else "ready")

    label, tone, priority = STAGES[st]
    note = ""
    if st == "in_progress" and past_due:
        note = "The deadline has passed. You can still finish; the company will see it was late."
    elif st == "in_progress" and withdrawn:
        note = "The company has closed this assessment, but you can finish the run you started."
    elif st == "expired":
        note = "The company withdrew this assessment." if withdrawn else "The deadline passed before the invitation was accepted."
    elif st == "missed":
        note = "The deadline passed before the assessment was started."
    elif st == "declined":
        note = "You declined this invitation. If the company invites you again, it will appear here."
    elif st == "withdrawn":
        note = "The company withdrew this invitation." if invitation == "revoked" else "The company closed this assessment."

    return {
        "stage": st,
        "label": label,
        "tone": tone,
        "priority": priority,
        "invitation": invitation,
        "attempt": attempt,
        "past_due": past_due,
        "withdrawn": withdrawn or invitation == "revoked",
        "note": note,
        "can_accept": st == "invited",
        "can_decline": st == "invited",
        "can_start": st == "ready",
        "can_continue": st == "in_progress",
        "can_view_results": st in ("submitted", "evaluated"),
    }


def sort_key(inv: dict[str, Any], st: dict[str, Any]) -> tuple:
    """Needs action first, then the nearest deadline, then the newest."""
    due = _aware(inv.get("due_at"))
    created = _aware(inv.get("created_at")) or datetime.min.replace(tzinfo=UTC)
    return (st["priority"], due is None, due or datetime.max.replace(tzinfo=UTC), -created.timestamp())
