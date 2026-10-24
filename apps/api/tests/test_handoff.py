from app.agents.prompts import build_character_messages
from app.simulation.engine import apply_disclosure, build_initial_state
from app.simulation.navigation import character_done, next_step_hint
from app.simulation.templates import build_production_incident


def _prompt(bp, state, character):
    return "\n".join(m["content"] for m in build_character_messages(bp, state, character, [], "thanks", []))


def test_manager_is_done_once_impact_and_deadline_known_and_hands_on():
    bp = build_production_incident(seed=11, incident="base")
    state = build_initial_state(bp, "v1")
    manager = next(c for c in bp.characters if c.id == "manager")
    coworker = next(c for c in bp.characters if c.id == "coworker")
    assert not character_done(bp, state, manager)
    assert "hand them on" not in _prompt(bp, state, manager)

    apply_disclosure(bp, state, "manager", "what's the customer impact and when is the deadline?")
    assert character_done(bp, state, manager)
    assert not character_done(bp, state, coworker)  # holds nothing, so never "done" (no handoff loop)
    hint = next_step_hint(bp, state, "manager")
    assert hint and "manager" not in hint.lower()
    assert f"tell them to {hint}." in _prompt(bp, state, manager)


def test_inspecting_a_tool_returns_its_findings(monkeypatch):
    import asyncio

    from app.services import session_service

    bp = build_production_incident(seed=11, incident="base")
    state = build_initial_state(bp, "v1")

    class Repo:
        session = None

        async def find_event_by_idempotency(self, *_):
            return None

        async def insert_event(self, **_):
            return {"id": "e"}

        async def save_session_state(self, **kw):
            return {"id": "s", "status": "active", "state_version": kw["new_version"]}

    async def fake_load(*_a, **_k):
        return {"id": "s", "status": "active", "state_version": state.state_version}, bp, state

    async def no_events(*_a, **_k):
        return []

    monkeypatch.setattr(session_service, "_load", fake_load)
    monkeypatch.setattr(session_service, "_persist_pending_events", no_events)
    res = asyncio.run(session_service.apply_world_action(
        repo=Repo(), user_id="u", session_id="s", client_action_id="c",
        expected_state_version=state.state_version, action_id="a_inspect_logs",
    ))
    assert res["tool"]["id"] == "log_viewer"
    assert [f["id"] for f in res["findings"]] == ["f_error_logs"] and res["findings"][0]["new"]
