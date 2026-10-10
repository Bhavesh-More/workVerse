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
- `scripts/build_office_map.py` — deterministic generator for the office map layers.

## Architecture in one paragraph

FastAPI is authoritative: it owns session ownership, scenario rules, allowed actions,
objective completion, event/transcript persistence, and evaluation. Phaser is a
presentation/input layer only. Every consequential action is re-validated on the server and
committed through deterministic code; model output is parsed into Pydantic models and never
trusted directly. All AI inference is remote (hosted Ollama Cloud) — no local model ever runs.

## Prerequisites

- Node.js ≥ 20 (repo engines target ≥ 24; Node 22 works for the web app)
- pnpm (this repo pins `pnpm@11.25.0`)
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Docker (only for the optional MinIO container)
- A Supabase project and an Ollama Cloud API key

## Setup

1. Install JavaScript dependencies:

   ```sh
   pnpm install
   ```

2. Configure environment files (see `.env.example`):

   ```sh
   cp .env.example apps/web/.env.local   # then edit the NEXT_PUBLIC_* values
   cp .env.example apps/api/.env         # then edit the server secrets
   ```

   `apps/web/.env.local` may only contain the public Supabase URL/publishable key and the API
   base URL. Server secrets (service/secret key, database URL, Ollama key) go in
   `apps/api/.env` and are never exposed to the browser.

3. Apply the database schema to your Supabase project:

   ```sh
   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
   ```

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

## Documentation

- Design system: `../workverse-ai-docs/docs/DESIGN.md` (calm editorial, JetBrains Mono, grid).
- Supplied product/architecture docs: `../workverse-ai-docs/`.
- Known limitations and decisions: `docs/LIMITATIONS.md`.

## Assets and licenses

- Neko Office Asset Pack (free assets) — used for tiles and furniture.
- PixelSerial "RPG Top Down Character Asset Pack" — human character sprites; see
  `assets/RPG_LICENSE.txt` (free for personal and commercial use; do not redistribute the
  assets themselves).
