"""Application error types and consistent error envelope."""

from __future__ import annotations

from typing import Any
from uuid import UUID


class AppError(Exception):
    """Base class for controlled, typed application errors."""

    status_code: int = 400
    code: str = "bad_request"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}


class AuthError(AppError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class ValidationAppError(AppError):
    status_code = 422
    code = "validation_error"


class RateLimitError(AppError):
    status_code = 429
    code = "rate_limited"


class UpstreamError(AppError):
    status_code = 502
    code = "upstream_error"


class AIConfigError(AppError):
    status_code = 503
    code = "ai_not_configured"


class AITimeoutError(AppError):
    status_code = 504
    code = "ai_timeout"


def error_envelope(
    *, code: str, message: str, request_id: UUID | str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "request_id": str(request_id),
    }
    if details:
        payload["details"] = details
    return {"error": payload}
