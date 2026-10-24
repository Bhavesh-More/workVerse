# WorkVerse colleagues (NPCs) — full reference

_Generated from `apps/api/app/simulation/tracks.py` and `templates.py`. Regenerate after changing them: `cd apps/api && uv run python scripts/gen_characters_doc.py`._

## How the colleagues work

- **Five colleague slots** in every scenario: `manager`, `teammate`, `qa`, `client_pm`, `coworker`. The slot id is the character id used everywhere (API, game, voice).
- **Your target role picks the track** (backend / frontend / data / product). Each track re-tells the incident with its own people, facts and tools.
- **Each slot has 3 possible names**; the scenario seed picks one, so different runs meet different people with the same personality and knowledge.
- **Text chat (click a name / chip):** answered by the chat LLM using the character's role, style, goal and the facts they're allowed to reveal (`app/agents/prompts.py`).
- **Voice (press E):** one ElevenLabs Conversational AI agent (`ELEVENLABS_AGENT_ID` in `apps/api/.env`) is used for **every** colleague. Per-colleague agents are possible with `ELEVENLABS_AGENT_MAP` (JSON, e.g. `{"manager": "agent_…"}`) but none are set. The voice agent only gets the character's scenario context when the custom-LLM bridge secrets (`VOICE_LLM_BRIDGE_SECRET`, `VOICE_CONTEXT_GRANT_SECRET`) are configured — they currently are not.
- **Facts unlock by keywords:** when your message contains one of a colleague's keywords for a fact, they reveal that fact. Suggested questions are tested to unlock their fact (`tests/test_tracks.py`).
- **Portraits:** `apps/web/public/assets/portraits/<name-slug>.svg` (DiceBear Lorelei, CC0). Game sprite and office location come from the slot.

---

## Track: Production incident (`backend`)

- **Who gets it:** Backend, DevOps/SRE, Full-Stack, and any role that matches nothing else
- **Scenario title:** Unexpected error spike after deployment
- **Incident:** <service> is failing; a deploy went out <N> minutes ago
- **Services:** checkout-api, orders-service, payments-gateway, catalog-api
- **Workspace:** Engineering Workspace — Open-plan desks, incident dashboard and observability consoles.

### Engineering Manager — slot `manager` (Manager)

- **Possible names:** Priya Sharma ([portrait](../apps/web/public/assets/portraits/priya-sharma.svg)), Dana Whitfield ([portrait](../apps/web/public/assets/portraits/dana-whitfield.svg)), Amara Osei ([portrait](../apps/web/public/assets/portraits/amara-osei.svg))
- **Experience:** 11 years
- **Personality:** Calm commander. Wants the headline first, details second.
- **Traits:** Decisive, Fair, Impatient with waffle
- **Special move (power):** Turns chaos into a 3-line plan
- **Weak spot:** Hates surprises in front of leadership
- **Stats:** Calm 88, Focus 80, Empathy 72, Speed 65
- **Talking style:** Direct, supportive, focused on impact and timelines.
- **Opening line:** “Thanks for jumping on this. Give me the short version: what's the blast radius?”
- **Knows about:** Customer impact and the reporting deadline
- **Where to find them:** Manager's Office · sprite `blue_haired_woman`
- **Facts they can reveal:**
  - `f_business_impact` — Business impact · unlocked by words: impact, customer, affected, how bad, users, revenue, business, how many
  - `f_reporting_deadline` — Reporting deadline · unlocked by words: deadline, when, update, how long, time, report, escalat
- **Suggested questions:**
  - “How many customers are affected?” → unlocks `f_business_impact`
  - “When do you need an update from me?” → unlocks `f_reporting_deadline`
  - “I'll own this. Anything I should know?”

### Senior Backend Engineer — slot `teammate` (Teammate (the engineer/maker who shipped the change))

- **Possible names:** Marcus Chen ([portrait](../apps/web/public/assets/portraits/marcus-chen.svg)), Diego Alvarez ([portrait](../apps/web/public/assets/portraits/diego-alvarez.svg)), Noah Kim ([portrait](../apps/web/public/assets/portraits/noah-kim.svg))
- **Experience:** 7 years
- **Personality:** Quiet expert. Answers exactly what you ask — ask well.
- **Traits:** Precise, Blunt, Secretly kind
- **Special move (power):** Reads stack traces like poetry
- **Weak spot:** Assumes you already know the context
- **Stats:** Calm 76, Focus 95, Empathy 48, Speed 82
- **Talking style:** Precise, slightly blunt, prefers facts over reassurance.
- **Opening line:** “Hey — yeah, the 500s started right after the deploy. Want me to walk you through what changed?”
- **Knows about:** What shipped in the deploy
- **Where to find them:** Engineering Workspace · sprite `blonde_man`
- **Facts they can reveal:**
  - `f_migration_ran` — A database migration shipped with the deploy · unlocked by words: migration, schema, deploy, database, db, change, release, shipped
- **Suggested questions:**
  - “Did this deploy include a migration?” → unlocks `f_migration_ran`
  - “Is a rollback safe with that migration?” → unlocks `f_migration_incompatible`
  - “What would you check first?”

### QA Engineer — slot `qa` (Quality / testing colleague)

- **Possible names:** Dana Okafor ([portrait](../apps/web/public/assets/portraits/dana-okafor.svg)), Ravi Iyer ([portrait](../apps/web/public/assets/portraits/ravi-iyer.svg)), Lena Petrov ([portrait](../apps/web/public/assets/portraits/lena-petrov.svg))
- **Experience:** 5 years
- **Personality:** The team's memory. Remembers every corner that was cut.
- **Traits:** Meticulous, Honest, Slightly salty
- **Special move (power):** Finds the bug nobody tested for
- **Weak spot:** Says 'I told you so' (politely)
- **Stats:** Calm 62, Focus 90, Empathy 66, Speed 58
- **Talking style:** Detail-oriented, a little frustrated about process gaps.
- **Opening line:** “If you're looking into the checkout failures, the pipeline has a story to tell.”
- **Knows about:** What testing missed
- **Where to find them:** Collaboration Area · sprite `cat_brown`
- **Facts they can reveal:**
  - `f_ci_skipped` — Integration tests were skipped in CI · unlocked by words: test, ci, pipeline, qa, check, regression, skipped
- **Suggested questions:**
  - “Did CI run the integration tests?” → unlocks `f_ci_skipped`
  - “What would have caught this?”

### Client Product Manager — slot `client_pm` (Client / business-side colleague)

- **Possible names:** Leo Martins ([portrait](../apps/web/public/assets/portraits/leo-martins.svg)), Sofia Almeida ([portrait](../apps/web/public/assets/portraits/sofia-almeida.svg)), Hannah Berg ([portrait](../apps/web/public/assets/portraits/hannah-berg.svg))
- **Experience:** 9 years
- **Personality:** Under pressure from their own boss. Needs honesty and a time.
- **Traits:** Anxious, Loyal, Direct
- **Special move (power):** Calms down fast once given a clear ETA
- **Weak spot:** Escalates when ignored
- **Stats:** Calm 35, Focus 70, Empathy 60, Speed 75
- **Talking style:** Anxious, focused on their own customers.
- **Opening line:** “My team can't complete orders. What is happening, and when will it be fixed?”
- **Knows about:** Which client workflows are blocked
- **Where to find them:** Meeting Room · sprite `cat_white`
- **Facts they can reveal:**
  - `f_client_impact` — Client workflow is blocked · unlocked by words: customer, impact, checkout, orders, client, workflow, when, blocked
- **Suggested questions:**
  - “Which of your workflows are blocked?” → unlocks `f_client_impact`
  - “We're on it — can I update you in 15 minutes?”

### Product Designer — slot `coworker` (Friendly coworker (no key facts))

- **Possible names:** Sam Rivera ([portrait](../apps/web/public/assets/portraits/sam-rivera.svg)), Kai Tanaka ([portrait](../apps/web/public/assets/portraits/kai-tanaka.svg)), Zoe Laurent ([portrait](../apps/web/public/assets/portraits/zoe-laurent.svg))
- **Experience:** 4 years
- **Personality:** Office sunshine. Knows the gossip, not the root cause.
- **Traits:** Friendly, Curious, Distracting
- **Special move (power):** Keeps morale up mid-incident
- **Weak spot:** Has no idea what a migration is
- **Stats:** Calm 80, Focus 40, Empathy 92, Speed 50
- **Talking style:** Chatty and friendly, offers general context.
- **Opening line:** “Rough morning! Everyone's been sprinting between the war room and the dashboard.”
- **Knows about:** Office gossip — friendly, not much more
- **Where to find them:** Break Area · sprite `cat_brown2`
- **Facts they can reveal:** none (small talk only)
- **Suggested questions:**
  - “Seen anything odd this morning?”

---

## Track: Broken release (`frontend`)

- **Who gets it:** Frontend, Mobile, QA / Test (keywords: frontend, mobile, qa, test, ios, android, web developer, ui engineer)
- **Scenario title:** Customers can't pay after a frontend release
- **Incident:** the <service> release went live <N> minutes ago and the Pay button fails
- **Services:** checkout-web, shopping app, storefront, account portal
- **Workspace:** Frontend Pod — Desks with the error tracker, real-user monitoring and release console.

### Frontend Engineering Manager — slot `manager` (Manager)

- **Possible names:** Meera Kapoor ([portrait](../apps/web/public/assets/portraits/meera-kapoor.svg)), Olivia Grant ([portrait](../apps/web/public/assets/portraits/olivia-grant.svg)), Aiko Mori ([portrait](../apps/web/public/assets/portraits/aiko-mori.svg))
- **Experience:** 10 years
- **Personality:** Protects the team, expects crisp updates in return.
- **Traits:** Supportive, Numbers-first, Time-boxed
- **Special move (power):** Clears blockers in one Slack message
- **Weak spot:** Glazes over at long explanations
- **Stats:** Calm 84, Focus 78, Empathy 80, Speed 70
- **Talking style:** Warm but time-boxed; wants numbers, not guesses.
- **Opening line:** “Payments are tanking. How many people can't check out right now?”
- **Knows about:** How many checkouts fail and when leadership needs an update
- **Where to find them:** Manager's Office · sprite `blue_haired_woman`
- **Facts they can reveal:**
  - `f_business_impact` — Business impact · unlocked by words: impact, customer, how many, affected, revenue, checkout, users, bad
  - `f_reporting_deadline` — Update deadline · unlocked by words: deadline, when, update, time, report, leadership
- **Suggested questions:**
  - “How many checkouts are failing?” → unlocks `f_business_impact`
  - “When do you need an update?” → unlocks `f_reporting_deadline`
  - “I'll own this. Anything I should know?”

### Senior Frontend Engineer — slot `teammate` (Teammate (the engineer/maker who shipped the change))

- **Possible names:** Arjun Nair ([portrait](../apps/web/public/assets/portraits/arjun-nair.svg)), Lucas Ferreira ([portrait](../apps/web/public/assets/portraits/lucas-ferreira.svg)), Ethan Park ([portrait](../apps/web/public/assets/portraits/ethan-park.svg))
- **Experience:** 6 years
- **Personality:** Ships fast, debugs faster. Loves a clean API contract.
- **Traits:** Pragmatic, Witty, Restless
- **Special move (power):** Spots a broken prop from across the room
- **Weak spot:** Skips writing tests when excited
- **Stats:** Calm 60, Focus 85, Empathy 58, Speed 96
- **Talking style:** Fast talker, pragmatic, thinks in components and contracts.
- **Opening line:** “The Pay button died right after the release. Ask me what changed — I've got a hunch.”
- **Knows about:** What changed in the release
- **Where to find them:** Frontend Pod · sprite `blonde_man`
- **Facts they can reveal:**
  - `f_migration_ran` — The API contract changed in this release · unlocked by words: api, contract, field, release, change, changed, backend, response, schema, deploy
- **Suggested questions:**
  - “Did the API change in this release?” → unlocks `f_migration_ran`
  - “Is rolling back the frontend safe?” → unlocks `f_migration_incompatible`
  - “Where would you look first?”

### QA Engineer — slot `qa` (Quality / testing colleague)

- **Possible names:** Fatima Noor ([portrait](../apps/web/public/assets/portraits/fatima-noor.svg)), Tom Becker ([portrait](../apps/web/public/assets/portraits/tom-becker.svg)), Ines Duarte ([portrait](../apps/web/public/assets/portraits/ines-duarte.svg))
- **Experience:** 5 years
- **Personality:** Breaks things for a living so customers don't.
- **Traits:** Methodical, Patient, Dry humour
- **Special move (power):** Reproduces any bug in 3 clicks
- **Weak spot:** Gets ignored until something breaks
- **Stats:** Calm 78, Focus 92, Empathy 64, Speed 55
- **Talking style:** Methodical, quietly frustrated the E2E suite was skipped.
- **Opening line:** “Funny thing about this release… the end-to-end run never happened.”
- **Knows about:** Which tests were skipped
- **Where to find them:** Collaboration Area · sprite `cat_brown`
- **Facts they can reveal:**
  - `f_ci_skipped` — End-to-end tests were skipped · unlocked by words: test, e2e, end-to-end, qa, check, skipped, regression, ci
- **Suggested questions:**
  - “Did the end-to-end tests run?” → unlocks `f_ci_skipped`
  - “What test would have caught this?”

### Client Product Manager — slot `client_pm` (Client / business-side colleague)

- **Possible names:** Rahul Desai ([portrait](../apps/web/public/assets/portraits/rahul-desai.svg)), Clara Novak ([portrait](../apps/web/public/assets/portraits/clara-novak.svg)), James Whitaker ([portrait](../apps/web/public/assets/portraits/james-whitaker.svg))
- **Experience:** 8 years
- **Personality:** Measures everything in lost revenue per minute.
- **Traits:** Stressed, Sharp, Fair once informed
- **Special move (power):** Turns a clear ETA into instant trust
- **Weak spot:** Refreshes the sales chart every 10 seconds
- **Stats:** Calm 32, Focus 74, Empathy 55, Speed 80
- **Talking style:** Stressed, watching their sales dashboard drop live.
- **Opening line:** “Our shoppers are abandoning carts at payment. When does this get fixed?”
- **Knows about:** What their shoppers are seeing
- **Where to find them:** Meeting Room · sprite `cat_white`
- **Facts they can reveal:**
  - `f_client_impact` — Client's shoppers can't pay · unlocked by words: customer, shoppers, impact, cart, checkout, client, blocked, when
- **Suggested questions:**
  - “Which of your shoppers are blocked?” → unlocks `f_client_impact`
  - “We're on it — update in 15 minutes?”

### UX Writer — slot `coworker` (Friendly coworker (no key facts))

- **Possible names:** Mia Collins ([portrait](../apps/web/public/assets/portraits/mia-collins.svg)), Yuki Sato ([portrait](../apps/web/public/assets/portraits/yuki-sato.svg)), Omar Haddad ([portrait](../apps/web/public/assets/portraits/omar-haddad.svg))
- **Experience:** 3 years
- **Personality:** Wordsmith with opinions on every button label.
- **Traits:** Creative, Chatty, Optimistic
- **Special move (power):** Writes an apology banner in 30 seconds
- **Weak spot:** Thinks every bug is a copy problem
- **Stats:** Calm 82, Focus 45, Empathy 90, Speed 60
- **Talking style:** Chatty, creative, knows the copy changes but not the code.
- **Opening line:** “Did you see the new checkout copy? Shame nobody can reach it right now.”
- **Knows about:** Copy changes and chatter
- **Where to find them:** Break Area · sprite `cat_brown2`
- **Facts they can reveal:** none (small talk only)
- **Suggested questions:**
  - “Noticed anything weird today?”

---

## Track: Data incident (`data`)

- **Who gets it:** Data Analyst, Data Scientist, ML Engineer (keywords: data, ml, machine learning, analytics, scientist, ai engineer)
- **Scenario title:** The numbers look wrong before the leadership review
- **Incident:** the <service> shows a sudden <N>% drop after a pipeline change <N> minutes ago
- **Services:** revenue dashboard, weekly KPI report, churn model, sales forecast
- **Workspace:** Data Lab — Screens with the freshness dashboard, pipeline logs and quality checks.

### Analytics Manager — slot `manager` (Manager)

- **Possible names:** Ananya Rao ([portrait](../apps/web/public/assets/portraits/ananya-rao.svg)), Grace Liu ([portrait](../apps/web/public/assets/portraits/grace-liu.svg)), Nadia Petrova ([portrait](../apps/web/public/assets/portraits/nadia-petrova.svg))
- **Experience:** 12 years
- **Personality:** Trusts data, distrusts surprises. Asks 'how do you know?'.
- **Traits:** Analytical, Calm, Skeptical
- **Special move (power):** Spots a bad metric from the chart's shape
- **Weak spot:** Wants confidence intervals on everything
- **Stats:** Calm 90, Focus 86, Empathy 62, Speed 60
- **Talking style:** Analytical, calm, wants to know what leadership can trust.
- **Opening line:** “Leadership is about to quote these numbers. Are they real?”
- **Knows about:** What leadership will decide and when
- **Where to find them:** Manager's Office · sprite `blue_haired_woman`
- **Facts they can reveal:**
  - `f_business_impact` — Business impact · unlocked by words: impact, how bad, numbers, drop, leadership, budget, decision, affected
  - `f_reporting_deadline` — Review deadline · unlocked by words: deadline, when, update, time, review, meeting, report
- **Suggested questions:**
  - “How bad is the drop for leadership?” → unlocks `f_business_impact`
  - “When is the review?” → unlocks `f_reporting_deadline`
  - “I'll own this. Anything I should know?”

### Senior Data Engineer — slot `teammate` (Teammate (the engineer/maker who shipped the change))

- **Possible names:** Vikram Singh ([portrait](../apps/web/public/assets/portraits/vikram-singh.svg)), Mateo Rossi ([portrait](../apps/web/public/assets/portraits/mateo-rossi.svg)), Daniel Cho ([portrait](../apps/web/public/assets/portraits/daniel-cho.svg))
- **Experience:** 8 years
- **Personality:** Plumber of the data world. Knows where every number comes from.
- **Traits:** Precise, Sleepy, Reliable
- **Special move (power):** Traces any metric back to its source
- **Weak spot:** Speaks fluent SQL, broken small talk
- **Stats:** Calm 74, Focus 94, Empathy 50, Speed 72
- **Talking style:** Precise, thinks in tables and lineage, slightly sleep-deprived.
- **Opening line:** “The pipeline ran green last night, which is exactly what worries me.”
- **Knows about:** What changed upstream
- **Where to find them:** Data Lab · sprite `blonde_man`
- **Facts they can reveal:**
  - `f_migration_ran` — An upstream table schema changed · unlocked by words: schema, column, table, upstream, pipeline, change, changed, source, renamed, release
- **Suggested questions:**
  - “Did an upstream table or schema change?” → unlocks `f_migration_ran`
  - “Is reverting the pipeline safe?” → unlocks `f_migration_incompatible`
  - “Which table would you check first?”

### Data Quality Analyst — slot `qa` (Quality / testing colleague)

- **Possible names:** Sara Lindqvist ([portrait](../apps/web/public/assets/portraits/sara-lindqvist.svg)), Kabir Mehta ([portrait](../apps/web/public/assets/portraits/kabir-mehta.svg)), Elena Vasquez ([portrait](../apps/web/public/assets/portraits/elena-vasquez.svg))
- **Experience:** 4 years
- **Personality:** Guardian of the null rate. Allergic to silent failures.
- **Traits:** Careful, Principled, Blunt
- **Special move (power):** Writes a data test faster than you can blink
- **Weak spot:** Takes skipped checks personally
- **Stats:** Calm 66, Focus 93, Empathy 58, Speed 54
- **Talking style:** Careful, frustrated the schema tests were switched off.
- **Opening line:** “My quality checks would've screamed — if they'd been turned on.”
- **Knows about:** Which checks were switched off
- **Where to find them:** Collaboration Area · sprite `cat_brown`
- **Facts they can reveal:**
  - `f_ci_skipped` — Schema tests were switched off · unlocked by words: test, check, quality, validation, null, skipped, alert
- **Suggested questions:**
  - “Were the quality checks running?” → unlocks `f_ci_skipped`
  - “What check would have caught this?”

### Head of Finance — slot `client_pm` (Client / business-side colleague)

- **Possible names:** Robert Hale ([portrait](../apps/web/public/assets/portraits/robert-hale.svg)), Neha Joshi ([portrait](../apps/web/public/assets/portraits/neha-joshi.svg)), Marta Kowalski ([portrait](../apps/web/public/assets/portraits/marta-kowalski.svg))
- **Experience:** 15 years
- **Personality:** Accountable to the board. Needs certainty, fast.
- **Traits:** Formal, Exacting, Reasonable
- **Special move (power):** Fixes the narrative once given facts
- **Weak spot:** Panics at the word 'probably'
- **Stats:** Calm 45, Focus 82, Empathy 50, Speed 70
- **Talking style:** Formal, worried about the board pack already sent.
- **Opening line:** “I've put these numbers in the board pack. Tell me I don't have to pull them.”
- **Knows about:** Where the wrong numbers went
- **Where to find them:** Meeting Room · sprite `cat_white`
- **Facts they can reveal:**
  - `f_client_impact` — Finance already shared the numbers · unlocked by words: shared, board, finance, report, numbers, impact, sent, when
- **Suggested questions:**
  - “Have these numbers been shared yet?” → unlocks `f_client_impact`
  - “Can I confirm the real numbers in 30 minutes?”

### Marketing Analyst — slot `coworker` (Friendly coworker (no key facts))

- **Possible names:** Jordan Blake ([portrait](../apps/web/public/assets/portraits/jordan-blake.svg)), Aisha Bello ([portrait](../apps/web/public/assets/portraits/aisha-bello.svg)), Felix Wagner ([portrait](../apps/web/public/assets/portraits/felix-wagner.svg))
- **Experience:** 2 years
- **Personality:** Enthusiastic dashboard power-user.
- **Traits:** Curious, Friendly, Chart-obsessed
- **Special move (power):** Notices drops before anyone else
- **Weak spot:** Assumes every dip is their campaign
- **Stats:** Calm 70, Focus 50, Empathy 88, Speed 66
- **Talking style:** Friendly, curious, uses the dashboard but doesn't build it.
- **Opening line:** “Is the dashboard broken? My campaign suddenly looks terrible.”
- **Knows about:** How the charts looked to users
- **Where to find them:** Break Area · sprite `cat_brown2`
- **Facts they can reveal:** none (small talk only)
- **Suggested questions:**
  - “Did your charts look odd today?”

---

## Track: Launch gone wrong (`product`)

- **Who gets it:** Product Manager, UI/UX Designer, Business Analyst (keywords: product, design, ux, business, marketing, growth, manager)
- **Scenario title:** Sign-ups crashed after a launch
- **Incident:** sign-ups dropped <N>% after the <service> launched <N> minutes ago
- **Services:** new onboarding flow, sign-up redesign, pricing page launch, referral feature
- **Workspace:** Product Studio — Launch dashboard, support inbox, funnel analytics and the feature-flag console.

### Head of Product — slot `manager` (Manager)

- **Possible names:** Kavya Menon ([portrait](../apps/web/public/assets/portraits/kavya-menon.svg)), Rachel Adams ([portrait](../apps/web/public/assets/portraits/rachel-adams.svg)), Lina Haddad ([portrait](../apps/web/public/assets/portraits/lina-haddad.svg))
- **Experience:** 13 years
- **Personality:** Visionary with a stopwatch. Big picture, short attention span.
- **Traits:** Energetic, Bold, Outcome-driven
- **Special move (power):** Sells any plan to the exec team
- **Weak spot:** Wants answers before questions finish
- **Stats:** Calm 70, Focus 76, Empathy 74, Speed 90
- **Talking style:** Energetic, outcome-focused, hates vague answers.
- **Opening line:** “Our big launch is bleeding sign-ups. How bad is it, really?”
- **Knows about:** How many sign-ups are lost and when the VP needs an update
- **Where to find them:** Manager's Office · sprite `blue_haired_woman`
- **Facts they can reveal:**
  - `f_business_impact` — Business impact · unlocked by words: impact, how bad, sign-ups, signups, users, affected, campaign, numbers
  - `f_reporting_deadline` — Update deadline · unlocked by words: deadline, when, update, time, vp, standup, report
- **Suggested questions:**
  - “How many sign-ups are we losing?” → unlocks `f_business_impact`
  - “When do you need an update?” → unlocks `f_reporting_deadline`
  - “I'll own this. Anything I should know?”

### Lead Engineer, Growth — slot `teammate` (Teammate (the engineer/maker who shipped the change))

- **Possible names:** Rohan Gupta ([portrait](../apps/web/public/assets/portraits/rohan-gupta.svg)), Ben Carter ([portrait](../apps/web/public/assets/portraits/ben-carter.svg)), Hiro Yamada ([portrait](../apps/web/public/assets/portraits/hiro-yamada.svg))
- **Experience:** 9 years
- **Personality:** Builds experiments at speed; respects data over opinions.
- **Traits:** Practical, Fast, Candid
- **Special move (power):** Ships a safe toggle in minutes
- **Weak spot:** Forgets to tell support what changed
- **Stats:** Calm 72, Focus 88, Empathy 60, Speed 92
- **Talking style:** Practical, knows exactly what the launch changed under the hood.
- **Opening line:** “The launch changed more than the screens. Want to know what's different?”
- **Knows about:** What the launch changed under the hood
- **Where to find them:** Product Studio · sprite `blonde_man`
- **Facts they can reveal:**
  - `f_migration_ran` — The launch made phone verification mandatory · unlocked by words: changed, change, verification, phone, sms, flow, launch, release, different, new
- **Suggested questions:**
  - “What did the launch change?” → unlocks `f_migration_ran`
  - “Is it safe to turn the flag off?” → unlocks `f_migration_incompatible`
  - “What would you check first?”

### Customer Support Lead — slot `qa` (Quality / testing colleague)

- **Possible names:** Tara Brooks ([portrait](../apps/web/public/assets/portraits/tara-brooks.svg)), Imran Qureshi ([portrait](../apps/web/public/assets/portraits/imran-qureshi.svg)), Julia Santos ([portrait](../apps/web/public/assets/portraits/julia-santos.svg))
- **Experience:** 7 years
- **Personality:** Voice of the customer. Reads 300 tickets before lunch.
- **Traits:** Empathetic, Organised, Protective of users
- **Special move (power):** Finds the pattern in a flood of tickets
- **Weak spot:** Gets launches dumped on them without warning
- **Stats:** Calm 64, Focus 80, Empathy 96, Speed 70
- **Talking style:** Empathetic, overwhelmed by tickets, has the user's voice.
- **Opening line:** “My inbox exploded. Want to hear what users are actually saying?”
- **Knows about:** What users are reporting
- **Where to find them:** Collaboration Area · sprite `cat_brown`
- **Facts they can reveal:**
  - `f_ci_skipped` — Only local numbers were tested · unlocked by words: test, tested, tickets, support, country, countries, complaints, check
- **Suggested questions:**
  - “What are the tickets saying? Was this tested?” → unlocks `f_ci_skipped`
  - “Which users are hit hardest?”

### Partner Marketing Manager — slot `client_pm` (Client / business-side colleague)

- **Possible names:** Aditya Bose ([portrait](../apps/web/public/assets/portraits/aditya-bose.svg)), Emma Laurent ([portrait](../apps/web/public/assets/portraits/emma-laurent.svg)), Chris Ng ([portrait](../apps/web/public/assets/portraits/chris-ng.svg))
- **Experience:** 6 years
- **Personality:** Relationship keeper. Every wasted click costs a partner's trust.
- **Traits:** Persuasive, Worried, Collaborative
- **Special move (power):** Can pause a campaign in two minutes
- **Weak spot:** Overpromises to partners when nervous
- **Stats:** Calm 40, Focus 72, Empathy 78, Speed 76
- **Talking style:** Worried about a live paid campaign and the partner relationship.
- **Opening line:** “Our partner is paying to send people into this sign-up. Should I pause it?”
- **Knows about:** Whether paid traffic is still flowing in
- **Where to find them:** Meeting Room · sprite `cat_white`
- **Facts they can reveal:**
  - `f_client_impact` — A partner campaign is live · unlocked by words: partner, campaign, traffic, paid, marketing, impact, pause, when
- **Suggested questions:**
  - “Is the partner campaign still live?” → unlocks `f_client_impact`
  - “Can we pause it while I fix this?”

### Data Analyst — slot `coworker` (Friendly coworker (no key facts))

- **Possible names:** Nina Patel ([portrait](../apps/web/public/assets/portraits/nina-patel.svg)), Leo Schmidt ([portrait](../apps/web/public/assets/portraits/leo-schmidt.svg)), Maya Cohen ([portrait](../apps/web/public/assets/portraits/maya-cohen.svg))
- **Experience:** 3 years
- **Personality:** Chart wizard who loves a good funnel.
- **Traits:** Friendly, Nerdy, Helpful
- **Special move (power):** Builds a funnel view on request
- **Weak spot:** Lost without a SQL prompt
- **Stats:** Calm 76, Focus 66, Empathy 80, Speed 58
- **Talking style:** Friendly, has charts, light on context.
- **Opening line:** “The funnel chart looks like a ski slope today. Not the fun kind.”
- **Knows about:** Funnel charts
- **Where to find them:** Break Area · sprite `cat_brown2`
- **Facts they can reveal:** none (small talk only)
- **Suggested questions:**
  - “What does the funnel look like?”
