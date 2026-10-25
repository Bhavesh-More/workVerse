"""Judges: the AI colleagues a candidate meets, as a company configures them.

The scenario mechanics know five roles (manager, teammate, qa, client_pm, coworker): each holds
part of the incident's facts and some score checks look for them. A company builds its own roster
of 1..MAX_JUDGES judges on top of those roles. Each judge picks the role it plays (what it knows),
a free name, an avatar from the existing portraits, one of the configured voices and its
personality. At scenario creation (apply_roster) the first judge of a role becomes that role's
character; more judges of the same role are copies that know the same things, and a role nobody
plays hands its knowledge to the first judge so the incident stays solvable.

Companies without a roster keep the legacy behaviour: the five roles with names from the cast,
optionally tuned per company (judge_defaults) and per topic. Everything is written into the
blueprint, so chat and voice turns never hit the company tables mid-session.
"""

from __future__ import annotations

import copy
import re
import secrets
from pathlib import Path
from typing import Any

from app.schemas.scenario import ScenarioBlueprint
from app.simulation.templates import _portrait
from app.simulation.tracks import CASTING, TRACKS, VOICES, gender_of

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

ROLE_LABELS = {
    "manager": "Manager",
    "teammate": "Senior teammate",
    "qa": "QA / reviewer",
    "client_pm": "Client stakeholder",
    "coworker": "Friendly coworker",
}
MAX_JUDGES = 12

# Each configured voice is one ElevenLabs agent (agents can't swap voices at call time), named by
# the (role, gender) key it is mapped under in ELEVENLABS_AGENT_MAP.
VOICE_AGENT: dict[str, tuple[str, str | None]] = {
    "hope": ("manager", None),
    "brayden": ("teammate", None),
    "sia": ("client_pm", "female"),
    "tony": ("client_pm", "male"),
    "siren": ("qa", "female"),
    "jeremy": ("qa", "male"),
}
VOICE_GENDER = {"hope": "female", "brayden": "male", "sia": "female", "tony": "male", "siren": "female", "jeremy": "male"}

DEFAULT_FOCUS = {
    "manager": "Business impact in plain numbers, a realistic time for the next update, and who owns it.",
    "teammate": "Whether the candidate asks what changed in the release before guessing, and checks a fix is safe.",
    "qa": "What testing covered and missed, and whether the candidate verifies the fix instead of assuming.",
    "client_pm": "Plain-language updates without jargon, an honest timeline, and what it means for customers.",
    "coworker": "Whether the candidate asks the team for help and uses what people know instead of working alone.",
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
        "focus": DEFAULT_FOCUS[slot],
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
        "roles": [{"id": slot, "label": ROLE_LABELS[slot]} for slot in SLOTS],
        "avatars": avatars(),
        "voices": voices(),
        "default_roster": default_roster(),
        "max_judges": MAX_JUDGES,
    }


# ---- roster -----------------------------------------------------------------------
_VOICE_SAMPLES = Path(__file__).resolve().parents[3] / "web" / "public" / "assets" / "voices"


def avatars() -> list[dict[str, str]]:
    """Every cast portrait, with the in-game sprite sheet that goes with it (stable per avatar)."""
    out: list[dict[str, str]] = []
    count = {"male": 0, "female": 0}
    for slot in SLOTS:
        for name in _cast(slot):
            if any(a["id"] == name for a in out):
                continue
            g = gender_of(name)
            count[g] += 1
            out.append({"id": name, "portrait": _portrait(name), "gender": g, "sheet": f"{g[0]}{(count[g] - 1) % 5 + 1}"})
    return out


def _avatar(avatar_id: str) -> dict[str, str] | None:
    return next((a for a in avatars() if a["id"] == avatar_id), None)


def voices() -> list[dict[str, Any]]:
    """The voices the configured ElevenLabs agents speak with, each with a short recorded sample."""
    out = []
    for vid, (_, label) in VOICES.items():
        sample = None
        for slot in SLOTS:
            for name in _cast(slot):
                if CASTING.get(slot, {}).get(gender_of(name)) == vid:
                    mp3 = _portrait(name).replace("/portraits/", "/voices/").replace(".svg", ".mp3")
                    if (_VOICE_SAMPLES / Path(mp3).name).exists():
                        sample = sample or mp3
        out.append({"id": vid, "label": label, "gender": VOICE_GENDER[vid], "sample": sample})
    return out


def default_voice(role: str, gender: str) -> str:
    return CASTING.get(role, CASTING["coworker"]).get(gender, "jeremy")


def judge_template(role: str, track: str = "backend", name: str | None = None) -> dict[str, Any]:
    """A complete, editable judge for `role`: the track's defaults with a cast name and its voice."""
    t = default_template(role, track)
    name = name or t["name"]
    return {
        "role": role,
        "name": name,
        "avatar": name,
        "voice": default_voice(role, gender_of(name)),
        "personality": t["personality"],
        "greeting": t["greeting"],
        "focus": t["focus"],
        "tone": t["tone"],
        "strictness": t["strictness"],
    }


def default_roster() -> list[dict[str, Any]]:
    """The five-role team a company starts from (ids match the role so placed judges carry over)."""
    return [{"id": slot, **judge_template(slot)} for slot in SLOTS]


_ID = re.compile(r"^[a-z0-9_-]{1,24}$")


def clean_roster(raw: Any) -> list[dict[str, Any]]:
    """Validate a roster from the dashboard. Raises ValueError with a message a person can act on."""
    if not isinstance(raw, list):
        raise ValueError("Judges must be a list.")
    if not 1 <= len(raw) <= MAX_JUDGES:
        raise ValueError(f"Keep between 1 and {MAX_JUDGES} judges.")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, j in enumerate(raw, start=1):
        if not isinstance(j, dict):
            raise ValueError(f"Judge {i} is not valid.")
        role = j.get("role")
        if role not in SLOTS:
            raise ValueError(f"Judge {i}: pick the role they play.")
        name = " ".join(str(j.get("name") or "").split())
        if not 1 <= len(name) <= 40:
            raise ValueError(f"Judge {i}: a name of 1 to 40 characters is required.")
        jid = str(j.get("id") or "")
        if not _ID.match(jid) or jid in seen:
            jid = "j_" + secrets.token_hex(4)
        seen.add(jid)
        avatar = _avatar(str(j.get("avatar") or "")) or _avatar(judge_template(role)["avatar"])
        assert avatar is not None
        voice = j.get("voice") if j.get("voice") in VOICE_AGENT else default_voice(role, avatar["gender"])
        tmpl = judge_template(role)
        clean: dict[str, Any] = {"id": jid, "role": role, "name": name, "avatar": avatar["id"], "voice": voice}
        for key, limit in (("personality", 600), ("focus", 400), ("greeting", 300)):
            val = j.get(key)
            clean[key] = val.strip()[:limit] if isinstance(val, str) and val.strip() else tmpl[key]
        clean["tone"] = j.get("tone") if j.get("tone") in TONES else tmpl["tone"]
        try:
            level = int(j.get("strictness"))
        except (TypeError, ValueError):
            level = tmpl["strictness"]
        clean["strictness"] = level if level in STRICTNESS else tmpl["strictness"]
        out.append(clean)
    if len({j["name"].lower() for j in out}) != len(out):
        raise ValueError("Two judges have the same name; give each a different one.")
    return out


def slot_of(blueprint: ScenarioBlueprint, character_id: str) -> str:
    """The role a character plays (extra judges of a role use that role's card and needs)."""
    return (blueprint.metadata.get("judge_roles") or {}).get(character_id, character_id)


def stands_in_for(blueprint: ScenarioBlueprint) -> dict[str, set[str]]:
    """character id -> roles it counts for in score checks (its own, plus roles it covers)."""
    roles: dict[str, set[str]] = {c.id: {slot_of(blueprint, c.id)} for c in blueprint.characters}
    for role, cid in (blueprint.metadata.get("covers") or {}).items():
        roles.setdefault(cid, set()).add(role)
    return roles


def voice_agent(blueprint: ScenarioBlueprint, character_id: str, name: str) -> tuple[str, str | None]:
    """(agent key, gender) for the voice call: the judge's chosen voice, else the role's casting."""
    voice = ((blueprint.metadata.get("profiles") or {}).get(character_id) or {}).get("voice")
    if voice in VOICE_AGENT:
        return VOICE_AGENT[voice]
    return slot_of(blueprint, character_id), gender_of(name)


def apply_roster(blueprint: ScenarioBlueprint, roster: list[dict[str, Any]]) -> None:
    """Turn the generated five-role cast into the company's judges (see module docstring)."""
    by_role = {c.id: c for c in blueprint.characters if c.id in SLOTS}
    profiles = blueprint.metadata.setdefault("profiles", {})
    cast: list[Any] = []
    roles: dict[str, str] = {}
    ids: dict[str, str] = {}
    counts: dict[str, int] = {}
    judges_meta: dict[str, dict[str, Any]] = {}
    for j in roster:
        base = by_role.get(j["role"])
        if base is None:
            continue
        counts[j["role"]] = counts.get(j["role"], 0) + 1
        if counts[j["role"]] == 1:
            ch, cid = base, base.id
        else:
            cid = f"{j['role']}_{counts[j['role']]}"
            ch = base.model_copy(deep=True, update={"id": cid})
            for fact in blueprint.facts:
                if base.id in fact.initially_known_by:
                    fact.initially_known_by.append(cid)
            profiles[cid] = copy.deepcopy(profiles.get(base.id) or {})
        avatar = _avatar(j["avatar"]) or {"portrait": _portrait(j["name"]), "gender": gender_of(j["name"]), "sheet": ""}
        # Text left at its default follows the topic's track (the defaults shown are backend's).
        stock, local = judge_template(j["role"]), default_template(j["role"], blueprint.metadata.get("track", "backend"))
        j = {**j, **{k: local[k] for k in ("personality", "greeting", "focus") if j[k] == stock[k]}}
        ch.name = j["name"]
        ch.greeting = j["greeting"]
        ch.style = f"{TONES.get(j['tone'], '')} {j['personality']}".strip()[:600]
        cfg = {k: j[k] for k in FIELDS}
        cfg["knows"] = default_template(j["role"], blueprint.metadata.get("track", "backend"))["knows"]
        judges_meta[cid] = cfg
        profiles.setdefault(cid, {}).update(
            personality=j["personality"][:200],
            portrait=avatar["portrait"],
            gender=avatar["gender"],
            sheet=avatar["sheet"],
            voice=j["voice"],
            # The recorded intro line says the cast member's own name, so it only fits that name.
            intro_audio=j["name"] == j["avatar"],
        )
        roles[cid] = j["role"]
        ids[j["id"]] = cid
        cast.append(ch)
    if not cast:
        return
    covers: dict[str, str] = {}
    lead = cast[0]
    for role, ch in by_role.items():
        if role in roles.values():
            continue
        # Nobody plays this role: the first judge also knows (and can share) what it knew.
        lead.initial_fact_ids += [f for f in ch.initial_fact_ids if f not in lead.initial_fact_ids]
        lead.disclosure_rules += [r for r in ch.disclosure_rules if r.fact_id not in {x.fact_id for x in lead.disclosure_rules}]
        for fact in blueprint.facts:
            if role in fact.initially_known_by:
                fact.initially_known_by = [lead.id if k == role else k for k in fact.initially_known_by]
        lead.goals = [*lead.goals, *[g for g in ch.goals if g not in lead.goals]][:6]
        judges_meta[lead.id]["knows"] += f"; also {default_template(role, blueprint.metadata.get('track', 'backend'))['knows'].lower()}"
        profiles.setdefault(lead.id, {})["knows"] = judges_meta[lead.id]["knows"]
        covers[role] = lead.id
        profiles.pop(role, None)
    others = [c for c in blueprint.characters if c.id not in SLOTS]
    blueprint.characters = cast + others
    blueprint.metadata["judges"] = judges_meta
    blueprint.metadata["judge_roles"] = roles
    blueprint.metadata["judge_ids"] = ids
    blueprint.metadata["covers"] = covers


def remap_world(world: dict[str, Any], judge_ids: dict[str, str]) -> dict[str, Any]:
    """Point placed judges (judge:<roster id>) at the characters they became in this run."""
    world = copy.deepcopy(world)
    doc = world.get("doc") if isinstance(world.get("doc"), dict) else world
    people = []
    for p in doc.get("people") or []:
        ref = str(p.get("ref", ""))
        if ref.startswith("judge:"):
            cid = judge_ids.get(ref[6:])
            if cid is None:
                continue  # removed from the roster after the world was published
            p = {**p, "ref": f"judge:{cid}"}
        people.append(p)
    doc["people"] = people
    return world


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
    overrides = topic.get("judges") or {}
    if company.get("judge_roster"):
        apply_roster(blueprint, company["judge_roster"])
        judges: dict[str, dict[str, Any]] = blueprint.metadata["judges"]
        # A topic tunes the role's lead judge; the roster owns names.
        for character in blueprint.characters:
            layer = {k: v for k, v in (overrides.get(character.id) or {}).items() if k in FIELDS and k != "name" and v not in (None, "")}
            if not layer or character.id not in judges:
                continue
            cfg = {**judges[character.id], **layer}
            if layer.get("greeting"):
                character.greeting = cfg["greeting"]
            character.style = f"{TONES.get(cfg['tone'], '')} {cfg['personality']}".strip()[:600]
            judges[character.id] = cfg
            blueprint.metadata["profiles"].setdefault(character.id, {})["personality"] = cfg["personality"][:200]
    else:
        _apply_legacy(blueprint, track, company.get("judge_defaults") or {}, overrides)
    blueprint.metadata["company"] = {"name": company.get("name"), "topic": topic.get("title")}
    if topic.get("title"):
        blueprint.title = topic["title"][:160]
    desc = (topic.get("description") or "").strip()
    if desc:
        setting = blueprint.metadata.setdefault("setting", {})
        setting["company"] = company.get("name") or setting.get("company")
        setting["story"] = desc[:600]
        blueprint.briefing = f"Assessment by {company.get('name')}: {desc[:600]}\n\n{blueprint.briefing}"


def _apply_legacy(blueprint: ScenarioBlueprint, track: str, defaults: dict[str, Any], overrides: dict[str, Any]) -> None:
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
