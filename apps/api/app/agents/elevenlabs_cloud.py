"""ElevenLabs ElevenAgents server adapter.

Server-only: mints short-lived WebRTC conversation tokens for a configured agent. The
long-lived ``ELEVENLABS_API_KEY`` never leaves the backend. The documented endpoint is
``GET /v1/convai/conversation/token?agent_id=...`` authenticated with the ``xi-api-key``
header (see docs/elevenagents-setup.md). The base URL is allow-listed at settings load.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

import httpx

from app.core.config import Settings, pick_agent
from app.core.errors import AIConfigError, AITimeoutError, AppError, RateLimitError, UpstreamError

# Calls cost about 11 credits a second; don't start one with less than a minute left.
MIN_CALL_CREDITS = 600

logger = logging.getLogger(__name__)


class ElevenLabsClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: httpx.AsyncClient | None = None

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
            code="voice_quota_exhausted",
        )

    async def mint_for_npc(self, npc_id: str, gender: str | None = None) -> tuple[str, str]:
        """(token, agent id) from the first account that can take the call.

        Accounts are tried in order (ELEVENLABS_API_KEY, then ELEVENLABS_API_KEY_2); one that is out
        of credits, rate limited, rejects its key or errors is skipped, and the last error is raised
        only if none works. Each account has its own agents, so the agent id comes with the token.
        """
        last: Exception | None = None
        for index, (key, agents) in enumerate(self._settings.elevenlabs_accounts, start=1):
            agent_id = pick_agent(agents, npc_id, gender)
            if not agent_id:
                continue
            try:
                token = await self.create_conversation_token(agent_id, api_key=key)
            except AppError as exc:
                logger.warning("elevenlabs_account_skipped", extra={"account": index, "code": exc.code})
                last = exc
                continue
            if index > 1:
                logger.info("elevenlabs_account_rotated", extra={"account": index})
            return token, agent_id
        raise last or AIConfigError(
            "Voice is not configured. Set ELEVENLABS_API_KEY and an agent id for this character.",
            code="voice_not_configured",
        )

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
