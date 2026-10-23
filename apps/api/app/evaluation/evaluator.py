"""Evidence-grounded evaluation.

The model proposes criterion-level assessments; this module verifies every evidence
reference against persisted records, computes the score from the frozen rubric, and only
then persists the report. Unsupported claims are dropped and the criterion is marked
``insufficient_evidence`` rather than published as fact.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.agents.ollama_cloud import OllamaCloudClient
from app.agents.prompts import build_evaluation_messages
from app.core.errors import AppError
from app.db.repository import Repository
from app.evaluation.ledger import build_ledger, conversation_stats, say_next_time
from app.schemas.ai import EvaluationSuggestion
from app.schemas.runtime import SimulationState
from app.schemas.scenario import ScenarioBlueprint

logger = logging.getLogger(__name__)

EVALUATOR_VERSION = "evaluator-v2"
FORMATIVE_LIMITATION = (
    "This report is formative practice feedback, not a validated predictor of job performance."
)
_WS = re.compile(r"\s+")


def _norm(text: str) -> str:
    return _WS.sub(" ", text).strip().lower()


def _exact_span(source: str, quote: str | None) -> str:
    """Return an exact substring of ``source`` whose whitespace-normalised form contains the quote.

    Falls back to the first 1000 characters of the source so that stored evidence is always a
    genuine, verifiable leaf of the persisted record (never a fabricated or edited quote).
    """
    if not quote:
        return source[:1000]
    ns = _norm(source)
    nq = _norm(quote)
    if not nq:
        return source[:1000]
    pos = ns.find(nq)
    if pos < 0:
        return source[:1000]
    norm_chars: list[str] = []
    mapping: list[int] = []
    pending_space = False
    for i, ch in enumerate(source):
        if ch.isspace():
            if norm_chars:
                pending_space = True
        else:
            if pending_space:
                norm_chars.append(" ")
                mapping.append(i)
                pending_space = False
            norm_chars.append(ch.lower())
            mapping.append(i)
    if pos + len(nq) > len(mapping):
        return source[:1000]
    start = mapping[pos]
    end = mapping[pos + len(nq) - 1]
    return source[start : end + 1]


def build_evidence_items(
    messages: list[dict[str, Any]],
    events: list[dict[str, Any]],
    deliverables: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    items: list[dict[str, Any]] = []
    index: dict[str, dict[str, str]] = {}
    for m in messages:
        text = m["content"]
        items.append(
            {
                "id": str(m["id"]),
                "type": "message",
                "speaker": m["speaker_type"],
                "text": text,
            }
        )
        index[str(m["id"])] = {"type": "message", "text": text, "quotable": "1"}
    for e in events:
        text = f"{e['event_type']} {e.get('payload', {})}"
        items.append({"id": str(e["id"]), "type": "event", "speaker": "system", "text": text})
        # jsonb::text formatting differs from Python repr, so events are cited without a quote.
        index[str(e["id"])] = {"type": "event", "text": text, "quotable": "0"}
    for d in deliverables:
        text = d.get("inline_text") or ""
        items.append(
            {"id": str(d["id"]), "type": "deliverable", "speaker": "learner", "text": text}
        )
        index[str(d["id"])] = {"type": "deliverable", "text": text, "quotable": "1"}
    return items, index


def deterministic_findings(
    blueprint: ScenarioBlueprint,
    state: SimulationState,
    messages: list[dict[str, Any]],
    events: list[dict[str, Any]],
    deliverables: list[dict[str, Any]],
) -> list[str]:
    findings: list[str] = []
    done = state.actions_done
    asked = sorted({m["character_id"] for m in messages if m["speaker_type"] == "character" and m.get("character_id")})
    findings.append(f"Learner inspected logs: {'yes' if 'a_inspect_logs' in done else 'no'}")
    findings.append(f"Learner inspected metrics: {'yes' if 'a_inspect_metrics' in done else 'no'}")
    findings.append(
        f"Migration compatibility checked: {'yes' if 'a_check_migration_compat' in done else 'no'}"
    )
    mitigation = state.flags.get("mitigation")
    findings.append(f"Chosen mitigation: {mitigation or 'none applied'}")
    if "a_apply_rollback" in done and "a_check_migration_compat" in done:
        order_ok = done.index("a_check_migration_compat") < done.index("a_apply_rollback")
        findings.append(f"Rollback applied after compatibility check: {'yes' if order_ok else 'no'}")
    rejected = [e for e in events if e["event_type"] == "decision_rejected"]
    if rejected:
        reasons = "; ".join(
            str(e.get("payload", {}).get("action_id")) for e in rejected
        )
        findings.append(f"Rejected/blocked actions during session: {reasons}")
    findings.append(f"Stakeholder update submitted: {'yes' if 'a_send_status_update' in done else 'no'}")
    if deliverables:
        text = deliverables[-1].get("inline_text") or ""
        findings.append(f"Update length: {len(text)} characters")
    findings.append(f"Follow-up documented: {'yes' if 'a_document_followup' in done else 'no'}")
    findings.append(f"Characters consulted: {', '.join(asked) if asked else 'none'}")
    findings.append(f"Facts discovered: {', '.join(state.facts_known)}")
    return findings


def _validate_suggestion(
    suggestion: EvaluationSuggestion,
    blueprint: ScenarioBlueprint,
    index: dict[str, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    by_id = {c.id: c for c in blueprint.rubric.criteria}
    results: list[dict[str, Any]] = []
    warnings: list[str] = []

    seen: set[str] = set()
    for crit in suggestion.criteria:
        if crit.criterion_id not in by_id:
            warnings.append(f"Unknown criterion '{crit.criterion_id}' from model was dropped.")
            continue
        seen.add(crit.criterion_id)
        criterion = by_id[crit.criterion_id]
        evidence: list[dict[str, Any]] = []
        for ref in crit.evidence:
            src = index.get(str(ref.source_id))
            if src is None or src["type"] != ref.source_type:
                warnings.append(
                    f"Dropped unverified evidence {ref.source_id} for '{crit.criterion_id}'."
                )
                continue
            quote = _exact_span(src["text"], ref.quote) if src.get("quotable") == "1" else None
            evidence.append(
                {
                    "source_type": ref.source_type,
                    "source_id": str(ref.source_id),
                    "quote": quote,
                    "interpretation": ref.interpretation or "Referenced during evaluation.",
                }
            )
        status = crit.status
        rating = crit.rating
        if status == "scored":
            if rating is None or not (0 <= int(rating) <= blueprint.rubric.scale_max):
                warnings.append(
                    f"Rating out of range for '{crit.criterion_id}'; marked insufficient evidence."
                )
                status, rating = "insufficient_evidence", None
            elif not evidence:
                warnings.append(
                    f"No verified evidence for scored criterion '{crit.criterion_id}'; "
                    "marked insufficient evidence."
                )
                status, rating = "insufficient_evidence", None
        else:
            rating = None
        results.append(
            {
                "criterion_id": criterion.id,
                "criterion_name": criterion.name,
                "status": status,
                "rating": int(rating) if rating is not None else None,
                "score_max": blueprint.rubric.scale_max,
                "rationale": crit.rationale or "",
                "recommendation": crit.recommendation
                or "Continue practising this competency in a fresh scenario.",
                "evidence": evidence,
            }
        )

    for criterion in blueprint.rubric.criteria:
        if criterion.id not in seen:
            results.append(
                {
                    "criterion_id": criterion.id,
                    "criterion_name": criterion.name,
                    "status": "insufficient_evidence",
                    "rating": None,
                    "score_max": blueprint.rubric.scale_max,
                    "rationale": "The session did not provide enough evidence to assess this criterion.",
                    "recommendation": "Attempt a variant where this behaviour is required.",
                    "evidence": [],
                }
            )
    return results, warnings


def _validate_coaching(
    suggestion: EvaluationSuggestion, messages: list[dict[str, Any]]
) -> list[dict[str, str]]:
    """Keep only rewrites of real learner messages; attach the original words verbatim."""
    learner = {str(m["id"]): m["content"] for m in messages if m["speaker_type"] == "learner"}
    out: list[dict[str, str]] = []
    for c in suggestion.coaching:
        original = learner.get(str(c.message_id))
        better = " ".join(c.better.split())[:200]
        if original is None or not better or str(c.message_id) in {o["message_id"] for o in out}:
            continue
        out.append(
            {"message_id": str(c.message_id), "original": original, "better": better, "why": c.why.strip()[:120]}
        )
    return out[:3]


def _overall(results: list[dict[str, Any]], scale_max: int) -> float | None:
    scored = [r for r in results if r["status"] == "scored" and r["rating"] is not None]
    if len(scored) < 2:
        return None
    mean = sum(r["rating"] for r in scored) / len(scored)
    return round(100.0 * mean / scale_max, 2)


async def generate_evaluation(
    *,
    repo: Repository,
    ai: OllamaCloudClient,
    session_id: str,
    blueprint: ScenarioBlueprint,
    state: SimulationState,
) -> dict[str, Any]:
    messages = await repo.list_messages(session_id)
    events = await repo.list_events(session_id)
    deliverables = await repo.list_deliverables(session_id)
    items, index = build_evidence_items(messages, events, deliverables)
    findings = deterministic_findings(blueprint, state, messages, events, deliverables)
    ledger = build_ledger(blueprint, state, messages, events, deliverables)
    conversation = conversation_stats(blueprint, messages, deliverables)
    findings.append(
        f"Learner spoke {conversation['learner_turns']} turns, avg {conversation['avg_words']} words, "
        f"{conversation['questions']} questions, {conversation['long_turns']} turns over "
        f"{conversation['long_turn_words']} words"
    )
    for crit, checks in ledger.items():
        missed = [c["label"] for c in checks if not c["passed"]]
        if missed:
            findings.append(f"Ledger {crit} missed: {'; '.join(missed)}")
    summary = (
        f"Session for '{blueprint.title}'. "
        + "; ".join(findings[:4])
    )

    suggestion: EvaluationSuggestion | None = None
    warnings: list[str] = []
    model_name: str | None = None
    if ai.configured:
        try:
            data = await ai.chat_json(
                build_evaluation_messages(blueprint, items, findings, summary),
                max_tokens=1600,
            )
            suggestion = EvaluationSuggestion.model_validate(data)
            model_name = getattr(ai, "model_name", None)
        except AppError as exc:
            warnings.append(f"Evaluator model error: {exc.code}")
            logger.warning("evaluation_model_error", extra={"event": exc.code})
        except Exception as exc:  # noqa: BLE001
            warnings.append("Evaluator model returned an unparseable response.")
            logger.warning("evaluation_parse_error", extra={"event": type(exc).__name__})

    if suggestion is None:
        suggestion = EvaluationSuggestion(
            summary=summary,
            criteria=[],
            limitations=["The evaluator model was unavailable; only deterministic findings are shown."],
        )

    results, vwarnings = _validate_suggestion(suggestion, blueprint, index)
    warnings.extend(vwarnings)
    overall = _overall(results, blueprint.rubric.scale_max)

    evaluation_row = await repo.create_evaluation(
        session_id=session_id,
        rubric_version=blueprint.rubric.version,
        evaluator_version=EVALUATOR_VERSION,
        model_provider="ollama" if ai.configured else None,
        model_name=model_name,
        overall_score=overall,
        report_summary=suggestion.summary or summary,
        limitations=[FORMATIVE_LIMITATION, *suggestion.limitations],
        validation_warnings=warnings,
        report_metadata={
            "findings": findings,
            "ledger": ledger,
            "conversation": conversation,
            "coaching": _validate_coaching(suggestion, messages),
            "say_next_time": say_next_time(ledger, blueprint),
        },
    )
    for result in results:
        item_row = await repo.insert_evaluation_item(
            evaluation_id=str(evaluation_row["id"]),
            criterion_id=result["criterion_id"],
            criterion_name=result["criterion_name"],
            status=result["status"],
            score=result["rating"],
            score_max=result["score_max"],
            explanation=result["rationale"],
            recommendation=result["recommendation"],
            counterevidence=[],
        )
        for ev in result["evidence"]:
            await repo.insert_evaluation_evidence(
                item_id=str(item_row["id"]),
                source_type=ev["source_type"],
                message_id=ev["source_id"] if ev["source_type"] == "message" else None,
                event_id=ev["source_id"] if ev["source_type"] == "event" else None,
                deliverable_id=ev["source_id"] if ev["source_type"] == "deliverable" else None,
                quote=ev["quote"],
                interpretation=ev["interpretation"],
            )
    return await evaluation_view(repo, evaluation_row, blueprint)


async def evaluation_view(
    repo: Repository, evaluation_row: dict[str, Any], blueprint: ScenarioBlueprint
) -> dict[str, Any]:
    items = await repo.list_evaluation_items(str(evaluation_row["id"]))
    out_items = []
    for item in items:
        evidence = await repo.list_evaluation_evidence(str(item["id"]))
        out_items.append(
            {
                "criterion_id": item["criterion_id"],
                "criterion_name": item["criterion_name"],
                "status": item["status"],
                "score": item["score"],
                "score_max": item["score_max"],
                "explanation": item["explanation"],
                "recommendation": item["recommendation"],
                "counterevidence": item.get("counterevidence") or [],
                "evidence": [
                    {
                        "source_type": ev["source_type"],
                        "source_id": str(
                            ev["message_id"] or ev["event_id"] or ev["deliverable_id"]
                        ),
                        "quote": ev["quote"],
                        "interpretation": ev["interpretation"],
                    }
                    for ev in evidence
                ],
            }
        )
    meta = evaluation_row.get("report_metadata") or {}
    return {
        "id": str(evaluation_row["id"]),
        "findings": meta.get("findings", []),
        "ledger": meta.get("ledger", {}),
        "conversation": meta.get("conversation"),
        "coaching": meta.get("coaching", []),
        "say_next_time": meta.get("say_next_time", []),
        "session_id": str(evaluation_row["session_id"]),
        "status": evaluation_row["status"],
        "rubric_version": evaluation_row["rubric_version"],
        "evaluator_version": evaluation_row["evaluator_version"],
        "evaluator_model": evaluation_row.get("model_name"),
        "overall_score": float(evaluation_row["overall_score"])
        if evaluation_row["overall_score"] is not None
        else None,
        "score_scale": {
            "minimum": 0,
            "maximum": 100,
            "interpretation": "formative practice score",
        },
        "summary": evaluation_row.get("report_summary"),
        "limitations": evaluation_row.get("limitations") or [FORMATIVE_LIMITATION],
        "validation_warnings": evaluation_row.get("validation_warnings") or [],
        "items": out_items,
        "created_at": evaluation_row["created_at"].isoformat()
        if evaluation_row.get("created_at")
        else None,
    }
