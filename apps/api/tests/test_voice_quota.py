import asyncio

import httpx
import pytest
from app.agents.elevenlabs_cloud import ElevenLabsClient
from app.core.config import Settings
from app.core.errors import AIConfigError, AppError
from app.simulation.tracks import VOICES


def _check(sub_status: int, sub: dict) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(sub_status, json=sub)

    async def run() -> None:
        async with httpx.AsyncClient(base_url="https://api.test", transport=httpx.MockTransport(handler)) as c:
            await ElevenLabsClient(Settings(elevenlabs_api_key="k"))._ensure_credits(c, {})

    asyncio.run(run())


def test_call_refused_when_credits_are_used_up():
    with pytest.raises(AIConfigError) as err:
        _check(200, {"character_count": 9982, "character_limit": 10000, "next_character_count_reset_unix": 1793928960})
    assert err.value.code == "voice_quota_exhausted" and "text chat" in str(err.value)


def test_call_allowed_with_credits_or_when_check_fails():
    _check(200, {"character_count": 1000, "character_limit": 10000})
    _check(401, {"detail": "missing_permissions"})


def test_call_moves_to_second_account_when_first_is_out_of_credits():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = request.headers["xi-api-key"]
        if request.url.path == "/v1/user/subscription":
            return httpx.Response(200, json={"character_count": 9990 if key == "k1" else 0, "character_limit": 10000})
        seen.append((key, request.url.params["agent_id"]))
        return httpx.Response(200, json={"token": f"tok-{key}"})

    settings = Settings(
        elevenlabs_api_key="k1", elevenlabs_agent_map='{"manager": "a1"}',
        elevenlabs_api_key_2="k2", elevenlabs_agent_map_2='{"manager": "a2"}',
    )
    client = ElevenLabsClient(settings)
    client._client = httpx.AsyncClient(base_url="https://api.test", transport=httpx.MockTransport(handler))
    assert asyncio.run(client.mint_for_npc("manager", "female")) == ("tok-k2", "a2")
    assert seen == [("k2", "a2")]


def test_third_account_is_tried_after_the_second():
    from app.core.config import Settings

    s = Settings(
        _env_file=None,
        elevenlabs_api_key="k1",
        elevenlabs_agent_map='{"manager":"a1"}',
        elevenlabs_api_key_2="k2",
        elevenlabs_agent_map_2='{"manager":"a2"}',
        elevenlabs_api_key_3="k3",
        elevenlabs_agent_map_3='{"manager":"a3"}',
    )
    assert [(k, m["manager"]) for k, m in s.elevenlabs_accounts] == [("k1", "a1"), ("k2", "a2"), ("k3", "a3")]


def _pool_client(handler) -> ElevenLabsClient:
    settings = Settings(
        _env_file=None,
        elevenlabs_api_key="k1", elevenlabs_agent_map='{"manager": "a1"}',
        elevenlabs_api_key_2="k2", elevenlabs_agent_map_2='{"manager": "a2"}',
    )
    client = ElevenLabsClient(settings)
    client._client = httpx.AsyncClient(base_url="https://api.test", transport=httpx.MockTransport(handler))
    return client


def _spent_pool(user_handler=None):
    """Every server account is out of credits; the player's key "mine" goes to user_handler."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = request.headers["xi-api-key"]
        calls.append((key, request.method, request.url.path))
        if key in ("k1", "k2"):
            if request.url.path == "/v1/user/subscription":
                return httpx.Response(200, json={"character_count": 10000, "character_limit": 10000})
            return httpx.Response(200, json={"token": "pool-token"})
        return user_handler(request)

    return _pool_client(handler), calls


def test_player_is_asked_for_a_key_only_when_every_account_is_out_of_credits():
    client, _ = _spent_pool()
    with pytest.raises(AIConfigError) as err:
        asyncio.run(client.mint_for_npc("manager", "female"))
    assert err.value.code == "voice_credits_exhausted"


def test_player_key_is_ignored_while_a_server_account_has_credits():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["xi-api-key"] != "mine"
        if request.url.path == "/v1/user/subscription":
            return httpx.Response(200, json={"character_count": 0, "character_limit": 10000})
        return httpx.Response(200, json={"token": "pool-token"})

    assert asyncio.run(_pool_client(handler).mint_for_npc("manager", "female", user_api_key="mine")) == ("pool-token", "a1")


def test_passing_failure_does_not_ask_for_a_key():
    def handler(request: httpx.Request) -> httpx.Response:
        key = request.headers["xi-api-key"]
        if request.url.path == "/v1/user/subscription":
            return httpx.Response(200, json={"character_count": 10000 if key == "k1" else 0, "character_limit": 10000})
        return httpx.Response(429)

    with pytest.raises(AppError) as err:
        asyncio.run(_pool_client(handler).mint_for_npc("manager", "female", user_api_key="mine"))
    assert err.value.code == "rate_limited"


def test_player_key_sets_up_the_agent_once_and_mints_the_token():
    def user(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/user/subscription":
            return httpx.Response(200, json={"character_count": 0, "character_limit": 10000})
        if path == "/v1/convai/agents":
            return httpx.Response(200, json={"agents": []})
        if path == "/v1/voices":
            return httpx.Response(200, json={"voices": [{"voice_id": v} for v, _ in VOICES.values()]})
        if path == "/v1/convai/agents/create":
            return httpx.Response(200, json={"agent_id": "my-agent"})
        if path == "/v1/convai/conversation/token":
            assert request.url.params["agent_id"] == "my-agent"
            return httpx.Response(200, json={"token": "my-token"})
        raise AssertionError(path)

    client, calls = _spent_pool(user)
    assert asyncio.run(client.mint_for_npc("manager", "female", user_api_key="mine")) == ("my-token", "my-agent")
    assert asyncio.run(client.mint_for_npc("manager", "female", user_api_key="mine")) == ("my-token", "my-agent")
    assert [c for c in calls if c[2] == "/v1/convai/agents/create"] == [("mine", "POST", "/v1/convai/agents/create")]
    # Spent server accounts are remembered, not re-checked on every call.
    assert sum(1 for c in calls if c[0] == "k1") == 1


def test_rejected_player_key_is_reported():
    client, _ = _spent_pool(lambda request: httpx.Response(401, json={"detail": "invalid_api_key"}))
    with pytest.raises(AIConfigError) as err:
        asyncio.run(client.mint_for_npc("manager", "female", user_api_key="mine"))
    assert err.value.code == "voice_user_key_invalid"


def test_twelve_accounts_are_read():
    s = Settings(_env_file=None, elevenlabs_api_key_12="k12", elevenlabs_agent_id_12="a12")
    assert s.elevenlabs_accounts == [("k12", {"*": "a12"})]
