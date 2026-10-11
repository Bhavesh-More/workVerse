"""Short-lived, narrowly scoped context grants for voice sessions.

A grant binds one provider conversation to a single authenticated user, WorkVerse
session, voice session and NPC. It is signed with an HMAC secret held only by FastAPI,
so the custom-LLM bridge can trust the routing fields ([LEARNER] / session / NPC) without
trusting any client-supplied id. Grants are also time-limited; both the signature and the
expiry are verified server-side.

This is deliberately small: a compact ``<payload>.<signature>`` token using URL-safe base64.
Only HMAC-SHA256 over the exact payload bytes is accepted.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any

from app.core.errors import AuthError, ValidationAppError

GRANT_SCOPE = "workverse.voice.context"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64url(data: str) -> bytes:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _sign(secret: str, payload: bytes) -> bytes:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()


@dataclass(frozen=True)
class VoiceGrant:
    user_id: str
    session_id: str
    voice_session_id: str
    npc_id: str
    issued_at: int
    expires_at: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "sub": self.user_id,
            "sid": self.session_id,
            "vsid": self.voice_session_id,
            "npc": self.npc_id,
            "iat": self.issued_at,
            "exp": self.expires_at,
            "scope": GRANT_SCOPE,
        }


def issue_grant(
    secret: str,
    *,
    user_id: str,
    session_id: str,
    voice_session_id: str,
    npc_id: str,
    ttl_seconds: int,
    now: int | None = None,
) -> tuple[str, int]:
    """Return ``(token, expires_at_epoch)``."""
    if not secret:
        raise ValidationAppError(
            "Voice context grants are not configured on the server.",
            code="voice_not_configured",
        )
    issued_at = int(now if now is not None else time.time())
    expires_at = issued_at + int(ttl_seconds)
    grant = VoiceGrant(
        user_id=str(user_id),
        session_id=str(session_id),
        voice_session_id=str(voice_session_id),
        npc_id=str(npc_id),
        issued_at=issued_at,
        expires_at=expires_at,
    )
    payload = json.dumps(grant.as_dict(), separators=(",", ":"), sort_keys=True).encode("utf-8")
    token = f"{_b64url(payload)}.{_b64url(_sign(secret, payload))}"
    return token, expires_at


def verify_grant(secret: str, token: str, *, now: int | None = None) -> VoiceGrant:
    """Verify signature and expiry; raise :class:`AuthError` on any failure."""
    if not secret:
        raise AuthError("Voice context grants are not configured on the server.")
    if not token or "." not in token:
        raise AuthError("Missing or malformed voice context grant.")
    encoded_payload, encoded_sig = token.split(".", 1)
    try:
        payload = _unb64url(encoded_payload)
        signature = _unb64url(encoded_sig)
    except (ValueError, TypeError) as exc:
        raise AuthError("Malformed voice context grant.") from exc
    if not hmac.compare_digest(_sign(secret, payload), signature):
        raise AuthError("Voice context grant signature is invalid.")
    try:
        data = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise AuthError("Malformed voice context grant payload.") from exc
    if data.get("scope") != GRANT_SCOPE:
        raise AuthError("Voice context grant has the wrong scope.")
    current = int(now if now is not None else time.time())
    expires_at = int(data.get("exp") or 0)
    if expires_at and current > expires_at:
        raise AuthError("Voice context grant has expired.")
    needed = ("sub", "sid", "vsid", "npc")
    if any(not data.get(key) for key in needed):
        raise AuthError("Voice context grant is missing required fields.")
    return VoiceGrant(
        user_id=str(data["sub"]),
        session_id=str(data["sid"]),
        voice_session_id=str(data["vsid"]),
        npc_id=str(data["npc"]),
        issued_at=int(data.get("iat") or 0),
        expires_at=expires_at,
    )
