import pytest
from app.simulation.engine import apply_disclosure, build_initial_state
from app.simulation.templates import build_production_incident
from app.simulation.tracks import TRACKS, track_for
from app.simulation.validation import validate_blueprint

ROLE_FOR_TRACK = {
    "backend": "Junior Backend Engineer",
    "frontend": "Junior Frontend Engineer",
    "data": "Data Analyst",
    "product": "Product Manager",
}


def test_roles_map_to_tracks():
    assert track_for("Mobile Developer") == "frontend"
    assert track_for("ML Engineer") == "data"
    assert track_for("UI/UX Designer") == "product"
    assert track_for("Cloud Engineer") == "backend"
    assert set(ROLE_FOR_TRACK) == set(TRACKS)


@pytest.mark.parametrize("track", list(TRACKS))
def test_every_suggested_question_unlocks_its_fact(track):
    bp = build_production_incident(seed=7, role=ROLE_FOR_TRACK[track], incident="base")
    assert validate_blueprint(bp).ok
    assert bp.metadata["track"] == track
    state = build_initial_state(bp, "v1")
    # Ask in order so prerequisite facts (e.g. what changed) come first.
    for cid, questions in bp.metadata["questions"].items():
        for q in questions:
            newly, _ = apply_disclosure(bp, state, cid, q["q"])
            if q["fact"]:
                assert q["fact"] in state.facts_known, f"{track}/{cid}: {q['q']!r} did not unlock {q['fact']}"
