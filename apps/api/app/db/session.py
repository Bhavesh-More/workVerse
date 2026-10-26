"""Async SQLAlchemy engine and session management."""

from __future__ import annotations

import logging
import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings

logger = logging.getLogger(__name__)

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
# Same pool, but no BEGIN/COMMIT round trips: used for read-only (GET) requests.
_read_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _async_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def init_engine(settings: Settings) -> None:
    global _engine, _sessionmaker, _read_sessionmaker
    if _engine is not None:
        return
    if not settings.database_url:
        logger.warning("database_url_missing", extra={"event": "startup"})
        return
    # Server-side keepalives reduce idle-connection drops through NAT/proxies.
    connect_args: dict = {
        "server_settings": {"application_name": "workverse-api", "tcp_keepalives_idle": "60"},
        # Supabase's transaction pooler cannot reuse session-level prepared statements.
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    }
    parsed_ssl = "require"
    connect_args["ssl"] = parsed_ssl if parsed_ssl else ssl.create_default_context()
    url = make_url(_async_url(settings.database_url))
    _engine = create_async_engine(
        url,
        poolclass=NullPool,
        connect_args=connect_args,
        echo=False,
    )
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    _read_sessionmaker = async_sessionmaker(
        _engine.execution_options(isolation_level="AUTOCOMMIT"),
        expire_on_commit=False,
        class_=AsyncSession,
    )


async def dispose_engine() -> None:
    global _engine, _sessionmaker, _read_sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
    _read_sessionmaker = None


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("Database engine is not initialised.")
    return _sessionmaker


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    maker = get_sessionmaker()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped session.

    Writes (POST/PATCH/DELETE…) run in one transaction, committed when the handler completes
    successfully and rolled back on any exception, so a failed request never partially
    persists state. Reads (GET/HEAD) use autocommit, saving the BEGIN and COMMIT round trips.
    """
    if request.method in ("GET", "HEAD") and _read_sessionmaker is not None:
        maker = _read_sessionmaker
    else:
        maker = get_sessionmaker()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
