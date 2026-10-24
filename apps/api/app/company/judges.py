"""Judges: the five AI colleagues a candidate meets, as a company configures them.

A judge is a character slot (manager, teammate, qa, client_pm, coworker). Each has a default
template (the role track's personality) that a company may override per company and again per
topic. Names can only be picked from the cast that already exists (portraits and voices are
matched to those names), so a company chooses a name rather than typing one.

Overrides are applied to the blueprint at scenario creation (apply_topic), so chat and voice turns
read them from the stored blueprint and never hit the company tables mid-session.
"""

from __future__ import annotations

from typing import Any

from app.schemas.scenario import ScenarioBlueprint
from app.simulation.templates import _portrait
from app.simulation.tracks import TRACKS, gender_of

SLOTS = ("manager", "teammate", "qa", "client_pm", "coworker")
FIELDS = ("name", "personality", "tone", "strictness", "focus", "greeting")

TONES = {
    "warm": "Warm and encouraging; you put people at ease.",
    "neutral": "Even and professional; neither warm nor cold.",
    "direct": "Direct and time-pressed; you get to the point.",
    "blunt": "Blunt and sceptical; you don't soften bad news or vague answers.",
    "anxious": "Stressed and anxious; you need reassurance backed by facts.",
}

STRICTNESS = {
    1: "Very helpful: you share what you know readily, even when the question is a little vague, and you are patient.",
    2: "Helpful: you answer reasonable questions fully and only ask for clarity when a question is very vague.",
    3: "Balanced: you answer specific questions and ask one clarifying question back when they are vague.",
    4: "Demanding: you answer clear, specific questions with your facts, but push back on vague questions and assumptions and expect evidence before agreeing.",
    5: "Very demanding: you still answer clear, specific questions with your facts, but you challenge every unsupported claim, make the candidate justify their reasoning, and give nothing to vague or leading questions.",
}

_DEFAULT_TONE = {"manager": "direct", "teammate": "blunt", "qa": "neutral", "client_pm": "anxious", "coworker": "warm"}
_DEFAULT_STRICTNESS = {"manager": 3, "teammate": 4, "qa": 3, "client_pm": 3, "coworker": 2}


def _cast(slot: str) -> list[str]:
    """Every existing name for a slot across all tracks and incidents (each has a portrait and voice)."""
    names: list[str] = []
    for track in TRACKS.values():
        for t in (track, *track.get("variants", [])):
            for n in t.get("names", {}).get(slot, []):
                if n not in names:
                    names.append(n)
    return names


def default_template(slot: str, track: str = "backend") -> dict[str, Any]:
    t = TRACKS.get(track, TRACKS["backend"])
    c = t["characters"][slot]
    return {
        "name": t["names"][slot][0],
        "role": c["role"],
        "personality": c["profile"]["personality"] + " " + c["style"],
        "tone": _DEFAULT_TONE[slot],
        "strictness": _DEFAULT_STRICTNESS[slot],
        "focus": "",
        "greeting": c["greeting"],
        "knows": t["people_knows"][slot],
    }


def catalog() -> dict[str, Any]:
    """Everything the dashboard needs to render the judge editor."""
    return {
        "slots": [
            {
                "id": slot,
                "names": [{"name": n, "gender": gender_of(n), "portrait": _portrait(n)} for n in _cast(slot)],
                "defaults": {track: default_template(slot, track) for track in TRACKS},
            }
            for slot in SLOTS
        ],
        "tones": [{"id": k, "description": v} for k, v in TONES.items()],
        "strictness": [{"level": k, "description": v} for k, v in STRICTNESS.items()],
        "tracks": [
            {
                "id": tid,
                "label": t["label"],
                "title": t["title"],
                "incidents": [{"id": "base", "title": t["title"]}]
                + [{"id": v["id"], "title": v["title"]} for v in t.get("variants", [])],
            }
            for tid, t in TRACKS.items()
        ],
        "samples": TOPIC_SAMPLES,
    }


def clean_judges(raw: Any) -> dict[str, dict[str, Any]]:
    """Keep only known slots/fields; names must come from the existing cast."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    for slot in SLOTS:
        cfg = raw.get(slot)
        if not isinstance(cfg, dict):
            continue
        clean: dict[str, Any] = {}
        name = cfg.get("name")
        if isinstance(name, str) and name in _cast(slot):
            clean["name"] = name
        for key, limit in (("personality", 600), ("focus", 400), ("greeting", 300)):
            val = cfg.get(key)
            if isinstance(val, str) and val.strip():
                clean[key] = val.strip()[:limit]
        if cfg.get("tone") in TONES:
            clean["tone"] = cfg["tone"]
        try:
            level = int(cfg.get("strictness"))
            if level in STRICTNESS:
                clean["strictness"] = level
        except (TypeError, ValueError):
            pass
        if clean:
            out[slot] = clean
    return out


def bad_names(raw: Any) -> list[str]:
    """Names a client sent that are not in the cast for their slot (for a clear 422)."""
    bad = []
    if isinstance(raw, dict):
        for slot in SLOTS:
            name = (raw.get(slot) or {}).get("name") if isinstance(raw.get(slot), dict) else None
            if name and name not in _cast(slot):
                bad.append(f"{slot}: {name}")
    return bad


def resolve(slot: str, track: str, company: dict[str, Any] | None, topic: dict[str, Any] | None) -> dict[str, Any]:
    """Default template <- company defaults <- topic overrides."""
    out = default_template(slot, track)
    for layer in ((company or {}).get(slot) or {}, (topic or {}).get(slot) or {}):
        out.update({k: v for k, v in layer.items() if k in FIELDS and v not in (None, "")})
    return out


def behaviour_prompt(cfg: dict[str, Any]) -> str:
    """The personality block injected into a judge's system prompt (chat and voice)."""
    parts = [
        f"Personality: {cfg.get('personality', '')}",
        f"Tone: {TONES.get(cfg.get('tone', ''), '')}",
        f"How hard you are on the candidate: {STRICTNESS.get(int(cfg.get('strictness') or 3), STRICTNESS[3])}",
    ]
    if cfg.get("focus"):
        parts.append(f"What you pay attention to and probe: {cfg['focus']}")
    return " ".join(p for p in parts if not p.endswith(": "))


def apply_topic(
    blueprint: ScenarioBlueprint,
    topic: dict[str, Any],
    company: dict[str, Any],
) -> None:
    """Fit a generated blueprint to a company topic: brief, judge names and personalities."""
    track = blueprint.metadata.get("track", "backend")
    defaults = company.get("judge_defaults") or {}
    overrides = topic.get("judges") or {}
    judges: dict[str, dict[str, Any]] = {}
    for character in blueprint.characters:
        if character.id not in SLOTS:
            continue
        if not (defaults.get(character.id) or overrides.get(character.id)):
            continue  # untouched judges keep the track's own behaviour exactly
        cfg = resolve(character.id, track, defaults, overrides)
        # Only overridden names replace the track's random pick, so untouched judges keep variety.
        chosen = (overrides.get(character.id) or {}).get("name") or (defaults.get(character.id) or {}).get("name")
        if chosen:
            character.name = chosen
        cfg["name"] = character.name
        if (overrides.get(character.id) or {}).get("greeting") or (defaults.get(character.id) or {}).get("greeting"):
            character.greeting = cfg["greeting"]
        character.style = f"{TONES.get(cfg['tone'], '')} {cfg['personality']}".strip()[:600]
        judges[character.id] = cfg
        profile = blueprint.metadata.setdefault("profiles", {}).setdefault(character.id, {})
        profile.update(
            personality=cfg["personality"][:200],
            portrait=_portrait(character.name),
            gender=gender_of(character.name),
        )
    blueprint.metadata["judges"] = judges
    blueprint.metadata["company"] = {"name": company.get("name"), "topic": topic.get("title")}
    if topic.get("title"):
        blueprint.title = topic["title"][:160]
    desc = (topic.get("description") or "").strip()
    if desc:
        setting = blueprint.metadata.setdefault("setting", {})
        setting["company"] = company.get("name") or setting.get("company")
        setting["story"] = desc[:600]
        blueprint.briefing = f"Assessment by {company.get('name')}: {desc[:600]}\n\n{blueprint.briefing}"


TOPIC_SAMPLES = [
    {
        "title": "On-call incident: checkout errors after a deploy",
        "description": (
            "We hire backend engineers who stay calm under pressure. The candidate is on call when a "
            "deploy breaks checkout. We want to see how they gather facts from the team before acting, "
            "whether they check that a rollback is safe, and how clearly they update stakeholders."
        ),
        "track": "backend",
        "difficulty": "standard",
        "judges": {
            "manager": {"tone": "direct", "strictness": 4, "focus": "Clear status updates with impact, ETA and owner. Pushes back on vague answers."},
            "client_pm": {"tone": "anxious", "strictness": 3, "focus": "Plain language, no jargon, an honest time for the next update."},
        },
    },
    {
        "title": "Frontend release gone wrong",
        "description": (
            "For our frontend team: customers can't pay after a release. We look for candidates who "
            "ask precise questions, communicate trade-offs to a non-technical client, and pick a safe "
            "fix instead of guessing."
        ),
        "track": "frontend",
        "difficulty": "standard",
        "judges": {
            "teammate": {"tone": "direct", "strictness": 4, "focus": "Whether the candidate asks what changed in the API contract before blaming the UI."},
        },
    },
    {
        "title": "Data analyst: numbers wrong before a leadership review",
        "description": (
            "Our analytics team needs people who question the data. The dashboard looks wrong an hour "
            "before leadership reviews it. We want to see the candidate find the cause, avoid "
            "publishing wrong numbers, and explain the situation simply."
        ),
        "track": "data",
        "difficulty": "challenging",
        "judges": {
            "manager": {"tone": "blunt", "strictness": 5, "focus": "Never accept a number without a source. Asks 'how do you know?'"},
        },
    },
    {
        "title": "Product launch: sign-ups crashed",
        "description": (
            "For product managers: a launch broke sign-ups during a campaign. We assess prioritisation, "
            "stakeholder management and whether the candidate makes decisions from evidence rather "
            "than pressure."
        ),
        "track": "product",
        "difficulty": "introductory",
        "judges": {
            "client_pm": {"tone": "anxious", "strictness": 2, "focus": "Wants reassurance and a timeline for their marketing campaign."},
        },
    },
]
