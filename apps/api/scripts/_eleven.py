"""Shared helpers for the ElevenLabs setup scripts. The API key is read from apps/api/.env and never printed.

Set ELEVENLABS_ACCOUNT=2 (or 3) to work on another account (ELEVENLABS_API_KEY_2 / ELEVENLABS_AGENT_MAP_2, ...).
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx

API = "https://api.elevenlabs.io"
ENV = Path(__file__).resolve().parents[1] / ".env"
_n = os.environ.get("ELEVENLABS_ACCOUNT", "1").strip()
SUFFIX = "" if _n in ("", "1") else f"_{_n}"  # .env names for this account: ELEVENLABS_API_KEY{SUFFIX}, ...


def api_key() -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith(f"ELEVENLABS_API_KEY{SUFFIX}="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"ELEVENLABS_API_KEY{SUFFIX} is missing from apps/api/.env")


def client() -> httpx.Client:
    return httpx.Client(base_url=API, headers={"xi-api-key": api_key()}, timeout=60)


def error_text(r: httpx.Response) -> str:
    try:
        detail = r.json().get("detail")
        return detail.get("message", str(detail)) if isinstance(detail, dict) else str(detail)
    except ValueError:
        return r.text[:200]
