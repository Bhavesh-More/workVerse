"""Process-wide AI provider singleton."""

from __future__ import annotations

from app.agents.ollama_cloud import OllamaCloudClient
from app.core.config import Settings

_client: OllamaCloudClient | None = None


def get_ai_client(settings: Settings) -> OllamaCloudClient:
    global _client
    if _client is None:
        _client = OllamaCloudClient(settings)
    return _client


async def close_ai_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None
