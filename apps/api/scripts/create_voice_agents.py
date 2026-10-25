"""Create one ElevenLabs agent per colleague slot and gender, then map them in apps/api/.env.

    uv run python scripts/create_voice_agents.py --dry-run   # print the payloads, no API calls
    uv run python scripts/create_voice_agents.py             # create missing agents + write ELEVENLABS_AGENT_MAP
    ELEVENLABS_ACCOUNT=2 uv run python scripts/create_voice_agents.py   # same on the second account (_2 vars)

Agent prompts hold only the role card (behaviour), never scenario facts: those reach the model per
turn through the Custom LLM bridge. Agents that already exist (same name) are reused, not duplicated.
"""

from __future__ import annotations

import json
import re
import sys

from app.agents.voice_agents import (
    AGENTS,
    CLIENT_EVENTS,
    END_CALL,
    FACT_DEFAULTS,
    payload,
    prompt_for,
)
from app.simulation.tracks import CASTING, VOICES


def write_env_map(mapping: dict[str, str]) -> None:
    from _eleven import ENV, SUFFIX

    var = f"ELEVENLABS_AGENT_MAP{SUFFIX}"
    text = ENV.read_text()
    line = f"{var}=" + json.dumps(mapping, separators=(",", ":"))
    text = re.sub(rf"^{var}=.*$", line, text, flags=re.M) if re.search(rf"^{var}=", text, flags=re.M) else text.rstrip("\n") + "\n" + line + "\n"
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
        for key, slot, _gender, _label, first in AGENTS:
            conf = {
                "conversation": {"client_events": CLIENT_EVENTS},
                "agent": {
                    "first_message": first,
                    "prompt": {"prompt": prompt_for(slot), "built_in_tools": END_CALL},
                    "dynamic_variables": FACT_DEFAULTS,
                },
            }
            r = http.patch(f"/v1/convai/agents/{mapping[key]}", json={"conversation_config": conf})
            if r.status_code >= 300:
                raise SystemExit(f"update {key}: {r.status_code} {error_text(r)}")
    write_env_map(mapping)
    from _eleven import SUFFIX

    print(f"ELEVENLABS_AGENT_MAP{SUFFIX} updated in apps/api/.env")


if __name__ == "__main__":
    main()
