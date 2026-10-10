# WorkVerse AI — API (FastAPI)

Authoritative backend for WorkVerse AI: authentication, profiles, scenario validation,
simulation state, AI character dialogue (hosted Ollama Cloud), and evidence-grounded
evaluation.

## Run

```bash
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Configuration is read from `apps/api/.env` (gitignored). See `.env.example` at the repo
root and `README.md` for the full list of variables.

## Test

```bash
uv run pytest
uv run ruff check .
```

## Hosted inference only

AI requests go to `https://ollama.com/v1` with a server-side Bearer token. The base URL is
validated at startup against an allow-list; local inference endpoints are rejected. Multiple
API keys rotate automatically when a key is rate limited.
