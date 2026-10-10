"""Live end-to-end integration test.

Skipped unless ``WORKVERSE_LIVE=1``. Requires valid Supabase (PostgreSQL) and Ollama Cloud
credentials in ``apps/api/.env``. Clerk identity is exercised by the Playwright E2E suite;
here we inject an authenticated principal directly so the test can focus on the authoritative
simulation + hosted-model evaluation path against the real database.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from app.core.config import get_settings
from app.core.security import Principal
from app.db.repository import Repository
from app.db.session import init_engine, session_scope
from app.deps import current_principal
from app.main import app
from httpx import ASGITransport

pytestmark = pytest.mark.integration

LIVE = os.environ.get("WORKVERSE_LIVE") == "1"


@pytest.mark.skipif(not LIVE, reason="set WORKVERSE_LIVE=1 to run the live integration test")
async def test_full_learner_journey() -> None:
    settings = get_settings()
    init_engine(settings)
    clerk_id = f"user_test_{uuid.uuid4().hex[:12]}"
    async with session_scope() as session:
        profile = await Repository(session).ensure_profile_for_clerk(clerk_id, "Integration Tester")
        profile_id = str(profile["id"])

    async def fake_principal() -> Principal:
        return Principal(user_id=profile_id, email="integration@test.local", role="authenticated")

    app.dependency_overrides[current_principal] = fake_principal
    headers = {"Authorization": "Bearer test-override"}

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=120) as c:
            r = await c.get("/api/v1/me", headers=headers)
            assert r.status_code == 200, r.text

            r = await c.patch(
                "/api/v1/me",
                headers=headers,
                json={"display_name": "Integration Tester", "target_role": "Junior Backend Developer"},
            )
            assert r.status_code == 200

            r = await c.post(
                "/api/v1/scenario-instances",
                headers=headers,
                json={"template_slug": "production-incident", "difficulty": "standard"},
            )
            assert r.status_code == 201, r.text
            instance_id = r.json()["scenario_instance_id"]

            r = await c.post(
                "/api/v1/sessions", headers=headers, json={"scenario_instance_id": instance_id}
            )
            assert r.status_code == 201, r.text
            session = r.json()
            sid = session["id"]
            version = session["state_version"]

            async def action(action_id: str, payload: dict | None = None) -> httpx.Response:
                nonlocal version
                resp = await c.post(
                    f"/api/v1/sessions/{sid}/actions",
                    headers=headers,
                    json={
                        "client_action_id": str(uuid.uuid4()),
                        "expected_state_version": version,
                        "type": action_id,
                        "payload": payload or {},
                    },
                )
                if resp.status_code == 200:
                    version = resp.json()["state_version"]
                return resp

            blocked = await action("a_apply_rollback")
            assert blocked.status_code == 422

            assert (await action("a_inspect_logs")).status_code == 200
            assert (await action("a_inspect_deploy")).status_code == 200

            async def turn(character: str, message: str) -> httpx.Response:
                nonlocal version
                resp = await c.post(
                    f"/api/v1/sessions/{sid}/turns",
                    headers=headers,
                    json={
                        "client_turn_id": str(uuid.uuid4()),
                        "expected_state_version": version,
                        "character_id": character,
                        "message": message,
                    },
                )
                if resp.status_code == 200:
                    version = resp.json()["state_version"]
                return resp

            manager = await turn("manager", "What is the customer impact and deadline?")
            assert manager.status_code == 200, manager.text
            teammate = await turn("teammate", "Did the deploy include a database migration?")
            assert teammate.status_code == 200, teammate.text

            assert (await action("a_check_migration_compat")).status_code == 200
            assert (await action("a_apply_rollback")).status_code == 200
            assert (
                await action(
                    "a_send_status_update",
                    {
                        "text": (
                            "Impact: customers cannot complete orders since the deploy. Cause: a "
                            "backward-incompatible migration. We verified compatibility and rolled "
                            "back; errors are recovering. Next update in 15 minutes. Owner: me."
                        )
                    },
                )
            ).status_code == 200

            done = await c.post(
                f"/api/v1/sessions/{sid}/complete",
                headers=headers,
                json={"expected_state_version": version, "force": False},
            )
            assert done.status_code == 200, done.text
            evaluation = done.json()["evaluation"]
            assert evaluation["rubric_version"] == "production-incident-v1"
            assert evaluation["limitations"]
            scored = [i for i in evaluation["items"] if i["status"] == "scored"]
            assert scored, "expected at least one scored criterion"
            for item in scored:
                assert item["evidence"], f"scored criterion {item['criterion_id']} lacks evidence"

    app.dependency_overrides.clear()
