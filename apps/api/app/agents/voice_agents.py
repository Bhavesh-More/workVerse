"""The ElevenLabs agent definitions: one per colleague slot and gender.

Used by scripts/create_voice_agents.py to set up the server's own accounts, and at runtime to
set up the same agents on a player's own ElevenLabs account once every server account is out
of credits. Agent prompts hold only the role card (behaviour), never scenario facts: those reach
the model per call through the {{shared_facts}} dynamic variable.
"""

from __future__ import annotations

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
    return (
        f"{base} {VOICE_RULES} Say you don't know rather than guess.\n\n"
        "Facts you can share on this call (exact, use these words and numbers; anything else you don't know):\n"
        "{{shared_facts}}\n\n"
        "When they ask about one of these, tell them plainly and say the numbers and times exactly. "
        "When the conversation is wrapped up (they say no, thanks, bye, or that they're good), say one short goodbye "
        "and call the end_call tool in that same turn. Never wait for a reply after saying goodbye."
    )


# Lets the character hang up after saying goodbye (ElevenLabs system tool).
END_CALL = {"end_call": {"name": "end_call", "description": "End the call once the conversation is wrapped up.", "params": {"system_tool_type": "end_call"}}}
# Default for calls started without the variable (e.g. testing in the ElevenLabs dashboard).
FACT_DEFAULTS = {"dynamic_variable_placeholders": {"shared_facts": "None."}}


def payload(slot: str, gender: str, label: str, first: str) -> dict:
    voice = CASTING[slot][gender]
    return {
        "name": f"WorkVerse - {label} (Dev)",
        "conversation_config": {
            "agent": {
                "first_message": first,
                "language": "en",
                "prompt": {"prompt": prompt_for(slot), "llm": "deepseek-v41-flash", "temperature": 0.3, "max_tokens": 100, "built_in_tools": END_CALL},
                "dynamic_variables": FACT_DEFAULTS,
            },
            "tts": {"voice_id": VOICES[voice][0], "model_id": "eleven_v4_turbo", "stability": 0.5, "similarity_boost": 0.8},
            # No "interruption" event = the character finishes speaking even if the room is noisy.
            "conversation": {"max_duration_seconds": 600, "client_events": CLIENT_EVENTS},
        },
        "platform_settings": {"auth": {"enable_auth": True}, "overrides": {"custom_llm_extra_body": True}},
    }


def agent_spec(npc_id: str, gender: str | None = None) -> tuple[str, str, str, str, str]:
    """The AGENTS entry for a call, most specific first like pick_agent: "qa:male", then "qa".
    A slot without its own agent falls back to that slot's first entry, then to the manager."""
    by_key = {spec[0]: spec for spec in AGENTS}
    found = (gender and by_key.get(f"{npc_id}:{gender}")) or by_key.get(npc_id)
    return found or next((spec for spec in AGENTS if spec[1] == npc_id), AGENTS[0])
