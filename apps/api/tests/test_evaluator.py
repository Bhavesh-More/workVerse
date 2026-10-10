"""Evaluation evidence-verification tests."""

from __future__ import annotations

from app.evaluation.evaluator import (
    _exact_span,
    _overall,
    _validate_suggestion,
    build_evidence_items,
)
from app.schemas.ai import CriterionSuggestion, EvaluationSuggestion, EvidenceSuggestion
from app.simulation.templates import build_production_incident


def test_exact_span_returns_original_substring() -> None:
    source = "Impact: 24% of checkout requests are failing since the 17:42 deploy."
    quote = "24% of   checkout requests are failing"  # extra whitespace
    span = _exact_span(source, quote)
    assert span in source
    assert "checkout requests" in span


def test_exact_span_falls_back_to_source_prefix() -> None:
    source = "A short factual message."
    assert _exact_span(source, "not present anywhere") == source[:1000]


def test_evidence_items_marks_events_unquotable() -> None:
    messages = [{"id": "m1", "speaker_type": "learner", "content": "hello"}]
    events = [{"id": "e1", "event_type": "fact_discovered", "payload": {"fact_id": "x"}}]
    deliverables = [{"id": "d1", "inline_text": "status"}]
    items, index = build_evidence_items(messages, events, deliverables)
    assert index["m1"]["quotable"] == "1"
    assert index["e1"]["quotable"] == "0"
    assert index["d1"]["quotable"] == "1"
    assert {i["type"] for i in items} == {"message", "event", "deliverable"}


def test_unknown_evidence_is_dropped_and_criterion_becomes_insufficient() -> None:
    bp = build_production_incident(seed=1)
    index = {"m1": {"type": "message", "text": "I inspected the logs.", "quotable": "1"}}
    suggestion = EvaluationSuggestion(
        summary="s",
        criteria=[
            CriterionSuggestion(
                criterion_id="diagnosis",
                status="scored",
                rating=4,
                rationale="r",
                recommendation="rec",
                evidence=[
                    EvidenceSuggestion(source_type="message", source_id="ghost", quote="x"),
                ],
            )
        ],
    )
    results, warnings = _validate_suggestion(suggestion, bp, index)
    diagnosis = next(r for r in results if r["criterion_id"] == "diagnosis")
    assert diagnosis["status"] == "insufficient_evidence"
    assert diagnosis["rating"] is None
    assert any("ghost" in w for w in warnings)


def test_valid_evidence_keeps_score_and_verifies_quote() -> None:
    bp = build_production_incident(seed=1)
    index = {"m1": {"type": "message", "text": "I inspected the logs first.", "quotable": "1"}}
    suggestion = EvaluationSuggestion(
        summary="s",
        criteria=[
            CriterionSuggestion(
                criterion_id="diagnosis",
                status="scored",
                rating=3,
                rationale="r",
                recommendation="rec",
                evidence=[
                    EvidenceSuggestion(
                        source_type="message", source_id="m1", quote="inspected the logs"
                    )
                ],
            )
        ],
    )
    results, _ = _validate_suggestion(suggestion, bp, index)
    diagnosis = next(r for r in results if r["criterion_id"] == "diagnosis")
    assert diagnosis["status"] == "scored"
    assert diagnosis["rating"] == 3
    assert diagnosis["evidence"][0]["quote"] in "I inspected the logs first."


def test_out_of_range_rating_is_marked_insufficient() -> None:
    bp = build_production_incident(seed=1)
    index = {"m1": {"type": "message", "text": "hello", "quotable": "1"}}
    suggestion = EvaluationSuggestion(
        criteria=[
            CriterionSuggestion(
                criterion_id="diagnosis",
                status="scored",
                rating=9,
                evidence=[EvidenceSuggestion(source_type="message", source_id="m1", quote="hello")],
            )
        ],
    )
    results, _ = _validate_suggestion(suggestion, bp, index)
    diagnosis = next(r for r in results if r["criterion_id"] == "diagnosis")
    assert diagnosis["status"] == "insufficient_evidence"


def test_missing_criteria_are_added_as_insufficient() -> None:
    bp = build_production_incident(seed=1)
    results, _ = _validate_suggestion(EvaluationSuggestion(criteria=[]), bp, {})
    assert len(results) == len(bp.rubric.criteria)
    assert all(r["status"] == "insufficient_evidence" for r in results)


def test_overall_requires_at_least_two_scored_criteria() -> None:
    one = [{"status": "scored", "rating": 3}]
    assert _overall(one, 4) is None
    two = [{"status": "scored", "rating": 4}, {"status": "scored", "rating": 2}]
    assert _overall(two, 4) == 75.0
