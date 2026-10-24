import asyncio

import pytest
from app.simulation.engine import apply_disclosure, build_initial_state
from app.simulation.templates import build_production_incident
from app.simulation.tracks import TRACKS
from app.simulation.validation import validate_blueprint

ROLES = {"backend": "Backend Developer", "frontend": "Frontend Developer", "data": "Data Analyst", "product": "Product Manager"}


@pytest.mark.parametrize("track", list(TRACKS))
def test_every_incident_type_builds_and_validates(track):
    expected = {"base", *(v["id"] for v in TRACKS[track]["variants"])}
    seen = {}
    for seed in range(200):
        bp = build_production_incident(seed=seed, role=ROLES[track])
        seen.setdefault(bp.metadata["variation"]["incident"], bp)
    assert set(seen) == expected
    for incident, bp in seen.items():
        report = validate_blueprint(bp)
        assert report.ok, (incident, report)
        assert "{" not in bp.briefing and all("{" not in f.detail for f in bp.facts), incident


@pytest.mark.parametrize("track", list(TRACKS))
def test_variants_only_override_known_keys(track):
    base = TRACKS[track]
    for v in base["variants"]:
        for section in ("facts", "actions", "blocked", "objects", "objectives", "questions", "say_next_time"):
            assert set(v.get(section, {})) <= set(base[section]), (v["id"], section)
        for cid, c in v.get("characters", {}).items():
            assert set(c.get("keywords", {})) <= set(base["characters"][cid]["keywords"]), (v["id"], cid)


@pytest.mark.parametrize("track", list(TRACKS))
def test_every_variant_question_unlocks_its_fact(track):
    for v in TRACKS[track]["variants"]:
        bp = build_production_incident(seed=3, role=ROLES[track], incident=v["id"])
        state = build_initial_state(bp, "v1")
        for cid, questions in bp.metadata["questions"].items():
            for q in questions:
                apply_disclosure(bp, state, cid, q["q"])
                if q["fact"]:
                    assert q["fact"] in state.facts_known, f"{v['id']}/{cid}: {q['q']!r}"


def test_card_incident_is_honoured_and_unknown_falls_back():
    from app.services.scenario_service import _track_copy

    card = _track_copy("Frontend Developer")
    bp = build_production_incident(seed=5, role="Frontend Developer", incident=card["incident"])
    assert bp.title == card["title"]
    assert build_production_incident(seed=5, incident="nope").metadata["variation"]["incident"] in {"base", "queue_format", "key_rotation"}


def test_catalog_endpoint_sends_incident_to_the_card():
    from types import SimpleNamespace

    from app.api.v1.scenarios import list_templates
    from app.simulation.templates import TEMPLATE_SLUG

    class Repo:
        async def get_profile(self, _):
            return {"target_role": "Data Analyst"}

        async def list_templates(self):
            return [{"id": 1, "slug": TEMPLATE_SLUG, "title": "t", "summary": "s", "categories": [],
                     "target_roles": [], "supported_modes": [], "estimated_minutes": 10}]

    item = asyncio.run(list_templates(SimpleNamespace(user_id="u"), Repo()))["items"][0]
    assert item["incident"] in {"base", *(v["id"] for v in TRACKS["data"]["variants"])}
