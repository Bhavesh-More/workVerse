import asyncio

from app.services.scenario_service import personalize
from app.simulation.templates import build_production_incident


class FakeAI:
    configured = True

    def __init__(self, out):
        self.out = out

    async def chat_json(self, messages, **_):
        return self.out


def test_company_is_randomized_per_seed():
    companies = {
        build_production_incident(seed=s).metadata["setting"]["company"] for s in range(40)
    }
    assert len(companies) > 3


def test_story_is_applied_to_briefing():
    bp = build_production_incident(seed=1)
    ai = FakeAI(
        {
            "company": "Gamebox",
            "product": "a video game store",
            "story": "Gamers pre-order here. Today is the big launch.",
        }
    )
    assert asyncio.run(personalize(ai, bp, {"career_goals": ["games"]}))
    assert bp.briefing.startswith("You work at Gamebox, a video game store. Gamers pre-order here.")
    assert bp.briefing.count("You work at") == 1


def test_spoiler_story_is_rejected():
    bp = build_production_incident(seed=1)
    before = bp.briefing
    ai = FakeAI({"company": "X", "product": "y", "story": "A database migration broke checkout."})
    assert not asyncio.run(personalize(ai, bp, None))
    assert bp.briefing == before
