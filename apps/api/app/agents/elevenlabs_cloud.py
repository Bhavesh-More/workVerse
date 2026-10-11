"""ElevenLabs ElevenAgents server adapter.

Server-only: mints short-lived WebRTC conversation tokens for a configured agent. The
long-lived ``ELEVENLABS_API_KEY`` never leaves the backend. The documented endpoint is
``GET /v1/convai/conversation/token?agent_id=...`` authenticated with the ``xi-api-key``
header (see docs/elevenagents-setup.md). The base URL is allow-listed at settings load.
"""

from __future__ import annotations

import logging
import time

import httpx

from app.core.config import Settings
from app.core.errors import AIConfigError, AITimeoutError, RateLimitError, UpstreamError

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
        return bool(self._settings.elevenlabs_api_key.strip())

    async def create_conversation_token(self, agent_id: str) -> str:
        """Return a short-lived conversation token for WebRTC, or raise a typed error."""
        if not self.configured:
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
        headers = {"xi-api-key": self._settings.elevenlabs_api_key, "Accept": "application/json"}
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
