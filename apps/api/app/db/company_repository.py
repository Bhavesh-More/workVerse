"""Company-side SQL: companies, topics, assessments and candidate invites.

Ownership is enforced in every read/write by joining back to the company id the caller owns.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repository import _row, _rows


def _json_or_null(v: Any) -> str | None:
    return None if v is None else json.dumps(v)


class CompanyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _one(self, sql: str, params: dict[str, Any]) -> dict[str, Any] | None:
        return _row(await self.session.execute(text(sql), params))

    async def _all(self, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        return _rows(await self.session.execute(text(sql), params))

    # ---- companies ----------------------------------------------------------
    async def get_company_for_owner(self, profile_id: str) -> dict[str, Any] | None:
        return await self._one(
            "select * from public.companies where owner_profile_id = :pid", {"pid": profile_id}
        )

    async def get_company(self, company_id: str) -> dict[str, Any] | None:
        return await self._one("select * from public.companies where id = :id", {"id": company_id})

    async def create_company(self, profile_id: str, name: str) -> dict[str, Any]:
        return await self._one(  # type: ignore[return-value]
            "insert into public.companies (owner_profile_id, name) values (:pid, :name) "
            "on conflict (owner_profile_id) do update set name = excluded.name returning *",
            {"pid": profile_id, "name": name},
        )

    async def update_company(self, company_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        sets, params = [], {"id": company_id}
        for key in ("name", "smtp", "judge_defaults", "judge_roster"):
            if key in fields:
                if key == "name":
                    sets.append("name = :name")
                    params["name"] = fields["name"]
                else:
                    sets.append(f"{key} = cast(:{key} as jsonb)")
                    params[key] = json.dumps(fields[key])
        if not sets:
            return await self.get_company(company_id)  # type: ignore[return-value]
        return await self._one(  # type: ignore[return-value]
            f"update public.companies set {', '.join(sets)} where id = :id returning *", params
        )

    # ---- topics -------------------------------------------------------------
    async def list_topics(self, company_id: str) -> list[dict[str, Any]]:
        return await self._all(
            "select t.*, (select count(*) from public.assessments a where a.topic_id = t.id) as assessment_count "
            "from public.company_topics t where t.company_id = :cid order by t.created_at desc",
            {"cid": company_id},
        )

    async def get_topic(self, company_id: str, topic_id: str) -> dict[str, Any] | None:
        return await self._one(
            "select * from public.company_topics where id = :id and company_id = :cid",
            {"id": topic_id, "cid": company_id},
        )

    async def insert_topic(self, company_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return await self._one(  # type: ignore[return-value]
            "insert into public.company_topics (company_id, title, description, track, incident, difficulty, judges, judge_ids) "
            "values (:cid, :title, :description, :track, :incident, :difficulty, cast(:judges as jsonb), cast(:judge_ids as jsonb)) returning *",
            {"cid": company_id, **data, "judges": json.dumps(data["judges"]), "judge_ids": _json_or_null(data.get("judge_ids"))},
        )

    async def update_topic(self, company_id: str, topic_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
        return await self._one(
            "update public.company_topics set title = :title, description = :description, track = :track, "
            "incident = :incident, difficulty = :difficulty, judges = cast(:judges as jsonb), judge_ids = cast(:judge_ids as jsonb) "
            "where id = :id and company_id = :cid returning *",
            {"id": topic_id, "cid": company_id, **data, "judges": json.dumps(data["judges"]), "judge_ids": _json_or_null(data.get("judge_ids"))},
        )

    async def delete_topic(self, company_id: str, topic_id: str) -> None:
        await self.session.execute(
            text("delete from public.company_topics where id = :id and company_id = :cid"),
            {"id": topic_id, "cid": company_id},
        )

    # ---- assessments --------------------------------------------------------
    async def list_assessments(self, company_id: str) -> list[dict[str, Any]]:
        return await self._all(
            "select a.*, t.title as topic_title, t.track, "
            " count(i.id) as invited, "
            " count(i.opened_at) as opened, "
            " count(i.session_id) as started, "
            " count(e.id) filter (where e.status = 'completed') as completed, "
            " avg(e.overall_score) filter (where e.status = 'completed') as avg_score "
            "from public.assessments a "
            "join public.company_topics t on t.id = a.topic_id "
            "left join public.assessment_invites i on i.assessment_id = a.id "
            "left join lateral (select id, status, overall_score from public.evaluations ev "
            "  where ev.session_id = i.session_id order by ev.created_at desc limit 1) e on true "
            "where a.company_id = :cid group by a.id, t.title, t.track order by a.created_at desc",
            {"cid": company_id},
        )

    async def get_assessment(self, company_id: str, assessment_id: str) -> dict[str, Any] | None:
        return await self._one(
            "select a.*, t.title as topic_title, t.track, t.description as topic_description "
            "from public.assessments a join public.company_topics t on t.id = a.topic_id "
            "where a.id = :id and a.company_id = :cid",
            {"id": assessment_id, "cid": company_id},
        )

    async def insert_assessment(self, company_id: str, topic_id: str, title: str, message: str) -> dict[str, Any]:
        return await self._one(  # type: ignore[return-value]
            "insert into public.assessments (company_id, topic_id, title, message) "
            "values (:cid, :tid, :title, :message) returning *",
            {"cid": company_id, "tid": topic_id, "title": title, "message": message},
        )

    async def set_assessment_status(self, company_id: str, assessment_id: str, status: str) -> None:
        await self.session.execute(
            text("update public.assessments set status = :s where id = :id and company_id = :cid"),
            {"s": status, "id": assessment_id, "cid": company_id},
        )

    # ---- invites ------------------------------------------------------------
    async def upsert_invite(self, assessment_id: str, email: str, name: str | None, token: str) -> tuple[dict[str, Any], bool]:
        """(invite, created). An email already invited keeps its token and progress."""
        row = await self._one(
            "insert into public.assessment_invites (assessment_id, email, candidate_name, token) "
            "values (:aid, :email, :name, :token) on conflict (assessment_id, email) do nothing returning *",
            {"aid": assessment_id, "email": email, "name": name, "token": token},
        )
        if row is not None:
            return row, True
        existing = await self._one(
            "select * from public.assessment_invites where assessment_id = :aid and email = :email",
            {"aid": assessment_id, "email": email},
        )
        return existing, False  # type: ignore[return-value]

    async def mark_invite_email(self, invite_id: str, ok: bool, error: str | None) -> None:
        await self.session.execute(
            text(
                "update public.assessment_invites set email_status = :st, email_error = :err, "
                "sent_at = case when :ok then now() else sent_at end where id = :id"
            ),
            {"st": "sent" if ok else "failed", "err": error, "ok": ok, "id": invite_id},
        )

    async def mark_invite_notified(self, invite_id: str, channel: str) -> None:
        await self.session.execute(
            text(
                "update public.assessment_invites set channel = :ch, notified_at = now(), "
                "sent_at = coalesce(sent_at, now()) where id = :id"
            ),
            {"ch": channel, "id": invite_id},
        )

    async def list_invites(self, assessment_id: str) -> list[dict[str, Any]]:
        """Invites with the candidate's session status and latest evaluation."""
        return await self._all(
            "select i.*, s.status as session_status, s.started_at as session_started_at, s.ended_at, "
            " p.display_name, e.id as evaluation_id, e.status as evaluation_status, e.overall_score, "
            " e.report_summary, e.report_metadata "
            "from public.assessment_invites i "
            "left join public.simulation_sessions s on s.id = i.session_id "
            "left join public.profiles p on p.id = i.profile_id "
            "left join lateral (select * from public.evaluations ev where ev.session_id = i.session_id "
            "  order by ev.created_at desc limit 1) e on true "
            "where i.assessment_id = :aid order by i.created_at",
            {"aid": assessment_id},
        )

    async def invite_item_scores(self, assessment_id: str) -> list[dict[str, Any]]:
        return await self._all(
            "select i.id as invite_id, it.criterion_id, it.criterion_name, it.status, it.score, it.score_max, "
            " it.explanation, it.recommendation "
            "from public.assessment_invites i "
            "join lateral (select id from public.evaluations ev where ev.session_id = i.session_id "
            "  and ev.status = 'completed' order by ev.created_at desc limit 1) e on true "
            "join public.evaluation_items it on it.evaluation_id = e.id "
            "where i.assessment_id = :aid",
            {"aid": assessment_id},
        )

    async def get_invite(self, assessment_id: str, invite_id: str) -> dict[str, Any] | None:
        return await self._one(
            "select * from public.assessment_invites where id = :id and assessment_id = :aid",
            {"id": invite_id, "aid": assessment_id},
        )

    async def delete_invite(self, assessment_id: str, invite_id: str) -> None:
        await self.session.execute(
            text("delete from public.assessment_invites where id = :id and assessment_id = :aid and session_id is null"),
            {"id": invite_id, "aid": assessment_id},
        )

    async def get_invite_by_token(self, token: str) -> dict[str, Any] | None:
        return await self._one(
            "select i.*, a.title as assessment_title, a.message, a.status as assessment_status, a.topic_id, "
            " a.company_id, c.name as company_name, t.title as topic_title, t.description as topic_description, "
            " t.difficulty, t.track "
            "from public.assessment_invites i "
            "join public.assessments a on a.id = i.assessment_id "
            "join public.companies c on c.id = a.company_id "
            "join public.company_topics t on t.id = a.topic_id "
            "where i.token = :token",
            {"token": token},
        )

    async def mark_invite_opened(self, invite_id: str) -> None:
        await self.session.execute(
            text("update public.assessment_invites set opened_at = coalesce(opened_at, now()) where id = :id"),
            {"id": invite_id},
        )

    async def claim_invite(self, invite_id: str, profile_id: str, session_id: str) -> dict[str, Any] | None:
        """Link the candidate's session; only an unclaimed invite (or the same candidate) can claim it."""
        return await self._one(
            "update public.assessment_invites set profile_id = :pid, session_id = :sid, started_at = now(), "
            " opened_at = coalesce(opened_at, now()) "
            "where id = :id and (profile_id is null or profile_id = :pid) returning *",
            {"id": invite_id, "pid": profile_id, "sid": session_id},
        )

    async def invite_for_session(self, session_id: str) -> dict[str, Any] | None:
        return await self._one(
            "select i.id, c.name as company_name, a.title as assessment_title "
            "from public.assessment_invites i join public.assessments a on a.id = i.assessment_id "
            "join public.companies c on c.id = a.company_id where i.session_id = :sid",
            {"sid": session_id},
        )

    # ---- workplace world ----------------------------------------------------
    async def get_world(self, company_id: str) -> dict[str, Any] | None:
        return await self._one("select * from public.company_worlds where company_id = :cid", {"cid": company_id})

    async def create_world(self, company_id: str, draft: dict[str, Any]) -> dict[str, Any]:
        """Create the company's world row (or return the existing one untouched)."""
        row = await self._one(
            "insert into public.company_worlds (company_id, draft) values (:cid, cast(:d as jsonb)) "
            "on conflict (company_id) do nothing returning *",
            {"cid": company_id, "d": json.dumps(draft)},
        )
        return row or await self.get_world(company_id)  # type: ignore[return-value]

    async def save_draft(self, company_id: str, draft: dict[str, Any], base_version: int) -> dict[str, Any] | None:
        """Optimistic save: only succeeds if nobody saved since `base_version`."""
        return await self._one(
            "update public.company_worlds set draft = cast(:d as jsonb), draft_version = draft_version + 1 "
            "where company_id = :cid and draft_version = :v returning draft_version, updated_at",
            {"cid": company_id, "d": json.dumps(draft), "v": base_version},
        )

    async def publish_world(self, company_id: str, base_version: int) -> dict[str, Any] | None:
        return await self._one(
            "update public.company_worlds set published = draft, published_version = draft_version, published_at = now() "
            "where company_id = :cid and draft_version = :v returning published_version, published_at",
            {"cid": company_id, "v": base_version},
        )

    async def revert_draft(self, company_id: str) -> dict[str, Any] | None:
        return await self._one(
            "update public.company_worlds set draft = published, draft_version = draft_version + 1 "
            "where company_id = :cid and published is not null returning draft_version",
            {"cid": company_id},
        )

    async def update_workplace(self, company_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        sets, params = [], {"id": company_id}
        if "world_mode" in fields:
            sets.append("world_mode = :mode")
            params["mode"] = fields["world_mode"]
        for key in ("world_setup", "team_members"):
            if key in fields:
                sets.append(f"{key} = cast(:{key} as jsonb)")
                params[key] = json.dumps(fields[key])
        if not sets:
            return await self.get_company(company_id)  # type: ignore[return-value]
        return await self._one(  # type: ignore[return-value]
            f"update public.companies set {', '.join(sets)} where id = :id returning *", params
        )
