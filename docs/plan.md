# WorkVerse AI — Implementation Plan

**Planning basis:** existing fresh Turborepo, pnpm, existing Next.js app in `apps/web`, FastAPI backend to be added, Supabase PostgreSQL supplied by the project owner, MinIO-compatible private object storage.  
**Plan style:** vertical slices; the first demo should prove one coherent scenario, not a wide collection of incomplete screens.

## 1. Delivery strategy

Build a thin end-to-end product first:

**Profile -> choose scenario -> generate/validate blueprint -> start session -> navigate to a functional room/object -> send message -> receive adaptive character response -> persist events/state -> end session -> receive evidence-grounded debrief -> retry a variant.**

This single path is the MVP milestone. Build a second and third scenario only after the first path is testable. Voice, highly autonomous multi-agent behavior, large maps, arbitrary coding sandboxes, job-matching analytics, and high-stakes employer scoring are not prerequisites.

### P0 — required for a credible demo
- Existing Next.js shell retained and updated rather than replaced.
- Supabase Auth integration or a clearly documented development auth path; production routes require verified identity.
- Profile fields and user-supplied skill/role/experience information.
- One validated production-incident scenario family with controlled variation.
- Compact Phaser 3 map with three useful areas, keyboard/click navigation, and object interactions.
- FastAPI scenario/session/turn APIs and PostgreSQL persistence.
- One role-selected character turn at a time, shared authoritative state, allowed actions and deterministic transition rules.
- Transcript + event trail with stable identifiers.
- Evaluation report using a frozen rubric, verified evidence references, and an insufficient-evidence state.
- Auth/owner checks, input validation, test suite, `.env.example`, and setup documentation.

### P1 — high value after P0 is stable
- Client discovery and code-review scenario families.
- User document upload and structured profile fact extraction.
- Session history, retries and progress view.
- Async job processing for expensive scenario generation/evaluation if measured request time warrants it.
- Text-to-speech/speech-to-text with transcript correction and modality-aware scoring.
- Admin/reviewer tools for inspecting invalid scenarios and sampled reports.

### P2 — only after evidence justifies complexity
- Fully autonomous agent-to-agent interactions or simulation of an entire company.
- Large explorable office, multiple floors, rich animations or real-time multiplayer.
- Vector database / long-term semantic retrieval, reinforcement learning for difficulty selection, custom model fine-tuning.
- Automated employer-facing candidate ranking or claims that a score predicts job success.
- A production-grade code execution sandbox. If later added, run it in an isolated, resource-limited service with no access to secrets or internal networks.

## 2. Repo integration — preserve the current Turborepo

The repo currently has an `apps/web` Next.js app and shared packages. Do not scaffold a second monorepo. First inspect:

```bash
pwd
git status --short
cat package.json
cat pnpm-workspace.yaml
cat turbo.json
cat apps/web/package.json
```

Make a branch before changes. Keep the existing pnpm lockfile and use pnpm commands for JS dependencies. Add `apps/api` as a Turbo workspace package by giving it a minimal `package.json` with scripts that invoke `uv` commands. The Python package itself is managed by `apps/api/pyproject.toml` and `uv.lock`; pnpm does not manage Python dependencies.

### Recommended layout additions

```text
apps/
  web/                              # preserve existing Next.js code
    app/
    components/
    game/                           # Phaser scenes, entities, map and event bridge
    lib/                            # typed API client, Supabase auth client, schemas
  api/
    package.json                    # Turborepo script wrapper
    pyproject.toml                  # Python dependencies and tooling
    uv.lock
    app/
      main.py
      api/v1/
      core/
      db/
      schemas/
      repositories/
      services/
      simulation/
      agents/
      evaluation/
    tests/
docs/
supabase/
infra/
```

Suggested dependencies are documented in `architecture.md`. Use the current existing versions as the starting point; do not update the entire frontend toolchain while implementing the backend unless a compatibility issue forces it.

## 3. Phase plan

Durations are planning estimates for one student developer or a small team; they are not guarantees. Shift phase boundaries based on test findings and coursework/hackathon constraints.

### Phase 0 — inspect, align, and decide
**Goal:** preserve the repository and clarify high-risk choices before implementing features.

Tasks:
1. Confirm the root pnpm/Turbo setup and existing app scripts.
2. Add this documentation set and update the root README without deleting the existing setup notes until merged.
3. Agree on the environment variable scheme and choose an approved, pinned MinIO image/distribution after reviewing current maintenance/license status.
4. Create the `apps/api` Python project with `uv`, a FastAPI health endpoint, settings model, structured logging, and pytest.
5. Decide whether auth is Supabase Auth from the browser. Recommended: yes, with access tokens verified by FastAPI. Avoid shipping a fake production auth path.

**Exit checks:** root `pnpm install` works without lockfile churn unrelated to planned changes; `pnpm --filter @workverse/web dev` (or current app filter) still starts; FastAPI `/health/live` works; no secrets are tracked.

### Phase 1 — monorepo and local development
**Goal:** one command starts frontend, backend, and object storage in development.

Tasks:
1. Add `apps/api/package.json` scripts (`dev`, `test`, `lint`, `format`, `typecheck` as applicable) that call `uv run` commands from the Python workspace.
2. Add Turbo task definitions carefully to the existing `turbo.json`; retain cache behavior for build/lint/test tasks and disable inappropriate caching for long-running `dev` tasks.
3. Add `.env.example`; document how to create `apps/web/.env.local`, `apps/api/.env`, and the root `.env` for Compose. Keep actual environment files ignored.
4. Add `infra/docker-compose.minio.yml`. It must require an explicitly configured image, use persistent local volume, private credentials, local-only ports, and health checks where supported.
5. Add `GET /health/live` and `GET /health/ready`; readiness checks should not dump secrets or expose connection strings.
6. Add CI-quality baseline: Ruff, pytest, TypeScript checking, ESLint; avoid adding a formatter/linter dependency when one already exists.

**Exit checks:** `pnpm dev` starts web/API using Turbo; MinIO can be started separately; root README explains all commands; environment values are not committed.

### Phase 2 — data model, authentication, and profile
**Goal:** durable, private user profile data.

Tasks:
1. Add SQL migrations/schema in `supabase/schema.sql`; version changes as migrations once the schema evolves.
2. Implement async PostgreSQL connection management and transaction helpers. Keep a clear runtime database role and migration role distinction where feasible.
3. Implement Supabase access-token verification using issuer, signature/JWKS or supported project mechanism, expiry and applicable audience checks. Never just base64-decode a JWT.
4. Implement `GET /api/v1/me`, `PATCH /api/v1/me`, and skill CRUD or profile array normalization.
5. Enforce user ownership in every repository/service. Add unauthorized, forbidden, missing, and cross-user integration tests.
6. Build profile intake in the existing Next.js app: target role, education/experience, skills/stack, project context, self-reported proficiency and goals. Do not require a resume to use the product.

**Exit checks:** profile persists, another test user cannot read/update it, expired/invalid token is rejected, database constraints and test policies run.

### Phase 3 — validated scenario blueprint
**Goal:** create scenario content that is variable but not incoherent.

Tasks:
1. Define Pydantic models for `ScenarioBlueprint`, `CharacterBlueprint`, `Objective`, `Task`, `WorldLocation`, `ActionDefinition`, `Fact`, `Rubric`, and `ValidationIssue`.
2. Author one base production incident template with learning goals and anchored rubric. Version both separately.
3. Implement deterministic parameter generation first (seeded root cause/severity/stakeholder/context values) before using an LLM to narrate/expand it.
4. Add validation rules: all IDs unique, locations/characters referenced, required facts have a discovery mechanism, every criterion has evidence opportunities, valid terminal outcomes reachable, no contradictory deadlines/dependencies.
5. Add LLM-assisted generation only after the template flow works. Treat generated results as drafts and reject schema/semantic validator failures.
6. Persist immutable scenario version, generation metadata, variation seed, user profile snapshot with minimal necessary fields, and validation output.

**Exit checks:** fixed-seed generation is reproducible; malformed or invalid variants are rejected; generated scenarios always match one of the expected schema variants; failed generation falls back to a known good template.

### Phase 4 — authoritative simulation/session engine
**Goal:** one scenario can be completed through real actions and conversation.

Tasks:
1. Implement session lifecycle states: `created`, `active`, `processing`, `completed`, `abandoned`, `failed` as needed.
2. Define a small action registry with valid actions and preconditions: navigate, inspect logs, inspect deployment metadata, ask character, communicate status, propose rollback, create update, complete task.
3. Store a `state_version` and state snapshot; write event and updated snapshot in one transaction.
4. Add idempotency using `client_turn_id` or `Idempotency-Key`; retries must not duplicate state-changing events.
5. Add server-controlled character selection, knowledge scoping, current objective, and event-trigger rules.
6. Persist messages and events with stable IDs and sequence ordering.
7. Add session recovery API so refreshing the page reconstructs state/transcript.
8. Add concurrency tests so two simultaneous turns cannot both mutate the same session from the same version.

**Exit checks:** the scripted path from incident detection to resolution can be replayed in tests; invalid actions cannot resolve the scenario; a browser reload restores the last committed state; retrying a client request does not duplicate an event.

### Phase 5 — Phaser workplace and React interaction panel
**Goal:** make the core simulation tangible without letting movement block learning.

Tasks:
1. Build one compact office map with engineering workspace, manager area, and meeting room.
2. Use a Phaser client-only module mounted from a Client Component; do not instantiate Phaser during SSR.
3. Implement WASD/arrow movement and click-to-navigate/quick room shortcuts; add collision and interaction radius only if it improves comprehension.
4. Add hotspots for logs, task board, pull request, and characters. Each sends a typed intent to FastAPI.
5. Implement an event bridge between Phaser and React; React owns accessible chat/task UI, Phaser owns scene rendering. Keep bridge contracts typed.
6. Add alternative non-spatial controls to access every core action for keyboard and accessibility.
7. Display the current objective and relevant context; keep transcripts and action history visible in the interaction panel.

**Exit checks:** users can complete the scenario without needing to discover an undocumented keyboard command; hotspot events map to backend API calls; a browser refresh restores position or a safe location; keyboard-only users can complete the main task.

### Phase 6 — adaptive character dialogue and text streaming
**Goal:** make character interaction adaptive and coherent.

Tasks:
1. Add a provider-neutral LLM adapter with configurable model name, request timeout, token/output budget, and rate limit.
2. Build prompts from immutable persona, allowed facts, recent context, objectives, state summary, and action schema.
3. Use JSON-schema/Pydantic structured output for proposed actions and state-relevant response metadata. Revalidate the action in deterministic code.
4. Implement streamed POST turn responses (SSE format over `fetch` streaming) or use non-streamed responses initially if that avoids delaying the vertical slice. Persist only validated final assistant content as a completed message.
5. Add timeout handling, one bounded structured-output repair attempt, retry policy, and safe fallback. Never retry non-idempotent state mutation blindly.
6. Add off-topic recovery and fact-grounding tests; keep model temperature/settings and prompt versions recorded for regression analysis.
7. Test role/persona drift, knowledge leakage, prompt injection and a missing-fact path.

**Exit checks:** manager/client/teammate responses use consistent facts; hidden facts are not leaked until their conditions are met; LLM output cannot directly change arbitrary state; provider failures preserve session integrity.

### Phase 7 — debrief/evaluator and progress
**Goal:** deliver meaningful, traceable learning feedback.

Tasks:
1. Freeze rubric per scenario version and include criterion anchors and `insufficient_evidence` rules.
2. Create deterministic checks for objective events/results (for example, whether rollback preconditions were evaluated).
3. Ask the evaluator to reference known message/event/deliverable IDs and exact excerpts, plus explanation, counterevidence, and improvement action.
4. Validate score bounds, required criteria, evidence ownership, quote substring and report completeness. Reject unsupported claims.
5. Save evaluator version, model ID, rubric version, generation timestamp, validation warnings, and per-criterion result.
6. Build report UI with evidence links that jump to transcript turns; present scores as practice feedback, not job-hiring predictions.
7. Add a small hand-labelled dataset and human review sheet for calibration. Include concise and verbose paraphrases, ambiguous evidence and no-evidence examples.
8. Add session history and one retry with varied details/same learning objective.

**Exit checks:** every substantive score is evidence-linked or marked insufficient; fabricated IDs/quotes fail validation; report can be regenerated for an existing saved transcript; retries produce a new instance linked to the same scenario family.

### Phase 8 — documents, MinIO, and optional voice
**Goal:** selectively add additional inputs after the core scenario works.

Tasks:
1. Implement authenticated presigned upload, finalize, parse, status, and download endpoints.
2. Keep the bucket private and store object metadata, not public URLs. Verify ownership before issuing URLs.
3. Limit file size/extensions, check actual object size and type, use random keys, and treat extracted content as untrusted.
4. Build a fact-extraction model with source spans/source filename and require user confirmation for inferred profile claims.
5. For voice, add opt-in audio capture, transcription preview/correction, text pipeline reuse, TTS playback, interrupt handling if supported, and text fallback.
6. Store modality and transcript correction metadata. Do not score pronunciation/accent unless explicitly part of a validated learning objective.

**Exit checks:** cross-user object access is denied; incomplete uploads do not appear as ready documents; extraction cannot modify the system prompt; if voice transcription is wrong the user can correct it before evaluation.

### Phase 9 — hardening, user testing, and demo
**Goal:** demonstrate a stable product and learn where assumptions fail.

Tasks:
1. Run unit/integration/E2E/security/LLM regression tests.
2. Conduct a usability pilot and record task completion, navigation failures, time on task, and user-reported confusion.
3. Run a scenario validity batch, human-review failures, and document defects.
4. Compare AI scores with human rubric scores on a sample; analyze criterion-specific disagreement and style invariance.
5. Test prompt-injection files, cross-user ownership, invalid JWTs, oversized files, expired links, provider timeouts, and simultaneous turns.
6. Add usage limits and cost visibility before inviting more users.
7. Complete README, API docs, known-issues list, source/license notices and demo reset instructions.

**Exit checks:** no known critical authorization defect; no report contains unverified quotes; the core vertical slice passes from a clean environment setup; demo uses non-sensitive test profiles.

## 4. Suggested root commands

Adapt to existing package scripts; do not copy a new `package.json` over the current one.

```bash
# JavaScript workspace install
pnpm install

# Add/use Python project with uv in apps/api
cd apps/api
uv sync
cd ../..

# Start Turbo dev tasks
pnpm dev

# Run relevant checks as wired into existing turbo.json
pnpm lint
pnpm typecheck
pnpm test
```

Example `apps/api/package.json` script intentions (exact commands depend on `uv` version and the final working directory):
- `dev`: `uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
- `test`: `uv run pytest`
- `lint`: `uv run ruff check .`
- `format`: `uv run ruff format .`
- `typecheck`: `uv run mypy app` (optional if configured)

For the web app, preserve existing package scripts and add Phaser/API client code incrementally. Add Turbo task dependencies/outputs for builds and tests, but do not cache a long-running `dev` process.

## 5. Environment and local dependencies

Keep committed `.env.example` templates with placeholders only. Create actual local environment files (ignored by Git) using the setup table in `README.md`. Root Docker Compose uses root `.env`; Next.js reads `apps/web/.env.local`; the FastAPI `pydantic-settings` configuration reads `apps/api/.env`. Explicitly pass required variables through Turbo or run services in a way that their own process reads the app-level env file. Do not assume root dotenv loading automatically applies to every workspace.

`SUPABASE_URL` and the browser publishable key can be configured on the frontend. `DATABASE_URL`, migration connection strings, MinIO credentials, JWT verification details, and LLM keys belong only to the backend/runtime environment. Do not commit real secrets or include them in the ZIP.

### MinIO risk gate

Before using a MinIO Docker image, record its exact image tag/digest, source location, maintenance status, and license review in the project decision log. The MinIO community repository currently warns that it is no longer maintained and that community binaries are source-only. The Compose file intentionally requires an explicitly selected `MINIO_IMAGE`. A Docker container by itself does not resolve update/security or AGPL questions.

## 6. Test gates and definition of done

A feature is done only when all are true:
- Requirements/acceptance criterion exists and is linked to tests where practical.
- Success and expected failure behavior are tested.
- Authentication and object/session ownership are considered.
- State-changing actions are idempotent or explicitly non-retryable.
- Logs are useful but do not disclose secrets or unnecessary PII.
- User-visible errors explain safe next steps.
- Accessibility fallback exists for spatial-only controls.
- Documentation/manifest is updated.
- No unresolved critical security issue is known.

See `acceptance-criteria.md` and `docs/validation-matrix.md` for measurable checks.

## 7. Roles if working as a team

| Workstream | Responsibility | Must coordinate with |
|---|---|---|
| Frontend/world | Next.js layout, Phaser scene, interaction bridge, accessible panels | API contracts and state/event schemas |
| Backend/platform | FastAPI, auth, DB, MinIO and migrations | Frontend, security, evaluator |
| AI/scenario | Blueprints, characters, validators, model adapter | Simulation state contract and rubric |
| Assessment/QA | Rubric anchors, evidence validation, regression dataset, human calibration | AI/scenario and product |
| Product/research | User flows, pilot study, scope, scenario realism | Whole team |

For a solo build, implement these workstreams sequentially around the vertical slice. Do not start separate advanced systems in parallel before the session state and API contracts settle.

## 8. Risks to track

| Risk | Early signal | Mitigation / owner |
|---|---|---|
| Map is decorative/frictional | Users ignore rooms or take longer without finding information | Compare spatial vs direct navigation; keep shortcuts. Product/frontend. |
| Generated scenario has no valid solution | Validator or human playtest finds unreachable objectives | Constrained templates, reachability tests, publication gate. AI/scenario. |
| Characters leak hidden facts | Regression asks for facts before discovery | Scoped prompts and event-based knowledge; test every sensitive fact. AI/backend. |
| Evaluator rewards style over substance | Paraphrases get different scores | Anchored rubric, content/style separation, counterfactual test suite, human calibration. Assessment. |
| State duplicated between Phaser and server | Refresh or retry changes outcome | Backend state version, event log, idempotent requests, reconcile on resume. Backend/frontend. |
| Direct SQL role bypasses RLS | Cross-user API integration test succeeds unexpectedly | Owner checks in repositories, restricted role, review actual DB role, deny tests. Backend/security. |
| MinIO distribution/licensing unsuitable | No maintained image or unclear license obligations | Review distribution, pin digest, choose alternative if needed. Platform owner. |
| AI spend or latency grows unexpectedly | Token usage or p95 latency rises with transcripts | Context summarization, output limits, cheap deterministic checks, quotas. AI/platform. |
| Scope grows too fast | Voice/multiplayer/extra rooms precede end-to-end flow | Enforce P0/P1/P2 and vertical-slice gates. Product owner. |

## 9. Milestone demo script

Use a synthetic learner profile for a junior backend role and run this 5–8 minute demo:
1. Show skills/profile and selected learning objective.
2. Generate a production incident variant and show pre-brief + success criteria (without revealing all hidden facts).
3. Enter the 2D office, inspect the incident dashboard and ask the manager for context.
4. Ask a teammate a relevant question to discover a hidden deployment/migration fact.
5. Propose an action. Demonstrate one consequential state transition and one blocked/unsafe action.
6. Complete the incident and communicate impact/next steps.
7. Show report with verified transcript citations and an objective-action finding.
8. Retry a different variation and show that the surface details change while rubric objectives remain aligned.

The strongest demo is a coherent scenario that reacts to decisions, with a transparent report—not a large office or the number of AI agents.
