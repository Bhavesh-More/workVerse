"""AI provider adapter tests (mocked transport; no credits consumed)."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from app.agents.ollama_cloud import ChatResult, OllamaCloudClient, _extract_json
from app.core.config import Settings, _clerk_domain
from app.core.errors import AIConfigError, RateLimitError
from pydantic import ValidationError


def test_base_url_must_be_https_hosted() -> None:
    with pytest.raises(ValidationError):
        Settings(ollama_base_url="http://localhost:11434/v1")
    with pytest.raises(ValidationError):
        Settings(ollama_base_url="http://127.0.0.1:11434/api")
    ok = Settings(ollama_base_url="https://ollama.com/v1")
    assert ok.ollama_base_url == "https://ollama.com/v1"


def test_key_pool_dedup_and_order() -> None:
    settings = Settings(ollama_api_keys="a,b,a", ollama_api_key="c")
    assert settings.ollama_key_pool == ["a", "b", "c"]


def test_no_keys_raises_config_error() -> None:
    client = OllamaCloudClient(Settings(ollama_api_keys="", ollama_api_key=""))
    assert client.configured is False
    with pytest.raises(AIConfigError):
        asyncio.run(client.chat([{"role": "user", "content": "hi"}]))


def test_extract_json_handles_fences_and_prose() -> None:
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert _extract_json('Sure! {"a": 2} done') == {"a": 2}
    assert _extract_json("not json") is None


def test_clerk_domain_decoding() -> None:
    # pk_test_<base64("example.clerk.accounts.dev$")>
    import base64

    domain = "mutual-monkfish-935.clerk.accounts.dev"
    pk = "pk_test_" + base64.b64encode(f"{domain}$".encode()).decode().rstrip("=")
    assert _clerk_domain(pk) == domain
    settings = Settings(clerk_publishable_key=pk)
    assert settings.clerk_jwt_issuer == f"https://{domain}"
    assert settings.clerk_jwks_url == f"https://{domain}/.well-known/jwks.json"


def test_key_rotation_on_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    client = OllamaCloudClient(Settings(ollama_api_keys="key1,key2", ollama_api_key=""))
    calls: list[int] = []

    async def fake_call(body, key, key_index):  # noqa: ANN001
        calls.append(key_index)
        if key_index == 0:
            raise RateLimitError("quota")
        return ChatResult(content="ok", model="m", key_index=key_index)

    monkeypatch.setattr(client, "_call_with_retries", fake_call)
    result = asyncio.run(client.chat([{"role": "user", "content": "hi"}]))
    assert result.content == "ok"
    assert calls == [0, 1]
    # cursor advanced past the exhausted key
    assert client._cursor == 1


def test_transport_parses_openai_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer testkey"
        return httpx.Response(
            200,
            json={
                "model": "gemma4:31b",
                "choices": [{"message": {"role": "assistant", "content": "hello"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            },
        )

    client = OllamaCloudClient(Settings(ollama_api_keys="testkey", ollama_api_key=""))
    client._client = httpx.AsyncClient(
        base_url="https://ollama.com/v1", transport=httpx.MockTransport(handler)
    )
    result = asyncio.run(client.chat([{"role": "user", "content": "hi"}]))
    assert result.content == "hello"
    assert result.prompt_tokens == 5
    asyncio.run(client.aclose())
