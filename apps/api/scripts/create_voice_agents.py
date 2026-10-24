"""Create one ElevenLabs agent per colleague slot and gender, then map them in apps/api/.env.

    uv run python scripts/create_voice_agents.py --dry-run   # print the payloads, no API calls
    uv run python scripts/create_voice_agents.py             # create missing agents + write ELEVENLABS_AGENT_MAP

Agent prompts hold only the role card (behaviour), never scenario facts: those reach the model per
turn through the Custom LLM bridge. Agents that already exist (same name) are reused, not duplicated.
"""

from __future__ import annotations

import json
import re
import sys

from app.agents.role_cards import VOICE_RULES, card_prompt
from app.simulation.tracks import CASTING, VOICES

AGENTS = [  # (map key, slot, gender, label, first message)
    ("manager", "manager", "female", "Manager", "Thanks for jumping on this. Find out what went wrong, and ask me if you need the impact or the deadline."),
    ("teammate", "teammate", "male", "Teammate", "Hey. What do you need to know?"),
    ("client_pm:female", "client_pm", "female", "Client (female)", "Hi, thanks for calling. My customers are stuck. What's going on?"),
    ("client_pm:male", "client_pm", "male", "Client (male)", "Hi, thanks for calling. My customers are stuck. What's going on?"),
    ("qa:female", "qa", "female", "QA (female)", "Hi. What would you like to check?"),
    ("qa:male", "qa", "male", "QA (male)", "Hi. What would you like to check?"),
    ("coworker:female", "coworker", "female", "Coworker (female)", "Oh hey! How's it going?"),
    ("coworker:male", "coworker", "male", "Coworker (male)", "Oh hey! How's it going?"),
]


CLIENT_EVENTS = ["audio", "user_transcript", "agent_response", "agent_response_correction"]


def prompt_for(slot: str) -> str:
    card = card_prompt(slot, f"the {slot.replace('_pm', '').replace('_', ' ')}", "in a WorkVerse workplace practice call")
    base = card or "You are a colleague in a WorkVerse workplace practice call. Be friendly and brief."
    return f"{base} {VOICE_RULES} Say you don't know rather than guess."


def payload(slot: str, gender: str, label: str, first: str) -> dict:
    voice = CASTING[slot][gender]
    return {
        "name": f"WorkVerse - {label} (Dev)",
        "conversation_config": {
            "agent": {
                "first_message": first,
                "language": "en",
                "prompt": {"prompt": prompt_for(slot), "llm": "deepseek-v41-flash", "temperature": 0.3, "max_tokens": 100},
            },
            "tts": {"voice_id": VOICES[voice][0], "model_id": "eleven_v4_turbo", "stability": 0.5, "similarity_boost": 0.8},
            # No "interruption" event = the character finishes speaking even if the room is noisy.
            "conversation": {"max_duration_seconds": 600, "client_events": CLIENT_EVENTS},
        },
        "platform_settings": {"auth": {"enable_auth": True}, "overrides": {"custom_llm_extra_body": True}},
    }


def write_env_map(mapping: dict[str, str]) -> None:
    from _eleven import ENV

    text = ENV.read_text()
    line = "ELEVENLABS_AGENT_MAP=" + json.dumps(mapping, separators=(",", ":"))
    text = re.sub(r"^ELEVENLABS_AGENT_MAP=.*$", line, text, flags=re.M) if re.search(r"^ELEVENLABS_AGENT_MAP=", text, flags=re.M) else text.rstrip("\n") + "\n" + line + "\n"
    ENV.write_text(text)


def main() -> None:
    if "--dry-run" in sys.argv:
        for key, slot, gender, label, first in AGENTS:
            p = payload(slot, gender, label, first)
            print(f"--- {key} -> {p['name']}  voice: {VOICES[CASTING[slot][gender]][1]}")
            print(json.dumps(p, indent=1))
        return
    from _eleven import client, error_text

    mapping: dict[str, str] = {}
    with client() as http:
        existing = {a["name"]: a["agent_id"] for a in http.get("/v1/convai/agents", params={"page_size": 100}).json().get("agents", [])}
        for key, slot, gender, label, first in AGENTS:
            p = payload(slot, gender, label, first)
            if p["name"] in existing:
                mapping[key] = existing[p["name"]]
                print("exists ", key, mapping[key])
                continue
            r = http.post("/v1/convai/agents/create", json=p)
            if r.status_code >= 300:
                raise SystemExit(f"{key}: {r.status_code} {error_text(r)}")
            mapping[key] = r.json()["agent_id"]
            print("created", key, mapping[key])
        # Keep existing agents in line with the current settings (free).
        for key, slot, gender, label, first in AGENTS:
            conf = {"conversation": {"client_events": CLIENT_EVENTS}, "agent": {"first_message": first, "prompt": {"prompt": prompt_for(slot)}}}
            http.patch(f"/v1/convai/agents/{mapping[key]}", json={"conversation_config": conf})
    write_env_map(mapping)
    print("ELEVENLABS_AGENT_MAP updated in apps/api/.env")


if __name__ == "__main__":
    main()
