"""Async SQLAlchemy engine and session management."""

from __future__ import annotations

import logging
import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings

logger = logging.getLogger(__name__)

_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _async_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def init_engine(settings: Settings) -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        return
    if not settings.database_url:
        logger.warning("database_url_missing", extra={"event": "startup"})
        return
    connect_args: dict = {"server_settings": {"application_name": "workverse-api"}}
    parsed_ssl = "require"
    connect_args["ssl"] = parsed_ssl if parsed_ssl else ssl.create_default_context()
    _engine = create_async_engine(
        _async_url(settings.database_url),
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args=connect_args,
        echo=False,
    )
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


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


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped session.

    The session is committed when the request handler completes successfully and rolled
    back on any exception, so a failed request never partially persists state.
    """
    maker = get_sessionmaker()
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
