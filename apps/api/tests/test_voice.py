"""Voice integration tests (all provider calls mocked; no credentials consumed)."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from app.agents.elevenlabs_cloud import ElevenLabsClient
from app.agents.ollama_cloud import OllamaCloudClient
from app.agents.prompts import build_character_messages
from app.core.config import Settings
from app.core.errors import AIConfigError, AuthError, ConflictError, ValidationAppError
from app.core.voice_grant import issue_grant, verify_grant
from app.services import voice_llm, voice_service
from app.simulation.templates import build_production_incident
from pydantic import ValidationError

SECRET = "grant-secret-" + "x" * 32
BLUEPRINT = build_production_incident(seed=7)


# --------------------------------------------------------------------------- grant
def test_grant_roundtrip_and_scope() -> None:
    token, exp = issue_grant(
        SECRET,
        user_id="u1",
        session_id="s1",
        voice_session_id="v1",
        npc_id="manager",
        ttl_seconds=60,
        now=1000,
    )
    grant = verify_grant(SECRET, token, now=1000)
    assert (grant.user_id, grant.session_id, grant.voice_session_id, grant.npc_id) == (
        "u1",
        "s1",
        "v1",
        "manager",
    )
    assert exp == 1060


def test_grant_rejects_tamper_expiry_and_wrong_secret() -> None:
    token, _ = issue_grant(
        SECRET,
        user_id="u1",
        session_id="s1",
        voice_session_id="v1",
        npc_id="manager",
        ttl_seconds=60,
        now=1000,
    )
    with pytest.raises(AuthError):
        verify_grant(SECRET, token + "a", now=1000)
    with pytest.raises(AuthError):
        verify_grant("other-secret-" + "y" * 32, token, now=1000)
    with pytest.raises(AuthError):
        verify_grant(SECRET, token, now=2000)
    with pytest.raises(AuthError):
        verify_grant(SECRET, "not-a-token", now=1000)


def test_grant_requires_secret() -> None:
    with pytest.raises(ValidationAppError):
        issue_grant(
            "", user_id="u", session_id="s", voice_session_id="v", npc_id="manager", ttl_seconds=1
        )


# --------------------------------------------------------------------------- settings
def test_agent_mapping_default_and_specific() -> None:
    settings = Settings(
        elevenlabs_api_key="k",
        elevenlabs_agent_id="agent_default",
        elevenlabs_agent_map='{"manager": "agent_mgr"}',
    )
    assert settings.agent_for_npc("manager") == "agent_mgr"
    assert settings.agent_for_npc("teammate") == "agent_default"
    assert settings.voice_configured is True


def test_agent_mapping_tolerates_bad_json() -> None:
    settings = Settings(
        elevenlabs_api_key="k", elevenlabs_agent_id="a", elevenlabs_agent_map="{oops"
    )
    assert settings.agent_for_npc("manager") == "a"


def test_elevenlabs_base_url_must_be_hosted_https() -> None:
    with pytest.raises(ValidationError):
        Settings(elevenlabs_base_url="http://api.elevenlabs.io")
    with pytest.raises(ValidationError):
        Settings(elevenlabs_base_url="https://evil.example.com")


# --------------------------------------------------------------------------- elevenlabs client
def test_conversation_token_minted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["xi-api-key"] == "test-key"
        if request.url.path == "/v1/user/subscription":
            return httpx.Response(200, json={"character_count": 0, "character_limit": 10000})
        assert request.url.params["agent_id"] == "agent_x"
        return httpx.Response(200, json={"token": "conv-token-123"})

    client = ElevenLabsClient(Settings(elevenlabs_api_key="test-key"))
    client._client = httpx.AsyncClient(
        base_url="https://api.elevenlabs.io", transport=httpx.MockTransport(handler)
    )
    token = asyncio.run(client.create_conversation_token("agent_x"))
    assert token == "conv-token-123"
    asyncio.run(client.aclose())


def test_conversation_token_maps_auth_errors() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "bad key"})

    client = ElevenLabsClient(Settings(elevenlabs_api_key="test-key"))
    client._client = httpx.AsyncClient(
        base_url="https://api.elevenlabs.io", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(AIConfigError):
        asyncio.run(client.create_conversation_token("agent_x"))
    asyncio.run(client.aclose())


# --------------------------------------------------------------------------- ollama streaming
def test_ollama_stream_parses_sse() -> None:
    body = (
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    client = OllamaCloudClient(Settings(ollama_api_key="k"))
    client._client = httpx.AsyncClient(
        base_url="https://ollama.com/v1", transport=httpx.MockTransport(handler)
    )

    async def collect() -> list[str]:
        return [chunk async for chunk in client.stream_chat([{"role": "user", "content": "hi"}])]

    assert asyncio.run(collect()) == ["Hel", "lo"]
    asyncio.run(client.aclose())


# --------------------------------------------------------------------------- bridge helpers
def test_extract_grant_from_extra_body_and_marker() -> None:
    assert voice_llm.extract_grant({"elevenlabs_extra_body": {"context_grant": "tok"}}) == "tok"
    messages = [{"role": "system", "content": "intro [[workverse_grant:abc.def]] outro"}]
    assert voice_llm.extract_grant({"messages": messages}, messages) == "abc.def"
    assert voice_llm.extract_grant({}, [{"role": "user", "content": "hi"}]) is None


def test_strip_grant_markers() -> None:
    stripped = voice_llm.strip_grant_markers("a [[workverse_grant:tok]] b")
    assert "workverse_grant" not in stripped
    assert "tok" not in stripped
    assert "a" in stripped and "b" in stripped


def test_build_voice_messages_drops_system_and_bounds_history() -> None:
    character = BLUEPRINT.character("manager")
    assert character is not None
    state = _state()
    eleven = [
        {"role": "system", "content": "agent system prompt [[workverse_grant:secret.token]]"},
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi, how can I help?"},
        {"role": "user", "content": "what is the impact?"},
    ]
    out = voice_llm.build_voice_messages(BLUEPRINT, state, character, eleven)
    assert out[0]["role"] == "system"
    joined = " ".join(m["content"] for m in out)
    assert "workverse_grant" not in joined  # internal routing metadata stripped
    assert "secret.token" not in joined
    assert out[-1]["role"] == "user"
    assert "what is the impact?" in out[-1]["content"]


def test_verify_bridge_secret_accepts_documented_forms() -> None:
    settings = Settings(voice_llm_bridge_secret="bridge-secret")
    voice_llm.verify_bridge_secret(settings, {"authorization": "Bearer bridge-secret"})
    voice_llm.verify_bridge_secret(settings, {"xi-api-key": "bridge-secret"})
    with pytest.raises(AuthError):
        voice_llm.verify_bridge_secret(settings, {"authorization": "Bearer nope"})
    with pytest.raises(AuthError):
        voice_llm.verify_bridge_secret(settings, {})
    with pytest.raises(AIConfigError):
        voice_llm.verify_bridge_secret(Settings(voice_llm_bridge_secret=""), {"authorization": "Bearer x"})


def test_validate_bridge_request_limits() -> None:
    voice_llm.validate_bridge_request({}, [{"role": "user", "content": "ok"}])
    with pytest.raises(AIConfigError):
        voice_llm.validate_bridge_request({}, [{"role": "user", "content": "x"}] * 100)


# --------------------------------------------------------------------------- bridge endpoint
class _FakeAI:
    async def stream_chat(self, messages: list[dict[str, str]], **_: Any):  # noqa: ANN202
        yield "Hello"
        yield " there"


def test_voice_llm_bridge_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import voice as voice_api
    from app.core.config import get_settings
    from app.deps import ai_client_dep, settings_dep
    from app.main import app
    from fastapi.testclient import TestClient

    settings = Settings(
        voice_llm_bridge_secret="bridge-secret",
        voice_context_grant_secret=SECRET,
        ollama_api_key="k",
    )
    monkeypatch.setattr(voice_api, "_bridge_context", _fake_bridge_context)

    app.dependency_overrides[settings_dep] = lambda: settings
    app.dependency_overrides[ai_client_dep] = lambda: _FakeAI()
    try:
        with TestClient(app) as client:
            unauthorized = client.post(
                "/api/v1/voice/llm",
                json={"messages": [{"role": "user", "content": "hi"}]},
            )
            assert unauthorized.status_code == 401

            missing_grant = client.post(
                "/api/v1/voice/llm",
                headers={"Authorization": "Bearer bridge-secret"},
                json={"messages": [{"role": "user", "content": "hi"}]},
            )
            assert missing_grant.status_code == 401

            ok = client.post(
                "/api/v1/voice/llm",
                headers={"Authorization": "Bearer bridge-secret"},
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "elevenlabs_extra_body": {"context_grant": "tok"},
                },
            )
            assert ok.status_code == 200
            assert ok.headers["content-type"].startswith("text/event-stream")
            assert "Hello" in ok.text
            assert ok.text.rstrip().endswith("data: [DONE]")

            # ElevenLabs may append /chat/completions to the Server URL; both forms must route here.
            for path in ("/api/v1/voice/llm/chat/completions", "/api/v1/voice/llm/v1/chat/completions"):
                alias = client.post(
                    path,
                    headers={"Authorization": "Bearer bridge-secret"},
                    json={"messages": [{"role": "user", "content": "hi"}], "elevenlabs_extra_body": {"context_grant": "tok"}},
                )
                assert alias.status_code == 200, path
                assert "Hello" in alias.text
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


async def _fake_bridge_context(*_: Any, **__: Any) -> list[dict[str, str]]:
    return [{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}]


# --------------------------------------------------------------------------- service (FakeRepo)
class _FakeVoice:
    def __init__(self, fail: bool = False) -> None:
        self.configured = True
        self.fail = fail

    async def mint_for_npc(self, npc_id: str, gender: str | None = None, *, user_api_key: str | None = None) -> tuple[str, str]:
        if self.fail:
            raise AIConfigError("nope", code="voice_provider_auth")
        return "token-abc", "agent_x"


class _FakeRepo:
    def __init__(self, *, status: str = "active", owner: str = "u1") -> None:
        self.blueprint = BLUEPRINT
        self.owner = owner
        self.row = {
            "id": "s1",
            "user_id": owner,
            "status": status,
            "state_version": 1,
            "scenario_version_id": "sv1",
            "state": _state().model_dump(),
        }
        self.voices: dict[str, dict[str, Any]] = {}
        self.messages: list[dict[str, Any]] = []
        self.committed = 0
        self.session = self  # mirror Repository.session for commit() calls

    async def commit(self) -> None:
        self.committed += 1

    async def lock_session_messages(self, session_id: str) -> None:
        return None

    @asynccontextmanager
    async def begin_nested(self):  # noqa: ANN201
        yield

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.row if session_id == "s1" else None

    async def get_scenario_version(self, version_id: str) -> dict[str, Any] | None:
        return {"id": version_id, "blueprint": self.blueprint.model_dump()}

    async def get_active_voice_session(self, session_id: str, npc_id: str):  # noqa: ANN201
        for v in self.voices.values():
            if (
                v["session_id"] == session_id
                and v["npc_id"] == npc_id
                and v["status"]
                in {
                    "created",
                    "connecting",
                    "active",
                }
            ):
                return v
        return None

    async def create_voice_session(self, **kw: Any):  # noqa: ANN201
        if await self.get_active_voice_session(kw["session_id"], kw["npc_id"]) is not None:
            return None
        vs = {
            "id": f"v{len(self.voices) + 1}",
            "session_id": kw["session_id"],
            "user_id": kw["user_id"],
            "npc_id": kw["npc_id"],
            "status": "created",
            "agent_config_key": kw["agent_config_key"],
        }
        self.voices[vs["id"]] = vs
        return vs

    async def set_voice_session_status(self, vid: str, status: str, **kw: Any):  # noqa: ANN201
        vs = self.voices.get(vid)
        if vs is not None:
            vs["status"] = status
        return vs

    async def get_voice_session(self, vid: str):  # noqa: ANN201
        return self.voices.get(vid)

    async def next_message_sequence(self, session_id: str) -> int:
        return len(self.messages) + 1

    async def get_message_by_provider_id(self, session_id: str, pmid: str):  # noqa: ANN201
        return next(
            (
                m
                for m in self.messages
                if m["provider_message_id"] == pmid and m["session_id"] == session_id
            ),
            None,
        )

    async def insert_message(self, **kw: Any):  # noqa: ANN201
        row = {"id": f"m{len(self.messages) + 1}", **kw}
        self.messages.append(row)
        return row

    async def list_messages(self, session_id: str, limit: int = 200):  # noqa: ANN201
        return [m for m in self.messages if m["session_id"] == session_id]


def _state():  # noqa: ANN202
    from app.simulation.engine import build_initial_state

    return build_initial_state(BLUEPRINT, "sv1")


def _settings() -> Settings:
    return Settings(
        elevenlabs_api_key="k",
        elevenlabs_agent_id="agent_default",
        voice_context_grant_secret=SECRET,
        voice_context_grant_ttl_seconds=600,
    )


def test_start_voice_session_mints_token_and_grant() -> None:
    repo = _FakeRepo()
    result = asyncio.run(
        voice_service.start_voice_session(
            repo=repo,  # type: ignore[arg-type]
            voice_client=_FakeVoice(),  # type: ignore[arg-type]
            settings=_settings(),
            user_id="u1",
            session_id="s1",
            npc_id="manager",
        )
    )
    assert result["conversation_token"] == "token-abc"
    assert result["npc"]["id"] == "manager"
    grant = verify_grant(SECRET, result["context_grant"])
    assert grant.voice_session_id == result["voice_session_id"]
    assert grant.npc_id == "manager"


def test_start_voice_session_is_idempotent() -> None:
    repo = _FakeRepo()
    kwargs = dict(
        repo=repo,  # type: ignore[arg-type]
        voice_client=_FakeVoice(),  # type: ignore[arg-type]
        settings=_settings(),
        user_id="u1",
        session_id="s1",
        npc_id="manager",
    )
    first = asyncio.run(voice_service.start_voice_session(**kwargs))
    second = asyncio.run(voice_service.start_voice_session(**kwargs))
    assert first["voice_session_id"] == second["voice_session_id"]
    assert len(repo.voices) == 1


def test_start_voice_session_rejects_bad_inputs() -> None:
    repo = _FakeRepo()
    with pytest.raises(ValidationAppError):
        asyncio.run(
            voice_service.start_voice_session(
                repo=repo,  # type: ignore[arg-type]
                voice_client=_FakeVoice(),  # type: ignore[arg-type]
                settings=_settings(),
                user_id="u1",
                session_id="s1",
                npc_id="ghost",
            )
        )
    inactive = _FakeRepo(status="completed")
    with pytest.raises(ConflictError):
        asyncio.run(
            voice_service.start_voice_session(
                repo=inactive,  # type: ignore[arg-type]
                voice_client=_FakeVoice(),  # type: ignore[arg-type]
                settings=_settings(),
                user_id="u1",
                session_id="s1",
                npc_id="manager",
            )
        )
    unconfigured = Settings(voice_enabled=False)
    with pytest.raises(AIConfigError):
        asyncio.run(
            voice_service.start_voice_session(
                repo=repo,  # type: ignore[arg-type]
                voice_client=_FakeVoice(),  # type: ignore[arg-type]
                settings=unconfigured,
                user_id="u1",
                session_id="s1",
                npc_id="manager",
            )
        )


def test_token_failure_creates_no_voice_session() -> None:
    repo = _FakeRepo()
    with pytest.raises(AIConfigError):
        asyncio.run(
            voice_service.start_voice_session(
                repo=repo,  # type: ignore[arg-type]
                voice_client=_FakeVoice(fail=True),  # type: ignore[arg-type]
                settings=_settings(),
                user_id="u1",
                session_id="s1",
                npc_id="manager",
            )
        )
    assert repo.voices == {}  # the token is minted first, so a failed start leaves nothing behind


def test_ingest_transcript_deduplicates() -> None:
    repo = _FakeRepo()
    v = asyncio.run(
        voice_service.start_voice_session(
            repo=repo,  # type: ignore[arg-type]
            voice_client=_FakeVoice(),  # type: ignore[arg-type]
            settings=_settings(),
            user_id="u1",
            session_id="s1",
            npc_id="manager",
        )
    )
    vid = v["voice_session_id"]
    first = asyncio.run(
        voice_service.ingest_transcript_message(
            repo=repo,  # type: ignore[arg-type]
            user_id="u1",
            session_id="s1",
            voice_session_id=vid,
            speaker="npc",
            text="The impact is 31 percent.",
            provider_message_id="evt-1",
        )
    )
    second = asyncio.run(
        voice_service.ingest_transcript_message(
            repo=repo,  # type: ignore[arg-type]
            user_id="u1",
            session_id="s1",
            voice_session_id=vid,
            speaker="npc",
            text="The impact is 31 percent.",
            provider_message_id="evt-1",
        )
    )
    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert len(repo.messages) == 1
    assert repo.messages[0]["speaker_type"] == "character"
    assert repo.messages[0]["character_id"] == "manager"
    assert repo.messages[0]["modality"] == "voice_transcript"


def test_ingest_rejects_unowned_voice_session() -> None:
    repo = _FakeRepo(owner="owner-a")
    repo.voices["vX"] = {
        "id": "vX",
        "session_id": "s1",
        "user_id": "owner-a",
        "npc_id": "manager",
        "status": "active",
    }
    from app.core.errors import ForbiddenError

    with pytest.raises(ForbiddenError):
        asyncio.run(
            voice_service.ingest_transcript_message(
                repo=repo,  # type: ignore[arg-type]
                user_id="intruder",
                session_id="s1",
                voice_session_id="vX",
                speaker="user",
                text="hello",
            )
        )


def test_prompt_disclosure_still_uses_server_rules() -> None:
    """The bridge reuses the deterministic disclosure path, not model output."""
    from app.simulation.engine import apply_disclosure

    state = _state()
    newly, events = apply_disclosure(BLUEPRINT, state, "manager", "what is the customer impact?")
    assert "f_business_impact" in newly
    assert any(e.event_type == "fact_discovered" for e in events)
    # building messages for that turn includes the newly-revealed fact context
    character = BLUEPRINT.character("manager")
    assert character is not None
    msgs = build_character_messages(BLUEPRINT, state, character, [], "impact?", newly)
    assert any("Business impact" in m["content"] for m in msgs)


def test_voice_prompt_uses_role_card_and_spoken_rules() -> None:
    state = _state()
    manager = BLUEPRINT.character("manager")
    assert manager is not None
    msgs = voice_llm.build_voice_messages(BLUEPRINT, state, manager, [{"role": "user", "content": "update?"}])
    system = msgs[0]["content"]
    assert "one question at a time" in system.lower()
    assert "No markdown, no lists" in system
    assert "Never solve the problem" in system
    # nothing the manager hasn't been granted: the teammate's deploy fact stays out of the prompt
    everything = " ".join(m["content"] for m in msgs)
    migration = BLUEPRINT.fact("f_migration_ran")
    assert migration is not None and migration.detail not in everything
    # text chat uses the same role card but chat-length rules, not spoken ones
    chat = build_character_messages(BLUEPRINT, state, manager, [], "update?", [])
    assert "Never solve the problem" in chat[0]["content"]
    assert "No markdown, no lists" not in chat[0]["content"]
    assert "Never ask the learner for the customer impact" in chat[0]["content"]


def test_spoken_strips_markdown() -> None:
    assert voice_llm.spoken("**Impact** is `high`") == "Impact is high"
