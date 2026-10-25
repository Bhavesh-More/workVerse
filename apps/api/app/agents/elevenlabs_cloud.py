"""ElevenLabs ElevenAgents server adapter.

Server-only: mints short-lived WebRTC conversation tokens for a configured agent. The
long-lived ``ELEVENLABS_API_KEY`` never leaves the backend. The documented endpoint is
``GET /v1/convai/conversation/token?agent_id=...`` authenticated with the ``xi-api-key``
header (see docs/elevenagents-setup.md). The base URL is allow-listed at settings load.

When every server account is out of credits, a call can run on the player's own ElevenLabs key
instead: the agents are created on their account the first time, and the key is only held in
memory as a fingerprint for that agent lookup, never stored or logged.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import UTC, datetime

import httpx

from app.agents.voice_agents import agent_spec, payload
from app.core.config import Settings, pick_agent
from app.core.errors import AIConfigError, AITimeoutError, AppError, RateLimitError, UpstreamError

# Calls cost about 11 credits a second; don't start one with less than a minute left.
MIN_CALL_CREDITS = 600
# An account found out of credits is skipped without asking again until then (or its monthly reset).
SPENT_RECHECK_SECONDS = 900
QUOTA_EXHAUSTED = "voice_quota_exhausted"
# Failures that mean an account can never take a call as configured (as if its slot were empty),
# as opposed to passing trouble such as a timeout or rate limit.
_UNUSABLE = {"voice_provider_auth", "voice_agent_not_found", "voice_not_configured"}


def _fingerprint(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()

logger = logging.getLogger(__name__)


class ElevenLabsClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: httpx.AsyncClient | None = None
        self._spent_until: dict[str, float] = {}  # key fingerprint -> unix time to check it again
        self._own_agents: dict[str, dict[str, str]] = {}  # player key fingerprint -> map key -> agent id
        self._own_locks: dict[str, asyncio.Lock] = {}

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._settings.elevenlabs_base_url,
                timeout=httpx.Timeout(self._settings.ollama_timeout_seconds),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def configured(self) -> bool:
        return bool(self._settings.elevenlabs_accounts)

    async def _ensure_credits(self, client: httpx.AsyncClient, headers: dict[str, str]) -> None:
        """Refuse to start a call the account can't pay for; ElevenLabs would cut it off mid-sentence
        with a bare "Unknown error". Best effort: if the check itself fails, the call goes ahead."""
        try:
            resp = await client.get("/v1/user/subscription", headers=headers)
            sub = resp.json() if resp.status_code == 200 else {}
        except (httpx.HTTPError, ValueError):
            return
        used, limit = sub.get("character_count"), sub.get("character_limit")
        if not isinstance(used, int) or not isinstance(limit, int) or limit - used >= MIN_CALL_CREDITS:
            return
        reset = sub.get("next_character_count_reset_unix")
        when = f" They reset on {datetime.fromtimestamp(reset, UTC):%d %B}." if isinstance(reset, int) else ""
        raise AIConfigError(
            f"Voice calls are paused: this month's ElevenLabs voice credits are used up.{when} "
            "You can keep going in text chat.",
            code=QUOTA_EXHAUSTED,
            details={"reset_unix": reset} if isinstance(reset, int) else None,
        )

    def _is_spent(self, api_key: str) -> bool:
        until = self._spent_until.get(_fingerprint(api_key))
        return until is not None and time.time() < until

    def _mark_spent(self, api_key: str, exc: AppError) -> None:
        until = time.time() + SPENT_RECHECK_SECONDS
        reset = exc.details.get("reset_unix")
        if isinstance(reset, int):
            until = min(until, reset)
        self._spent_until[_fingerprint(api_key)] = until

    async def mint_for_npc(
        self, npc_id: str, gender: str | None = None, *, user_api_key: str | None = None
    ) -> tuple[str, str]:
        """(token, agent id) from the first account that can take the call.

        Accounts are tried in order (ELEVENLABS_API_KEY, then _2 … _12); one that is out
        of credits, rate limited, rejects its key or errors is skipped, and the last error is raised
        only if none works. Each account has its own agents, so the agent id comes with the token.

        The player's own key (``user_api_key``) is used only when every server account is out of
        credits; without one, that case raises ``voice_credits_exhausted`` so the app can ask for it.
        Accounts that can never work (bad key, missing agent) don't count either way; any passing
        failure (timeout, rate limit) means the server's credits aren't known to be gone.
        """
        last: AppError | None = None
        spent = 0
        passing_failure = False
        for index, (key, agents) in enumerate(self._settings.elevenlabs_accounts, start=1):
            agent_id = pick_agent(agents, npc_id, gender)
            if not agent_id:
                continue
            if self._is_spent(key):
                spent += 1
                continue
            try:
                token = await self.create_conversation_token(agent_id, api_key=key)
            except AppError as exc:
                logger.warning("elevenlabs_account_skipped", extra={"account": index, "code": exc.code})
                last = exc
                if exc.code == QUOTA_EXHAUSTED:
                    self._mark_spent(key, exc)
                    spent += 1
                elif exc.code not in _UNUSABLE:
                    passing_failure = True
                continue
            if index > 1:
                logger.info("elevenlabs_account_rotated", extra={"account": index})
            return token, agent_id
        if spent and not passing_failure:
            if user_api_key and user_api_key.strip():
                logger.info("elevenlabs_user_key_used")
                return await self._mint_with_user_key(user_api_key.strip(), npc_id, gender)
            raise AIConfigError(
                "WorkVerse's voice credits are used up for now. Add your own ElevenLabs API key "
                "to keep talking, or carry on in text chat.",
                code="voice_credits_exhausted",
            )
        raise last or AIConfigError(
            "Voice is not configured. Set ELEVENLABS_API_KEY and an agent id for this character.",
            code="voice_not_configured",
        )

    async def _mint_with_user_key(self, api_key: str, npc_id: str, gender: str | None) -> tuple[str, str]:
        for attempt in range(2):
            agent_id = await self._user_agent(api_key, npc_id, gender)
            try:
                return await self.create_conversation_token(agent_id, api_key=api_key), agent_id
            except AppError as exc:
                if exc.code == "voice_agent_not_found" and attempt == 0:
                    # Deleted on their account since we made it: make it again.
                    self._own_agents.get(_fingerprint(api_key), {}).pop(agent_spec(npc_id, gender)[0], None)
                    continue
                if exc.code == QUOTA_EXHAUSTED:
                    raise AIConfigError(
                        "Your ElevenLabs key is out of voice credits too. You can keep going in text chat.",
                        code="voice_user_key_exhausted",
                    ) from exc
                if exc.code == "voice_provider_auth":
                    raise self._user_key_rejected() from exc
                raise
        raise AssertionError("unreachable")

    @staticmethod
    def _user_key_rejected() -> AIConfigError:
        return AIConfigError(
            "ElevenLabs didn't accept your API key. Check it's correct and allows ElevenAgents "
            "(write) and Voices access.",
            code="voice_user_key_invalid",
        )

    async def _user_agent(self, api_key: str, npc_id: str, gender: str | None) -> str:
        """This character's agent on the player's account, created on first use."""
        fp = _fingerprint(api_key)
        spec = agent_spec(npc_id, gender)
        async with self._own_locks.setdefault(fp, asyncio.Lock()):
            agents = self._own_agents.setdefault(fp, {})
            if spec[0] not in agents:
                agents[spec[0]] = await self._create_user_agent(api_key, spec)
            return agents[spec[0]]

    async def _user_request(self, method: str, path: str, api_key: str, **kwargs) -> httpx.Response:
        client = await self._get_client()
        try:
            resp = await client.request(method, path, headers={"xi-api-key": api_key, "Accept": "application/json"}, **kwargs)
        except httpx.TimeoutException as exc:
            raise AITimeoutError("The voice provider timed out.") from exc
        except httpx.HTTPError as exc:
            raise UpstreamError("Unable to reach the voice provider.") from exc
        if resp.status_code in (401, 403):
            raise self._user_key_rejected()
        if resp.status_code == 429:
            raise RateLimitError("The voice provider rate limit or quota was reached.")
        return resp

    async def _create_user_agent(self, api_key: str, spec: tuple[str, str, str, str, str]) -> str:
        """Reuse the agent of the same name if the account has one, else add its voice and create it."""
        _key, slot, gender, label, first = spec
        body = payload(slot, gender, label, first)
        listed = await self._user_request("GET", "/v1/convai/agents", api_key, params={"page_size": 100, "search": body["name"]})
        try:
            found = [a for a in (listed.json() or {}).get("agents", []) if a.get("name") == body["name"]]
        except ValueError:
            found = []
        if listed.status_code == 200 and found and found[0].get("agent_id"):
            return str(found[0]["agent_id"])

        voice_id = body["conversation_config"]["tts"]["voice_id"]
        await self._add_library_voice(api_key, voice_id)
        resp = await self._user_request("POST", "/v1/convai/agents/create", api_key, json=body)
        if 400 <= resp.status_code < 500:
            # Most likely the voice isn't available on their plan: fall back to the default voice.
            del body["conversation_config"]["tts"]["voice_id"]
            resp = await self._user_request("POST", "/v1/convai/agents/create", api_key, json=body)
        try:
            agent_id = (resp.json() or {}).get("agent_id") if resp.status_code < 300 else None
        except ValueError:
            agent_id = None
        if not agent_id:
            raise UpstreamError(f"Couldn't set up the voice character on your ElevenLabs account ({resp.status_code}).")
        logger.info("elevenlabs_user_agent_created", extra={"agent": spec[0]})
        return str(agent_id)

    async def _add_library_voice(self, api_key: str, voice_id: str) -> None:
        """Best effort: add the cast's library voice to the player's account (free) so the agent can use it."""
        try:
            mine = await self._user_request("GET", "/v1/voices", api_key)
            if any(v.get("voice_id") == voice_id for v in (mine.json() or {}).get("voices", [])):
                return
            from app.simulation.tracks import VOICES

            label = next((lbl for vid, lbl in VOICES.values() if vid == voice_id), "")
            shared = await self._user_request(
                "GET", "/v1/shared-voices", api_key, params={"search": label.split(" - ")[0], "page_size": 50}
            )
            match = next((v for v in (shared.json() or {}).get("voices", []) if v.get("voice_id") == voice_id), None)
            if match:
                await self._user_request(
                    "POST", f"/v1/voices/add/{match['public_owner_id']}/{voice_id}", api_key, json={"new_name": label or voice_id}
                )
        except (AppError, ValueError, KeyError):
            return

    async def create_conversation_token(self, agent_id: str, *, api_key: str | None = None) -> str:
        """Return a short-lived conversation token for WebRTC, or raise a typed error."""
        api_key = (api_key or self._settings.elevenlabs_api_key).strip()
        if not api_key:
            raise AIConfigError(
                "Voice is not configured. Set ELEVENLABS_API_KEY on the server to enable it.",
                code="voice_not_configured",
            )
        if not agent_id:
            raise AIConfigError(
                "No ElevenAgents agent is mapped to this character.",
                code="voice_not_configured",
            )
        client = await self._get_client()
        headers = {"xi-api-key": api_key, "Accept": "application/json"}
        await self._ensure_credits(client, headers)
        started = time.perf_counter()
        try:
            resp = await client.get(
                "/v1/convai/conversation/token",
                params={"agent_id": agent_id},
                headers=headers,
            )
        except httpx.TimeoutException as exc:
            raise AITimeoutError("The voice provider timed out.") from exc
        except httpx.HTTPError as exc:
            raise UpstreamError("Unable to reach the voice provider.") from exc

        latency_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code in (401, 403):
            detail: dict = {}
            try:
                body = resp.json()
                if isinstance(body, dict) and isinstance(body.get("detail"), dict):
                    detail = body["detail"]
            except ValueError:
                detail = {}
            if detail.get("status") == "quota_exceeded":
                raise AIConfigError(
                    "Voice calls are paused: this month's ElevenLabs voice credits are used up. "
                    "You can keep going in text chat.",
                    code=QUOTA_EXHAUSTED,
                )
            if detail.get("status") == "missing_permissions":
                raise AIConfigError(
                    "Voice is unavailable: the server's ElevenLabs API key is missing the "
                    "required 'convai_write' (ElevenAgents) permission. Text chat still works.",
                    code="voice_provider_auth",
                )
            raise AIConfigError(
                "The voice provider rejected the configured API key or agent access.",
                code="voice_provider_auth",
            )
        if resp.status_code == 429:
            raise RateLimitError("The voice provider rate limit or quota was reached.")
        if resp.status_code == 404:
            raise AIConfigError(
                "The configured ElevenAgents agent was not found for this API key.",
                code="voice_agent_not_found",
            )
        if resp.status_code >= 400:
            raise UpstreamError(f"The voice provider returned an error ({resp.status_code}).")

        try:
            token = (resp.json() or {}).get("token")
        except ValueError as exc:
            raise UpstreamError("The voice provider returned an unreadable response.") from exc
        if not token:
            raise UpstreamError("The voice provider did not return a conversation token.")
        logger.info("elevenlabs_token_minted", extra={"latency_ms": latency_ms})
        return str(token)
