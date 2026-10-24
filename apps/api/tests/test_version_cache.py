import asyncio

from app.db.repository import _VERSION_CACHE, Repository


class _Result:
    def mappings(self):
        return self

    def first(self):
        return {"id": "v1", "blueprint": {"x": 1}}


class _Session:
    calls = 0

    async def execute(self, *_args, **_kwargs):
        self.calls += 1
        return _Result()


def test_scenario_version_is_fetched_once():
    _VERSION_CACHE.clear()
    session = _Session()
    repo = Repository(session)  # type: ignore[arg-type]
    first = asyncio.run(repo.get_scenario_version("v1"))
    first["mutated"] = True  # callers get a copy, the cache stays clean
    second = asyncio.run(repo.get_scenario_version("v1"))
    assert session.calls == 1
    assert "mutated" not in second
