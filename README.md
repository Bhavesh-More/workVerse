# WorkVerse AI

An AI-powered 2D workplace simulator. Learners enter a virtual office, interact with
AI-controlled managers and teammates, complete a realistic workplace scenario, and receive
an evidence-grounded debrief that cites their own transcript and actions.

**Core loop:** profile → scenario selection → validated scenario → enter the office →
interact with characters and objects → complete the challenge → evidence-grounded debrief →
review progress → retry a variant.

This repository is a pnpm + Turborepo monorepo containing:

- `apps/web` — Next.js App Router frontend, the Phaser 3 office game, and the Playwright E2E tests.
- `apps/api` — FastAPI backend: auth verification, scenario validation, authoritative
  simulation state, hosted Ollama Cloud AI orchestration, and evaluation.
- `packages/*` — existing shared UI / eslint / TypeScript configs.
- `supabase/` — SQL schema and migrations.
- `infra/` — local MinIO compose file (optional).
- `assets/` — the supplied art packs (Neko Office, PixelSerial RPG characters) and license.
- `scripts/build_office_map.py` — deterministic generator for the office: baked floor/wall layers,
  the prop atlas and `map.json` (collision, props, NPC/object slots). Art lives in
  `scripts/office_art.py` (one palette, 16px tiles, exported at 2x so the engine never scales).
- `scripts/build_characters.py` — recolours the PixelSerial bases into the gender-matched cast
  (`player`, `m1`–`m5`, `f1`–`f5`) and packs the Neko cats as ambient pets.

## Architecture in one paragraph

FastAPI is authoritative: it owns session ownership, scenario rules, allowed actions,
objective completion, event/transcript persistence, and evaluation. Phaser is a
presentation/input layer only. Every consequential action is re-validated on the server and
committed through deterministic code; model output is parsed into Pydantic models and never
trusted directly. All AI inference is remote (hosted Ollama Cloud) — no local model ever runs.
Identity is provided by **Clerk** (verified server-side against the instance JWKS); Supabase is
used only as the PostgreSQL database, and internal profile rows are keyed by a `clerk_user_id`.

## Prerequisites

- Node.js ≥ 20 (repo engines target ≥ 24; Node 22 works for the web app)
- pnpm (this repo pins `pnpm@11.25.0`)
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Docker (only for the optional MinIO container)
- A Clerk application (publishable + secret keys), a Supabase project (database only), and an
  Ollama Cloud API key

## Setup

1. Install JavaScript dependencies:

   ```sh
   pnpm install
   ```

2. Configure environment files (see `.env.example`):

   ```sh
   cp .env.example apps/web/.env.local   # NEXT_PUBLIC_* values + Clerk keys
   cp .env.example apps/api/.env         # server secrets (Clerk, DB, Ollama)
   ```

   `apps/web/.env.local` may only contain public values plus the Clerk secret key (used by
   Next middleware; never exposed to the browser). Server secrets go in `apps/api/.env`.

3. Apply the database schema to your Supabase project (database only — identity is Clerk):

   ```sh
   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
   psql "$DATABASE_URL" -f supabase/migrations/0002_clerk_identity.sql
   psql "$DATABASE_URL" -f supabase/migrations/0003_voice_sessions.sql
   psql "$DATABASE_URL" -f supabase/migrations/0004_company_assessments.sql
   psql "$DATABASE_URL" -f supabase/migrations/0005_company_worlds.sql
   psql "$DATABASE_URL" -f supabase/migrations/0006_judge_roster.sql
   psql "$DATABASE_URL" -f supabase/migrations/0007_notifications.sql
   ```

   Use a plain `postgresql://` URL (drop `+asyncpg`). The files are safe to re-run. If
   `db.<ref>.supabase.co` doesn't resolve (it is IPv6-only), use the IPv4 session pooler instead:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.

4. Sync the Python environment:

   ```sh
   cd apps/api && uv sync && cd ../..
   ```

## Run

```sh
pnpm dev            # starts apps/web (3000) and apps/api (8000) via Turbo
```

Optional local object storage (private bucket, loopback only):

```sh
docker compose -f infra/docker-compose.minio.yml --env-file .env up
```

## Verify

```sh
pnpm lint           # ESLint (web) + Ruff (api)
pnpm check-types    # Next.js typegen + tsc, Ruff for api
pnpm test           # pytest (unit)
pnpm --filter web build
pnpm test:e2e       # Playwright: full learner journey (requires web+api+Supabase+Ollama)
```

Backend integration test against live services:

```sh
cd apps/api && WORKVERSE_LIVE=1 uv run pytest tests/test_integration_live.py
```

## Hosted inference only

The backend calls `https://ollama.com/v1` with a server-side Bearer token. The base URL is
validated at startup against an allow-list; `http://localhost:11434` and other local
endpoints are rejected by configuration, and no code path falls back to local inference.
Multiple keys in `OLLAMA_API_KEYS` rotate automatically when one is rate limited.

## Company assessments

Companies sign in at `/company/login` and run hiring rounds on top of the same simulation:

- **Topics** — a title and description (or **Fill with sample**), plus optional role track, problem
  and difficulty. The description becomes the candidate's brief.
- **AI judges** — the five colleagues. Set company-wide defaults under *AI judges* and override them
  per topic: tone, how demanding (1–5), what they probe for, opening line. Names are picked from the
  existing cast so portraits and voices match. Settings are written into the scenario blueprint and
  shape both chat and voice replies; judges a company hasn't touched behave exactly as before.
- **Assessments & invites** — pick a topic, then invite candidates by typing, pasting a list or
  uploading a CSV (`email` column, optional `name` or first/last name). Invites are emailed through
  the company's SMTP server (Settings, with a test button) or the fallback `SMTP_*` settings.
- **Candidates** open `/invite/<token>`, sign up or log in, and play. Their debrief notes that the
  report is shared with the company.
- **Results** — pipeline, recommendation bands, score distribution, skill averages, ranking, a
  per-candidate report (skills vs group, evidence quotes, transcript), and **PDF** (written for HR:
  summary, shortlist, charts, one page per candidate, glossary) and **CSV** exports.
- **Candidates** — everyone invited to any assessment in one list, with search, assessment/status/band
  filters, cohort charts and company-wide CSV/PDF exports.

E2E: `pnpm --filter web exec playwright test e2e/company-assessment.spec.ts` (needs mailpit on
127.0.0.1:1025/8025 in addition to web, api, database and Ollama).

If the repo moves on disk, rebuild the Python env (`rm -rf apps/api/.venv && uv sync --all-groups`
in `apps/api`): its launch scripts embed the old path and `uv run uvicorn` falls back to a global
Python otherwise.

## Virtual workplace builder

Companies can keep the ready-made office or design their own (`/company/workplace`).

**Journey.** After creating a company, admins choose *Build your workplace* or *Use the default
workplace* (reversible; asked once). The custom path picks from six editable room presets (open-plan
office, meeting room, reception, executive offices, engineering & operations lab with the incident
tools, breakout lounge), reviews participants (5 AI judges, display-only team members, real company
accounts — kept distinct), then opens the editor with a generated layout: rooms in two rows along a
corridor, each with a doorway, people auto-placed on reachable tiles.

**Editor** (`/company/workplace/editor`): a canvas that renders the real tiles and sprites under a
pan/zoom camera with a grid locked to world tiles; drag from the library with live valid/invalid
footprints (or click to place), snapping per asset type (free placement for furniture with snap off),
select / shift-select / marquee, move by drag or arrows, inspector editing, room move + resize
handles, rename/purpose/floor/paint, duplicate room, floor brush, wall brush, doorway tool, room tool,
undo/redo, copy/paste, minimap, walkability overlay, live world check (errors block publishing,
warnings don't; click to jump), autosave with version conflicts, play-test in the real engine, and a
publish review. Publishing snapshots the draft; new candidate sessions copy the published world into
their scenario, so later edits never change a run in progress.

**How it fits together.**
- `scripts/build_world_kit.py` exports the existing art as reusable pieces — floor patches, wall caps
  per neighbour mask, wall faces per paint, and a catalog atlas of 73 assets with footprint / mount /
  solid / interactive metadata (`apps/web/public/assets/game/kit/`, catalog also copied to
  `apps/api/app/world/catalog.json`). Re-run it after changing `scripts/office_art.py`.
- `apps/web/lib/world/`: `WorldDoc` (floor grid + rooms + placed objects + people placements +
  spawn), pure document operations, `compileWorld` (walls derived from floors exactly like the default
  office, collision, NPC/object slots), the canvas renderer shared by editor and game, placement rules,
  validation with flood-fill reachability, presets and auto-layout. Unit tests: `node --test
  lib/world/world.test.ts`.
- People placements reference identities (`judge:<slot>`, `member:<id>`, `pet:<sprite>`); identities
  live in AI judges / team members and are never rewritten by moving someone.
- `apps/api/app/world` validates every save (schema, catalog asset ids, bounds, unique ids, person
  refs) and gates publishing (spawn, wall mounts, duplicates, reachability). `/company/workplace`
  endpoints are scoped to the caller's company; drafts carry a version and stale saves get 409.
- `game/office.ts` renders a compiled custom world (kit floors/walls drawn once into textures at 1:1,
  props y-sorted, team members as ambient NPCs); without one it uses the default baked map.

E2E: `playwright test e2e/workplace.spec.ts e2e/workplace-visual.spec.ts`. The specs reuse existing
`e2e*` Clerk test accounts (`e2e/users.ts`) because development instances are capped at 100 users.

## Real-time voice

Walk to a character and press **E** to hold a live voice conversation (ElevenAgents over WebRTC).
Reasoning runs through a FastAPI OpenAI-compatible bridge so per-turn scenario context is
injected server-side; the exact finalized NPC words appear in the bottom-right transcript and
feed the evidence-grounded debrief. The browser never receives any provider key.

- Owner setup: `docs/elevenagents-setup.md`
- Design decision: `docs/adr/0001-elevenagents-ollama-voice.md`
- API contracts: `docs/api-contracts-voice.md`

## Documentation

- **What's new (Evidence Ledger, coaching, charts, SFX, bug fixes): `docs/IMPROVEMENTS.md`** — start here.
- Design system: `../workverse-ai-docs/docs/DESIGN.md` (calm editorial, JetBrains Mono, grid).
- Supplied product/architecture docs: `../workverse-ai-docs/`.
- Known limitations and decisions: `docs/LIMITATIONS.md`.

## Assets and licenses

- Neko Office Asset Pack (free assets) — used for tiles and furniture.
- PixelSerial "RPG Top Down Character Asset Pack" — human character sprites; see
  `assets/RPG_LICENSE.txt` (free for personal and commercial use; do not redistribute the
  assets themselves).
