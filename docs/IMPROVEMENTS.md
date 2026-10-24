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

All sounds are **synthesized 8-bit** (Web Audio API, no audio files), so there is nothing to license and
nothing extra to download on a slow connection. The palette is adapted from our
[Crowdspawn](https://github.com/divyanshu-patil/Crowdspawn) project (MIT) plus classic
[sfxr](https://www.npmjs.com/jsfxr) archetypes (coin, power-up, hurt).

| Moment | Sound |
|---|---|
| Hover a control (mouse) | tiny tick |
| Primary button / ghost button / link | confirm chord / blip / rising "nav" sweep |
| Toggle or chip on / off | two-note up / two-note down |
| Tab, expand / collapse, Close / Cancel / End | tab chirp, select / back |
| Send / receive a chat message | up-blip / two-note reply |
| New fact discovered | coin |
| Objective complete | power-up |
| Blocked or failed action | noise hit + falling buzz |
| Press **E** to call someone | phone ring |
| Report ready | victory fanfare |

**Background music** is a chiptune loop: lo-fi **calm** groove on menus and reports, and a driving
minor **focus** groove with drums, bass and a lead melody during the incident. It starts on your first
click (browsers block autoplay), pauses when the tab is hidden, and fades out during voice meetings.

- **Sound on/off** and **Music on/off** buttons: sidebar footer and the session top bar (they stay in sync).
- Any control can pick its sound with `data-sfx="coin"` etc., or stay silent with `data-sfx="none"`.
- Tune it in `apps/web/lib/sfx.ts`: `SOUNDS` (effects), `GROOVES` (music patterns), `MUSIC_VOL` (loudness).
  Click routing lives in `apps/web/components/Sound.tsx`.

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

## 10. Voice in a noisy room: they finish their sentence

Background noise was picked up as you "interrupting", so the character kept restarting its answer.

- **First fix (removed):** pause your mic while the character speaks. It broke voice: muting/unmuting the
  WebRTC mic on every speaking↔listening switch raced, and the mic often stayed dead — the agent heard
  only silence ("..." in the ElevenLabs transcript).
- **Now:** your mic stays open; only the **Mute mic** button mutes it. The ElevenLabs agents have
  **interruptions turned off** (no `interruption` client event), so they ignore sound while they talk and
  listen again when they finish. Wait for them to stop before you answer. Headphones help.
- Code: `apps/web/game/VoiceMeeting.tsx`; agent setting in `apps/api/scripts/create_voice_agents.py` (`CLIENT_EVENTS`).

## 11. Every role gets its own story (role tracks)

**Before:** everyone played the same "checkout errors" incident with the same people.
**Now:** the scenario is re-told for your target role (picked in onboarding/profile):

| Your role contains… | Track | What breaks |
| --- | --- | --- |
| backend, devops, full-stack (default) | Backend | An API release causes errors |
| frontend, mobile, QA | Frontend | A UI release breaks a user flow |
| data, ML, analyst | Data | A dashboard shows wrong numbers before a leadership review |
| product, design, business | Product | A launch goes wrong and customers complain |

Each track has its own colleagues, facts, tools, actions and suggested questions.
- Code: `apps/api/app/simulation/tracks.py` (all the text), `templates.py` (builds the scenario).
- Test: `apps/api/tests/test_tracks.py` checks that every suggested question really unlocks its fact.

## 12. Help when you're stuck

- **Chat open, nothing typed for 8 s:** a glowing "Try asking…" card pops up with two questions you can click.
- **No key/mouse input for 20 s:** a "Stuck?" card shows your next step with "Talk to them" / "Show guide" buttons.
- Code: `apps/web/app/(app)/session/[sessionId]/page.tsx` (search for `idleHint` and `stuck`).

## 13. "Meet the team" anime intro

When a session starts you see an anime-opening style intro, one card per colleague:
a slash wipe and flash, the portrait slams in (screen shake + impact ring), the name
drops in letter by letter, then role, years of experience, traits, stat bars that count
up, a typed-out quote, personality, what they know, their "special move" and "weak spot".
It ends with a line-up of the whole team and the incident stamped across it.

- Shows **once per session**. Replay with **Meet the team** in the top bar; the **ⓘ** next to a chat name shows just that person.
- **Q = profile card.** Walk up to someone: the hint says "Press E to talk · Q profile card". Press **Q** to see their card any time.
- **First meeting:** the first time you talk to someone (E, or clicking them) whose card you haven't seen yet, their card plays first, then the call/chat starts. Cards seen in the opening intro count as "met" (remembered per session in the browser tab).
- Skip any time: **Esc**, the Skip button. **Space / Enter / click** jumps to the next card.
- Sounds are made in code (`lib/sfx.ts`: `whoosh`, `slam`, `shimmer`, `stat`, `type`, `stamp`) — no audio files.
- While the intro is open the music switches to a louder action/survival track (`intro` in `GROOVES`, 150 BPM, D minor) and switches back to the office music when it closes (`setMusicOverride`).
- If your OS has "reduce motion" on, it keeps the fades and drops the movement.
- Portraits: `apps/web/public/assets/portraits/` (DiceBear Lorelei, CC0 — see `CREDITS.md`).
- Preview without signing in (dev only): run the web app and open http://localhost:3000/intro-preview.
- Code: `apps/web/components/TeamIntro.tsx`, styles at the end of `apps/web/app/globals.css` (classes start with `ti`).

**Why music needs one key press first:** browsers block sound until you interact with the page
(autoplay rule). Music now starts on your *first* key press or mouse press anywhere — walking with the
arrow keys counts — instead of waiting for a click. If you came from the dashboard by clicking, it is already playing.

**Full list of every colleague** (all tracks, names, profiles, facts, keywords, questions, voice setup): see [`docs/CHARACTERS.md`](CHARACTERS.md).

## 14. Each colleague has their own voice

- **Casting** (`apps/api/app/simulation/tracks.py` → `VOICES`, `CASTING`): manager = Arabella, teammate = Brayden,
  client = Hope (women) / Tony Smyles (men), QA = Sia / Jeremy, coworker = Siren / Jeremy. Gender comes from the first name.
- **Intro line:** on each intro card the colleague says only "Hello, I'm <name>" in their voice.
  Clips live in `apps/web/public/assets/voices/`; make them with
  `cd apps/api && uv run python scripts/gen_intro_voices.py --dry-run` (free preview) then without `--dry-run` (uses credits).
  "Sound off" mutes them too.
  On the free ElevenLabs plan the TTS API can't use library voices, so these lines use the closest built-in
  voice (Hope→Sarah, Brayden→Liam, Tony→Eric, Sia→Bella, Siren→Jessica, Jeremy→Chris; `STANDINS` in the script).
  Voice *calls* still use the real cast voices. Manager is Hope (Arabella needs a paid plan).
- **Voice calls:** one ElevenLabs agent per slot and gender, created by `scripts/create_voice_agents.py` (`--dry-run` first).
  It writes `ELEVENLABS_AGENT_MAP` into `apps/api/.env`, e.g. `{"manager":"agent_…","client_pm:male":"agent_…"}`.
  Lookup order: `client_pm:male` → `client_pm` → `ELEVENLABS_AGENT_ID`.
- **Role cards** (`apps/api/app/agents/role_cards.py`) set how the manager, teammate and client behave on calls.

## 15. Clear roles in chat: who knows what

**Problem:** the manager asked *you* "who's affected?", but she is the one who knows the impact — you
were confused whether to answer or investigate.

- **Who owns what now:** the manager *tells* you the impact and the deadline when you ask; *you* find the
  cause, propose a plan and send the status update. Her greeting, goals, role card and voice first line say so.
- **"Who you're talking to" card** above the chat: portrait, role, personality, **"<Name> can tell you"**
  and **"<Name> needs from you"** (`NEEDS_FROM_LEARNER` in `apps/api/app/agents/role_cards.py`).
- Suggestions now say **"Ask Olivia:"** so it's clear they are questions *you* send.
- Right-hand sections (**What you know**, **Stakeholder update**, **Chat**) collapse — click the title.
- Chat always scrolls to the newest message; the chat box can no longer be squeezed to a sliver.

## 16. A different story every session

**Before:** every session happened at the same unnamed company.
**Now:** each new session picks a random company (12 options: grocery app, ticketing site, gym app…;
`COMPANIES` in `apps/api/app/simulation/templates.py`). Then Ollama rewrites it to fit **your profile**
(role, experience, career goals): e.g. a gaming fan gets a game store during a holiday sale.

- Only the *story* changes; the incident, clues and scoring stay the same and tested.
- Safety: Ollama never sees the hidden cause. A story mentioning anything cause-like ("database",
  "rollback", "test"…) or numbers is thrown away. If Ollama is slow (8 s) or off, the random company is used.
- Colleagues know the company too, so chat and voice stay consistent.
- Code: `personalize()` in `apps/api/app/services/scenario_service.py`; test `tests/test_personalize.py`.

## 17. A different incident every session

**Before:** each role always got the same problem (backend = a database change that can't be rolled back).
**Now:** each role has **3 incident types** and every new session picks one at random:

| Role track | Incident types |
| --- | --- |
| Backend | Database migration · Message format change jams the queue · Rotated payment key |
| Frontend | API field renamed · Service worker caches a broken app · New app version crashes on old phones |
| Data | Upstream column renamed · Timezone switched to UTC · Source sends events twice |
| Product | Phone verification launch · Promo code only works in one region · Google-only login launch |

- All of them follow the same shape, so the game logic and scoring stay the same: *something shipped →
  a plain undo won't fix it → find that out → ship a forward fix → send an update.* Only the story, clues,
  colleague lines and suggested questions change.
- The **Practice** page card already shows the incident you'll get: the card picks it, and the
  **Start** button sends its id (`incident`) so the session matches. A refreshed page may deal a new one.
- **⇄ Shuffle** on the card deals a different incident without starting anything.
- *Troubleshooting:* if the card never changes, an old API server may still be running. Run
  `lsof -nP -iTCP:8000 -sTCP:LISTEN`: there should be only your `uvicorn --reload` processes.
- Add your own: append to `TRACKS["<track>"]["variants"]` at the bottom of
  `apps/api/app/simulation/tracks.py`; list only the text that changes.
  `tests/test_incident_variants.py` checks that every type builds, passes validation and that each
  suggested question unlocks its clue.

## 18. Faces match names and voices

**Problem:** portraits were picked only by name, so some women had beards and some men had long hair,
while the voice followed the name, e.g. a bearded "Aiko" speaking with a woman's voice.
**Fix:** all 60 portraits were regenerated so the hairstyle and beard follow the same gender the voices use
(`gender_of()` in `apps/api/app/simulation/tracks.py`). Men get short hairstyles (sometimes a beard); women
get longer styles and no beard. To regenerate, see `apps/web/scripts/gen_portraits.mjs`.

## 19. Colleagues hand you on when they're done

Each colleague exists to give you certain facts (the manager: impact and deadline; the teammate: what
changed…). Once you know **all** of them, that colleague's job is done:

- **They say so.** Their next reply (chat or voice) answers you, then points you to the next step in one
  sentence, e.g. "…next, go inspect the application logs in the Engineering Workspace."
- **A handoff card appears in the chat:** "✓ Olivia has told you what she knows."
  - Next step is a **person** → the chat switches to them after a 6-second countdown.
    **Talk to … now** skips the wait; **Stay here** cancels. (During a voice call it waits for you.)
  - Next step is a **place or tool** → the card names it, and the arrow in the office points there.
- The "next step" comes from the same server logic as the office arrow (`resolve_navigation`), so they always agree.
- Colleagues with no facts (the friendly coworker) never trigger it.
- Code: `character_done()` / `next_step_hint()` in `apps/api/app/simulation/navigation.py`, the
  `characters_done` field in the session view, the handoff card in the session page; test `tests/test_handoff.py`.

## 20. Voice keeps working when credits run out

**Problem:** a call stopped after a minute with "Server error: Unknown error". The real reason (from
ElevenLabs' call record) was *"This request exceeds your quota limit"*: the free plan's 10,000 monthly
credits were used up. A call costs about **11 credits per second**, so a free account covers ~15 minutes a month.

**What changed:**
- **Credit check before every call.** If an account has less than one minute's worth left, it isn't used.
- **Two ElevenLabs accounts, automatic switch.** `apps/api/.env` (never committed) holds
  `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_MAP` for account 1 and `ELEVENLABS_API_KEY_2` +
  `ELEVENLABS_AGENT_MAP_2` for account 2. Each call tries account 1, and if it's out of credits, rate limited
  or its key fails, uses account 2 instead (each account has its own copy of the 8 agents).
- **Plain error messages.** If every account is out of credits, the app says so and suggests text chat;
  a call cut off mid-way now says the voice service ended it (often credits) instead of "Unknown error".

**Set up another account:** put its key in `.env` as `ELEVENLABS_API_KEY_2`, then from `apps/api/scripts`:
```bash
ELEVENLABS_ACCOUNT=2 uv run --project .. python add_library_voices.py   # adds the 6 cast voices (free)
ELEVENLABS_ACCOUNT=2 uv run --project .. python create_voice_agents.py  # creates the 8 agents, writes ELEVENLABS_AGENT_MAP_2
```
Code: `mint_for_npc()` in `apps/api/app/agents/elevenlabs_cloud.py`; tests in `tests/test_voice_quota.py`.

## 21. Tools pop up and show what you found

Inspecting a tool (walk up + E, or click the action) now opens a **pixel-art window** in the office colours,
styled like the tool: **logs** open as a terminal with the error lines typing in; **metrics / dashboard**
show a pixel chart plus alerts; the **deploy console** shows release stages; the **runbook / notes**
open as a document. It lists only facts you now know (re-opening a tool shows them again; new ones are
marked NEW). Close with **Got it**, Esc or Enter.
Code: `apps/web/components/ToolPopup.tsx`; the server adds `findings` + `tool` to action responses.

## 22. Anime "Shift complete" end card

When you finish a shift (the **Complete** button), an end card plays in the same style as the team intro:
letterbox bars and speed lines, an orange slash wipe, **SHIFT COMPLETE** slamming in letter by letter
with a screen shake, each finished objective stamped ✓ (with a stamp sound), your team's cards fanning in,
and an **INCIDENT RESOLVED** stamp, with the action soundtrack. **See your debrief →** (or Esc/Enter) goes on.

Dev previews (no sign-in, not in production): `http://localhost:3000/intro-preview?end=1` for the end card,
`http://localhost:3000/tool-preview?tool=log_viewer` (or `metrics_panel`, `deploy_console`, `runbook`) for the tool popups.
Code: `apps/web/components/ShiftComplete.tsx`.

## 23. Create new + Previous sessions page

- **Dashboard:** next to **Resume session** there's **+ Create new**. It deals a fresh scenario (random
  company and incident) and opens its briefing; your in-progress session stays where it was.
- **Sessions** (new sidebar link, also **View all →** under *Recent sessions*) lists every session, newest first.
  - **Finished** session → click opens its **report**.
  - **Unfinished** session → click (or **Start new**) starts a **new** session of that scenario with a
    fresh incident. **Resume** next to it continues the old one instead.
- Code: `apps/web/app/(app)/sessions/page.tsx` (uses the existing `/sessions/{id}/retry` API).

## 24. Voice handoff, "told you" dialogue, sticky voice transcript

- **Facts count no matter how you learn them.** Before, a fact only counted if your *question* used
  certain keywords (which the suggested questions always did). Now, after every colleague reply,
  in text chat **and** in a voice call, a quick AI check (`apps/api/app/services/fact_check.py`)
  asks: "did this reply actually state any of the facts this person is allowed to share?" If yes,
  they're added to *What you know*. The AI only ever sees facts that person may share right now,
  so nothing hidden leaks.
- **Voice calls now trigger the handoff.** Each spoken line is saved as before; now the server also
  updates what you know and sends the new state back. When the person on the call has told you
  everything, the call shows **"✓ … has told you what they know. Next: …"** with a button that
  ends the call and takes you to the next person (or the next step).
- **"Told you" dialogue box.** When a colleague tells you something new (typed or spoken), a pixel
  dialogue window pops up with their portrait and the facts, like the tool findings popup.
- **Voice transcript sticks to the newest line** like a chat app, and voice tags such as `[calm]`
  are hidden from the text.

## 25. Handoff fires when the step is done (and calls end themselves)

- **Before:** you were only handed on once a colleague had told you *everything* they know. The
  manager knows the impact *and* the deadline, so learning only the impact (which is all the
  "Establish the impact" step needs) moved the path on but never ended the conversation.
- **Now:** the handoff also fires the moment the step you went to that person for is finished (the
  path stops pointing at them).
- **In a voice call** a banner shows the next step with a 6-second countdown (paused while the
  "told you" box is open). At 0 the call hangs up by itself and you're taken to the next person, or
  the office arrow points you to the next place. You can press the button to go sooner.
- **In text chat** the same countdown switches the chat to the next person; if the next step is a
  place, the card tells you where and the arrow shows the way.

## 26. Voice: a fact counts only when the colleague says it

In a voice call the colleague has already answered by the time your spoken question is saved, so
matching keywords in *your* question (as text chat does) claimed facts they never gave: you'd see
"Olivia told you …" while she said she didn't know. Voice now counts a fact only when the AI check
finds it in what the **colleague** actually said.

Why might she not know? Voice agents currently answer with ElevenLabs' built-in model, which only
has their role card, not the scenario facts. The facts reach them through the **Custom LLM bridge**
(`/v1/voice/llm-bridge`), which needs a public URL to this API (e.g. ngrok) set as each agent's
Custom LLM. Until that's connected, ask the voice colleague, then check the logs/tools, or use text
chat for exact numbers.

## 27. Shift complete: stats slideshow with victory music

The end card is now a short slideshow in the intro's style:
1. **SHIFT COMPLETE** slams in with a trumpet fanfare and timpani hit, then shrinks into a header.
2. One stat at a time, each slides in with a slash wipe and a trumpet call, stays about 3.6 seconds, then moves on:
   - **Mission cleared**: ring chart of objectives done, with the list ticking in.
   - **Clues found**: big count-up plus each fact stamped in as a tag.
   - **Who you talked to**: skewed bars per colleague (portrait + how many times you spoke to them, typed or voice).
   - **Time on shift**: minutes:seconds count-up.
3. **Finale**: team cards fan in, fanfare again, **INCIDENT RESOLVED** stamp.

Music switches to a new bright "victory" march (C major) for the whole card. **Next →** / Enter / → skips
to the next slide; Esc or **See your debrief →** leaves at any time. Dots under the chart show where you are.
Sounds and music are synthesized in `apps/web/lib/sfx.ts` (cues `fanfare`, `trumpet`; mood `victory`), no audio files.
Preview: `http://localhost:3000/intro-preview?end=1`.

## 28. A vague answer doesn't count as the exact fact

If a fact has numbers, times or percentages (e.g. "About 24% of checkouts are failing"), the colleague
now has to actually say at least one of them for it to count. "Checkout is failing for customers" no
longer unlocks the 24% fact, its popup, or "has told you what they know". (`says_specifics` in
`apps/api/app/services/fact_check.py`.)

## 29. Voice colleagues say the real numbers, hang up on goodbye; arrow keys don't scroll

- **They know their facts now.** When a call starts, the server sends the colleague the facts *they* may
  share (same rule as text chat: only their own facts, nothing locked behind something you haven't done
  yet), exact wording and numbers included, e.g. "About 31% of customer requests are failing". It goes into
  the agent's prompt slot `{{shared_facts}}` for that call only; it's never saved on the agent.
  The agent is told to say numbers and times exactly. Since the popup only appears when the colleague
  actually says the number (section 28), what you hear and the "told you" box now match.
- **They hang up.** When the conversation is wrapped up ("thanks", "I'm good"), the colleague says goodbye and
  ends the call with ElevenLabs' `end_call` tool. The app closes the call like the End button and moves on
  to the next step if there is one.
- Agents on both ElevenLabs accounts were updated with
  `uv run python scripts/create_voice_agents.py` (and `ELEVENLABS_ACCOUNT=2 …`). Settings only, no credits.
- **Arrow keys / space no longer scroll the page** while walking in the office (still work normally while typing
  in a field). `apps/web/game/office.ts`.

## 30. Every "told you" box shows the next step; Skip button

- **The dialogue box always routes you.** Under what the colleague told you there's now a yellow
  **Next ▶** line (e.g. "Inspect application logs in the Engineering workspace. Follow the arrow."
  or "Talk to Arjun, the teammate") and a button that does it: **Talk to Arjun** opens their chat,
  **Go there** closes the box so you follow the arrow. In a voice call the button is **End call · …**
  and hangs up first. **Stay** keeps you where you are.
- **Skip ▶ what they know.** In the chat panel and in a voice call there's a skip button: the colleague
  hands over everything they can share right now, the box shows it, and the Next line points you on.
  Skips are logged as `via: "skipped"` (not "asked"), so the debrief can tell the difference.
  API: `POST /v1/sessions/{id}/characters/{character_id}/skip`.
