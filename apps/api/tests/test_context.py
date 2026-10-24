import asyncio
import io
import zipfile

import httpx
import pytest
from app.context import sources as src
from app.context.builder import build_context, fallback_context, source_hash
from app.context.library import library
from app.context.planner import _slots, normalize_plan, plan_scenarios
from app.schemas.context import LearnerContext
from app.services.scenario_service import apply_setting
from app.simulation.templates import build_production_incident
from app.simulation.validation import validate_blueprint


class FakeAI:
    configured = True
    model_name = "fake"

    def __init__(self, out):
        self.out = out

    async def chat_json(self, messages, **_):
        if isinstance(self.out, Exception):
            raise self.out
        return self.out


# ---------------------------------------------------------------- sources


def test_github_username_forms():
    assert src.github_username("https://github.com/octocat") == "octocat"
    assert src.github_username("github.com/octo-cat/repo") == "octo-cat"
    assert src.github_username("@octocat") == "octocat"
    assert src.github_username("https://github.com/settings") is None
    assert src.github_username("not a user!") is None


def test_linkedin_url_is_canonicalised():
    assert src.linkedin_url("linkedin.com/in/jane-doe/details") == "https://www.linkedin.com/in/jane-doe"
    assert src.linkedin_url("https://www.linkedin.com/company/acme") is None


def test_profile_links_found_in_cv_text():
    links = src.find_profile_links(
        "Jane — jane@gmail.com — github.com/janedoe — https://linkedin.com/in/jane-d — https://jane.dev/work."
    )
    assert links == {
        "github": "https://github.com/janedoe",
        "linkedin": "https://www.linkedin.com/in/jane-d",
        "portfolio": "https://jane.dev/work",
    }


def test_read_text_and_docx_documents():
    doc = src.read_document("cv.txt", b"Jane Doe. Python developer who built a FastAPI service. github.com/janedoe")
    assert doc["ok"] and doc["links"]["github"] == "https://github.com/janedoe"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "word/document.xml",
            "<w:document><w:body><w:p><w:r><w:t>Data analyst with SQL &amp; dbt experience</w:t></w:r></w:p>"
            "<w:p><w:r><w:t>Built dashboards for a retail chain across many stores</w:t></w:r></w:p></w:body></w:document>",
        )
    docx = src.read_document("cv.docx", buf.getvalue())
    assert "SQL & dbt" in docx["text"] and "\n" in docx["text"]


def test_unreadable_documents_are_rejected():
    with pytest.raises(src.SourceError):
        src.read_document("cv.exe", b"MZ" * 50)
    with pytest.raises(src.SourceError):
        src.read_document("cv.txt", b"too short")


def test_private_addresses_are_refused():
    for host in ("localhost", "127.0.0.1", "10.0.0.5", "169.254.169.254"):
        with pytest.raises(src.SourceError):
            asyncio.run(src.ensure_public_host(host))
    with pytest.raises(src.SourceError):
        src.normalize_url("http://example.com:5432/")


def test_parse_page_reads_text_meta_and_json_ld():
    page = src.parse_page(
        "<html><head><title>Jane</title><meta property='og:description' content='Designer'>"
        "<script type='application/ld+json'>{\"@type\": \"Person\", \"jobTitle\": \"UX Designer\"}</script>"
        "<style>.x{}</style></head><body><h1>Hi</h1><p>I design apps.</p><script>evil()</script></body></html>"
    )
    assert page["title"] == "Jane"
    assert page["description"] == "Designer"
    assert page["person"]["jobTitle"] == "UX Designer"
    assert "I design apps." in page["text"] and "evil" not in page["text"]


def test_read_github_summarises_profile_and_repos():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/users/janedoe":
            return httpx.Response(200, json={"name": "Jane", "bio": "Backend dev", "public_repos": 7, "created_at": "2021-01-01"})
        if path == "/users/janedoe/repos":
            return httpx.Response(
                200,
                json=[
                    {"name": "api", "language": "Python", "stargazers_count": 5, "description": "FastAPI shop", "pushed_at": "2026-09-01T00:00:00Z"},
                    {"name": "fork", "language": "C", "fork": True},
                    {"name": "ui", "language": "TypeScript", "stargazers_count": 1},
                ],
            )
        if path.endswith("/readme"):
            return httpx.Response(200, text="# API\nA shop backend.")
        return httpx.Response(404)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await src.read_github(client, "github.com/janedoe")

    gh = asyncio.run(run())
    assert gh["ok"] and gh["login"] == "janedoe"
    assert gh["languages"] == {"Python": 1, "TypeScript": 1}
    assert [r["name"] for r in gh["repos"]] == ["api", "ui"]
    assert "shop backend" in gh["repos"][0]["readme"]


def test_unknown_github_user_is_a_failed_source():
    async def run():
        transport = httpx.MockTransport(lambda r: httpx.Response(404))
        async with httpx.AsyncClient(transport=transport) as client:
            return await src.read_github(client, "nobody-here")

    gh = asyncio.run(run())
    assert gh["ok"] is False and "no user" in gh["error"]


# ---------------------------------------------------------------- builder

PROFILE = {
    "target_role": "Junior Backend Engineer",
    "experience_level": "early_career",
    "career_goals": ["stakeholder communication"],
    "preferred_stack": ["Python"],
}
SOURCES = {"github": {"ok": True, "languages": {"Go": 3}, "repos": [{"name": "svc", "language": "Go"}], "public_repos": 9}}


def test_hash_changes_with_profile_and_sources_but_not_fetch_time():
    h = source_hash(PROFILE, [], SOURCES)
    assert h == source_hash(PROFILE, [], {"github": {**SOURCES["github"], "fetched_at": "later"}})
    assert h != source_hash({**PROFILE, "custom_situation": "angry client"}, [], SOURCES)
    assert h != source_hash(PROFILE, ["SQL"], SOURCES)


def test_fallback_context_uses_profile_and_github():
    ctx = fallback_context(PROFILE, ["Docker"], SOURCES)
    assert ctx.suggested_tracks == ["backend"]
    assert {"Python", "Go", "Docker"} <= set(ctx.tech_stack)
    assert ctx.sources_used == ["github"]


def test_model_context_is_clipped_and_role_track_leads():
    out = {
        "headline": "x" * 500,
        "inferred_level": "wizard",
        "strengths": ["a", "A", "b"],
        "suggested_tracks": ["data", "space"],
        "notable_projects": [{"name": "p", "tech": ["Go"]}, "junk"],
    }
    ctx, builder = asyncio.run(build_context(FakeAI(out), PROFILE, [], SOURCES))
    assert builder == "fake"
    assert len(ctx.headline) == 140
    assert ctx.inferred_level == "early_career"
    assert ctx.strengths == ["a", "b"]
    assert ctx.suggested_tracks == ["backend", "data"]
    assert len(ctx.notable_projects) == 1


def test_model_failure_falls_back():
    ctx, builder = asyncio.run(build_context(FakeAI(RuntimeError("down")), PROFILE, [], SOURCES))
    assert builder == "deterministic" and ctx.suggested_tracks == ["backend"]


# ---------------------------------------------------------------- planner


def test_library_has_three_incidents_per_track():
    lib = library()
    assert len(lib) == 12
    assert {e["track"] for e in lib} == {"backend", "frontend", "data", "product"}


def test_plan_covers_major_custom_and_stretch_slots_without_a_model():
    ctx = LearnerContext(suggested_tracks=["frontend", "product"], inferred_level="beginner")
    plan = normalize_plan({}, ctx, "Explain a delay to an angry client", _slots(ctx, "x"), seed=3)
    kinds = [s.kind for s in plan.scenarios]
    assert kinds == ["major", "major", "major", "custom", "stretch"]
    assert {s.incident for s in plan.scenarios if s.kind == "major"} == {"base", "service_worker", "app_store"}
    assert plan.scenarios[-1].track == "product"
    assert all(s.difficulty == "introductory" for s in plan.scenarios)
    assert "communication" in plan.scenarios[3].focus


def test_plan_keeps_valid_model_choices_and_drops_bad_ones():
    ctx = LearnerContext(suggested_tracks=["backend"], inferred_level="intermediate")
    raw = {
        "scenarios": [
            {"kind": "major", "track": "backend", "incident": "base", "title": "Checkout down on launch day", "company": "Gamebox", "product": "a game store", "story": "Gamers pre-order here. Today is the big launch.", "focus": ["communication", "bogus"]},
            {"kind": "major", "track": "backend", "incident": "key_rotation", "title": "Rollback chaos", "story": "The config flag broke it."},
            {"kind": "custom", "track": "space", "incident": "moon", "title": "Client escalation"},
        ],
        "custom_note": "The client PM is under pressure.",
    }
    plan = normalize_plan(raw, ctx, "client escalation", _slots(ctx, "client escalation"), seed=1)
    first, rotation = plan.scenarios[0], next(s for s in plan.scenarios if s.incident == "key_rotation")
    assert (first.company, first.title, first.focus) == ("Gamebox", "Checkout down on launch day", ["communication"])
    assert rotation.title == "Payments failing after a key rotation"  # spoiler title replaced
    assert rotation.story == ""
    custom = plan.scenarios[-1]
    assert custom.kind == "custom" and custom.track == "backend"  # unknown track -> role's own
    assert plan.custom_note == "The client PM is under pressure."


def test_plan_scenarios_survives_model_error():
    ctx = LearnerContext(suggested_tracks=["data"])
    plan = asyncio.run(plan_scenarios(FakeAI(RuntimeError("x")), ctx, None, seed=9))
    assert [s.kind for s in plan.scenarios] == ["major"] * 3


# ---------------------------------------------------------------- engine


def test_spec_track_override_and_setting_build_a_valid_blueprint():
    bp = build_production_incident(seed=5, role="Junior Backend Engineer", track="data", incident="duplicates")
    assert bp.metadata["track"] == "data" and bp.metadata["variation"]["incident"] == "duplicates"
    apply_setting(bp, "Gamebox", "a video game store", "Gamers pre-order here.")
    assert bp.briefing.startswith("You work at Gamebox, a video game store. Gamers pre-order here.")
    assert validate_blueprint(bp).ok


class FakeRepo:
    """Just enough of Repository for scenario_service.create_instance."""

    def __init__(self):
        self.inserted = None

    async def get_template_by_slug(self, slug):
        return {"id": "tpl-1", "slug": slug}

    async def next_version_number(self, template_id):
        return 1

    async def insert_scenario_version(self, **kw):
        self.inserted = kw
        return {"id": "ver-1", "version_number": 1}


def test_create_instance_from_a_plan_spec_uses_its_track_story_and_focus():
    from app.schemas.context import ScenarioSpec
    from app.services.scenario_service import create_instance

    spec = ScenarioSpec(
        id="c4-data-timezone", track="data", incident="timezone", difficulty="challenging", kind="custom",
        title="Numbers before the board", company="Gamebox", product="a video game store",
        story="Gamers pre-order here. The board meets today.", focus=["communication"],
    )
    repo = FakeRepo()
    out = asyncio.run(
        create_instance(
            repo=repo, ai=FakeAI(RuntimeError("must not be called")), user_id="u1",
            profile={"target_role": "Junior Backend Engineer"}, spec=spec,
        )
    )
    bp = repo.inserted["blueprint"]
    assert bp["metadata"]["track"] == "data" and bp["metadata"]["variation"]["incident"] == "timezone"
    assert bp["difficulty"] == "challenging" and bp["competency_goals"] == ["communication"]
    assert bp["metadata"]["spec"]["id"] == spec.id
    assert repo.inserted["generator_provider"] == "context-plan"
    assert out["prebrief"]["briefing"].startswith("You work at Gamebox, a video game store. Gamers pre-order here.")
