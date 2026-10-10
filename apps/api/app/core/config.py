"""Typed application settings.

Secrets are read from environment variables / a local ``.env`` file and are never
logged. The Ollama base URL is validated against an explicit allowlist so that no
code path can accidentally fall back to a local inference endpoint.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ALLOWED_OLLAMA_HOSTS = {"ollama.com"}
FORBIDDEN_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}


def _is_local_host(host: str) -> bool:
    if host in FORBIDDEN_HOSTS:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


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

    # --- Supabase ----------------------------------------------------------
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    supabase_jwks_url: str = ""
    supabase_jwt_issuer: str = ""
    supabase_jwt_audience: str = "authenticated"

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
            self.supabase_jwks_url = f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        if self.supabase_url and not self.supabase_jwt_issuer:
            self.supabase_jwt_issuer = f"{self.supabase_url.rstrip('/')}/auth/v1"
        return self

    def validate_runtime(self) -> list[str]:
        """Return a list of non-fatal configuration warnings (no secret values)."""
        warnings: list[str] = []
        if not self.database_url:
            warnings.append("DATABASE_URL is not set; database features will fail.")
        if not self.supabase_url:
            warnings.append("SUPABASE_URL is not set; authentication cannot be verified.")
        if not self.ollama_key_pool:
            warnings.append("No OLLAMA_API_KEY configured; AI features will return a setup error.")
        return warnings


@lru_cache
def get_settings() -> Settings:
    return Settings()
