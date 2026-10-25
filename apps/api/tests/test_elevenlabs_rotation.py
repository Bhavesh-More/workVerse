"""ElevenLabs account rotation: every configured account is tried, in order."""


def test_elevenlabs_rotation_reads_five_accounts_in_order():
    from app.core.config import Settings

    s = Settings(
        _env_file=None,
        elevenlabs_api_key="k1",
        elevenlabs_agent_id="a1",
        elevenlabs_api_key_3="k3",
        elevenlabs_agent_map_3='{"manager": "a3"}',
        elevenlabs_api_key_4="k4",
        elevenlabs_agent_map_4='{"manager": "a4"}',
        elevenlabs_api_key_5="k5",
        elevenlabs_agent_map_5='{"qa:female": "a5"}',
    )
    assert [k for k, _ in s.elevenlabs_accounts] == ["k1", "k3", "k4", "k5"]  # empty slot 2 skipped
    assert s.elevenlabs_accounts[3][1]["qa:female"] == "a5"
