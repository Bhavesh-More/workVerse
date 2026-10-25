"""iMocha product guide: a stand-alone office agent that answers questions about iMocha.

It is deliberately outside the simulation: nothing it says is stored on a session, so it can
never reveal incident facts or change a learner's evaluation. Grounded in docs/iMocha.md.
"""

from __future__ import annotations

import re

from app.agents.ollama_cloud import OllamaCloudClient
from app.core.errors import AIConfigError, AITimeoutError, RateLimitError, UpstreamError

GUIDE_NAME = "Mia"

# Each topic: (keywords, answer). Also the fallback when the model is unavailable.
TOPICS: list[tuple[tuple[str, ...], str]] = [
    (
        ("what", "imocha", "about", "who", "company"),
        "iMocha is a Skills & Work Intelligence platform — the context layer that gives enterprises "
        "one defensible view of their workforce's skills. WorkVerse is part of it: you practise real "
        "work, and iMocha turns that into skills evidence.",
    ),
    (
        ("skills intelligence", "architecture", "inference", "profile"),
        "Skills Intelligence has three parts: Skills Architecture (a role-aligned skills map), Skills "
        "Inference (AI keeps skill profiles up to date) and Skills Assessment (10,000+ real-world "
        "evaluations to validate them).",
    ),
    (
        ("work intelligence", "simulation", "workverse"),
        "Work Intelligence looks at how people actually do the work. Simulations like this office are "
        "where that shows up: how you investigate, decide and communicate under pressure.",
    ),
    (
        ("assessment", "test", "coding", "compiler", "logicbox", "englishpro", "proctor"),
        "Assessments include coding tests in 30+ compilers, AI-LogicBox (logic without boilerplate), "
        "AI-EnglishPro (communication), Conversational AI Interviews and a Smart Proctoring Suite — "
        "in 50+ languages, WCAG 2.1 compliant.",
    ),
    (
        ("hire", "hiring", "recruit", "candidate", "resume"),
        "Skills-based hiring: hire for skills, not just resumes. Companies invite candidates to "
        "validated assessments and simulations like WorkVerse and compare evidence, not claims.",
    ),
    (
        ("gap", "upskill", "reskill", "mobility", "career", "learn", "planning"),
        "Use cases: Skill Gap Analysis, Upskilling & Reskilling, Internal Mobility, Strategic "
        "Workforce Planning, Skills-based Hiring and the AI-Readiness Index.",
    ),
    (
        ("ai-readiness", "ai readiness", "readiness"),
        "The AI-Readiness Index replaces self-reported confidence with performance-based evidence of "
        "how ready a team is to work with AI.",
    ),
    (
        ("integrat", "workday", "sap", "successfactors", "lightcast", "oracle"),
        "iMocha connects to your HR tech: Workday, SAP SuccessFactors, Lightcast and Oracle, so skills "
        "data flows where decisions are made.",
    ),
    (
        ("customer", "trusted", "enterprise", "l'oréal", "loreal", "pmi"),
        "iMocha is trusted by 300+ enterprises — customer stories include L'Oréal and PMI (Project "
        "Management Institute).",
    ),
]

SUGGESTIONS = [
    "What is iMocha?",
    "What is Skills Intelligence?",
    "Which assessments do you offer?",
    "How does this help me get hired?",
]

_FACTS = "\n".join(f"- {answer}" for _, answer in TOPICS)

SYSTEM_PROMPT = f"""You are {GUIDE_NAME}, the iMocha product guide standing in the WorkVerse office lobby.
WorkVerse is a work-simulation product by iMocha where students and early-career engineers practise
real workplace moments. Answer questions about iMocha and its products only, using these facts:
{_FACTS}

Rules:
- 1–3 short sentences, friendly and plain. Use iMocha's words (Skills Intelligence, skills-first).
- Always write the name as "iMocha".
- If asked about the current incident or scenario, say you're the product guide and the learner's
  colleagues in the office can help with that. Never give scenario hints.
- If you don't know (pricing, contracts, private data), say so and suggest booking a demo at imocha.io.
- Never invent numbers, customers or features beyond the facts above."""

MAX_QUESTION = 400
MAX_HISTORY = 6


def fallback_answer(question: str) -> str:
    """Best keyword match from the topic list; used when the model is unavailable."""
    q = question.lower()
    best, score = TOPICS[0][1], 0
    for words, answer in TOPICS:
        hits = sum(1 for w in words if re.search(rf"\b{re.escape(w)}", q))
        if hits > score:
            best, score = answer, hits
    return best


async def answer(ai: OllamaCloudClient, question: str, history: list[dict[str, str]]) -> str:
    question = question.strip()[:MAX_QUESTION]
    turns = [
        {"role": "assistant" if h.get("role") == "assistant" else "user", "content": str(h.get("content", ""))[:MAX_QUESTION]}
        for h in history[-MAX_HISTORY:]
    ]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *turns, {"role": "user", "content": question}]
    try:
        result = await ai.chat(messages, max_tokens=220, temperature=0.4)
    except (AIConfigError, AITimeoutError, RateLimitError, UpstreamError):
        return fallback_answer(question)
    return result.content.strip() or fallback_answer(question)
