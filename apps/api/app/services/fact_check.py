"""Which facts a colleague's reply actually stated, so facts they volunteer count as learned.

Keyword disclosure only looks at the learner's question; when the colleague says a fact unprompted,
or the learner phrased the question their own way, this catches it. The model only ever sees facts
this colleague is already allowed to share right now, so nothing hidden is exposed.
"""

from __future__ import annotations

import asyncio
import logging

from app.agents.ollama_cloud import OllamaCloudClient
from app.schemas.runtime import SimulationState
from app.schemas.scenario import ScenarioBlueprint
from app.simulation.engine import disclosable_now

logger = logging.getLogger(__name__)


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
                "(the substance, not just the topic). Asking about something, or saying they don't know, does not count."
            ),
        },
    ]
    try:
        out = await asyncio.wait_for(ai.chat_json(messages, max_tokens=60), timeout=6)
    except Exception:  # noqa: BLE001 - best effort; keyword disclosure still works
        logger.info("fact_check_skipped")
        return []
    stated = out.get("stated") if isinstance(out, dict) else None
    return [f for f in candidates if isinstance(stated, list) and f in stated]
