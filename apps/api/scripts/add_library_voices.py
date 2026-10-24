"""Add the cast's ElevenLabs library voices to the account (free) so agents and TTS can use them.

    uv run --project .. python add_library_voices.py
"""

from __future__ import annotations

from _eleven import client, error_text

from app.simulation.tracks import VOICES


def main() -> None:
    with client() as http:
        mine = {v["voice_id"] for v in http.get("/v1/voices").json().get("voices", [])}
        for key, (voice_id, label) in VOICES.items():
            if voice_id in mine:
                print("have  ", label)
                continue
            found = http.get("/v1/shared-voices", params={"search": label.split(" - ")[0], "page_size": 50}).json()
            match = next((v for v in found.get("voices", []) if v["voice_id"] == voice_id), None)
            if not match:
                print("NOT FOUND in library:", label)
                continue
            r = http.post(f"/v1/voices/add/{match['public_owner_id']}/{voice_id}", json={"new_name": label})
            print("added " if r.status_code < 300 else f"FAILED {r.status_code} {error_text(r)}:", label)


if __name__ == "__main__":
    main()
