"""Repository layer: parameterised SQL against Supabase PostgreSQL.

Kept deliberately thin and explicit. All ownership-sensitive reads accept the owner id
so that FastAPI enforces authorization even though its DB role bypasses RLS.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _row(result: Any) -> dict[str, Any] | None:
    mapping = result.mappings().first()
    return dict(mapping) if mapping else None


_VERSION_CACHE: dict[str, dict[str, Any]] = {}


def _rows(result: Any) -> list[dict[str, Any]]:
    return [dict(m) for m in result.mappings().all()]


class Repository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ---- profiles ---------------------------------------------------------
    async def ensure_profile(self, user_id: str, display_name: str | None = None) -> dict[str, Any]:
        await self.session.execute(
            text(
                "insert into public.profiles (id, display_name) values (:id, :name) "
                "on conflict (id) do nothing"
            ),
            {"id": user_id, "name": display_name},
        )
        return await self.get_profile(user_id)  # type: ignore[return-value]

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.profiles where id = :id"), {"id": user_id}
            )
        )

    async def get_profile_by_clerk(self, clerk_user_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.profiles where clerk_user_id = :cid"),
                {"cid": clerk_user_id},
            )
        )

    async def ensure_profile_for_clerk(
        self, clerk_user_id: str, display_name: str | None = None
    ) -> dict[str, Any]:
        # One round trip: insert if missing, otherwise return the existing row (no write).
        profile = _row(
            await self.session.execute(
                text(
                    "with ins as ("
                    " insert into public.profiles (clerk_user_id, display_name) values (:cid, :name)"
                    " on conflict (clerk_user_id) do nothing returning *"
                    ") select * from ins"
                    " union all select * from public.profiles where clerk_user_id = :cid"
                    " limit 1"
                ),
                {"cid": clerk_user_id, "name": display_name},
            )
        )
        if profile is None:
            # A concurrent first request inserted the row after this statement's snapshot
            # was taken; a fresh statement sees it.
            profile = await self.get_profile_by_clerk(clerk_user_id)
        if profile is None:  # pragma: no cover - defensive
            raise RuntimeError("Failed to provision profile for Clerk user.")
        return profile

    async def update_profile(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "display_name",
            "education_summary",
            "experience_summary",
            "target_role",
            "career_goals",
            "preferred_stack",
            "experience_level",
            "github_url",
            "linkedin_url",
            "portfolio_url",
            "custom_situation",
        }
        # Links and the custom situation can be cleared: "" stores NULL.
        clearable = {"github_url", "linkedin_url", "portfolio_url", "custom_situation"}
        sets = {
            k: (v or None) if k in clearable else v
            for k, v in fields.items()
            if k in allowed and (v is not None or k in clearable)
        }
        if sets:
            assignments = ", ".join(f"{k} = :{k}" for k in sets)
            params = {**sets, "id": user_id}
            await self.session.execute(
                text(f"update public.profiles set {assignments} where id = :id"), params
            )
        return await self.get_profile(user_id)  # type: ignore[return-value]

    # ---- skills -----------------------------------------------------------
    # ---- learner context ----------------------------------------------------
    async def get_learner_context(self, user_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.learner_contexts where user_id = :id"), {"id": user_id}
            )
        )

    async def upsert_learner_context(self, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Insert or update the learner's context row; jsonb fields are passed as Python objects."""
        allowed = {"sources", "context", "scenario_plan", "source_hash", "builder", "built_at"}
        jsonb = {"sources", "context", "scenario_plan"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        params = {
            k: (json.dumps(v) if k in jsonb and v is not None else v) for k, v in sets.items()
        }
        values = {k: f"cast(:{k} as jsonb)" if k in jsonb else f":{k}" for k in sets}
        cols = ", ".join(["user_id", *values])
        vals = ", ".join([":user_id", *values.values()])
        updates = ", ".join(f"{k} = excluded.{k}" for k in sets) or "user_id = excluded.user_id"
        row = _row(
            await self.session.execute(
                text(
                    f"insert into public.learner_contexts ({cols}) values ({vals}) "
                    f"on conflict (user_id) do update set {updates} returning *"
                ),
                {**params, "user_id": user_id},
            )
        )
        return row  # type: ignore[return-value]

    async def list_skills(self, user_id: str) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text("select * from public.profile_skills where user_id = :id order by created_at"),
                {"id": user_id},
            )
        )

    async def add_skill(self, user_id: str, name: str, level: str | None) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.profile_skills (user_id, name, level_self_reported) "
                    "values (:uid, :name, :level) "
                    "on conflict (user_id, name) do update set level_self_reported = excluded.level_self_reported "
                    "returning *"
                ),
                {"uid": user_id, "name": name, "level": level},
            )
        )  # type: ignore[return-value]

    async def delete_skill(self, user_id: str, skill_id: str) -> None:
        await self.session.execute(
            text("delete from public.profile_skills where id = :id and user_id = :uid"),
            {"id": skill_id, "uid": user_id},
        )

    # ---- scenario templates / versions -----------------------------------
    async def list_templates(self) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select id, slug, title, summary, categories, target_roles, supported_modes, "
                    "estimated_minutes, template_definition from public.scenario_templates "
                    "where is_published = true order by created_at"
                )
            )
        )

    async def get_template_by_slug(self, slug: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.scenario_templates where slug = :slug"), {"slug": slug}
            )
        )

    async def ensure_template(
        self, slug: str, title: str, summary: str, definition: dict[str, Any]
    ) -> dict[str, Any]:
        existing = await self.get_template_by_slug(slug)
        if existing:
            return existing
        return _row(
            await self.session.execute(
                text(
                    "insert into public.scenario_templates "
                    "(slug, title, summary, categories, target_roles, supported_modes, estimated_minutes, "
                    "is_published, template_definition) values "
                    "(:slug, :title, :summary, :categories, :roles, :modes, :minutes, true, cast(:def as jsonb)) "
                    "returning *"
                ),
                {
                    "slug": slug,
                    "title": title,
                    "summary": summary,
                    "categories": definition.get("categories", []),
                    "roles": definition.get("target_roles", []),
                    "modes": definition.get("supported_modes", ["quick", "project"]),
                    "minutes": definition.get("estimated_minutes", 10),
                    "def": json.dumps(definition),
                },
            )
        )  # type: ignore[return-value]

    async def insert_scenario_version(
        self,
        *,
        template_id: str,
        version_number: int,
        created_by: str,
        difficulty: str,
        mode: str,
        variation_seed: str,
        blueprint: dict[str, Any],
        rubric_snapshot: dict[str, Any],
        profile_snapshot: dict[str, Any],
        validation_report: dict[str, Any],
        generator_provider: str | None,
        generator_model: str | None,
        prompt_version: str | None,
        validator_version: str,
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.scenario_versions "
                    "(template_id, version_number, created_by, status, difficulty, mode, variation_seed, "
                    "blueprint, rubric_snapshot, profile_snapshot, validation_report, generator_provider, "
                    "generator_model, prompt_version, validator_version, is_published, validated_at) "
                    "values (:tid, :vnum, :cb, 'validated', :diff, :mode, :seed, cast(:bp as jsonb), "
                    "cast(:rub as jsonb), cast(:prof as jsonb), cast(:vr as jsonb), :gp, :gm, :pv, :vv, false, now()) "
                    "returning *"
                ),
                {
                    "tid": template_id,
                    "vnum": version_number,
                    "cb": created_by,
                    "diff": difficulty,
                    "mode": mode,
                    "seed": variation_seed,
                    "bp": json.dumps(blueprint),
                    "rub": json.dumps(rubric_snapshot),
                    "prof": json.dumps(profile_snapshot),
                    "vr": json.dumps(validation_report),
                    "gp": generator_provider,
                    "gm": generator_model,
                    "pv": prompt_version,
                    "vv": validator_version,
                },
            )
        )  # type: ignore[return-value]

    async def get_scenario_version(self, version_id: str) -> dict[str, Any] | None:
        # Versions are immutable once inserted, and the row carries the whole blueprint (seconds
        # to fetch over a slow link), so cache it per process.
        # ponytail: unbounded per-process dict; one row per scenario instance, add an LRU if it grows.
        key = str(version_id)
        cached = _VERSION_CACHE.get(key)
        if cached is None:
            cached = _row(
                await self.session.execute(
                    text("select * from public.scenario_versions where id = :id"), {"id": key}
                )
            )
            if cached is None:
                return None
            _VERSION_CACHE[key] = cached
        return dict(cached)

    async def next_version_number(self, template_id: str) -> int:
        row = _row(
            await self.session.execute(
                text(
                    "select coalesce(max(version_number), 0) + 1 as n from public.scenario_versions "
                    "where template_id = :tid"
                ),
                {"tid": template_id},
            )
        )
        return int(row["n"]) if row else 1

    # ---- sessions ---------------------------------------------------------
    async def create_session(
        self,
        *,
        user_id: str,
        scenario_version_id: str,
        mode: str,
        state: dict[str, Any],
        client_create_key: str | None,
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.simulation_sessions "
                    "(user_id, scenario_version_id, mode, status, state, state_version, client_create_key, started_at) "
                    "values (:uid, :svid, :mode, 'active', cast(:state as jsonb), 1, :ck, now()) returning *"
                ),
                {
                    "uid": user_id,
                    "svid": scenario_version_id,
                    "mode": mode,
                    "state": json.dumps(state),
                    "ck": client_create_key,
                },
            )
        )  # type: ignore[return-value]

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.simulation_sessions where id = :id"), {"id": session_id}
            )
        )

    async def get_session_for_update(self, session_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.simulation_sessions where id = :id for update"),
                {"id": session_id},
            )
        )

    async def list_sessions(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select s.id, s.scenario_version_id, s.status, s.state_version, s.mode, "
                    "s.started_at, s.ended_at, s.created_at, sv.template_id, sv.difficulty "
                    "from public.simulation_sessions s "
                    "join public.scenario_versions sv on sv.id = s.scenario_version_id "
                    # Company assessment runs live in Company assessments, not in learning.
                    "where s.user_id = :uid and not exists (select 1 from public.assessment_invites ai where ai.session_id = s.id) "
                    "order by s.created_at desc limit :lim"
                ),
                {"uid": user_id, "lim": limit},
            )
        )

    async def save_session_state(
        self,
        *,
        session_id: str,
        expected_version: int,
        new_version: int,
        state: dict[str, Any],
        status: str | None = None,
        active_turn_id: str | None = None,
        ended_at: Any | None = None,
    ) -> dict[str, Any] | None:
        row = _row(
            await self.session.execute(
                text(
                    "update public.simulation_sessions set state = cast(:state as jsonb), "
                    "state_version = :new_version, "
                    "status = coalesce(:status, status), "
                    "active_turn_id = :turn, "
                    "ended_at = coalesce(:ended, ended_at), "
                    "last_activity_at = now() "
                    "where id = :id and state_version = :expected returning *"
                ),
                {
                    "state": json.dumps(state),
                    "new_version": new_version,
                    "status": status,
                    "turn": active_turn_id,
                    "ended": ended_at,
                    "id": session_id,
                    "expected": expected_version,
                },
            )
        )
        return row

    async def set_session_status(
        self, session_id: str, status: str, ended_at: Any | None = None
    ) -> None:
        await self.session.execute(
            text(
                "update public.simulation_sessions set status = :status, "
                "ended_at = coalesce(:ended, ended_at), last_activity_at = now() where id = :id"
            ),
            {"status": status, "ended": ended_at, "id": session_id},
        )

    # ---- messages ---------------------------------------------------------
    async def lock_session_messages(self, session_id: str) -> None:
        """Serialize message-sequence allocation for a session (transaction-scoped)."""
        await self.session.execute(
            text("select pg_advisory_xact_lock(hashtext(:sid))"), {"sid": session_id}
        )

    async def next_message_sequence(self, session_id: str) -> int:
        row = _row(
            await self.session.execute(
                text(
                    "select coalesce(max(sequence_number), 0) + 1 as n from public.conversation_messages "
                    "where session_id = :sid"
                ),
                {"sid": session_id},
            )
        )
        return int(row["n"]) if row else 1

    async def insert_message(
        self,
        *,
        session_id: str,
        sequence_number: int,
        turn_id: str | None,
        client_turn_id: str | None,
        speaker_type: str,
        character_id: str | None,
        content: str,
        modality: str = "text",
        status: str = "completed",
        metadata: dict[str, Any] | None = None,
        provider_message_id: str | None = None,
        source: str = "text",
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.conversation_messages "
                    "(session_id, sequence_number, turn_id, client_turn_id, speaker_type, character_id, "
                    "content, modality, status, metadata, provider_message_id, source) values "
                    "(:sid, :seq, :turn, :ctid, :spk, :char, :content, :modality, :status, "
                    "cast(:meta as jsonb), :pmid, :source) "
                    "returning *"
                ),
                {
                    "sid": session_id,
                    "seq": sequence_number,
                    "turn": turn_id,
                    "ctid": client_turn_id,
                    "spk": speaker_type,
                    "char": character_id,
                    "content": content,
                    "modality": modality,
                    "status": status,
                    "meta": json.dumps(metadata or {}),
                    "pmid": provider_message_id,
                    "source": source,
                },
            )
        )  # type: ignore[return-value]

    async def get_message_by_client_turn(
        self, session_id: str, client_turn_id: str
    ) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "select * from public.conversation_messages where session_id = :sid and client_turn_id = :ctid"
                ),
                {"sid": session_id, "ctid": client_turn_id},
            )
        )

    async def get_message_by_provider_id(
        self, session_id: str, provider_message_id: str
    ) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "select * from public.conversation_messages "
                    "where session_id = :sid and provider_message_id = :pmid"
                ),
                {"sid": session_id, "pmid": provider_message_id},
            )
        )

    # ---- voice sessions ---------------------------------------------------
    async def create_voice_session(
        self,
        *,
        session_id: str,
        user_id: str,
        npc_id: str,
        agent_config_key: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.voice_sessions "
                    "(session_id, user_id, npc_id, agent_config_key, status, metadata) values "
                    "(:sid, :uid, :npc, :akey, 'created', cast(:meta as jsonb)) "
                    "on conflict (session_id) where status in ('created', 'connecting', 'active') "
                    "do nothing returning *"
                ),
                {
                    "sid": session_id,
                    "uid": user_id,
                    "npc": npc_id,
                    "akey": agent_config_key,
                    "meta": json.dumps(metadata or {}),
                },
            )
        )  # type: ignore[return-value]

    async def get_voice_session(self, voice_session_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text("select * from public.voice_sessions where id = :id"), {"id": voice_session_id}
            )
        )

    async def get_active_voice_session(self, session_id: str, npc_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "select * from public.voice_sessions where session_id = :sid and npc_id = :npc "
                    "and status in ('created', 'connecting', 'active') "
                    "order by created_at desc limit 1"
                ),
                {"sid": session_id, "npc": npc_id},
            )
        )

    async def set_voice_session_status(
        self,
        voice_session_id: str,
        status: str,
        *,
        provider_conversation_id: str | None = None,
        end_reason: str | None = None,
        ended: bool = False,
    ) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "update public.voice_sessions set "
                    "status = :status, "
                    "provider_conversation_id = coalesce(:pcid, provider_conversation_id), "
                    "end_reason = coalesce(:reason, end_reason), "
                    "connected_at = case when :status in ('active', 'connecting') "
                    "  then coalesce(connected_at, now()) else connected_at end, "
                    "ended_at = case when :ended then coalesce(ended_at, now()) else ended_at end "
                    "where id = :id returning *"
                ),
                {
                    "status": status,
                    "pcid": provider_conversation_id,
                    "reason": end_reason,
                    "ended": ended,
                    "id": voice_session_id,
                },
            )
        )

    async def list_messages(self, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select id, session_id, sequence_number, speaker_type, character_id, content, modality, "
                    "status, created_at from public.conversation_messages where session_id = :sid "
                    "order by sequence_number asc limit :lim"
                ),
                {"sid": session_id, "lim": limit},
            )
        )

    # ---- events -----------------------------------------------------------
    async def insert_event(
        self,
        *,
        session_id: str,
        sequence_number: int,
        event_type: str,
        actor_type: str,
        actor_id: str | None,
        payload: dict[str, Any],
        state_version_after: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.simulation_events "
                    "(session_id, sequence_number, event_type, actor_type, actor_id, idempotency_key, "
                    "payload, state_version_after) values "
                    "(:sid, :seq, :etype, :atype, :aid, :idem, cast(:payload as jsonb), :sva) returning *"
                ),
                {
                    "sid": session_id,
                    "seq": sequence_number,
                    "etype": event_type,
                    "atype": actor_type,
                    "aid": actor_id,
                    "idem": idempotency_key,
                    "payload": json.dumps(payload),
                    "sva": state_version_after,
                },
            )
        )  # type: ignore[return-value]

    async def list_events(self, session_id: str, limit: int = 300) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select id, session_id, sequence_number, event_type, actor_type, actor_id, payload, "
                    "state_version_after, created_at from public.simulation_events "
                    "where session_id = :sid order by sequence_number asc limit :lim"
                ),
                {"sid": session_id, "lim": limit},
            )
        )

    async def find_event_by_idempotency(
        self, session_id: str, idempotency_key: str
    ) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "select * from public.simulation_events "
                    "where session_id = :sid and idempotency_key = :key limit 1"
                ),
                {"sid": session_id, "key": idempotency_key},
            )
        )

    # ---- deliverables -----------------------------------------------------
    async def insert_deliverable(
        self,
        *,
        session_id: str,
        user_id: str,
        task_id: str,
        inline_text: str,
        result_status: str = "submitted",
        result_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.task_deliverables "
                    "(session_id, user_id, task_id, inline_text, result_status, result_metadata) values "
                    "(:sid, :uid, :tid, :text, :status, cast(:meta as jsonb)) returning *"
                ),
                {
                    "sid": session_id,
                    "uid": user_id,
                    "tid": task_id,
                    "text": inline_text,
                    "status": result_status,
                    "meta": json.dumps(result_metadata or {}),
                },
            )
        )  # type: ignore[return-value]

    async def list_deliverables(self, session_id: str) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select * from public.task_deliverables where session_id = :sid order by created_at"
                ),
                {"sid": session_id},
            )
        )

    # ---- evaluations ------------------------------------------------------
    async def create_evaluation(
        self,
        *,
        session_id: str,
        rubric_version: str,
        evaluator_version: str,
        model_provider: str | None,
        model_name: str | None,
        overall_score: float | None,
        report_summary: str,
        limitations: list[str],
        validation_warnings: list[str],
        report_metadata: dict[str, Any],
        status: str = "completed",
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.evaluations "
                    "(session_id, status, rubric_version, evaluator_version, model_provider, model_name, "
                    "overall_score, report_summary, limitations, validation_warnings, report_metadata, "
                    "started_at, completed_at) values "
                    "(:sid, :status, :rubric, :evaluator, :mp, :mn, :score, :summary, "
                    "cast(:lim as jsonb), cast(:warn as jsonb), cast(:meta as jsonb), now(), now()) returning *"
                ),
                {
                    "sid": session_id,
                    "status": status,
                    "rubric": rubric_version,
                    "evaluator": evaluator_version,
                    "mp": model_provider,
                    "mn": model_name,
                    "score": overall_score,
                    "summary": report_summary,
                    "lim": json.dumps(limitations),
                    "warn": json.dumps(validation_warnings),
                    "meta": json.dumps(report_metadata),
                },
            )
        )  # type: ignore[return-value]

    async def insert_evaluation_item(
        self,
        *,
        evaluation_id: str,
        criterion_id: str,
        criterion_name: str,
        status: str,
        score: int | None,
        score_max: int,
        explanation: str,
        recommendation: str,
        counterevidence: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.evaluation_items "
                    "(evaluation_id, criterion_id, criterion_name, status, score, score_max, explanation, "
                    "recommendation, counterevidence) values "
                    "(:eid, :cid, :name, :status, :score, :smax, :expl, :rec, cast(:ce as jsonb)) returning *"
                ),
                {
                    "eid": evaluation_id,
                    "cid": criterion_id,
                    "name": criterion_name,
                    "status": status,
                    "score": score,
                    "smax": score_max,
                    "expl": explanation,
                    "rec": recommendation,
                    "ce": json.dumps(counterevidence),
                },
            )
        )  # type: ignore[return-value]

    async def insert_evaluation_evidence(
        self,
        *,
        item_id: str,
        source_type: str,
        message_id: str | None,
        event_id: str | None,
        deliverable_id: str | None,
        quote: str | None,
        interpretation: str,
    ) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "insert into public.evaluation_evidence "
                    "(evaluation_item_id, source_type, message_id, event_id, deliverable_id, quote, interpretation) "
                    "values (:iid, :st, :mid, :eid, :did, :quote, :interp) returning *"
                ),
                {
                    "iid": item_id,
                    "st": source_type,
                    "mid": message_id,
                    "eid": event_id,
                    "did": deliverable_id,
                    "quote": quote,
                    "interp": interpretation,
                },
            )
        )

    async def get_evaluation(self, session_id: str) -> dict[str, Any] | None:
        return _row(
            await self.session.execute(
                text(
                    "select * from public.evaluations where session_id = :sid order by created_at desc limit 1"
                ),
                {"sid": session_id},
            )
        )

    async def delete_evaluation(self, session_id: str) -> None:
        await self.session.execute(
            text("delete from public.evaluations where session_id = :sid"), {"sid": session_id}
        )

    async def list_evaluation_items(self, evaluation_id: str) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select * from public.evaluation_items where evaluation_id = :eid order by criterion_id"
                ),
                {"eid": evaluation_id},
            )
        )

    async def list_evaluation_evidence(self, item_id: str) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text("select * from public.evaluation_evidence where evaluation_item_id = :iid"),
                {"iid": item_id},
            )
        )

    async def user_progress(self, user_id: str) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select e.session_id, e.overall_score, e.rubric_version, e.completed_at, "
                    "s.scenario_version_id, sv.template_id, sv.difficulty "
                    "from public.evaluations e "
                    "join public.simulation_sessions s on s.id = e.session_id "
                    "join public.scenario_versions sv on sv.id = s.scenario_version_id "
                    "where s.user_id = :uid and e.status = 'completed' "
                    "and not exists (select 1 from public.assessment_invites ai where ai.session_id = s.id) "
                    "order by e.completed_at desc"
                ),
                {"uid": user_id},
            )
        )

    async def competency_trends(self, user_id: str) -> list[dict[str, Any]]:
        return _rows(
            await self.session.execute(
                text(
                    "select ei.criterion_id, ei.criterion_name, count(*) as attempts, "
                    "avg(ei.score) as avg_score, max(ei.score_max) as score_max, e.rubric_version "
                    "from public.evaluation_items ei "
                    "join public.evaluations e on e.id = ei.evaluation_id "
                    "join public.simulation_sessions s on s.id = e.session_id "
                    "where s.user_id = :uid and e.status = 'completed' and ei.status = 'scored' "
                    "and not exists (select 1 from public.assessment_invites ai where ai.session_id = s.id) "
                    "group by ei.criterion_id, ei.criterion_name, e.rubric_version "
                    "order by ei.criterion_id"
                ),
                {"uid": user_id},
            )
        )
