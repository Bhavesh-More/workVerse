"""Shared helpers for the ElevenLabs setup scripts. The API key is read from apps/api/.env and never printed."""

from __future__ import annotations

from pathlib import Path

import httpx

API = "https://api.elevenlabs.io"
ENV = Path(__file__).resolve().parents[1] / ".env"


def api_key() -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("ELEVENLABS_API_KEY is missing from apps/api/.env")


def client() -> httpx.Client:
    return httpx.Client(base_url=API, headers={"xi-api-key": api_key()}, timeout=60)


def error_text(r: httpx.Response) -> str:
    try:
        detail = r.json().get("detail")
        return detail.get("message", str(detail)) if isinstance(detail, dict) else str(detail)
    except ValueError:
        return r.text[:200]
