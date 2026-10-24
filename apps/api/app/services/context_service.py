"""Learner context: collect sources, build the context, plan personalised scenarios.

Flow: the learner's profile links and uploaded documents become ``sources`` (re-scraped only when
a link changes, or on a forced refresh); a fingerprint of profile + sources decides whether the
context is stale; a rebuild runs the context builder and then the scenario planner, and stores
both. Editing the profile later simply makes the fingerprint differ, and the next build call
(the profile page makes one after every save) brings the context and scenarios up to date.
"""

from __future__ import annotations

import asyncio
import random
from datetime import UTC, datetime
from typing import Any

import httpx

from app.agents.ollama_cloud import OllamaCloudClient
from app.context import sources as src
from app.context.builder import build_context, source_hash
from app.context.planner import plan_scenarios, plan_summary
from app.core.config import Settings
from app.core.errors import NotFoundError, ValidationAppError
from app.db.repository import Repository
from app.schemas.context import ScenarioPlan, ScenarioSpec

# Profile column -> source kind it is scraped into.
LINK_SOURCES = {"github_url": "github", "linkedin_url": "linkedin", "portfolio_url": "portfolio"}
DOCUMENT_KINDS = {"cv", "linkedin_pdf"}


async def _load(repo: Repository, user_id: str) -> tuple[dict[str, Any], list[str], dict[str, Any], dict[str, Any] | None]:
    profile = await repo.get_profile(user_id)
    if profile is None:
        await repo.ensure_profile(user_id, None)
        profile = await repo.get_profile(user_id) or {}
    skills = [s["name"] for s in await repo.list_skills(user_id)]
    row = await repo.get_learner_context(user_id)
    return profile, skills, dict((row or {}).get("sources") or {}), row


def _source_view(kind: str, s: dict[str, Any]) -> dict[str, Any]:
    """What the UI shows per source: status and a short 'what we found', never the full text."""
    found: list[str] = []
    if kind in DOCUMENT_KINDS and s.get("ok"):
        found.append(f"{len(s.get('text', '')):,} characters of text")
        found += [f"{k} link" for k in (s.get("links") or {})]
    elif kind == "github" and s.get("ok"):
        found.append(f"{len(s.get('repos', []))} recent repositories")
        if s.get("languages"):
            found.append(", ".join(list(s["languages"])[:4]))
    elif kind == "linkedin" and s.get("ok"):
        found += [x for x in (s.get("headline"), s.get("job_title")) if x]
    elif kind == "portfolio" and s.get("ok"):
        found += [x for x in (s.get("title"),) if x]
    return {
        "kind": kind,
        "ok": bool(s.get("ok")),
        "error": s.get("error"),
        "url": s.get("url"),
        "filename": s.get("filename"),
        "fetched_at": s.get("fetched_at"),
        "found": found[:4],
        "links": s.get("links") if kind in DOCUMENT_KINDS else None,
    }


def _view(profile: dict[str, Any], skills: list[str], sources: dict[str, Any], row: dict[str, Any] | None) -> dict[str, Any]:
    current = source_hash(profile, skills, sources)
    built = bool(row and row.get("context"))
    plan = ScenarioPlan.model_validate(row["scenario_plan"]) if row and row.get("scenario_plan") else None
    return {
        "status": "empty" if not built else "ready" if row.get("source_hash") == current else "stale",
        "context": row.get("context") if built else None,
        "scenarios": plan_summary(plan) if plan else [],
        "custom_situation": plan.custom_situation if plan else None,
        "custom_note": plan.custom_note if plan else "",
        "sources": [_source_view(k, v) for k, v in sorted(sources.items())],
        "builder": row.get("builder") if row else None,
        "built_at": row.get("built_at") if row else None,
    }


async def get_view(repo: Repository, user_id: str) -> dict[str, Any]:
    return _view(*await _load(repo, user_id))


async def upload_document(repo: Repository, user_id: str, kind: str, filename: str, data: bytes) -> dict[str, Any]:
    if kind not in DOCUMENT_KINDS:
        raise ValidationAppError("Unknown document kind.", code="bad_document_kind")
    try:
        # pypdf is CPU-bound; keep it off the event loop.
        doc = await asyncio.to_thread(src.read_document, filename, data)
    except src.SourceError as exc:
        raise ValidationAppError(str(exc), code="unreadable_document")
    _, _, sources, _ = await _load(repo, user_id)
    sources[kind] = doc
    await repo.upsert_learner_context(user_id, {"sources": sources})
    return {"source": _source_view(kind, doc)}


async def remove_document(repo: Repository, user_id: str, kind: str) -> None:
    _, _, sources, _ = await _load(repo, user_id)
    if kind not in DOCUMENT_KINDS or kind not in sources:
        raise NotFoundError("No such document.")
    sources.pop(kind)
    await repo.upsert_learner_context(user_id, {"sources": sources})


async def refresh_sources(repo: Repository, settings: Settings, user_id: str, force: bool = False) -> dict[str, Any]:
    """Scrape each profile link that is new, changed, previously failed or (with force) all of them."""
    profile, skills, sources, row = await _load(repo, user_id)
    todo: dict[str, str] = {}
    for column, kind in LINK_SOURCES.items():
        url = (profile.get(column) or "").strip()
        if not url:
            sources.pop(kind, None)  # link removed from the profile: forget what it said
            continue
        old = sources.get(kind) or {}
        if force or not old.get("ok") or old.get("input") != url:
            todo[kind] = url
    if todo:
        async with httpx.AsyncClient(timeout=httpx.Timeout(settings.scrape_timeout_seconds)) as client:
            readers = {
                "github": lambda u: src.read_github(client, u, settings.github_token),
                "linkedin": lambda u: src.read_linkedin(client, u),
                "portfolio": lambda u: src.read_portfolio(client, u),
            }
            results = await asyncio.gather(*(readers[k](u) for k, u in todo.items()), return_exceptions=True)
        for (kind, url), result in zip(todo.items(), results, strict=True):
            if isinstance(result, BaseException):
                result = src._failed(url, "Something went wrong reading this link.")
            sources[kind] = {**result, "input": url}
    if todo or row is None or sources != (row or {}).get("sources"):
        row = await repo.upsert_learner_context(user_id, {"sources": sources})
    return _view(profile, skills, sources, row)


async def build(
    repo: Repository, ai: OllamaCloudClient, settings: Settings, user_id: str, force: bool = False
) -> dict[str, Any]:
    """Refresh sources, then rebuild context + scenario plan if anything changed (or forced)."""
    await refresh_sources(repo, settings, user_id, force=force)
    profile, skills, sources, row = await _load(repo, user_id)
    fingerprint = source_hash(profile, skills, sources)
    if row and row.get("context") and row.get("source_hash") == fingerprint and not force:
        return _view(profile, skills, sources, row)
    context, builder = await build_context(ai, profile, skills, sources)
    plan = await plan_scenarios(ai, context, profile.get("custom_situation"), seed=random.randint(1, 2_000_000_000))
    row = await repo.upsert_learner_context(
        user_id,
        {
            "context": context.model_dump(),
            "scenario_plan": plan.model_dump(),
            "source_hash": fingerprint,
            "builder": builder,
            "built_at": datetime.now(UTC),
        },
    )
    return _view(profile, skills, sources, row)


async def find_spec(repo: Repository, user_id: str, spec_id: str) -> tuple[ScenarioSpec, ScenarioPlan]:
    row = await repo.get_learner_context(user_id)
    if not row or not row.get("scenario_plan"):
        raise NotFoundError("You don't have personalised scenarios yet. Build your context first.")
    plan = ScenarioPlan.model_validate(row["scenario_plan"])
    spec = next((s for s in plan.scenarios if s.id == spec_id), None)
    if spec is None:
        raise NotFoundError("That personalised scenario no longer exists — your scenarios were rebuilt.")
    return spec, plan
