"""Company assessments: judge config, topic application, prompt injection, analytics, PDF."""

from __future__ import annotations

import datetime as dt

from app.agents.prompts import build_character_messages
from app.company import analytics, judges
from app.company.report_pdf import build_pdf
from app.services.voice_service import _voice_behaviour
from app.simulation.engine import build_initial_state
from app.simulation.templates import build_production_incident
from app.simulation.validation import validate_blueprint

COMPANY = {"name": "Acme", "judge_defaults": {"qa": {"tone": "warm", "personality": "Patient mentor."}}}


def test_clean_judges_drops_unknown_fields_and_names():
    raw = {
        "manager": {"name": "Not A Real Person", "tone": "blunt", "strictness": "5", "hack": "x"},
        "teammate": {"name": "Marcus Chen", "tone": "shouty", "strictness": 9},
        "intruder": {"tone": "warm"},
    }
    clean = judges.clean_judges(raw)
    assert clean == {"manager": {"tone": "blunt", "strictness": 5}, "teammate": {"name": "Marcus Chen"}}
    assert judges.bad_names(raw) == ["manager: Not A Real Person"]


def test_resolve_layers_default_company_topic():
    cfg = judges.resolve("qa", "backend", COMPANY["judge_defaults"], {"qa": {"strictness": 5}})
    assert cfg["tone"] == "warm" and cfg["personality"] == "Patient mentor." and cfg["strictness"] == 5
    assert cfg["role"] == "QA Engineer"


def test_apply_topic_sets_names_brief_and_stays_valid():
    bp = build_production_incident(seed=3, role="Backend Engineer")
    topic = {
        "title": "On-call round",
        "description": "We want calm engineers.",
        "judges": {"manager": {"name": "Amara Osei", "tone": "blunt", "strictness": 5, "greeting": "Talk fast."}},
    }
    judges.apply_topic(bp, topic, COMPANY)
    manager = bp.character("manager")
    assert manager.name == "Amara Osei" and manager.greeting == "Talk fast."
    assert bp.title == "On-call round"
    assert bp.briefing.startswith("Assessment by Acme: We want calm engineers.")
    assert bp.metadata["judges"]["qa"]["tone"] == "warm"
    assert "teammate" not in bp.metadata["judges"]
    assert bp.metadata["profiles"]["manager"]["portrait"].endswith("amara-osei.svg")
    assert validate_blueprint(bp).ok


def test_judge_personality_reaches_chat_and_voice_prompts():
    bp = build_production_incident(seed=3, role="Backend Engineer")
    judges.apply_topic(bp, {"title": "t", "description": "", "judges": {"manager": {"tone": "blunt", "strictness": 5, "focus": "Demands an ETA."}}}, COMPANY)
    state = build_initial_state(bp, "v")
    # manager (topic) and qa (company default) are configured; coworker is untouched.
    for slot, expected in (("manager", True), ("qa", True), ("coworker", False)):
        system = build_character_messages(bp, state, bp.character(slot), [], "hi", [])[0]["content"]
        assert ("HOW THIS COMPANY WANTS YOU TO BEHAVE" in system) is expected
    system = build_character_messages(bp, state, bp.character("manager"), [], "hi", [])[0]["content"]
    assert "Demands an ETA." in system and "Blunt" in system
    assert "Demands an ETA." in _voice_behaviour(bp, "manager")


def test_no_company_config_leaves_prompts_unchanged():
    bp = build_production_incident(seed=3, role="Backend Engineer")
    state = build_initial_state(bp, "v")
    system = build_character_messages(bp, state, bp.character("manager"), [], "hi", [])[0]["content"]
    assert "COMPANY" not in system and _voice_behaviour(bp, "manager") == ""


def _invites():
    t0 = dt.datetime(2026, 10, 1, 9, tzinfo=dt.UTC)
    base = {"email_status": "sent", "sent_at": t0, "candidate_name": None, "display_name": None, "report_metadata": {}}
    return [
        {**base, "id": "a", "email": "a@x.com", "opened_at": t0, "session_id": "s1", "session_started_at": t0, "ended_at": t0 + dt.timedelta(minutes=12), "evaluation_status": "completed", "overall_score": 85, "report_summary": "Great."},
        {**base, "id": "b", "email": "b@x.com", "opened_at": t0, "session_id": "s2", "session_started_at": t0, "ended_at": t0 + dt.timedelta(minutes=9), "evaluation_status": "completed", "overall_score": 40, "report_summary": "Weak."},
        {**base, "id": "c", "email": "c@x.com", "opened_at": t0, "session_id": None, "evaluation_status": None, "overall_score": None},
        {**base, "id": "d", "email": "d@x.com", "opened_at": None, "session_id": None, "email_status": "failed", "evaluation_status": None, "overall_score": None},
    ]


def _items():
    return [
        {"invite_id": "a", "criterion_id": "diagnosis", "criterion_name": "x", "status": "scored", "score": 4, "score_max": 4, "recommendation": ""},
        {"invite_id": "b", "criterion_id": "diagnosis", "criterion_name": "x", "status": "scored", "score": 1, "score_max": 4, "recommendation": "Ask first."},
    ]


def test_analytics_statuses_bands_and_summary():
    rows = analytics.candidates(_invites(), _items())
    assert [r["status"] for r in rows] == ["completed", "completed", "opened", "email_failed"]
    assert rows[0]["band"]["label"] == "Strong" and rows[1]["band"]["label"] == "Needs support"
    assert rows[0]["strengths"] == ["Problem solving"] and rows[1]["gaps"][0]["advice"] == "Ask first."
    assert rows[0]["minutes"] == 12.0
    sm = analytics.summary(rows)
    assert sm["completed"] == 2 and sm["completion_rate"] == 50 and sm["avg_score"] == 62.5
    assert [f["count"] for f in sm["funnel"]] == [3, 3, 2, 2, 2]  # invited, opened, accepted, started, completed
    assert sm["top_candidate"] == "a" and sm["skills"][0]["average"] == 62


def test_pdf_builds():
    rows = analytics.candidates(_invites(), _items())
    pdf = build_pdf(company="Acme", assessment={"title": "Round 1", "topic_title": "On-call"}, rows=rows, sm=analytics.summary(rows))
    assert pdf[:4] == b"%PDF" and len(pdf) > 10_000


def test_csv_ranks_and_tags_assessment():
    from app.api.v1.company import _csv_response

    rows = [{**r, "assessment_title": "Round 1"} for r in analytics.candidates(_invites(), _items())]
    body = _csv_response(rows, "x.csv", with_assessment=True).body.decode("utf-8").lstrip("﻿").splitlines()
    assert body[0].startswith("Rank,Assessment,Name,Email")
    assert body[1].startswith("1,Round 1,a,a@x.com,Completed,85")
    assert body[2].startswith("2,Round 1,b,b@x.com")
    assert len(body) == 5


def test_in_app_invites_count_as_invited_even_without_email():
    base = {"evaluation_status": None, "session_id": None, "opened_at": None}
    assert analytics.candidate_status({**base, "email_status": "pending", "notified_at": dt.datetime.now(dt.UTC)}) == "invited"
    assert analytics.candidate_status({**base, "email_status": "failed", "notified_at": dt.datetime.now(dt.UTC)}) == "invited"
    assert analytics.candidate_status({**base, "email_status": "failed", "notified_at": None}) == "email_failed"
    assert analytics.candidate_status({**base, "email_status": "pending", "notified_at": None}) == "pending"
