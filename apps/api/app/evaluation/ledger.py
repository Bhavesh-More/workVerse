"""Evidence Ledger and conversation analysis.

Everything here is deterministic: computed from persisted events, messages and deliverables,
never from model output. The ledger shows *why* each criterion got its feedback by listing the
concrete checks behind it, each pointing at the record that proves it (or marked as missed).
"""

from __future__ import annotations

import re
from statistics import median
from typing import Any

from app.schemas.runtime import SimulationState
from app.schemas.scenario import ScenarioBlueprint

LONG_TURN_WORDS = 40  # spoken workplace turns are mostly 5-25 words; 40+ reads like an essay
_WORD = re.compile(r"[A-Za-z0-9']+")
_QUESTION_START = re.compile(
    r"^\s*(who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|have|has|any)\b",
    re.I,
)

# Status-update checklist: what a stakeholder needs to hear, and a plain-language test for each.
UPDATE_CHECKS: list[tuple[str, str, re.Pattern[str]]] = [
    ("impact", "Says who/what is affected", re.compile(r"\d+\s*%|impact|customer|user|checkout|order|affect|fail|sign.?up|shopper|revenue|numbers|report", re.I)),
    ("cause", "Names the likely cause", re.compile(r"cause|migration|deploy|release|schema|column|because|due to|api|field|rename|pipeline|upstream|launch|flag|sms|verification", re.I)),
    ("action", "Says what was done", re.compile(r"roll(ed)?\s*back|revert|forward.?fix|hotfix|mitigat|fix(ed)?|applied|restor|patch|backfill|optional|turn(ed)?\s*off|pause", re.I)),
    ("next_update", "Commits to a next update time", re.compile(r"next update|update (you|again|in|at|by)|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b|in \d+\s*(min|minutes|hour)", re.I)),
    ("owner", "States who owns it", re.compile(r"\bI('m| am| will|'ll)\b|\bowner\b|\bon.?call\b|\bI\b.*(own|lead|handl)", re.I)),
]

# Concrete lines a learner can say next time when a check was missed (scenario: production incident).
SAY_NEXT_TIME: dict[str, dict[str, str]] = {
    "impact_known": {"to": "manager", "say": "Quick one: how many customers are hit, and when do you need an update?"},
    "migration_known": {"to": "teammate", "say": "Did this deploy include a DB migration?"},
    "compat_checked": {"to": "teammate", "say": "Before I roll back, is the migration backward compatible?"},
    "talked_qa": {"to": "qa", "say": "Did CI run the integration tests on this release?"},
    "talked_client": {"to": "client_pm", "say": "We're on it. I'll update you by the top of the hour."},
    "right_fix": {"to": "teammate", "say": "Rollback won't fix the schema. Can we ship a forward fix instead?"},
    "update_sent": {"to": "stakeholders", "say": "Impact: X% of checkout failing. Cause: migration. Action: rolling back. Next update 15 min. Owner: me."},
}


def words(text: str) -> int:
    return len(_WORD.findall(text or ""))


def is_question(text: str) -> bool:
    return "?" in (text or "") or bool(_QUESTION_START.match(text or ""))


def _event_for_action(events: list[dict[str, Any]], action_id: str) -> str | None:
    for e in events:
        if e["event_type"] == "action_applied" and (e.get("payload") or {}).get("action_id") == action_id:
            return str(e["id"])
    return None


def _event_for_fact(events: list[dict[str, Any]], fact_id: str) -> str | None:
    for e in events:
        if e["event_type"] == "fact_discovered" and (e.get("payload") or {}).get("fact_id") == fact_id:
            return str(e["id"])
    return None


def _first_message_to(messages: list[dict[str, Any]], character_id: str) -> str | None:
    for m in messages:
        if m["speaker_type"] == "learner" and m.get("character_id") == character_id:
            return str(m["id"])
    return None


def _check(cid: str, label: str, passed: bool, source_type: str | None, source_id: str | None, detail: str = "") -> dict[str, Any]:
    return {
        "id": cid,
        "label": label,
        "passed": bool(passed),
        "source_type": source_type if passed and source_id else None,
        "source_id": source_id if passed else None,
        "detail": detail,
    }


def update_checklist(text: str) -> list[dict[str, Any]]:
    return [{"id": cid, "label": label, "passed": bool(rx.search(text or ""))} for cid, label, rx in UPDATE_CHECKS]


def build_ledger(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    messages: list[dict[str, Any]],
    events: list[dict[str, Any]],
    deliverables: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Per-criterion list of verifiable checks. Unknown criteria simply get no checks."""
    done = state.actions_done
    known = set(state.facts_known)
    # Labels come from the blueprint so each role track reads in its own words.
    A = {a.id: a.label for a in blueprint.actions}  # noqa: N806
    F = {f.id: f.label for f in blueprint.facts}  # noqa: N806
    R = {c.id: c.role for c in blueprint.characters}  # noqa: N806
    ev = lambda a: _event_for_action(events, a)  # noqa: E731
    fact_ev = lambda f: _event_for_fact(events, f)  # noqa: E731
    rejected = [e for e in events if e["event_type"] == "decision_rejected"]
    update = deliverables[-1] if deliverables else None
    update_text = (update or {}).get("inline_text") or ""
    consulted = {m.get("character_id") for m in messages if m["speaker_type"] == "learner" and m.get("character_id")}

    compat_before = (
        "a_check_migration_compat" in done
        and state.flags.get("mitigation") in {"rollback", "forward_fix"}
        and done.index("a_check_migration_compat")
        < max(done.index(a) for a in ("a_apply_rollback", "a_apply_forward_fix") if a in done)
    ) if any(a in done for a in ("a_apply_rollback", "a_apply_forward_fix")) else False

    ledger: dict[str, list[dict[str, Any]]] = {
        "diagnosis": [
            _check("logs", A["a_inspect_logs"], "a_inspect_logs" in done, "event", ev("a_inspect_logs")),
            _check("metrics", A["a_inspect_metrics"], "a_inspect_metrics" in done, "event", ev("a_inspect_metrics")),
            _check("dashboard", A["a_inspect_dashboard"], "a_inspect_dashboard" in done, "event", ev("a_inspect_dashboard")),
            _check("migration_known", f"Learned: {F['f_migration_ran']}", "f_migration_ran" in known, "event", fact_ev("f_migration_ran")),
        ],
        "risk_decision": [
            _check("compat_checked", A["a_check_migration_compat"], "a_check_migration_compat" in done, "event", ev("a_check_migration_compat")),
            _check("compat_first", f"{A['a_check_migration_compat']} before fixing", compat_before, "event", ev("a_check_migration_compat")),
            _check(
                "right_fix",
                f"Chose: {A['a_apply_forward_fix']} (undoing can't fix this change)",
                state.flags.get("mitigation") == "forward_fix",
                "event",
                ev("a_apply_forward_fix"),
            ),
            _check("runbook", A["a_inspect_runbook"], "a_inspect_runbook" in done, "event", ev("a_inspect_runbook")),
            _check(
                "no_blocked",
                "No unsafe action was blocked",
                not rejected,
                None,
                None,
                f"{len(rejected)} blocked attempt(s)" if rejected else "",
            ),
        ],
        "communication": [
            _check("update_sent", "Sent a stakeholder update", update is not None, "deliverable", str(update["id"]) if update else None),
            *[
                _check(f"update_{c['id']}", c["label"], c["passed"], "deliverable", str(update["id"]) if update else None)
                for c in (update_checklist(update_text) if update else [])
            ],
            _check(
                "update_concise",
                "Update is short enough to read in 20 seconds (≤ 80 words)",
                update is not None and words(update_text) <= 80,
                "deliverable",
                str(update["id"]) if update else None,
                f"{words(update_text)} words" if update else "",
            ),
        ],
        "ownership": [
            _check("impact_known", f"Asked the {R['manager']} about impact", "f_business_impact" in known, "event", fact_ev("f_business_impact")),
            _check("talked_qa", f"Talked to the {R['qa']}", "qa" in consulted, "message", _first_message_to(messages, "qa")),
            _check("talked_client", f"Kept the {R['client_pm']} informed", "client_pm" in consulted, "message", _first_message_to(messages, "client_pm")),
            _check("followup", "Documented a follow-up", "a_document_followup" in done, "event", ev("a_document_followup")),
        ],
        "adaptation": [
            _check("mitigated", f"Applied a real fix (not just: {A['a_restart_service']})", state.flags.get("mitigation") in {"rollback", "forward_fix"}, "event", ev("a_apply_rollback") or ev("a_apply_forward_fix")),
            _check("pool", f"Learned: {F['f_connection_pool']}", "f_connection_pool" in known, "event", fact_ev("f_connection_pool")),
            _check("deploy", A["a_inspect_deploy"], "a_inspect_deploy" in done, "event", ev("a_inspect_deploy")),
        ],
    }
    criterion_ids = {c.id for c in blueprint.rubric.criteria}
    return {k: v for k, v in ledger.items() if k in criterion_ids}


def conversation_stats(
    blueprint: ScenarioBlueprint,
    messages: list[dict[str, Any]],
    deliverables: list[dict[str, Any]],
) -> dict[str, Any]:
    """How the learner talked: turn length, questions, talk balance per colleague."""
    deliverable_texts = {(d.get("inline_text") or "").strip() for d in deliverables}
    names = {c.id: c.name for c in blueprint.characters}
    turns: list[dict[str, Any]] = []
    people: dict[str, dict[str, Any]] = {}
    for m in messages:
        content = m.get("content") or ""
        if m["speaker_type"] == "learner" and content.strip() in deliverable_texts:
            continue  # the status update is a document, not a spoken turn
        cid = m.get("character_id")
        n = words(content)
        if cid:
            p = people.setdefault(cid, {"character_id": cid, "name": names.get(cid, cid), "learner_words": 0, "npc_words": 0, "learner_turns": 0, "npc_turns": 0})
            side = "learner" if m["speaker_type"] == "learner" else "npc"
            p[f"{side}_words"] += n
            p[f"{side}_turns"] += 1
        if m["speaker_type"] == "learner":
            turns.append(
                {
                    "message_id": str(m["id"]),
                    "character_id": cid,
                    "words": n,
                    "question": is_question(content),
                    "long": n > LONG_TURN_WORDS,
                    "modality": m.get("modality") or "text",
                }
            )
    counts = [t["words"] for t in turns]
    npc_counts = [words(m.get("content") or "") for m in messages if m["speaker_type"] == "character"]
    questions = sum(t["question"] for t in turns)
    return {
        "turns": turns,
        "people": list(people.values()),
        "learner_turns": len(turns),
        "questions": questions,
        "question_ratio": round(questions / len(turns), 2) if turns else 0.0,
        "avg_words": round(sum(counts) / len(counts), 1) if counts else 0.0,
        "median_words": float(median(counts)) if counts else 0.0,
        "long_turns": sum(t["long"] for t in turns),
        "npc_avg_words": round(sum(npc_counts) / len(npc_counts), 1) if npc_counts else 0.0,
        "long_turn_words": LONG_TURN_WORDS,
    }


def say_next_time(ledger: dict[str, list[dict[str, Any]]], blueprint: ScenarioBlueprint) -> list[dict[str, str]]:
    """Ready-to-use lines for the checks the learner missed (max 4, in ledger order)."""
    names = {c.id: c.name for c in blueprint.characters}
    lines = blueprint.metadata.get("say_next_time") or SAY_NEXT_TIME
    out: list[dict[str, str]] = []
    for checks in ledger.values():
        for c in checks:
            tip = lines.get(c["id"])
            if tip and not c["passed"]:
                out.append({"check": c["label"], "to": names.get(tip["to"], tip["to"]), "say": tip["say"]})
    return out[:4]
