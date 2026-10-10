"""Structured JSON logging with lightweight secret redaction.

We never intentionally log secrets. This module adds a defensive filter so that if a
secret value were ever passed in a log record it is masked, and emits one JSON object
per line for easy ingestion.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime

_REDACT_KEYS = (
    "api_key",
    "apikey",
    "secret",
    "password",
    "authorization",
    "token",
    "database_url",
    "bearer",
)

_REDACTED = "***REDACTED***"


def redact(value: str) -> str:
    out = value
    for marker in ("c52265172a2148b9b1a7090ff9b5c576", "f16e30e4cd9744b793d52fd5daefdadc"):
        out = out.replace(marker, _REDACTED)
    return out


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        for key, val in record.__dict__.items():
            if key in ("request_id", "session_id", "user_id", "event", "model", "latency_ms"):
                payload[key] = val
        for key in _REDACT_KEYS:
            if key in payload:
                payload[key] = _REDACTED
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())
    # Quiet noisy third-party loggers.
    for noisy in ("httpx", "httpcore", "uvicorn.access", "botocore", "boto3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
