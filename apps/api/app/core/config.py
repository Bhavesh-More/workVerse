"""Typed application settings.

Secrets are read from environment variables / a local ``.env`` file and are never
logged. The Ollama base URL is validated against an explicit allowlist so that no
code path can accidentally fall back to a local inference endpoint.
"""

from __future__ import annotations

import ipaddress
import json
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ALLOWED_OLLAMA_HOSTS = {"ollama.com"}
ALLOWED_ELEVENLABS_HOSTS = {"api.elevenlabs.io"}
FORBIDDEN_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}


def _is_local_host(host: str) -> bool:
    if host in FORBIDDEN_HOSTS:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _clerk_domain(publishable_key: str) -> str | None:
    """Decode a Clerk publishable key to its frontend-API domain.

    ``pk_test_<base64>`` / ``pk_live_<base64>`` encode ``<domain>$``.
    """
    try:
        encoded = publishable_key.split("_", 2)[2]
        padded = encoded + "=" * (-len(encoded) % 4)
        import base64

        domain = base64.b64decode(padded).decode("utf-8").rstrip("$").strip()
        return domain or None
    except Exception:  # noqa: BLE001
        return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "apps/api/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Application -------------------------------------------------------
    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    log_level: str = "INFO"
    cors_allowed_origins: str = "http://localhost:3000"

    # --- Supabase (PostgreSQL database only; identity is Clerk) ------------
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    supabase_jwks_url: str = ""
    supabase_jwt_issuer: str = ""
    supabase_jwt_audience: str = "authenticated"

    # --- Clerk (identity provider) ----------------------------------------
    clerk_publishable_key: str = ""
    clerk_secret_key: str = ""
    clerk_jwks_url: str = ""
    clerk_jwt_issuer: str = ""
    clerk_authorized_parties: str = ""

    # --- Database ----------------------------------------------------------
    database_url: str = ""
    database_pool_size: int = 5
    database_max_overflow: int = 5
    database_command_timeout_seconds: int = 15

    # --- Ollama Cloud (hosted inference ONLY) ------------------------------
    ollama_api_key: str = ""
    ollama_api_keys: str = ""
    ollama_base_url: str = "https://ollama.com/v1"
    ollama_model: str = "gemma4:31b"
    ollama_timeout_seconds: int = 45
    ollama_max_output_tokens: int = 700
    ollama_temperature: float = 0.7
    ollama_max_retries: int = 2

    # --- ElevenLabs ElevenAgents (real-time voice; server-only) ------------
    # The API key and agent IDs are never sent to the browser: FastAPI mints a
    # short-lived WebRTC conversation token per voice session.
    voice_enabled: bool = True
    elevenlabs_api_key: str = ""
    elevenlabs_base_url: str = "https://api.elevenlabs.io"
    elevenlabs_agent_id: str = ""  # default agent used for any NPC without a specific mapping
    elevenlabs_agent_map: str = "{}"  # JSON: {"manager": "agent_...", "teammate": "agent_..."}
    # Shared secret configured in the ElevenLabs Custom LLM secret store; authenticates
    # requests from ElevenLabs to our OpenAI-compatible bridge endpoint.
    voice_llm_bridge_secret: str = ""
    # HMAC secret used to sign/verify short-lived, narrowly scoped context grants that
    # bind a provider conversation to one user + WorkVerse session + NPC. Required for
    # the custom-LLM bridge; must be a long random value.
    voice_context_grant_secret: str = ""
    voice_context_grant_ttl_seconds: int = 900
    voice_llm_max_output_tokens: int = 100  # ~60 spoken words; replies are 1-3 sentences
    voice_llm_max_history_messages: int = 24
    voice_llm_max_history_chars: int = 6000

    # --- MinIO / S3-compatible object storage -----------------------------
    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "workverse-private"
    minio_region: str = "us-east-1"
    minio_secure: bool = False
    minio_presigned_url_ttl_seconds: int = 300
    minio_max_upload_bytes: int = 10_485_760

    # --- Development auth (never enabled in production) -------------------
    dev_auth_enabled: bool = False

    @property
    def ollama_key_pool(self) -> list[str]:
        """Ordered, de-duplicated list of usable API keys (rotation pool)."""
        raw: list[str] = []
        if self.ollama_api_keys:
            raw.extend(k.strip() for k in self.ollama_api_keys.split(","))
        if self.ollama_api_key:
            raw.append(self.ollama_api_key.strip())
        seen: list[str] = []
        for key in raw:
            if key and key not in seen:
                seen.append(key)
        return seen

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def elevenlabs_agents(self) -> dict[str, str]:
        """Internal NPC-id -> agent-id mapping, plus the default under key ``*``."""
        mapping: dict[str, str] = {}
        try:
            parsed = json.loads(self.elevenlabs_agent_map or "{}")
            if isinstance(parsed, dict):
                mapping = {
                    str(k): str(v) for k, v in parsed.items() if isinstance(v, str) and v.strip()
                }
        except (json.JSONDecodeError, TypeError):
            mapping = {}
        if self.elevenlabs_agent_id.strip():
            mapping.setdefault("*", self.elevenlabs_agent_id.strip())
        return mapping

    def agent_for_npc(self, npc_id: str, gender: str | None = None) -> str | None:
        """Most specific match wins: "client_pm:male", then "client_pm", then the default "*"."""
        agents = self.elevenlabs_agents
        return (gender and agents.get(f"{npc_id}:{gender}")) or agents.get(npc_id) or agents.get("*")

    @property
    def voice_configured(self) -> bool:
        """True when the server can mint an ElevenLabs conversation token for some NPC."""
        return bool(
            self.voice_enabled
            and self.elevenlabs_api_key.strip()
            and (self.elevenlabs_agent_id.strip() or self.elevenlabs_agents)
        )

    @property
    def voice_llm_bridge_configured(self) -> bool:
        return bool(
            self.voice_llm_bridge_secret.strip() and self.voice_context_grant_secret.strip()
        )

    @field_validator("elevenlabs_base_url")
    @classmethod
    def _validate_elevenlabs_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            raise ValueError("ELEVENLABS_BASE_URL must use https")
        if _is_local_host(host):
            raise ValueError(f"Local voice endpoints are prohibited: {host!r}")
        if host not in ALLOWED_ELEVENLABS_HOSTS:
            raise ValueError(
                f"ELEVENLABS_BASE_URL host {host!r} is not in the allowlist "
                f"{sorted(ALLOWED_ELEVENLABS_HOSTS)}"
            )
        return value.rstrip("/")

    @field_validator("ollama_base_url")
    @classmethod
    def _validate_ollama_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            raise ValueError("OLLAMA_BASE_URL must use https (hosted inference only)")
        if _is_local_host(host):
            raise ValueError(f"Local inference endpoints are prohibited: {host!r}")
        if ALLOWED_OLLAMA_HOSTS and host not in ALLOWED_OLLAMA_HOSTS:
            raise ValueError(
                f"OLLAMA_BASE_URL host {host!r} is not in the allowlist {sorted(ALLOWED_OLLAMA_HOSTS)}"
            )
        return value.rstrip("/")

    @model_validator(mode="after")
    def _defaults(self) -> Settings:
        if self.supabase_url and not self.supabase_jwks_url:
            self.supabase_jwks_url = (
                f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            )
        if self.supabase_url and not self.supabase_jwt_issuer:
            self.supabase_jwt_issuer = f"{self.supabase_url.rstrip('/')}/auth/v1"
        if self.clerk_publishable_key:
            domain = _clerk_domain(self.clerk_publishable_key)
            if domain:
                if not self.clerk_jwt_issuer:
                    self.clerk_jwt_issuer = f"https://{domain}"
                if not self.clerk_jwks_url:
                    self.clerk_jwks_url = f"https://{domain}/.well-known/jwks.json"
        return self

    def validate_runtime(self) -> list[str]:
        """Return a list of non-fatal configuration warnings (no secret values)."""
        warnings: list[str] = []
        if not self.database_url:
            warnings.append("DATABASE_URL is not set; database features will fail.")
        if not self.clerk_publishable_key:
            warnings.append("CLERK_PUBLISHABLE_KEY is not set; authentication cannot be verified.")
        if not self.ollama_key_pool:
            warnings.append("No OLLAMA_API_KEY configured; AI features will return a setup error.")
        if self.voice_enabled and not self.voice_configured:
            warnings.append(
                "Voice is enabled but ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID are not set; "
                "voice sessions will return a setup error."
            )
        if self.voice_enabled and not self.voice_llm_bridge_configured:
            warnings.append(
                "Voice custom-LLM bridge is not configured "
                "(VOICE_LLM_BRIDGE_SECRET / VOICE_CONTEXT_GRANT_SECRET); spoken dialogue "
                "cannot carry authorized scenario context."
            )
        return warnings


@lru_cache
def get_settings() -> Settings:
    return Settings()
