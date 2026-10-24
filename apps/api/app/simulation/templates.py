"""Approved, pre-authored scenario templates.

The first family is a production-incident response, re-told per role track (see tracks.py). Variations change surface details
(service, timing, impact, stakeholder voice) but keep the learning objectives, action
graph, required facts and rubric stable so scores are comparable across attempts.
"""

from __future__ import annotations

import random
from typing import Any

from app.schemas.scenario import (
    ActionDefinition,
    CharacterBlueprint,
    CompletionContract,
    DisclosureRule,
    Effect,
    Fact,
    InteractiveObject,
    LocationDef,
    Objective,
    Precondition,
    ReferencePath,
    Rubric,
    RubricCriterion,
    ScenarioBlueprint,
    TaskDef,
)
from app.simulation.tracks import COMMON_SAY_NEXT_TIME, TRACKS, gender_of, track_for

RUBRIC_VERSION = "production-incident-v1"
TEMPLATE_SLUG = "production-incident"


def _rubric() -> Rubric:
    return Rubric(
        version=RUBRIC_VERSION,
        scale_max=4,
        criteria=[
            RubricCriterion(
                id="diagnosis",
                name="Diagnosis and information gathering",
                description=(
                    "Inspected impact, signals, recent changes and logs, asked targeted "
                    "questions, and distinguished observation from speculation."
                ),
                evidence_hint="Inspection actions and targeted questions before acting.",
                anchors={
                    "0": "Acted without relevant evidence and ignored available diagnostic information.",
                    "1": "Requested vague information but missed major evidence sources.",
                    "2": "Checked one useful signal but left a key uncertainty unaddressed.",
                    "3": "Collected relevant evidence and used it to narrow the cause.",
                    "4": "Prioritized high-value evidence, stated uncertainty and updated the hypothesis.",
                },
            ),
            RubricCriterion(
                id="risk_decision",
                name="Risk-aware technical decision",
                description=(
                    "Used preconditions, rollback compatibility, mitigations, verification and "
                    "reversibility before recommending a change."
                ),
                evidence_hint="Mitigation actions and whether prerequisites were checked first.",
                anchors={
                    "0": "Recommended a dangerous action while ignoring an explicit critical risk.",
                    "1": "Recognized risk only after a prompt or proposed an incomplete mitigation.",
                    "2": "Named a risk but did not verify preconditions or recovery.",
                    "3": "Chose a defensible mitigation and checked major preconditions.",
                    "4": "Balanced impact, reversibility, compatibility, verification and rollback/fix options.",
                },
            ),
            RubricCriterion(
                id="communication",
                name="Stakeholder communication",
                description=(
                    "Communicated impact, what is known and unknown, next action, ownership and a "
                    "sensible update cadence."
                ),
                evidence_hint="The written status update deliverable.",
                anchors={
                    "0": "Misled stakeholders or made unsupported promises while the service was affected.",
                    "1": "Gave vague reassurance with no ownership or update commitment.",
                    "2": "Explained some facts but omitted impact, next action or update cadence.",
                    "3": "Gave a clear factual update and a sensible next update time.",
                    "4": "Tailored the update, made uncertainty explicit and committed to follow-up.",
                },
            ),
            RubricCriterion(
                id="ownership",
                name="Ownership and coordination",
                description=(
                    "Took ownership of next steps, involved relevant teammates and tracked follow-up."
                ),
                evidence_hint="Follow-up actions and coordination with teammates.",
                anchors={
                    "0": "Hid or ignored material information and abandoned the task.",
                    "1": "Waited passively or gave no actionable next step.",
                    "2": "Took some responsibility but follow-up or coordination stayed unclear.",
                    "3": "Owned next steps and involved a relevant teammate or stakeholder.",
                    "4": "Coordinated a clear plan, documented decisions and identified follow-up ownership.",
                },
            ),
            RubricCriterion(
                id="adaptation",
                name="Adaptation and closure",
                description=(
                    "Changed the plan when evidence shifted, verified recovery and stated incident "
                    "status and follow-up."
                ),
                evidence_hint="Verification actions and closure statements.",
                anchors={
                    "0": "Persisted with an invalid plan despite contradictory evidence.",
                    "1": "Acknowledged new evidence without changing the plan.",
                    "2": "Changed plan but did not validate recovery or communicate closure.",
                    "3": "Updated the plan using new evidence and verified service recovery.",
                    "4": "Re-evaluated assumptions, confirmed signals and proposed a proportionate follow-up.",
                },
            ),
        ],
    )


# The company each session happens at; every one sells something, so "checkout" and "sign-ups" fit all tracks.
COMPANIES = [
    ("Basketly", "a grocery delivery app"),
    ("TripNest", "a travel booking site"),
    ("Seatwave", "a concert ticketing platform"),
    ("Threadline", "an online fashion store"),
    ("FitPass", "a gym membership app"),
    ("Pawprint", "a pet supplies shop"),
    ("Bookmark", "an online bookstore"),
    ("MealDrop", "a meal-kit subscription"),
    ("GearHub", "an outdoor gear marketplace"),
    ("Studyo", "an online course platform"),
    ("Plantly", "a houseplant delivery service"),
    ("RideShare Go", "a bike and scooter rental app"),
]


def _fmt(text: str, ctx: dict[str, Any]) -> str:
    return text.format(**ctx)


def _locations(t: dict[str, Any]) -> list[LocationDef]:
    ws_name, ws_desc = t["workspace"]
    return [
        LocationDef(id="reception", name="Reception", description="Front desk and entrance.", order=0),
        LocationDef(id="corridor_main", name="Main Corridor", kind="corridor", order=1),
        LocationDef(id="engineering_workspace", name=ws_name, description=ws_desc, order=2),
        LocationDef(id="meeting_room", name="Meeting Room", description="Client and team meetings.", order=3),
        LocationDef(id="manager_office", name="Manager's Office", description="Your manager's workspace.", order=4),
        LocationDef(id="collaboration_area", name="Collaboration Area", description="QA and pairing space.", order=5),
        LocationDef(id="corridor_west", name="West Corridor", kind="corridor", order=6),
        LocationDef(id="break_area", name="Break Area", description="Kitchen and quiet corner.", order=7),
    ]


# Engine wiring per character slot (same for every track): where they sit, sprite, what they know.
_SLOTS: dict[str, dict[str, Any]] = {
    "manager": {"location": "manager_office", "sprite": "blue_haired_woman", "facts": ["f_business_impact", "f_reporting_deadline"]},
    "teammate": {"location": "engineering_workspace", "sprite": "blonde_man", "facts": ["f_migration_ran"]},
    "qa": {"location": "collaboration_area", "sprite": "cat_brown", "facts": ["f_ci_skipped"]},
    "client_pm": {"location": "meeting_room", "sprite": "cat_white", "facts": ["f_client_impact"]},
    "coworker": {"location": "break_area", "sprite": "cat_brown2", "facts": []},
}
_GOALS = {
    "manager": ["Hear the cause and a safe plan from the learner", "Get a clear status update before the reporting deadline"],
    "teammate": ["Identify the technical cause", "Avoid making the incident worse"],
    "qa": ["Report what testing missed", "Prevent a repeat"],
    "client_pm": ["Understand when things work again"],
    "coworker": ["Help however they can"],
}


def _characters(t: dict[str, Any], names: dict[str, str]) -> list[CharacterBlueprint]:
    out = []
    for cid, slot in _SLOTS.items():
        c = t["characters"][cid]
        rules = []
        for fact_id, words in c["keywords"].items():
            rules.append(
                DisclosureRule(
                    fact_id=fact_id,
                    keywords=words,
                    requires_facts=["f_migration_ran"] if fact_id == "f_migration_incompatible" else [],
                )
            )
        out.append(
            CharacterBlueprint(
                id=cid,
                name=names[cid],
                role=c["role"],
                style=c["style"],
                goals=_GOALS[cid],
                location_id=slot["location"],
                sprite=slot["sprite"],
                initial_fact_ids=slot["facts"],
                disclosure_rules=rules,
                greeting=c["greeting"],
            )
        )
    return out


_FACT_META: dict[str, dict[str, Any]] = {
    "f_initial_5xx": {"sensitivity": "public", "keywords": ["500", "error", "down", "failing"]},
    "f_deploy_event": {"discovered_by_actions": ["a_inspect_dashboard"]},
    "f_error_logs": {"discovered_by_actions": ["a_inspect_logs"]},
    "f_connection_pool": {"discovered_by_actions": ["a_inspect_metrics"]},
    "f_no_canary": {"discovered_by_actions": ["a_inspect_deploy"]},
    "f_runbook_rollback": {"discovered_by_actions": ["a_inspect_runbook"]},
    "f_business_impact": {"initially_known_by": ["manager"], "keywords": ["impact", "business"]},
    "f_reporting_deadline": {"initially_known_by": ["manager"], "keywords": ["deadline"]},
    "f_migration_ran": {"initially_known_by": ["teammate"], "keywords": ["migration"]},
    "f_migration_incompatible": {"sensitivity": "restricted", "initially_known_by": ["teammate"], "keywords": ["compatibility"]},
    "f_ci_skipped": {"initially_known_by": ["qa"], "keywords": ["test"]},
    "f_client_impact": {"initially_known_by": ["client_pm"], "keywords": ["client"]},
}


def _facts(t: dict[str, Any], ctx: dict[str, Any]) -> list[Fact]:
    out = []
    for fid, meta in _FACT_META.items():
        label, detail = t["facts"][fid]
        out.append(Fact(id=fid, label=_fmt(label, ctx), detail=_fmt(detail, ctx), sensitivity=meta.get("sensitivity", "internal"), **{k: v for k, v in meta.items() if k != "sensitivity"}))
    return out


def _objectives(t: dict[str, Any]) -> list[Objective]:
    risk_label, risk_desc = t["objectives"]["o_identify_risk"]
    fix_label, fix_desc = t["objectives"]["o_choose_mitigation"]
    return [
        Objective(id="o_establish_impact", label="Establish the impact", description="Determine who is affected and how badly.", required=True, completed_by_facts=["f_business_impact"]),
        Objective(id="o_gather_evidence", label="Investigate evidence", description="Look at the evidence to find the likely cause.", required=True, completed_by_actions=["a_inspect_logs", "a_inspect_metrics"]),
        Objective(id="o_identify_risk", label=risk_label, description=risk_desc, required=True, completed_by_actions=["a_check_migration_compat"]),
        Objective(id="o_choose_mitigation", label=fix_label, description=fix_desc, required=True, completed_by_actions=["a_apply_rollback", "a_apply_forward_fix"]),
        Objective(id="o_communicate", label="Communicate a status update", description="Send stakeholders a clear written update.", required=True, completed_by_actions=["a_send_status_update"]),
        Objective(id="o_followup", label="Document follow-up", description="Record a follow-up/prevention action.", required=False, completed_by_actions=["a_document_followup"]),
    ]


def _actions(t: dict[str, Any]) -> list[ActionDefinition]:
    a = t["actions"]

    def label(aid: str) -> dict[str, str]:
        return {"label": a[aid][0], "description": a[aid][1]}

    return [
        ActionDefinition(id="a_inspect_dashboard", **label("a_inspect_dashboard"), action_type="inspect", kind="investigation", location_id="engineering_workspace", target_id="incident_dashboard", effects=Effect(reveal_fact_ids=["f_deploy_event"])),
        ActionDefinition(id="a_inspect_logs", **label("a_inspect_logs"), action_type="inspect", kind="investigation", location_id="engineering_workspace", target_id="log_viewer", effects=Effect(reveal_fact_ids=["f_error_logs"], complete_objective_ids=["o_gather_evidence"], set_flag={"logs_inspected": "yes"}), initially_available=True),
        ActionDefinition(id="a_inspect_metrics", **label("a_inspect_metrics"), action_type="inspect", kind="investigation", location_id="engineering_workspace", target_id="metrics_panel", effects=Effect(reveal_fact_ids=["f_connection_pool"], complete_objective_ids=["o_gather_evidence"], set_flag={"metrics_inspected": "yes"})),
        ActionDefinition(id="a_inspect_deploy", **label("a_inspect_deploy"), action_type="inspect", kind="investigation", location_id="engineering_workspace", target_id="deploy_console", effects=Effect(reveal_fact_ids=["f_no_canary"], set_flag={"deploy_inspected": "yes"})),
        ActionDefinition(id="a_inspect_runbook", **label("a_inspect_runbook"), action_type="inspect", kind="investigation", location_id="engineering_workspace", target_id="runbook", effects=Effect(reveal_fact_ids=["f_runbook_rollback"])),
        ActionDefinition(
            id="a_check_migration_compat", **label("a_check_migration_compat"), action_type="mitigate", kind="decision", location_id="engineering_workspace", target_id="migration_notes",
            preconditions=[Precondition(kind="fact_known", ref="f_migration_ran", failure_message=t["blocked"]["a_check_migration_compat"])],
            effects=Effect(reveal_fact_ids=["f_migration_incompatible"], complete_objective_ids=["o_identify_risk"], set_flag={"migration_checked": "yes"}),
        ),
        ActionDefinition(
            id="a_apply_rollback", **label("a_apply_rollback"), action_type="mitigate", kind="mitigation", location_id="engineering_workspace", target_id="deploy_console", risk_level="high",
            preconditions=[Precondition(kind="flag_equals", ref="migration_checked", value="yes", failure_message=t["blocked"]["a_apply_rollback"])],
            effects=Effect(complete_objective_ids=["o_choose_mitigation"], set_flag={"mitigation": "rollback", "incident_status": "mitigated"}),
        ),
        ActionDefinition(
            id="a_apply_forward_fix", **label("a_apply_forward_fix"), action_type="mitigate", kind="mitigation", location_id="engineering_workspace", target_id="deploy_console", risk_level="low",
            preconditions=[Precondition(kind="fact_known", ref="f_migration_incompatible", failure_message="Confirm the cause before applying a fix.")],
            effects=Effect(complete_objective_ids=["o_choose_mitigation"], set_flag={"mitigation": "forward_fix", "incident_status": "mitigated"}),
        ),
        ActionDefinition(id="a_restart_service", **label("a_restart_service"), action_type="mitigate", kind="mitigation", location_id="engineering_workspace", target_id="deploy_console", risk_level="low", effects=Effect(set_flag={"mitigation": "restart"})),
        ActionDefinition(
            id="a_send_status_update", **label("a_send_status_update"), action_type="communicate", kind="communication", requires_text=True,
            preconditions=[Precondition(kind="fact_known", ref="f_business_impact", failure_message="Get the impact from your manager before writing the update.")],
            effects=Effect(complete_objective_ids=["o_communicate"], set_flag={"update_sent": "yes"}),
        ),
        ActionDefinition(
            id="a_document_followup", **label("a_document_followup"), action_type="communicate", kind="decision", location_id="engineering_workspace", target_id="incident_dashboard",
            preconditions=[Precondition(kind="objective_complete", ref="o_choose_mitigation", failure_message="Decide on the mitigation before documenting follow-up.")],
            effects=Effect(complete_objective_ids=["o_followup"]),
        ),
    ]


def _objects(t: dict[str, Any]) -> list[InteractiveObject]:
    o = t["objects"]
    return [
        InteractiveObject(id="incident_dashboard", label=o["incident_dashboard"], location_id="engineering_workspace", marker="dashboard"),
        InteractiveObject(id="log_viewer", label=o["log_viewer"], location_id="engineering_workspace", marker="console"),
        InteractiveObject(id="metrics_panel", label=o["metrics_panel"], location_id="engineering_workspace", marker="console"),
        InteractiveObject(id="deploy_console", label=o["deploy_console"], location_id="engineering_workspace", marker="console"),
        InteractiveObject(id="runbook", label=o["runbook"], location_id="engineering_workspace", marker="board"),
        InteractiveObject(id="migration_notes", label=o["migration_notes"], location_id="engineering_workspace", marker="board"),
        InteractiveObject(id="team_board", label="Task board", location_id="collaboration_area", marker="board"),
        InteractiveObject(id="meeting_whiteboard", label="Whiteboard", location_id="meeting_room", marker="board"),
        InteractiveObject(id="coffee_machine", label="Coffee machine", location_id="break_area", marker="misc"),
        InteractiveObject(id="reception_desk", label="Reception desk", location_id="reception", marker="misc"),
    ]


def _portrait(name: str) -> str:
    return "/assets/portraits/" + "".join(ch for ch in name.lower().replace(" ", "-") if ch.isalnum() or ch == "-") + ".svg"


def build_production_incident(
    *,
    seed: int,
    difficulty: str = "standard",
    mode: str = "quick",
    role: str = "Junior Backend Developer",
    variation_request: str = "",
    profile_goals: list[str] | None = None,
) -> ScenarioBlueprint:
    rng = random.Random(seed)
    track = track_for(role)
    t = TRACKS[track]
    service = rng.choice(t["services"])
    deploy_minutes = rng.choice([6, 9, 12, 15])
    pct = rng.choice([18, 24, 31, 42])
    names = {cid: rng.choice(options) for cid, options in t["names"].items()}
    company, product = rng.choice(COMPANIES)
    ctx = {"role": role, "service": service, "pct": pct, "minutes": deploy_minutes}

    difficulty_minutes = {"introductory": 8, "standard": 10, "challenging": 15}[difficulty]  # type: ignore[index]

    competency_goals = list(profile_goals or []) or [
        "technical_reasoning",
        "risk_management",
        "stakeholder_communication",
    ]
    characters = _characters(t, names)
    say_next = {**COMMON_SAY_NEXT_TIME, **t["say_next_time"]}

    blueprint = ScenarioBlueprint(
        family_slug=TEMPLATE_SLUG,
        version=1,
        title=t["title"],
        briefing=f"You work at {company}, {product}. "
        + _fmt(t["briefing"], ctx)
        + " You can walk the office, talk to people, and open the tools.",
        role=role,
        difficulty=difficulty,  # type: ignore[arg-type]
        mode=mode,  # type: ignore[arg-type]
        estimated_minutes=difficulty_minutes,
        competency_goals=competency_goals,
        locations=_locations(t),
        characters=characters,
        facts=_facts(t, ctx),
        objectives=_objectives(t),
        actions=_actions(t),
        objects=_objects(t),
        tasks=[
            TaskDef(id="t_investigate", label="Investigate the incident", status="available"),
            TaskDef(id="t_mitigate", label="Mitigate safely", status="locked"),
            TaskDef(id="t_update", label="Send a status update", status="locked"),
        ],
        rubric=_rubric(),
        completion=CompletionContract(
            required_objective_ids=[
                "o_establish_impact",
                "o_gather_evidence",
                "o_identify_risk",
                "o_choose_mitigation",
                "o_communicate",
            ],
            required_action_ids=[],
            summary_template="Establish impact, investigate the change, verify the undo risk, fix safely and update stakeholders.",
        ),
        reference_paths=[
            ReferencePath(
                id="preferred",
                steps=[
                    "a_inspect_dashboard",
                    "a_inspect_logs",
                    "a_inspect_deploy",
                    "a_check_migration_compat",
                    # The change is never backward compatible, so a plain undo keeps failing.
                    "a_apply_forward_fix",
                    "a_send_status_update",
                    "a_document_followup",
                ],
                is_preferred=True,
            )
        ],
        initial_state={
            "phase": "investigate",
            "start_location_id": "reception",
            "incident": {
                "service": service,
                "severity": "high" if pct >= 30 else "medium",
                "status": "investigating",
                "deploy_minutes_ago": deploy_minutes,
                "impact_pct": pct,
                "summary": _fmt(t["incident_line"], ctx),
                "track": track,
                "label": t["label"],
            },
            "deadline_minutes": 18,
        },
        metadata={
            "track": track,
            "evidence_map": {
                "diagnosis": ["action:a_inspect_logs", "action:a_inspect_metrics", "fact:f_error_logs"],
                "risk_decision": [
                    "action:a_check_migration_compat",
                    "action:a_apply_rollback",
                    "action:a_apply_forward_fix",
                ],
                "communication": ["deliverable:status_update"],
                "ownership": ["action:a_document_followup"],
                "adaptation": ["action:a_inspect_metrics", "fact:f_connection_pool"],
            },
            # Per-character extras for the UI: intro card, suggested questions, who knows what.
            "profiles": {
                c.id: {**t["characters"][c.id]["profile"], "portrait": _portrait(c.name), "knows": t["people_knows"][c.id], "gender": gender_of(c.name)}
                for c in characters
            },
            "questions": {
                cid: [{"q": q, "fact": fact} for q, fact in qs] for cid, qs in t["questions"].items()
            },
            "say_next_time": {k: {"to": to, "say": say} for k, (to, say) in say_next.items()},
            "tip_risk": t["tip_risk"],
            # Public story flavour; scenario_service may replace "story" with an Ollama-written one.
            "setting": {"company": company, "product": product, "story": ""},
            "variation": {
                "seed": seed,
                "service": service,
                "variation_request": variation_request,
            },
        },
    )
    return blueprint


TEMPLATE_CATALOG = [
    {
        "slug": TEMPLATE_SLUG,
        "title": "Production Incident Response",
        "summary": (
            "Investigate a production regression after a deploy, decide on a safe mitigation, and "
            "communicate with stakeholders."
        ),
        "categories": ["technical_reasoning", "risk_management", "communication"],
        "target_roles": ["junior_backend_developer", "software_engineer", "on_call_engineer"],
        "supported_modes": ["quick", "project"],
        "estimated_minutes": 10,
        "difficulty_options": ["introductory", "standard", "challenging"],
        "story": (
            "It's your on-call shift. A deploy went out minutes ago and checkout is throwing errors. "
            "Your manager wants the blast radius, the client is anxious, and a rollback might make "
            "things worse. Talk to people, read the consoles, fix it safely and tell everyone."
        ),
        "you_will": [
            "Ask short, sharp questions to 5 colleagues who each know something different",
            "Inspect logs, metrics, the deploy console and the runbook",
            "Decide between a rollback and a forward fix — safely",
            "Write a stakeholder update: impact, cause, action, next update, owner",
        ],
        "people": [
            {"role": "Engineering Manager", "knows": "Customer impact and the reporting deadline"},
            {"role": "Senior Backend Engineer", "knows": "What shipped in the deploy"},
            {"role": "QA Engineer", "knows": "What testing missed"},
            {"role": "Client Product Manager", "knows": "Which client workflows are blocked"},
            {"role": "Product Designer", "knows": "Office gossip — friendly, not much more"},
        ],
        "skills": [
            "Diagnosis",
            "Risk-aware decisions",
            "Stakeholder communication",
            "Ownership",
            "Adaptation",
        ],
        "report": "Evidence Ledger with proof links, skill scores, talk-time charts, a full transcript and lines to say next time.",
    }
]
