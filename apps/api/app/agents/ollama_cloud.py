"""Hosted Ollama Cloud provider adapter (OpenAI-compatible API).

Hosted inference only: the base URL is validated at settings load time to be the
allow-listed ``https://ollama.com/v1`` endpoint, and every request carries a server-side
Bearer token. Multiple API keys may be configured; the adapter rotates to the next key when
the current key reports a rate-limit/quota/auth failure, so a single exhausted key does not
disable the product.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import Settings
from app.core.errors import AIConfigError, AITimeoutError, RateLimitError, UpstreamError

logger = logging.getLogger(__name__)

_RATE_LIMIT_STATUSES = {429, 402}
_RETRYABLE_STATUSES = {500, 502, 503, 504}


@dataclass
class ChatResult:
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    key_index: int = 0
    raw: dict[str, Any] = field(default_factory=dict)


class OllamaCloudClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._keys = settings.ollama_key_pool
        self._cursor = 0
        self._client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()

    # ---- lifecycle --------------------------------------------------------
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._settings.ollama_base_url,
                timeout=httpx.Timeout(self._settings.ollama_timeout_seconds),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def configured(self) -> bool:
        return bool(self._keys)

    def _ordered_keys(self) -> list[tuple[int, str]]:
        n = len(self._keys)
        return [((self._cursor + i) % n, self._keys[(self._cursor + i) % n]) for i in range(n)]

    async def _advance_cursor(self, index: int) -> None:
        async with self._lock:
            self._cursor = (index + 1) % max(len(self._keys), 1)

    # ---- chat -------------------------------------------------------------
    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        json_mode: bool = False,
    ) -> ChatResult:
        if not self._keys:
            raise AIConfigError(
                "AI is not configured. Set OLLAMA_API_KEY to use dialogue and evaluation features."
            )
        model = model or self._settings.ollama_model
        max_tokens = max_tokens or self._settings.ollama_max_output_tokens
        temperature = self._settings.ollama_temperature if temperature is None else temperature

        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        last_error: Exception | None = None
        for index, key in self._ordered_keys():
            try:
                result = await self._call_with_retries(body, key, index)
                if index != self._cursor:
                    await self._advance_cursor(index)
                return result
            except RateLimitError as exc:
                logger.warning("ollama_key_exhausted", extra={"event": f"key_{index}"})
                last_error = exc
                await self._advance_cursor(index)
                continue
            except AIConfigError as exc:
                last_error = exc
                await self._advance_cursor(index)
                continue
            except UpstreamError as exc:
                last_error = exc
                continue

        if isinstance(last_error, RateLimitError):
            raise RateLimitError(
                "All configured AI keys are rate limited or out of quota. Please retry shortly.",
            )
        raise last_error or UpstreamError("AI provider request failed.")

    async def _call_with_retries(
        self, body: dict[str, Any], key: str, key_index: int
    ) -> ChatResult:
        client = await self._get_client()
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        attempts = max(1, self._settings.ollama_max_retries)
        last_exc: Exception | None = None

        for attempt in range(attempts):
            started = time.perf_counter()
            try:
                resp = await client.post("/chat/completions", json=body, headers=headers)
            except httpx.TimeoutException:
                last_exc = AITimeoutError("The AI provider timed out.")
                logger.warning("ollama_timeout", extra={"event": f"attempt_{attempt}"})
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            except httpx.HTTPError:
                last_exc = UpstreamError("Unable to reach the AI provider.")
                await asyncio.sleep(0.5 * (attempt + 1))
                continue

            latency_ms = int((time.perf_counter() - started) * 1000)
            if resp.status_code in _RATE_LIMIT_STATUSES:
                raise RateLimitError("AI provider rate limit or quota reached.")
            if resp.status_code in (401, 403):
                raise AIConfigError("AI provider rejected the configured API key.")
            if resp.status_code in _RETRYABLE_STATUSES:
                last_exc = UpstreamError("AI provider temporarily unavailable.")
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            if resp.status_code >= 400:
                detail = resp.text[:200]
                raise UpstreamError(f"AI provider returned an error ({resp.status_code}): {detail}")

            data = resp.json()
            choice = (data.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            usage = data.get("usage") or {}
            return ChatResult(
                content=message.get("content", "") or "",
                model=data.get("model", body["model"]),
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                latency_ms=latency_ms,
                key_index=key_index,
                raw=data,
            )

        raise last_exc or UpstreamError("AI provider request failed.")

    async def chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        """Request a JSON object, tolerating fenced/prose-wrapped output with one repair."""
        result = await self.chat(messages, model=model, max_tokens=max_tokens, json_mode=True)
        parsed = _extract_json(result.content)
        if parsed is None:
            repair = messages + [
                {"role": "assistant", "content": result.content},
                {
                    "role": "user",
                    "content": "Return ONLY a single valid JSON object. No prose, no markdown fences.",
                },
            ]
            result = await self.chat(repair, model=model, max_tokens=max_tokens, json_mode=True)
            parsed = _extract_json(result.content)
        if parsed is None:
            raise UpstreamError("AI provider returned output that was not valid JSON.")
        return parsed


def _extract_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        if candidate.lower().startswith("json"):
            candidate = candidate[4:]
    try:
        value = json.loads(candidate)
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        pass
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            value = json.loads(candidate[start : end + 1])
            return value if isinstance(value, dict) else None
        except json.JSONDecodeError:
            return None
    return None
