"""Per-candidate PDFs: the summary is exactly one page per candidate; the detailed review is complete."""

from __future__ import annotations

import io

from app.company.candidate_report import build_candidate_pdf
from pypdf import PdfReader

ASSESSMENT = {"title": "Backend on-call round", "topic_title": "On-call incident"}
COHORT = {"diagnosis": 62.5, "risk_decision": 50.0, "communication": 45.0, "ownership": 70.0, "adaptation": None}


def _candidate(name: str, score: float, long_text: bool = False) -> dict:
    words = " ".join(["Detailed explanation of the decision and the evidence behind it."] * (40 if long_text else 2))
    row = {
        "id": name,
        "name": name,
        "email": f"{name.lower().replace(' ', '.')}@example.com",
        "status": "completed",
        "score": score,
        "band": {"label": "Good" if score >= 65 else "Developing", "advice": "Advance: solid, with minor gaps to probe in interview."},
        "skills": {"diagnosis": 75, "risk_decision": 50, "communication": 25, "ownership": 100, "adaptation": None},
        "strengths": ["Problem solving", "Ownership & teamwork"],
        "gaps": [{"skill": "Communication", "advice": words}, {"skill": "Adaptability", "advice": ""}],
        "summary": words,
        "minutes": 12.5,
        "messages": 9,
        "question_ratio": 0.56,
        "avg_words": 11.2,
        "checks_passed": 7,
        "checks_total": 12,
        "completed_at": "2026-10-25T09:00:00+00:00",
    }
    ev = {
        "items": [
            {"criterion_id": "diagnosis", "criterion_name": "Diagnosis and information gathering", "status": "scored", "score": 3, "score_max": 4, "explanation": words, "recommendation": "Ask about the deploy first.", "evidence": [{"source_type": "message", "quote": "What changed in the last deploy?"}], "counterevidence": []},
            {"criterion_id": "communication", "criterion_name": "Stakeholder communication", "status": "scored", "score": 1, "score_max": 4, "explanation": words, "recommendation": "Include impact and an ETA.", "evidence": [{"source_type": "deliverable", "quote": "We are looking into it."}], "counterevidence": [{"source_type": "message", "quote": "I'll update you soon"}]},
            {"criterion_id": "adaptation", "criterion_name": "Adaptation and closure", "status": "insufficient_evidence", "score": None, "score_max": 4, "explanation": "Ended before verifying.", "recommendation": "", "evidence": [], "counterevidence": []},
        ],
        "ledger": {"diagnosis": [{"id": "logs", "label": "Inspect application logs", "detail": "", "passed": True}, {"id": "metrics", "label": "Inspect metrics", "detail": "", "passed": False}]},
        "conversation": {
            "learner_turns": 9,
            "questions": 5,
            "question_ratio": 0.56,
            "median_words": 9,
            "long_turns": 1,
            "long_turn_words": 40,
            "people": [{"name": "Amara Osei", "learner_words": 40, "npc_words": 80}, {"name": "Noah Kim", "learner_words": 25, "npc_words": 60}],
            "turns": [{"words": w, "question": i % 2 == 0} for i, w in enumerate([6, 12, 45, 8, 9, 14, 5, 22, 7])],
        },
        "coaching": [{"original": "how bad is it", "better": "What's the impact and error rate?", "why": "Too vague."}],
        "say_next_time": [{"to": "Dana Okafor", "say": "Did CI run the integration tests?", "check": "Talked to the QA Engineer"}],
    }
    transcript = [{"speaker": "candidate" if i % 2 == 0 else "Amara Osei", "content": f"Message {i} " + words[:120], "created_at": f"2026-10-25T09:{i:02d}:00"} for i in range(30)]
    return {"row": row, "evaluation": ev, "transcript": transcript, "rank": 1, "ranked": 3}


def _pages(pdf: bytes) -> PdfReader:
    return PdfReader(io.BytesIO(pdf))


def test_summary_is_one_page_per_candidate_even_with_long_text():
    one = _pages(build_candidate_pdf(kind="summary", company="Acme", assessment=ASSESSMENT, candidates=[_candidate("Asha Patel", 72, long_text=True)], cohort=COHORT))
    assert len(one.pages) == 1
    text = one.pages[0].extract_text()
    for part in ("Asha Patel", "Suggested next step", "AREAS TO PROBE", "STRENGTHS", "EVALUATOR'S VERDICT"):
        assert part in text, part


def test_summary_for_several_candidates_adds_a_contents_page():
    many = _pages(build_candidate_pdf(kind="summary", company="Acme", assessment=ASSESSMENT, candidates=[_candidate("Asha Patel", 72), _candidate("Ben Ortiz", 55)], cohort=COHORT))
    assert len(many.pages) == 3  # contents + one page each
    assert "Ben Ortiz" in many.pages[0].extract_text()


def test_group_summary_is_one_page_for_a_hundred_candidates():
    import random

    from app.company import analytics
    from app.company.cohort_report import build_cohort_summary, insights

    rng = random.Random(7)
    rows = []
    for i in range(100):
        r = _candidate(f"Candidate {i:03d}", 0)["row"]
        score = round(rng.uniform(20, 95), 1) if i < 86 else None
        r.update(
            id=str(i), score=score, status="completed" if score is not None else "invited", minutes=round(rng.uniform(6, 25), 1),
            band=analytics.band(score), accepted_at="x", opened_at="x", session_id="s" if score is not None else None,
            skills={k: rng.choice([25, 50, 75, 100]) for k in COHORT}, email_status="sent",
        )
        rows.append(r)
    sm = analytics.summary(rows)
    pdf = _pages(build_cohort_summary(company="Acme", assessment=ASSESSMENT, rows=rows, sm=sm))
    assert len(pdf.pages) == 1
    text = pdf.pages[0].extract_text()
    for part in ("GROUP SUMMARY", "Score distribution", "Recommendation bands", "Top 8 of 86", "KEY INSIGHTS"):
        assert part in text, part
    assert any("Strong or Good" in line for line in insights(rows, sm))


def test_detailed_review_has_every_section():
    pdf = _pages(build_candidate_pdf(kind="detailed", company="Acme", assessment=ASSESSMENT, candidates=[_candidate("Asha Patel", 72)], cohort=COHORT))
    text = " ".join(p.extract_text() for p in pdf.pages)
    assert len(pdf.pages) >= 4
    for heading in ("Skill-by-skill review", "How they communicated", "Coaching", "Full transcript", "How to read these scores"):
        assert heading in text, heading
    assert "What changed in the last deploy?" in text  # quoted evidence
    assert "Inspect application logs" in text  # evidence ledger checks


def _synthetic_rows(rng, n: int, mean: float, prefix: str) -> list[dict]:
    from app.company import analytics

    rows = []
    for i in range(n):
        r = _candidate(f"{prefix} {i:02d}", 0)["row"]
        score = round(min(97, max(15, rng.gauss(mean, 14))), 1) if rng.random() < 0.75 else None
        r.update(
            id=f"{prefix}-{i}", score=score, status="completed" if score is not None else "invited", minutes=round(rng.uniform(6, 25), 1),
            band=analytics.band(score), accepted_at="x", opened_at="x", session_id="s" if score is not None else None,
            skills={k: rng.choice([25, 50, 75, 100]) for k in COHORT}, email_status="sent",
        )
        rows.append(r)
    return rows


def test_assessment_results_summary_is_one_page_and_detailed_covers_each():
    import random

    from app.company import analytics
    from app.company.assessments_report import _stats, build_assessments_report, insights

    rng = random.Random(11)
    items = []
    for k in range(9):
        rows = _synthetic_rows(rng, 30, 45 + 4 * k, f"R{k}")
        items.append({"assessment": {**ASSESSMENT, "title": f"Round {k}", "status": "active", "due_at": None}, "rows": rows, "sm": analytics.summary(rows)})
    items.append({"assessment": {**ASSESSMENT, "title": "Empty round", "status": "active", "due_at": None}, "rows": [], "sm": analytics.summary([])})

    summary = _pages(build_assessments_report(kind="summary", company="Acme", items=items))
    assert len(summary.pages) == 1
    text = summary.pages[0].extract_text()
    for part in ("Assessment results", "How the assessments compare", "Round 0", "Round 8", "Empty round", "KEY INSIGHTS"):
        assert part in text, part

    detailed = _pages(build_assessments_report(kind="detailed", company="Acme", items=items))
    assert len(detailed.pages) >= 1 + 9 * 2
    full = "\n".join(p.extract_text() for p in detailed.pages)
    assert full.count("Everyone invited ·") == 9  # empty round has nobody to rank

    lines = insights([_stats(i) for i in items])
    assert any("Highest median score" in line for line in lines)
