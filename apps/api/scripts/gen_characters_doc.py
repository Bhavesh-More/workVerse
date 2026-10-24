"""Generate docs/CHARACTERS.md from the role tracks. Run from apps/api: uv run python scripts/gen_characters_doc.py"""
import re

from app.simulation import templates as T
from app.simulation import tracks

ROLE_HINT = {
    "backend": "Backend, DevOps/SRE, Full-Stack, and any role that matches nothing else",
    "frontend": "Frontend, Mobile, QA / Test (keywords: frontend, mobile, qa, test, ios, android, web developer, ui engineer)",
    "data": "Data Analyst, Data Scientist, ML Engineer (keywords: data, ml, machine learning, analytics, scientist, ai engineer)",
    "product": "Product Manager, UI/UX Designer, Business Analyst (keywords: product, design, ux, business, marketing, growth, manager)",
}
SLOT_TITLE = {"manager": "Manager", "teammate": "Teammate (the engineer/maker who shipped the change)",
              "qa": "Quality / testing colleague", "client_pm": "Client / business-side colleague",
              "coworker": "Friendly coworker (no key facts)"}
ctx = {"role": "<your role>", "service": "<service>", "pct": "<N>", "minutes": "<N>"}

def fmt(s):
    try:
        return s.format(**ctx)
    except Exception:
        return s

def slug(n):
    return re.sub(r"[^a-z0-9-]", "", n.lower().replace(" ", "-"))

out = []
w = out.append
w("# WorkVerse colleagues (NPCs) — full reference\n")
w("_Generated from `apps/api/app/simulation/tracks.py` and `templates.py`. Regenerate after changing them: `cd apps/api && uv run python scripts/gen_characters_doc.py`._\n")
w("## How the colleagues work\n")
w("- **Five colleague slots** in every scenario: `manager`, `teammate`, `qa`, `client_pm`, `coworker`. The slot id is the character id used everywhere (API, game, voice).")
w("- **Your target role picks the track** (backend / frontend / data / product). Each track re-tells the incident with its own people, facts and tools.")
w("- **Each slot has 3 possible names**; the scenario seed picks one, so different runs meet different people with the same personality and knowledge.")
w("- **Text chat (click a name / chip):** answered by the chat LLM using the character's role, style, goal and the facts they're allowed to reveal (`app/agents/prompts.py`).")
w("- **Voice (press E):** one ElevenLabs Conversational AI agent (`ELEVENLABS_AGENT_ID` in `apps/api/.env`) is used for **every** colleague. "
  "Per-colleague agents are possible with `ELEVENLABS_AGENT_MAP` (JSON, e.g. `{\"manager\": \"agent_…\"}`) but none are set. "
  "The voice agent only gets the character's scenario context when the custom-LLM bridge secrets (`VOICE_LLM_BRIDGE_SECRET`, `VOICE_CONTEXT_GRANT_SECRET`) are configured — they currently are not.")
w("- **Facts unlock by keywords:** when your message contains one of a colleague's keywords for a fact, they reveal that fact. Suggested questions are tested to unlock their fact (`tests/test_tracks.py`).")
w("- **Portraits:** `apps/web/public/assets/portraits/<name-slug>.svg` (DiceBear Lorelei, CC0). Game sprite and office location come from the slot.\n")

for key, t in tracks.TRACKS.items():
    locs = {loc.id: loc.name for loc in T._locations(t)}
    w(f"---\n\n## Track: {t['label']} (`{key}`)\n")
    w(f"- **Who gets it:** {ROLE_HINT.get(key, '')}")
    w(f"- **Scenario title:** {fmt(t['title'])}")
    w(f"- **Incident:** {fmt(t['incident_line'])}")
    w(f"- **Services:** {', '.join(t['services'])}")
    w(f"- **Workspace:** {t['workspace'][0]} — {fmt(t['workspace'][1])}\n")
    for slot, ch in t["characters"].items():
        s = T._SLOTS[slot]
        p = ch["profile"]
        names = t["names"][slot]
        w(f"### {ch['role']} — slot `{slot}` ({SLOT_TITLE.get(slot, slot)})\n")
        w(f"- **Possible names:** {', '.join(f'{n} ([portrait](../apps/web/public/assets/portraits/{slug(n)}.svg))' for n in names)}")
        w(f"- **Experience:** {p['years']} years")
        w(f"- **Personality:** {p['personality']}")
        w(f"- **Traits:** {', '.join(p['traits'])}")
        w(f"- **Special move (power):** {p['power']}")
        w(f"- **Weak spot:** {p['weakness']}")
        w(f"- **Stats:** {', '.join(f'{k} {v}' for k, v in p['stats'].items())}")
        w(f"- **Talking style:** {fmt(ch['style'])}")
        w(f"- **Opening line:** “{fmt(ch['greeting'])}”")
        w(f"- **Knows about:** {t['people_knows'].get(slot, '—')}")
        w(f"- **Where to find them:** {locs.get(s['location'], s['location'])} · sprite `{s['sprite']}`")
        facts = s["facts"]
        if facts:
            w("- **Facts they can reveal:**")
            for f in facts:
                label = t["facts"][f][0] if f in t["facts"] else T._FACT_META.get(f, f)
                kws = ch.get("keywords", {}).get(f, [])
                w(f"  - `{f}` — {fmt(label) if isinstance(label, str) else label} · unlocked by words: {', '.join(kws) if kws else '—'}")
        else:
            w("- **Facts they can reveal:** none (small talk only)")
        qs = t["questions"].get(slot, [])
        if qs:
            w("- **Suggested questions:**")
            for q, f in qs:
                w(f"  - “{q}”" + (f" → unlocks `{f}`" if f else ""))
        w("")
open("../../docs/CHARACTERS.md", "w").write("\n".join(out))
print("ok", len(out))
