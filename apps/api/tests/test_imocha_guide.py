import asyncio

from app.agents import imocha_guide
from app.core.errors import AIConfigError


class _NoAI:
    async def chat(self, *a, **k):
        raise AIConfigError("off")


def test_fallback_matches_topic():
    assert "Workday" in imocha_guide.fallback_answer("Do you integrate with SAP or Workday?")
    assert "30+ compilers" in imocha_guide.fallback_answer("what coding assessment do you have")
    assert imocha_guide.fallback_answer("hello") == imocha_guide.TOPICS[0][1]


def test_answer_falls_back_when_ai_unavailable():
    out = asyncio.run(imocha_guide.answer(_NoAI(), "How does hiring work?", []))
    assert "skills" in out.lower()
