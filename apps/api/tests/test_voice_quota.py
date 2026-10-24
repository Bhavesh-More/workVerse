import asyncio

import httpx
import pytest
from app.agents.elevenlabs_cloud import ElevenLabsClient
from app.core.config import Settings
from app.core.errors import AIConfigError


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
