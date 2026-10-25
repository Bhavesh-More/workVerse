"""iMocha product guide endpoints (office lobby agent; not part of any session)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.agents import imocha_guide
from app.deps import AIDep, CurrentUser

router = APIRouter(prefix="/imocha", tags=["imocha"])


class GuideTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=2000)


class GuideAsk(BaseModel):
    question: str = Field(min_length=1, max_length=imocha_guide.MAX_QUESTION)
    history: list[GuideTurn] = Field(default_factory=list, max_length=20)


@router.get("/guide")
async def guide(principal: CurrentUser) -> dict:
    return {"name": imocha_guide.GUIDE_NAME, "suggestions": imocha_guide.SUGGESTIONS}


@router.post("/guide/ask")
async def ask(principal: CurrentUser, ai: AIDep, body: GuideAsk) -> dict:
    text = await imocha_guide.answer(ai, body.question, [t.model_dump() for t in body.history])
    return {"answer": text}
