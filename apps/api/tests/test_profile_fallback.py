from app.services.scenario_service import world_view
from app.simulation.engine import build_initial_state
from app.simulation.templates import build_production_incident


def test_old_blueprints_without_profiles_still_get_cards():
    b = build_production_incident(seed=3, role="Junior Backend Engineer")
    b.metadata.pop("profiles")
    w = world_view(b, build_initial_state(b, "v"))
    for c in w["characters"]:
        assert c["profile"]["portrait"].startswith("/assets/portraits/")
        assert c["profile"]["years"] > 0
