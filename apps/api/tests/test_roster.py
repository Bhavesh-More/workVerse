"""Company judge rosters: any number of judges on the scenario's five roles."""

from __future__ import annotations

import pytest
from app.agents.prompts import build_character_messages
from app.company import judges
from app.evaluation.ledger import build_ledger, say_next_time
from app.simulation.engine import build_initial_state
from app.simulation.templates import build_production_incident
from app.simulation.validation import validate_blueprint


def _j(role: str, name: str, **kw):
    return {**judges.judge_template(role), "name": name, **kw}


def test_default_roster_is_the_five_roles_with_defaults_filled():
    roster = judges.default_roster()
    assert [j["id"] for j in roster] == list(judges.SLOTS)
    for j in roster:
        assert j["personality"] and j["greeting"] and j["focus"] and j["voice"] in judges.VOICE_AGENT
    assert judges.clean_roster(roster) == roster


def test_catalog_lists_avatars_and_the_six_configured_voices():
    cat = judges.catalog()
    assert {v["id"] for v in cat["voices"]} == set(judges.VOICE_AGENT)
    assert all(v["sample"] for v in cat["voices"])
    assert len(cat["avatars"]) >= 50 and all(a["sheet"][0] in "mf" for a in cat["avatars"])


def test_clean_roster_rules():
    with pytest.raises(ValueError, match="between 1 and"):
        judges.clean_roster([])
    with pytest.raises(ValueError, match="between 1 and"):
        judges.clean_roster([_j("qa", f"Q{i}") for i in range(judges.MAX_JUDGES + 1)])
    with pytest.raises(ValueError, match="role"):
        judges.clean_roster([_j("qa", "Ann") | {"role": "ceo"}])
    with pytest.raises(ValueError, match="name"):
        judges.clean_roster([_j("qa", "  ")])
    with pytest.raises(ValueError, match="same name"):
        judges.clean_roster([_j("qa", "Ann"), _j("manager", "ann")])
    out = judges.clean_roster([_j("qa", "Ann  Lee", voice="nope", avatar="nobody", personality="", strictness=9, id="BAD ID")])
    j = out[0]
    assert j["name"] == "Ann Lee" and j["id"].startswith("j_")
    assert j["voice"] in judges.VOICE_AGENT and j["avatar"] == judges.judge_template("qa")["avatar"]
    assert j["personality"] == judges.judge_template("qa")["personality"] and j["strictness"] == 3


def test_roster_with_extra_and_missing_roles_stays_solvable():
    roster = judges.clean_roster([
        _j("manager", "Zara Quinn", id="boss", voice="tony", focus="Wants numbers."),
        _j("teammate", "Pat Doe", id="pat"),
        _j("teammate", "Lee Roy", id="lee", avatar="Noah Kim"),
    ])
    bp = build_production_incident(seed=5, role="Backend Engineer")
    qa_facts = set(bp.character("qa").initial_fact_ids)
    judges.apply_topic(bp, {"title": "Round", "description": ""}, {"name": "Acme", "judge_roster": roster})
    ids = [c.id for c in bp.characters]
    assert ids[:3] == ["manager", "teammate", "teammate_2"]
    assert not {"qa", "client_pm", "coworker"} & set(ids)
    assert bp.metadata["judge_ids"] == {"boss": "manager", "pat": "teammate", "lee": "teammate_2"}
    assert bp.metadata["covers"] == {"qa": "manager", "client_pm": "manager", "coworker": "manager"}
    manager = bp.character("manager")
    assert manager.name == "Zara Quinn" and qa_facts <= set(manager.initial_fact_ids)
    clone = bp.character("teammate_2")
    assert clone.name == "Lee Roy" and clone.initial_fact_ids == bp.character("teammate").initial_fact_ids
    assert bp.metadata["profiles"]["teammate_2"]["portrait"].endswith("noah-kim.svg")
    assert bp.metadata["profiles"]["manager"]["intro_audio"] is False
    assert judges.voice_agent(bp, "manager", "Zara Quinn") == ("client_pm", "male")
    assert validate_blueprint(bp).ok, validate_blueprint(bp).__dict__

    state = build_initial_state(bp, "v")
    system = build_character_messages(bp, state, clone, [], "hi", [])[0]["content"]
    assert "Lee Roy" in system  # clone uses the teammate role card
    # Talking to the covering judge counts as talking to the roles it covers.
    msgs = [{"id": "m1", "speaker_type": "learner", "character_id": "manager", "content": "What did QA see?"}]
    ledger = build_ledger(bp, state, msgs, [], [])
    checks = {c["id"]: c for cs in ledger.values() for c in cs}
    assert checks["talked_qa"]["passed"] and checks["talked_client"]["passed"]
    tips = say_next_time(ledger, bp)
    assert all(t["to"] != "qa" for t in tips)


def test_world_refs_follow_the_roster():
    world = {"doc": {"people": [{"id": "p1", "ref": "judge:boss"}, {"id": "p2", "ref": "judge:gone"}, {"id": "p3", "ref": "member:m1"}]}}
    out = judges.remap_world(world, {"boss": "manager"})
    assert [p["ref"] for p in out["doc"]["people"]] == ["judge:manager", "member:m1"]
    assert world["doc"]["people"][0]["ref"] == "judge:boss"


def test_default_text_follows_topic_track():
    roster = judges.default_roster()
    bp = build_production_incident(seed=2, role="Data Analyst")
    track = bp.metadata.get("track")
    judges.apply_topic(bp, {"title": "t", "description": ""}, {"name": "A", "judge_roster": roster})
    assert bp.character("qa").greeting == judges.default_template("qa", track)["greeting"]
