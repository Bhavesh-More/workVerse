# What changed — AI report, coaching & polish

Branch: `feat/ai-report-evidence`
Hackathon fit: **VIT Code_Apex 3.0 · Track 2 · Problem 04 "AI Job Simulator"** — *"AI-powered workplace
simulation where users practise real-world scenarios and receive evidence-based feedback."*
This branch is about the second half of that sentence: **evidence-based feedback you can trust**.

---

## 1. The one-minute version

| You asked for | What you get now | Where |
|---|---|---|
| **Evidence Ledger** — prove why the AI gave its feedback | Every skill shows ✓/✕ checks (e.g. "Checked migration compatibility"). Each ✓ has a **proof →** link that jumps to the exact message or action in your transcript. | Report page |
| **Show what the user said as a transcript** | Full transcript at the bottom of the report: your messages, colleague replies, and your actions ("You: Inspect application logs", "Blocked: Roll back…") in order. Messages the AI quoted are highlighted. | Report page |
| **Suggestions of what to say** | **In the game:** 2–3 short question chips per colleague ("Did this deploy include a migration?") — click to send. **In the report:** "Say this next time" cards — the AI rewrites your longest/vaguest messages into what a pro would say. | Session + report |
| **Humans talk short, AI was too long** | Colleagues now answer in 1–2 short sentences (≈15–25 words) and **ask you questions back**. Report feedback is short too. Long messages from you get a nudge while typing and are flagged in the report. | Everywhere |
| **Analytics as charts** | Skill score bars · words-per-message chart (with the "natural range" shaded) · who-did-the-talking bars · score trend across attempts on Progress. | Report + Progress |
| **SFX** | Small synthesized sounds: message sent/received, new fact discovered, objective complete, error, report ready. **Sound on/off** button in the session top bar (remembered). | Session + report |
| **More info on scenario page** | Story, "You will…", who you'll meet and what they know, skills scored, what the report contains. Briefing shows incident stats, people + where they sit, what a perfect score looks like, tips. | Scenarios + Briefing |
| **Improve UI** | Above, plus "Save as PDF" on the report (clean print layout). | Report |

---

## 2. How the Evidence Ledger works (plain English)

There are **two** kinds of proof on the report. They are deliberately kept separate:

1. **Checks (computed by code, not AI).** File: `apps/api/app/evaluation/ledger.py`.
   After the session, the server looks at what *actually happened* (actions, facts learned, messages,
   the status update) and ticks boxes like:
   - *Inspected application logs* → proof = the "action applied" event
   - *Chose the forward fix* → proof = the forward-fix event
   - *Status update names a next update time* → proof = your update text
   These can't be hallucinated: no record, no ✓.
2. **What the AI cited.** The AI (Ollama Cloud) scores each skill 0–4 against a fixed rubric and must
   quote your own words. The server throws away any quote/ID that doesn't exist in your session
   (`_validate_suggestion` in `evaluator.py`). If no real evidence is left, the skill shows
   "insufficient evidence" instead of a made-up score.

The coaching rewrites are validated the same way: the AI can only rewrite messages *you* sent.

### Example from a real run (live API, Oct 2026)

> **Risk-aware decision — 3/4.** ✓ Checked migration compatibility · ✓ Checked it before mitigating ·
> ✓ Chose the forward fix · ✕ Read the ops runbook · ✕ No unsafe action was blocked *(you tried a rollback first)*
>
> **Say this next time** — You said: *"Hi, so I just got paged about this incident and I wanted to come
> and talk to you first because…"* (52 words) → **"I'm on the page. What's the current customer impact and what do we know so far?"**

---

## 3. Bugs found and fixed

| Bug | Effect before | Fix |
|---|---|---|
| Your chat messages were saved without saying **who** you talked to | Every message you sent appeared in **every** colleague's chat; colleagues "heard" questions you asked someone else | Learner messages (text **and** voice) now store `character_id`; chat + AI context filter by it |
| **Blocked unsafe actions vanished** | Trying to roll back before checking compatibility was rejected, but the record was rolled back with the error — the evaluator never knew | The rejection is now committed before the error is returned (`session_service.apply_world_action`) |
| Scenario contradicted itself | The teammate says a rollback "will keep failing", yet the reference path and guide said "roll back". The AI scored rollback 0 while the game called it correct | Reference path, guide text, e2e test and ledger all use the **forward fix** |
| "New information: f_error_logs" | Raw IDs shown to the learner | Shows the human label ("Error logs point to the database") |
| `evaluator_model` always empty | Report never showed which model graded you | Filled from config |
| Progress page linked force-ended sessions to "Resume" | Dead end | Links to the report when a score exists |
| Retry endpoint fetched the same DB row twice | Wasted query | Removed |

---

## 4. Files you'd touch to change things

| Want to change… | Edit |
|---|---|
| Ledger checks / "say next time" lines | `apps/api/app/evaluation/ledger.py` (`build_ledger`, `SAY_NEXT_TIME`) |
| What counts as a "too long" message (default 40 words) | `LONG_TURN_WORDS` in `ledger.py` |
| How short colleagues talk | `build_character_messages` in `apps/api/app/agents/prompts.py` |
| Evaluator tone / coaching rules | `build_evaluation_messages` in `prompts.py` |
| Suggested question chips | `QUESTIONS` in `apps/web/lib/practice.ts` |
| Sounds | `apps/web/lib/sfx.ts` (frequencies + durations, no audio files) |
| Charts | `apps/web/components/Charts.tsx` (plain SVG, no chart library) |
| Scenario card copy | `TEMPLATE_CATALOG` in `apps/api/app/simulation/templates.py` (served from code, no DB re-seed needed) |
| Briefing copy (people, tips) | `prebrief()` in `apps/api/app/services/scenario_service.py` |

No database migration is needed: the ledger, conversation stats and coaching are stored in the
existing `evaluations.report_metadata` JSON column. **Old reports still open** — they just don't have
the new sections.

---

## 5. Run & check it yourself

```sh
pnpm install
cd apps/api && uv sync && uv run pytest -q     # 64 pass (4 new ledger tests)
cd ../web && node --test lib/*.test.ts          # includes new suggestion/word-count tests
pnpm --filter web lint && pnpm --filter web check-types && pnpm --filter web build
pnpm dev                                        # web :3000, api :8000
```

**Demo path (≈5 min)** — the one complete workflow:

1. Scenarios → read the richer card → *Start practice* → Briefing (incident stats, people, scoring).
2. Enter the office. Open the manager chat → click a suggested question. Notice the short reply that
   asks you something back. Try typing a long paragraph — the "keep it short" nudge appears.
3. Ask the teammate about the migration → inspect logs → **try rolling back** (blocked, error sound) →
   check migration compatibility → apply the **forward fix** → write the status update.
4. *Complete & debrief* → report: score bars, "How you talked", **Say this next time**, the
   **Evidence Ledger** (click any *proof →*), message-length chart, full transcript. *Save as PDF*.
5. *Retry a variant* → second attempt → Progress shows the score trend line.

### Verified vs not verified

- ✅ Backend: unit tests + a **live run against the real API, database and Ollama model** (dev auth)
  for the whole flow above — ledger, coaching, blocked-rollback record and short NPC replies all confirmed.
- ✅ Frontend: type-check, lint, unit tests and production build pass.
- ⚠️ The new report/briefing UI was **not clicked through in a browser** (needs a Clerk login).
  Please open one report and eyeball the charts before demoing.
- ⚠️ The live run created two test sessions under random `dev:` user IDs in the dev database.

---

## 6. Ideas to win the hackathon (not built yet)

Ranked by judge impact ÷ effort:

1. **Skill Passport export** (overlaps Track 2 #03): a public, shareable page per user listing ledger
   checks passed across attempts — "verified by evidence", each linking to a proof. Data already exists.
2. **Live coach whisper**: during the session, a tiny hint when the learner sends a 40+ word message
   ("Try: *Did this deploy include a migration?*"). The detection is already in `wordCount`.
3. **Second scenario** (e.g. "Client escalation" or "Code review disagreement") reusing the same
   engine — shows the simulator generalises. Only `templates.py` + `QUESTIONS` + ledger checks needed.
4. **Recruiter view**: compare candidates on the same scenario variant with ledger pass-rates.
5. **Replay mode**: animate the learner's path through the office from the event timeline.

---

## 7. Fix: logged-in users still saw the login page

**Bug:** `/`, `/login` and `/signup` were "public" routes, and nothing checked whether you were
*already* signed in — so a logged-in user could land on the login form (or the landing page with
"Log in" buttons).

**Fix:** `apps/web/middleware.ts`. Every request already passes through Clerk's middleware. For the public
routes it now asks Clerk "is there a signed-in user?" and, if yes, redirects to `/dashboard`.
Signed-out visitors see exactly what they saw before.

Also renamed the deprecated Clerk env vars `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `…AFTER_SIGN_UP_URL` to
`NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` / `…SIGN_UP_FALLBACK_REDIRECT_URL` in `.env.example`
(removes the "afterSignInUrl is deprecated" console warning). **Rename them in your own `apps/web/.env` too**,
then restart `pnpm dev`.

---

## 8. Game sounds + background music

- **Every click has a sound** (`components/Sound.tsx` → `SoundLayer`, mounted once in `app/layout.tsx`):
  buttons *click*, ghost/secondary buttons *soft tick*, links *nav chime*, toggles/tabs *pop*.
  A control can override with `data-sfx="nav"` or opt out with `data-sfx="none"` (used on Send,
  which already plays its own sound).
- **Background music**, synthesized live (no audio files): a calm loop on menus/reports and a tenser
  "focus" loop inside the incident. Starts on your first click (browsers block autoplay), pauses when the
  tab is hidden, and fades out during a voice meeting.
- **Sound on/off** and **Music on/off** buttons: sidebar footer and the session top bar (remembered).
- Tune it in `lib/sfx.ts` (`NOTES` for clicks, `MOODS` for music, `MUSIC_VOL` for loudness).

## 9. Snappier on slow internet

Measured (India → Supabase in Sydney): one DB round trip ≈ 0.4 s, and the scenario blueprint row took
**3–9 s to download on every request**.

| Fix | Effect |
|---|---|
| Scenario versions are cached in the API process (`get_scenario_version`, they never change) | Removes the 3–9 s fetch from every chat turn, action, voice turn and page load after the first |
| Chat reply is appended from the response instead of refetching the whole transcript | One request per message instead of two |
| Pressing **E** shows "Calling …" instantly and asks for the mic *while* the server mints the token | Feels instant; mic stream no longer left open |
| Reads and idempotent writes (turns, actions, voice start) retry twice on network drops | A blip no longer shows an error |

**Biggest remaining lever:** the database is in Sydney. Moving the Supabase project to **Mumbai
(ap-south-1)** cuts every DB round trip several times over. Voice reply speed also depends on the ElevenLabs
agent's own settings (turn timeout / eagerness) in its dashboard.

## 10. Voice in a noisy room: "Wait for my turn"

Background noise was picked up as you "interrupting", so the character kept restarting its answer.
Now, during a voice meeting, **your mic is paused while the character speaks** and reopens the moment
it's your turn (the status shows "speaking · your mic is paused"). Turn it off with the
**Wait for my turn** button if you want to be able to cut in. Headphones help too: the speakers can't leak
back into the mic. (`game/VoiceMeeting.tsx`)
