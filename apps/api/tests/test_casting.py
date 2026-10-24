from app.core.config import Settings
from app.simulation.tracks import CASTING, TRACKS, VOICES, gender_of, voice_for


def test_every_name_has_a_voice_matching_their_gender() -> None:
    female = {"arabella", "hope", "sia", "siren"}
    for t in TRACKS.values():
        for slot, names in t["names"].items():
            for name in names:
                voice = voice_for(slot, name)
                assert voice in VOICES
                assert (voice in female) == (gender_of(name) == "female"), name
    assert set(CASTING) >= {"manager", "teammate", "client_pm", "qa", "coworker"}


def test_agent_lookup_prefers_gendered_then_slot_then_default() -> None:
    s = Settings(elevenlabs_agent_id="agent_default", elevenlabs_agent_map='{"client_pm:male":"agent_cm","manager":"agent_m"}')
    assert s.agent_for_npc("client_pm", "male") == "agent_cm"
    assert s.agent_for_npc("client_pm", "female") == "agent_default"
    assert s.agent_for_npc("manager", "female") == "agent_m"
