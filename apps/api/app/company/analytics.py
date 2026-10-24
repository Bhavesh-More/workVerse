"""Assessment analytics for HR: per-candidate rows plus cohort summaries.

Everything here is derived from the candidate's stored evaluation (the same one the candidate
sees), described in plain language so a recruiter can read it without knowing the rubric.
"""

from __future__ import annotations

from statistics import median
from typing import Any

# Rubric criteria, renamed and explained for HR readers.
SKILLS: dict[str, tuple[str, str]] = {
    "diagnosis": ("Problem solving", "Gathers facts and evidence before acting; asks targeted questions."),
    "risk_decision": ("Judgement under risk", "Checks what could go wrong before making a change; picks a safe option."),
    "communication": ("Communication", "Keeps people informed clearly: impact, what's known, next steps and timing."),
    "ownership": ("Ownership & teamwork", "Takes responsibility, involves the right people and follows up."),
    "adaptation": ("Adaptability", "Changes course when new information appears and confirms the result."),
}

# Score bands (0-100) and what they suggest for the hiring process.
BANDS = [
    (80, "Strong", "Advance: clearly demonstrated the skills."),
    (65, "Good", "Advance: solid, with minor gaps to probe in interview."),
    (50, "Developing", "Consider: some skills shown; probe the gaps before deciding."),
    (0, "Needs support", "Hold: key skills were not demonstrated in this exercise."),
]


def band(score: float | None) -> dict[str, str] | None:
    if score is None:
        return None
    for floor, label, advice in BANDS:
        if score >= floor:
            return {"label": label, "advice": advice}
    return None


def candidate_status(inv: dict[str, Any]) -> str:
    if inv.get("evaluation_status") == "completed":
        return "completed"
    if inv.get("session_id"):
        return "in_progress"
    if inv.get("opened_at"):
        return "opened"
    if inv.get("email_status") == "failed":
        return "email_failed"
    return "invited" if inv.get("email_status") == "sent" else "pending"


STATUS_LABELS = {
    "completed": "Completed",
    "in_progress": "In progress",
    "opened": "Opened invite",
    "invited": "Invited",
    "pending": "Not sent",
    "email_failed": "Email failed",
}


def _iso(v: Any) -> str | None:
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else v


def candidates(invites: list[dict[str, Any]], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_invite: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        by_invite.setdefault(str(it["invite_id"]), []).append(it)
    out = []
    for inv in invites:
        status = candidate_status(inv)
        score = float(inv["overall_score"]) if inv.get("overall_score") is not None and status == "completed" else None
        meta = inv.get("report_metadata") or {}
        conv = meta.get("conversation") or {}
        ledger = meta.get("ledger") or {}
        checks = [c for group in ledger.values() for c in group] if isinstance(ledger, dict) else []
        skills = {}
        strengths, gaps = [], []
        for it in by_invite.get(str(inv["id"]), []):
            name, _ = SKILLS.get(it["criterion_id"], (it["criterion_name"], ""))
            pct = round(100 * it["score"] / it["score_max"]) if it["score"] is not None else None
            skills[it["criterion_id"]] = pct
            if pct is not None and pct >= 75:
                strengths.append(name)
            elif pct is None or pct <= 50:
                gaps.append({"skill": name, "advice": it.get("recommendation") or ""})
        started, ended = inv.get("session_started_at"), inv.get("ended_at")
        minutes = round((ended - started).total_seconds() / 60, 1) if started and ended else None
        out.append(
            {
                "id": str(inv["id"]),
                "email": inv["email"],
                "name": inv.get("candidate_name") or inv.get("display_name") or inv["email"].split("@")[0],
                "status": status,
                "status_label": STATUS_LABELS[status],
                "email_status": inv.get("email_status"),
                "email_error": inv.get("email_error"),
                "sent_at": _iso(inv.get("sent_at")),
                "opened_at": _iso(inv.get("opened_at")),
                "started_at": _iso(inv.get("started_at")),
                "completed_at": _iso(ended) if status == "completed" else None,
                "session_id": str(inv["session_id"]) if inv.get("session_id") else None,
                "score": score,
                "band": band(score),
                "skills": skills,
                "strengths": strengths,
                "gaps": gaps,
                "summary": inv.get("report_summary") if status == "completed" else None,
                "minutes": minutes,
                "messages": conv.get("learner_turns"),
                "question_ratio": conv.get("question_ratio"),
                "avg_words": conv.get("avg_words"),
                "checks_passed": sum(1 for c in checks if c.get("passed")),
                "checks_total": len(checks),
            }
        )
    return out


def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    done = [r for r in rows if r["status"] == "completed"]
    scores = [r["score"] for r in done if r["score"] is not None]
    funnel = [
        {"id": "invited", "label": "Invited", "count": sum(1 for r in rows if r["email_status"] == "sent" or r["status"] not in ("pending", "email_failed"))},
        {"id": "opened", "label": "Opened invite", "count": sum(1 for r in rows if r["opened_at"] or r["session_id"])},
        {"id": "started", "label": "Started", "count": sum(1 for r in rows if r["session_id"])},
        {"id": "completed", "label": "Completed", "count": len(done)},
    ]
    bands = [{"label": label, "advice": advice, "count": sum(1 for r in done if (r["band"] or {}).get("label") == label)} for _, label, advice in BANDS]
    histogram = [
        {"range": f"{lo}–{lo + 19 if lo < 80 else 100}", "count": sum(1 for s in scores if lo <= s < lo + 20 or (lo == 80 and s == 100))}
        for lo in (0, 20, 40, 60, 80)
    ]
    skills = []
    for sid, (name, desc) in SKILLS.items():
        vals = [r["skills"][sid] for r in done if r["skills"].get(sid) is not None]
        skills.append({"id": sid, "name": name, "description": desc, "average": round(sum(vals) / len(vals)) if vals else None, "n": len(vals)})
    ranked = sorted((r for r in done if r["score"] is not None), key=lambda r: -r["score"])
    def avg(key: str) -> float | None:
        vals = [r[key] for r in done if r.get(key) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None
    return {
        "total": len(rows),
        "completed": len(done),
        "completion_rate": round(100 * len(done) / len(rows)) if rows else 0,
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "median_score": round(median(scores), 1) if scores else None,
        "top_score": max(scores) if scores else None,
        "top_candidate": ranked[0]["name"] if ranked else None,
        "avg_minutes": avg("minutes"),
        "avg_question_ratio": avg("question_ratio"),
        "avg_words": avg("avg_words"),
        "funnel": funnel,
        "bands": bands,
        "histogram": histogram,
        "skills": skills,
        "ranking": [{"id": r["id"], "name": r["name"], "score": r["score"], "band": r["band"]["label"]} for r in ranked],
        "strongest_skill": max((s for s in skills if s["average"] is not None), key=lambda s: s["average"], default=None),
        "weakest_skill": min((s for s in skills if s["average"] is not None), key=lambda s: s["average"], default=None),
    }
