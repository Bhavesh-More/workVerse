"""WorkVerse AI FastAPI application."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import AppError, error_envelope
from app.core.logging import configure_logging
from app.db.session import dispose_engine, init_engine, session_scope
from app.services.ai_provider import close_ai_client
from app.services.voice_provider import close_voice_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    for warning in settings.validate_runtime():
        logger.warning("config_warning", extra={"event": warning})
    init_engine(settings)
    if settings.database_url:
        try:
            from app.db.repository import Repository
            from app.services.scenario_service import ensure_seed_templates

            async with session_scope() as session:
                await ensure_seed_templates(Repository(session))
        except Exception as exc:  # noqa: BLE001
            logger.warning("seed_templates_failed", extra={"event": type(exc).__name__})
    yield
    await close_ai_client()
    await close_voice_client()
    await dispose_engine()


app = FastAPI(
    title="WorkVerse AI API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_envelope(
            code=exc.code, message=exc.message, request_id=_rid(request), details=exc.details
        ),
    )


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_envelope(
            code="validation_error",
            message="The request payload was invalid.",
            request_id=_rid(request),
            details={"errors": exc.errors()},
        ),
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_envelope(
            code=f"http_{exc.status_code}", message=str(exc.detail), request_id=_rid(request)
        ),
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled_exception", exc_info=exc, extra={"request_id": _rid(request)})
    return JSONResponse(
        status_code=500,
        content=error_envelope(
            code="internal_error",
            message="An unexpected error occurred. Please retry.",
            request_id=_rid(request),
        ),
    )


app.include_router(health_router)
app.include_router(api_router, prefix="/api/v1")
