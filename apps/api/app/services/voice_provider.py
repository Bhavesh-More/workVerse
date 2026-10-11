"""Process-wide ElevenLabs voice provider singleton (mirrors the AI provider lifecycle)."""

from __future__ import annotations

from app.agents.elevenlabs_cloud import ElevenLabsClient
from app.core.config import Settings

_client: ElevenLabsClient | None = None


def get_voice_client(settings: Settings) -> ElevenLabsClient:
    global _client
    if _client is None:
        _client = ElevenLabsClient(settings)
    return _client


async def close_voice_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None
