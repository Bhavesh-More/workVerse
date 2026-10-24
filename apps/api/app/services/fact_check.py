"""Which facts a colleague's reply actually stated, so facts they volunteer count as learned.

Keyword disclosure only looks at the learner's question; when the colleague says a fact unprompted,
or the learner phrased the question their own way, this catches it. The model only ever sees facts
this colleague is already allowed to share right now, so nothing hidden is exposed.
"""

from __future__ import annotations

import asyncio
import logging
import re

from app.agents.ollama_cloud import OllamaCloudClient
from app.schemas.runtime import SimulationState
from app.schemas.scenario import ScenarioBlueprint
from app.simulation.engine import disclosable_now

logger = logging.getLogger(__name__)

_NUMBER = re.compile(r"\d+(?:[.:]\d+)?")


def says_specifics(detail: str, reply: str) -> bool:
    """A fact with numbers (24%, 16:00, 3 devices) only counts if the reply says at least one of them:
    "checkout is failing" is not "24% of checkouts are failing"."""
    needed = set(_NUMBER.findall(detail))
    return not needed or bool(needed & set(_NUMBER.findall(reply)))


async def facts_stated(
    ai: OllamaCloudClient, blueprint: ScenarioBlueprint, state: SimulationState, character_id: str, reply: str
) -> list[str]:
    candidates = disclosable_now(blueprint, state, character_id)
    if not candidates or not reply.strip() or not ai.configured:
        return []
    listed = "\n".join(f"- {fid}: {f.label}. {f.detail}" for fid in candidates if (f := blueprint.fact(fid)))
    messages = [
        {"role": "system", "content": "You check whether a workplace message states specific facts. Answer with JSON only."},
        {
            "role": "user",
            "content": (
                f"Facts:\n{listed}\n\nMessage:\n{reply[:1200]}\n\n"
                'Return {"stated": [fact ids]}: only facts the message clearly tells the listener '
                "including any specific numbers, times or names in it; a vague version (e.g. 'checkout is failing' "
                "for a fact with a percentage) does not count. Asking about something, or saying they don't know, does not count."
            ),
        },
    ]
    try:
        out = await asyncio.wait_for(ai.chat_json(messages, max_tokens=60), timeout=6)
    except Exception:  # noqa: BLE001 - best effort; keyword disclosure still works
        logger.info("fact_check_skipped")
        return []
    stated = out.get("stated") if isinstance(out, dict) else None
    return [
        f
        for f in candidates
        if isinstance(stated, list) and f in stated and says_specifics(blueprint.fact(f).detail, reply)  # type: ignore[union-attr]
    ]
