"""Generate the "Hello, I'm <name>" lines played on each colleague's intro card.

    uv run python scripts/gen_intro_voices.py --dry-run   # list clips + estimated characters, no API calls
    uv run python scripts/gen_intro_voices.py             # generate missing clips (uses ElevenLabs credits)
    uv run python scripts/gen_intro_voices.py --voice hope   # only one voice's clips

Writes apps/web/public/assets/voices/<name-slug>.mp3. Existing files are skipped, so re-runs are free.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.simulation.templates import _portrait
from app.simulation.tracks import TRACKS, VOICES, voice_for

OUT = Path(__file__).resolve().parents[3] / "apps/web/public/assets/voices"
MODEL = "eleven_flash_v2_5"  # cheapest/fastest; ~0.5 credit per character

# The free plan can't use library voices through the TTS API (agents still can), so intro lines use the
# closest built-in voice. ponytail: drop this map once the account can use library voices via the API.
STANDINS: dict[str, tuple[str, str]] = {
    "hope": ("EXAVITQu4vr4xnSDxMaL", "Sarah - Mature, Reassuring, Confident"),
    "brayden": ("TX3LPaxmHKxFdv7VOQHJ", "Liam - Energetic, Social Media Creator"),
    "tony": ("cjVigY5qzO86Huf0OWal", "Eric - Smooth, Trustworthy"),
    "sia": ("hpp4J3VqNfWAUOO0d1Us", "Bella - Professional, Bright, Warm"),
    "siren": ("cgSgspJ2msm6clMCkdW9", "Jessica - Playful, Bright, Warm"),
    "jeremy": ("iP95p4xoKVk53GoZ742B", "Chris - Charming, Down-to-Earth"),
}


def tts_voice(cast: str) -> tuple[str, str]:
    return STANDINS.get(cast) or VOICES[cast]


def clips() -> list[tuple[str, str, str]]:
    seen: dict[str, tuple[str, str, str]] = {}
    for t in TRACKS.values():
        for slot, names in t["names"].items():
            for name in names:
                slug = _portrait(name).rsplit("/", 1)[1].removesuffix(".svg")
                seen.setdefault(slug, (slug, f"Hello, I'm {name}.", voice_for(slot, name)))
    return sorted(seen.values())


def main() -> None:
    dry = "--dry-run" in sys.argv
    only = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else None  # e.g. --voice hope
    todo = [c for c in clips() if not (OUT / f"{c[0]}.mp3").exists() and (only is None or c[2] == only)]
    chars = sum(len(text) for _, text, _ in todo)
    for slug, text, voice in todo:
        print(f"{slug:18} {tts_voice(voice)[1]:48} {text}")
    print(f"\n{len(todo)} clips, {chars} characters (~{chars // 2}-{chars} credits with {MODEL}).")
    if dry or not todo:
        return
    from _eleven import client, error_text

    OUT.mkdir(parents=True, exist_ok=True)
    with client() as http:
        for slug, text, voice in todo:
            r = http.post(
                f"/v1/text-to-speech/{tts_voice(voice)[0]}",
                params={"output_format": "mp3_22050_32"},
                json={"text": text, "model_id": MODEL, "voice_settings": {"stability": 0.5, "similarity_boost": 0.8}},
            )
            if r.status_code != 200:
                raise SystemExit(f"{slug}: {r.status_code} {error_text(r)}")
            (OUT / f"{slug}.mp3").write_bytes(r.content)
            print("wrote", slug)


if __name__ == "__main__":
    main()
