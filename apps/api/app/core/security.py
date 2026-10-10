"""Supabase JWT verification.

Tokens are cryptographically verified against the project JWKS (ES256/RS256). We do
not accept a merely decoded token. A clearly-gated development path exists for local
testing and is hard-disabled in production.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from app.core.config import Settings
from app.core.errors import AuthError

logger = logging.getLogger(__name__)

_jwk_client: PyJWKClient | None = None


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str | None = None
    role: str | None = None
    dev: bool = False


def _get_jwk_client(settings: Settings) -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        if not settings.supabase_jwks_url:
            raise AuthError("Authentication is not configured on the server.")
        _jwk_client = PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=300)
    return _jwk_client


def _dev_principal(settings: Settings, token: str) -> Principal | None:
    if not (settings.dev_auth_enabled and not settings.is_production):
        return None
    if token.startswith("dev:"):
        user_id = token[4:].strip()
        if user_id:
            return Principal(user_id=user_id, email=f"{user_id}@dev.local", role="dev", dev=True)
    return None


def verify_token(token: str, settings: Settings) -> Principal:
    dev = _dev_principal(settings, token)
    if dev is not None:
        logger.warning("dev_auth_used", extra={"user_id": dev.user_id})
        return dev

    try:
        signing_key = _get_jwk_client(settings).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience=settings.supabase_jwt_audience or None,
            issuer=settings.supabase_jwt_issuer or None,
            options={"verify_exp": True, "verify_aud": bool(settings.supabase_jwt_audience)},
        )
    except AuthError:
        raise
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Access token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Access token is invalid.") from exc
    except Exception as exc:  # network/JWKS errors
        logger.warning("jwt_verification_error", extra={"event": type(exc).__name__})
        raise AuthError("Unable to verify access token.") from exc

    user_id = claims.get("sub")
    if not user_id:
        raise AuthError("Access token is missing a subject.")
    return Principal(
        user_id=user_id,
        email=claims.get("email"),
        role=claims.get("role"),
    )
