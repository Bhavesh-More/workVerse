# WorkVerse — Manual Vercel Deployment

Last verified: 2026-10-27. Repo-side checklist completed; Vercel deployment not started.

This guide deploys both apps as **one Vercel project using Services**:

- `apps/web` → Next.js
- `apps/api` → FastAPI
- Public routes: `/api/*` and `/health/*` go to FastAPI; everything else goes to Next.js.

Use the Vercel **dashboard in a browser** for everything. No CLI is required.

If Services fails to build or route correctly, use the two-project fallback in
[Appendix B](#appendix-b-two-project-fallback).

---

## Quick checklist

### Repo-side — completed

- [x] Remove the hardcoded Ollama key fragments from `logging.py`
- [x] Add `vercel.json`
- [x] Add `.vercelignore`
- [x] Add `apps/api/.python-version`
- [x] Lower the document upload cap from 5 MB to 4 MB
- [x] Confirm the Supabase database has all 21 tables

### Manual steps still required

- [ ] Rotate the two exposed Ollama keys and update `OLLAMA_API_KEYS`
- [ ] Commit and push the repo-side changes
- [ ] Import the repo into Vercel with Framework Preset **Services** and Root Directory **blank**
- [ ] Add all environment variables for **Production** and **Preview**
- [ ] Deploy
- [ ] Set `WEB_BASE_URL` and `CORS_ALLOWED_ORIGINS` to the final production domain, then redeploy
- [ ] Set Deployment Protection to **Standard Protection**
- [ ] Verify `/health/live`, `/health/ready`, `/`, and `/api/v1/*`
- [ ] Test login, a scenario, a report PDF/CSV, and voice
- [ ] Point the ElevenLabs Custom LLM URL at the production domain

Repo-side checks already run: API Ruff, `tests/test_context.py` (19 passed), web ESLint, JSON
syntax, and the live 21-table Supabase query. The Vercel build itself is still unrun.

---

## 1. Before you start

You need:

- A Vercel account and access to the GitHub repo.
- A Supabase project with the WorkVerse migrations applied.
- Clerk keys (`pk_test_` / `sk_test_` for a demo, or `pk_live_` / `sk_live_` for production).
- The existing Ollama, ElevenLabs, and bridge secrets from your local `.env` files.
- A final production domain. For a demo, `https://<project-name>.vercel.app` is fine.

Important platform limits:

| Limit | Value |
|---|---|
| Request body | 4.5 MB |
| Response body | 4.5 MB |
| Function duration, Hobby | 300 seconds maximum |
| Function duration, Pro | 800 seconds maximum |
| Python function bundle | 500 MB standard, 5 GB with Large Functions |
| Outbound SMTP | Port 25 blocked; use 465 or 587 |
| Vercel Services | Beta, available on all plans |

Do not use the Vercel CLI for this guide. Everything below is dashboard-based.

---

## 2. Repo changes

The code and config changes are complete. Rotate the keys, commit, and push before importing the
project into Vercel.

### 2.1 Rotate the two exposed Ollama keys (manual)

The two 32-character fragments have been removed from `apps/api/app/core/logging.py`; there is no
key material left in that file. The two keys are still active, so rotate them in Ollama:

1. Sign in to Ollama.
2. Revoke the first two keys currently in `OLLAMA_API_KEYS`.
3. Create two replacement keys.
4. Replace the first two values in `apps/api/.env` with the new keys.
5. Keep the total at 13 keys.

After rotation, verify the new keys against:

```text
GET https://ollama.com/v1/models
```

Do not put any key value into this Markdown file or into Vercel `NEXT_PUBLIC_*` variables.

### 2.2 `vercel.json` (added)

`vercel.json` is already at the repository root. Confirm it contains:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "web": {
      "root": "apps/web/",
      "framework": "nextjs"
    },
    "api": {
      "root": "apps/api/",
      "framework": "fastapi",
      "entrypoint": "app.main:app",
      "functions": {
        "app/main.py": {
          "maxDuration": 300
        }
      }
    }
  },
  "rewrites": [
    { "source": "/health", "destination": { "service": "api" } },
    { "source": "/health/(.*)", "destination": { "service": "api" } },
    { "source": "/api/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ]
}
```

Notes:

- `functions` and `framework` must be **inside** the service. They are invalid at the top level
  when `services` is present.
- FastAPI receives the original path, so it keeps the `/api/v1` prefix.
- `/health` needs its own rewrite; otherwise the catch-all sends it to Next.js.
- `maxDuration: 300` is safe on Hobby. Raise it to `800` only if you are on Pro and need it.
- If Vercel cannot find the FastAPI entrypoint, remove `entrypoint` and let auto-detection find
  `app/main.py`. Alternatively add this to `apps/api/pyproject.toml`:

```toml
[tool.vercel]
entrypoint = "app.main:app"
```

### 2.3 `.vercelignore` (added)

`.vercelignore` is already at the repository root:

```gitignore
.env
.env.local
.env.*.local
**/.env
**/.env.local
**/.env.*.local
```

Vercel's default ignore list does **not** include `.env`; it only ignores `.env.local` and
`.env.*.local`. This file is a safety net for CLI uploads. Git integration already respects
`.gitignore`, and `.env` is not tracked in this repo.

### 2.4 Python version (pinned)

`apps/api/.python-version` is already present:

```text
3.12
```

Vercel defaults to Python 3.12, but pinning avoids future drift. `uv.lock` is already present, so
Vercel will use `uv`.

### 2.5 Upload cap (lowered)

Vercel rejects request bodies over 4.5 MB. The cap is now 4 MB. `apps/api/app/context/sources.py`
contains:

```python
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
```

The error messages and UI hints now say “up to 4 MB.” in:

- `apps/api/app/context/sources.py`
- `apps/api/app/api/v1/context.py`
- `apps/web/app/(app)/profile/page.tsx`
- `apps/web/app/(app)/onboarding/page.tsx`

### 2.6 Commit and push (manual)

The repo-side changes are currently uncommitted. Commit the new files and code changes, then push
to `main`.

Do not commit `.env`, `.env.local`, or any secret.

---

## 3. Check the Supabase database

The database currently configured in `apps/api/.env` already has the expected 21 tables. This was
verified on 2026-10-27. If you are using that same database in production, no migration is needed.

To confirm, open the Supabase SQL editor and run:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

You should see these 21 tables:

```text
assessment_invites, assessments, companies, company_topics, company_worlds,
conversation_messages, evaluation_evidence, evaluation_items, evaluations,
learner_contexts, notifications, profile_skills, profiles, scenario_templates,
scenario_versions, simulation_events, simulation_sessions, skill_progress,
task_deliverables, user_documents, voice_sessions
```

If you are using a fresh database:

1. Open `supabase/migrations/`.
2. Apply `0001` through `0010` **in order**.
3. Use a direct or session connection on port `5432` for migrations.
4. Do **not** apply `supabase/schema.sql` separately; it can conflict with the migration chain.

For the running API, use the Supabase **transaction pooler** on port `6543`:

```text
postgresql+asyncpg://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres
```

Use `DATABASE_POOL_SIZE=1` and `DATABASE_MAX_OVERFLOW=0`. The code already disables prepared
statements when it sees port `6543`, and sets SSL to `require`.

URL-encode any reserved characters in the password.

---

## 4. Import the project into Vercel

1. Open <https://vercel.com/new>.
2. Import the `workVerse` GitHub repository.
3. On **Configure Project**:
   - **Project Name:** anything you like. Note the resulting domain.
   - **Framework Preset:** **Services**.
   - **Root Directory:** leave **blank** or use `./`. Do **not** set it to `apps/web`.
   - **Build Command:** leave blank.
   - **Output Directory:** leave blank.
   - **Install Command:** leave blank.
   - **Node.js Version:** leave the default (24.x).
4. Do not deploy yet. Add the environment variables first.

If you do not see **Services** in the Framework Preset list, check that `vercel.json` is at the
repository root and that you are on the current Vercel UI. If it still does not appear, use
Appendix B.

---

## 5. Add environment variables

Open the project's **Settings → Environment Variables** and add each variable. Select both
**Production** and **Preview** unless a note says otherwise.

Use the **Secret** type for keys and passwords. `NEXT_PUBLIC_*` values are public by design and
are embedded in the browser bundle at build time.

Replace `<domain>` with your final production domain, for example:

```text
https://workverse-demo.vercel.app
```

No trailing slash.

### 5.1 Shared variables

In Services, variables are shared across both services. The “Read by” column shows which app
actually uses the value.

| Variable | Value | Read by |
|---|---|---|
| `APP_ENV` | `production` | API |
| `LOG_LEVEL` | `INFO` | API |
| `DATABASE_URL` | Supabase transaction-pooler URI on `:6543` | API |
| `DATABASE_POOL_SIZE` | `1` | API |
| `DATABASE_MAX_OVERFLOW` | `0` | API |
| `CLERK_PUBLISHABLE_KEY` | `pk_test_...` for demo, `pk_live_...` for production | API |
| `CLERK_SECRET_KEY` | matching `sk_test_...` or `sk_live_...` | API + web |
| `CORS_ALLOWED_ORIGINS` | `https://<domain>` | API |
| `WEB_BASE_URL` | `https://<domain>` | API |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Build |

`ENABLE_EXPERIMENTAL_COREPACK=1` makes Vercel honor `packageManager: pnpm@11.25.0`. Without it,
Vercel may use pnpm 10. If the Corepack build fails, remove the variable and check the build log's
pnpm version.

### 5.2 Web variables

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | same value as `CLERK_PUBLISHABLE_KEY` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/login` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/signup` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/onboarding` |

`NEXT_PUBLIC_API_BASE_URL=/api/v1` is intentionally relative. The browser calls the same Vercel
domain, and the `/api/(.*)` rewrite sends it to FastAPI. This avoids CORS for normal browser
traffic.

### 5.3 API variables

Copy the current values from `apps/api/.env`.

| Variable | Value |
|---|---|
| `OLLAMA_API_KEYS` | 13 comma-separated keys, after rotation |
| `OLLAMA_BASE_URL` | `https://ollama.com/v1` |
| `OLLAMA_MODEL` | `gemma4:31b` |
| `OLLAMA_TIMEOUT_SECONDS` | `45` |
| `OLLAMA_MAX_OUTPUT_TOKENS` | `700` |
| `OLLAMA_TEMPERATURE` | `0.7` |
| `DEV_AUTH_ENABLED` | `false` |
| `VOICE_ENABLED` | `true` |
| `ELEVENLABS_API_KEY` | existing key |
| `ELEVENLABS_AGENT_ID` | existing default agent |
| `ELEVENLABS_AGENT_MAP` | existing JSON map |
| `ELEVENLABS_API_KEY_2` … `ELEVENLABS_API_KEY_8` | existing keys |
| `ELEVENLABS_AGENT_MAP_2` … `ELEVENLABS_AGENT_MAP_8` | existing JSON maps |
| `VOICE_LLM_BRIDGE_SECRET` | existing secret |
| `VOICE_CONTEXT_GRANT_SECRET` | existing secret |
| `VOICE_CONTEXT_GRANT_TTL_SECONDS` | `900` |
| `VOICE_LLM_MAX_OUTPUT_TOKENS` | `100` |

Optional:

| Variable | When needed |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `SMTP_SECURITY` | Company invite email fallback |
| `GITHUB_TOKEN` | Higher GitHub scraping limit |
| `VERCEL_SUPPORT_LARGE_FUNCTIONS` | Only if the Python bundle exceeds 500 MB; set to `1` |

Do not set `MINIO_*` or `SUPABASE_*`; those settings are not used by the running app. The health
check may report `object_storage_configured: false`; that is expected.

### 5.4 Environment notes

- Set variables before the first build. `NEXT_PUBLIC_*` values are baked at build time.
- Changing an environment variable does not update old deployments. Redeploy after changes.
- For a demo, use Clerk test keys in both Production and Preview.
- For production Clerk, create a Clerk production instance on a domain you own. Clerk production
  cannot use a `*.vercel.app` domain.
- Never put API keys in `NEXT_PUBLIC_*` variables.
- `APP_ENV=production` hard-disables development auth even if `DEV_AUTH_ENABLED` is misconfigured.

---

## 6. Deploy

1. Click **Deploy**.
2. Wait for both services to build.
3. Open the deployment summary and confirm both `web` and `api` built successfully.
4. Open **Domains** and copy the production domain.

If the domain is different from the one you used in `WEB_BASE_URL` and
`CORS_ALLOWED_ORIGINS`:

1. Go to **Settings → Environment Variables**.
2. Update `WEB_BASE_URL` and `CORS_ALLOWED_ORIGINS` to the exact production domain.
3. Go to **Deployments** and redeploy the latest production deployment.

### Optional: set the function region

If your Supabase database is in `ap-south-1`, open **Settings → Functions → Function Regions**
and choose `bom1` (Mumbai). This avoids a cross-continent database round trip.

If the dashboard does not expose Function Regions for Services, skip this. The default `iad1`
works, but database latency will be higher.

### Deployment Protection

Open **Settings → Deployment Protection**.

- Choose **Standard Protection**.
- Do **not** choose **All Deployments**.
- Standard protects preview and deployment URLs but leaves the production domain public.

The production domain must be public for candidate invites and for ElevenLabs to reach the voice
bridge. Preview URLs will be protected, so do not use a preview URL for ElevenLabs.

---

## 7. Verify

### 7.1 Health endpoints

Open these in the browser or run `curl`:

```text
https://<domain>/health/live
https://<domain>/health/ready
```

Expected:

```json
{"status":"ok"}
```

`/health/ready` should show:

- `database: "ok"`
- `llm_configured: true`
- `voice_configured: true`
- `voice_llm_bridge_configured: true`

`/health/ready` returns HTTP 200 even when degraded. Inspect the JSON, not just the status code.

`object_storage_configured: false` is fine; MinIO is not used.

### 7.2 Routing

```text
https://<domain>/                  -> Next.js landing page
https://<domain>/api/v1/me         -> 401 JSON, not a Next.js 404
https://<domain>/health/live       -> FastAPI JSON
```

If `/api/v1/me` returns a Next.js HTML 404, the Services rewrite is not active. Check the
Framework Preset and `vercel.json`.

If `/health` returns Next.js HTML, the `/health` rewrite is missing.

### 7.3 App flow

1. Sign up or sign in.
2. Create or open a scenario.
3. Start a session and send a text turn.
4. Complete a session and open the debrief.
5. As a company user, generate a report PDF and a CSV.
6. Confirm both downloads are under 4.5 MB.
7. Test a candidate invite link.
8. Test voice if ElevenLabs is configured.

### 7.4 ElevenLabs voice

Follow `docs/elevenagents-setup.md` for the full voice setup.

In the ElevenLabs agent:

- **Custom LLM Server URL:**
  `https://<domain>/api/v1/voice/llm`
- **Secret:** the exact value of `VOICE_LLM_BRIDGE_SECRET`.

The API accepts the secret as `Authorization: Bearer <secret>`, `xi-api-key`, or `x-api-key`.

Use the production domain, not a preview URL. Preview deployments are protected and ElevenLabs
will not reach them.

### 7.5 Clerk

For a demo:

- Use `pk_test_` / `sk_test_`.
- `*.vercel.app` is fine.
- If Clerk rejects the Vercel origin, add the production domain to the Clerk instance's allowed
  origins/domains.

For production:

1. Create a Clerk production instance.
2. Use a domain you own.
3. Add the required DNS records.
4. Replace the keys on both services with `pk_live_` / `sk_live_`.
5. Redeploy.
6. The API derives its JWKS URL and issuer from `CLERK_PUBLISHABLE_KEY`; no separate JWKS setting
   is required.

DNS can take up to 48 hours.

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Build says it cannot detect a framework | Framework Preset is not **Services**, or `vercel.json` is not at the repo root. |
| `apps/web` build cannot find workspace packages | Services/pnpm workspace detection failed. Try Appendix B. |
| pnpm install fails on `allowBuilds` | Set `ENABLE_EXPERIMENTAL_COREPACK=1`; if it still fails, remove it and check the build log's pnpm version. |
| `/api/*` returns Next.js 404 | Rewrites are not active. Check `vercel.json` and Framework Preset. |
| `/health` returns Next.js HTML | Missing `/health` rewrite. |
| API returns 401 for a signed-in user | `CLERK_PUBLISHABLE_KEY` on the API does not match the web key, or the token issuer is wrong. |
| API returns 500 | Open Vercel Runtime Logs; check `DATABASE_URL`, Ollama keys, and Clerk settings. |
| `/health/ready` says `database: unavailable` | Use the Supabase transaction pooler on `:6543`, user `postgres.<ref>`, URL-encoded password. |
| Upload returns 413 | File is over the 4 MB cap or over Vercel's 4.5 MB limit. |
| Report download returns 413 | PDF/CSV is over 4.5 MB. Use summary mode or external storage; streaming does not bypass the limit. |
| Function returns 504 | Work exceeded `maxDuration`. Raise to 800 on Pro or reduce the work. |
| Invite link points to localhost | `WEB_BASE_URL` is wrong. Update it and redeploy. |
| Invite email fails | SMTP port 25 is blocked by Vercel. Use 587/465 or an HTTP email API. |
| Candidate or ElevenLabs cannot open the app | Deployment Protection is set to **All Deployments**, or you are using a preview URL. Use Standard Protection and the production domain. |
| Voice bridge returns 401 | `VOICE_LLM_BRIDGE_SECRET` mismatch, or ElevenLabs is not forwarding the configured header. |
| Voice returns 503 | `ELEVENLABS_API_KEY` or agent mapping is missing. |
| Voice agent gives generic answers | Custom LLM URL is wrong, or the bridge secret is not configured. |
| Clerk says custom domain required | You are using production Clerk keys on a `*.vercel.app` domain. Use test keys for the demo or add a custom domain. |
| Login redirects to localhost | Check the Clerk sign-in/up URLs and the app's production domain. |

---

## 9. Known risks

- **Services is Beta.** This is a pnpm workspace with a Next.js app and a Python app. I have not
  run a real Vercel Services build for this repo.
- **Shared environment in Services.** API secrets are available in the web service's server
  runtime. They are not exposed to the browser unless prefixed `NEXT_PUBLIC_`. If that is not
  acceptable, use Appendix B.
- **4.5 MB request/response limit.** The upload cap is lowered to 4 MB, but cohort PDFs/CSVs still
  need a real size test.
- **300-second Hobby limit.** Large evaluations may need Pro (800 seconds) or a background job.
- **Cold starts.** `matplotlib` is imported at module scope in `report_pdf.py`; lazy import would
  improve non-report routes. `boto3` is unused and can be removed.
- **No persistent filesystem.** Generated reports are built in memory. Do not add code that
  expects local files to survive between requests.
- **Server-side API calls.** Current `lib/api` consumers are client components, so relative
  `/api/v1` is safe. If you add a server component call, use an absolute internal URL.
- **Unverified end-to-end:** real Vercel Services build, live DB connectivity from Vercel, Clerk
  production, PDF sizes, and voice.

---

## Appendix A: Environment variable summary

Use this as a final check before deploying.

```text
APP_ENV=production
LOG_LEVEL=INFO
DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<password>@<pooler-host>:6543/postgres
DATABASE_POOL_SIZE=1
DATABASE_MAX_OVERFLOW=0
CLERK_PUBLISHABLE_KEY=pk_test_... or pk_live_...
CLERK_SECRET_KEY=sk_test_... or sk_live_...
CORS_ALLOWED_ORIGINS=https://<domain>
WEB_BASE_URL=https://<domain>
ENABLE_EXPERIMENTAL_COREPACK=1

NEXT_PUBLIC_API_BASE_URL=/api/v1
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=same as CLERK_PUBLISHABLE_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding

OLLAMA_API_KEYS=13 comma-separated keys
OLLAMA_BASE_URL=https://ollama.com/v1
OLLAMA_MODEL=gemma4:31b
OLLAMA_TIMEOUT_SECONDS=45
OLLAMA_MAX_OUTPUT_TOKENS=700
OLLAMA_TEMPERATURE=0.7
DEV_AUTH_ENABLED=false

VOICE_ENABLED=true
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
ELEVENLABS_AGENT_MAP={...}
ELEVENLABS_API_KEY_2=...
ELEVENLABS_AGENT_MAP_2={...}
# ... through _8
VOICE_LLM_BRIDGE_SECRET=...
VOICE_CONTEXT_GRANT_SECRET=...
VOICE_CONTEXT_GRANT_TTL_SECONDS=900
VOICE_LLM_MAX_OUTPUT_TOKENS=100
```

Optional: `SMTP_*`, `GITHUB_TOKEN`, `VERCEL_SUPPORT_LARGE_FUNCTIONS`.

Do not add `MINIO_*`, `SUPABASE_*`, or `NEXT_PUBLIC_SUPABASE_*` unless you add code that uses them.

---

## Appendix B: Two-project fallback

Use this only if the Services build or routing fails. If you switch to this path, remove the root
`vercel.json` (or leave it unused) so the Services config cannot interfere with the separate
projects.

### B.1 API project

1. Create a Vercel project from the same repository.
2. **Root Directory:** `apps/api`.
3. **Framework Preset:** FastAPI.
4. Add `apps/api/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/main.py": {
      "maxDuration": 300
    }
  }
}
```

5. Add the API environment variables from Section 5.
6. Deploy.
7. Copy the API production domain.

### B.2 Web project

1. Create a second Vercel project from the same repository.
2. **Root Directory:** `apps/web`.
3. **Framework Preset:** Next.js.
4. Add the web environment variables from Section 5, except:

```text
NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api/v1
```

5. Deploy.
6. Copy the web production domain.

### B.3 Update API CORS and links

On the API project, set:

```text
CORS_ALLOWED_ORIGINS=https://<web-domain>
WEB_BASE_URL=https://<web-domain>
```

Redeploy the API.

CORS uses `allow_credentials=True`, so `*` is not valid. Use exact origins with no trailing slash.

For preview deployments, add the exact preview origin per branch, or use a branch-specific
environment variable. Do not use a wildcard with credentials.

---

## Sources

- FastAPI on Vercel: <https://vercel.com/docs/frameworks/backend/fastapi>
- Services: <https://vercel.com/docs/services>
- Services routing: <https://vercel.com/docs/services/routing>
- Service configuration reference: <https://vercel.com/docs/services/config-reference>
- Function limits: <https://vercel.com/docs/functions/limitations>
- Python versions: <https://vercel.com/docs/functions/runtimes/python/python-version>
- Environment variables: <https://vercel.com/docs/environment-variables>
- `.vercelignore`: <https://vercel.com/docs/deployments/vercel-ignore>
- Deployment Protection: <https://vercel.com/docs/deployment-protection>
- Clerk production: <https://clerk.com/docs/deployments/overview>
- Supabase connections: <https://supabase.com/docs/guides/database/connecting-to-postgres>
- SMTP on Vercel: <https://vercel.com/kb/guide/serverless-functions-and-smtp>
- WorkVerse voice setup: `docs/elevenagents-setup.md`
