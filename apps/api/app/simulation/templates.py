"""Approved, pre-authored scenario templates.

The first family is a production-incident response. Variations change surface details
(service, timing, impact, stakeholder voice) but keep the learning objectives, action
graph, required facts and rubric stable so scores are comparable across attempts.
"""

from __future__ import annotations

import random

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
                    "Inspected impact, error rates, recent deploys and logs, asked targeted "
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


def _locations() -> list[LocationDef]:
    return [
        LocationDef(id="reception", name="Reception", description="Front desk and entrance.", order=0),
        LocationDef(id="corridor_main", name="Main Corridor", kind="corridor", order=1),
        LocationDef(
            id="engineering_workspace",
            name="Engineering Workspace",
            description="Open-plan desks, incident dashboard and observability consoles.",
            order=2,
        ),
        LocationDef(id="meeting_room", name="Meeting Room", description="Client and team meetings.", order=3),
        LocationDef(id="manager_office", name="Manager's Office", description="Your manager's workspace.", order=4),
        LocationDef(id="collaboration_area", name="Collaboration Area", description="QA and pairing space.", order=5),
        LocationDef(id="corridor_west", name="West Corridor", kind="corridor", order=6),
        LocationDef(id="break_area", name="Break Area", description="Kitchen and quiet corner.", order=7),
    ]


def _characters(rng: random.Random, manager: str, teammate: str, qa: str, client: str) -> list[CharacterBlueprint]:
    teammate_styles = [
        "Precise, slightly blunt, prefers facts over reassurance.",
        "Helpful and collaborative, explains reasoning step by step.",
        "Calm under pressure, asks clarifying questions before answering.",
    ]
    return [
        CharacterBlueprint(
            id="manager",
            name=manager,
            role="Engineering Manager",
            style="Direct, supportive, focused on impact and timelines.",
            goals=["Understand customer impact", "Get a clear update before the reporting deadline"],
            location_id="manager_office",
            sprite="blue_haired_woman",
            initial_fact_ids=["f_business_impact", "f_reporting_deadline"],
            disclosure_rules=[
                DisclosureRule(
                    fact_id="f_business_impact",
                    keywords=["impact", "customer", "affected", "how bad", "users", "revenue", "business"],
                ),
                DisclosureRule(
                    fact_id="f_reporting_deadline",
                    keywords=["deadline", "when", "update", "how long", "time", "report", "escalat"],
                ),
            ],
            greeting="Thanks for jumping on this. Give me the short version: what's the blast radius?",
        ),
        CharacterBlueprint(
            id="teammate",
            name=teammate,
            role="Senior Backend Engineer",
            style=rng.choice(teammate_styles),
            goals=["Identify the technical cause", "Avoid making the incident worse"],
            location_id="engineering_workspace",
            sprite="blonde_man",
            initial_fact_ids=["f_migration_ran"],
            disclosure_rules=[
                DisclosureRule(
                    fact_id="f_migration_ran",
                    keywords=["migration", "schema", "deploy", "database", "db", "change", "release"],
                ),
                DisclosureRule(
                    fact_id="f_migration_incompatible",
                    keywords=["rollback", "compatible", "safe", "forward", "revert"],
                    requires_facts=["f_migration_ran"],
                ),
            ],
            greeting="Hey — yeah, the 500s started right after the deploy. Want me to walk you through what changed?",
        ),
        CharacterBlueprint(
            id="qa",
            name=qa,
            role="QA Engineer",
            style="Detail-oriented, a little frustrated about process gaps.",
            goals=["Report what testing missed", "Prevent a repeat"],
            location_id="collaboration_area",
            sprite="cat_brown",
            initial_fact_ids=["f_ci_skipped"],
            disclosure_rules=[
                DisclosureRule(
                    fact_id="f_ci_skipped",
                    keywords=["test", "ci", "pipeline", "qa", "check", "regression", "skipped"],
                )
            ],
            greeting="If you're looking into the checkout failures, the pipeline has a story to tell.",
        ),
        CharacterBlueprint(
            id="client_pm",
            name=client,
            role="Client Product Manager",
            style="Anxious, focused on their own customers.",
            goals=["Understand when checkout works again"],
            location_id="meeting_room",
            sprite="cat_white",
            initial_fact_ids=["f_client_impact"],
            disclosure_rules=[
                DisclosureRule(
                    fact_id="f_client_impact",
                    keywords=["customer", "impact", "checkout", "orders", "client", "workflow", "when"],
                )
            ],
            greeting="My team can't complete orders. What is happening, and when will it be fixed?",
        ),
        CharacterBlueprint(
            id="coworker",
            name="Sam Rivera",
            role="Product Designer",
            style="Chatty and friendly, offers general context.",
            goals=["Help however they can"],
            location_id="break_area",
            sprite="cat_brown2",
            initial_fact_ids=[],
            disclosure_rules=[],
            greeting="Rough morning! Everyone's been sprinting between the war room and the dashboard.",
        ),
    ]


def _facts(rng: random.Random, service: str, pct: int) -> list[Fact]:
    return [
        Fact(
            id="f_initial_5xx",
            label="Service returning HTTP 500s",
            detail=f"{service} is returning HTTP 500 responses in production.",
            sensitivity="public",
            keywords=["500", "error", "down", "failing"],
        ),
        Fact(
            id="f_deploy_event",
            label="Deployment just completed",
            detail="The incident dashboard shows error rates spiking within minutes of the most recent deployment.",
            sensitivity="internal",
            discovered_by_actions=["a_inspect_dashboard"],
        ),
        Fact(
            id="f_error_logs",
            label="Error logs point to the database",
            detail="Application logs show failed database queries referencing a column that does not exist yet.",
            sensitivity="internal",
            discovered_by_actions=["a_inspect_logs"],
        ),
        Fact(
            id="f_connection_pool",
            label="Connection pool is saturated",
            detail="The database connection pool is exhausted by retries, amplifying the failure.",
            sensitivity="internal",
            discovered_by_actions=["a_inspect_metrics"],
        ),
        Fact(
            id="f_no_canary",
            label="Deploy went straight to 100%",
            detail="The deployment was applied to all instances with no canary stage.",
            sensitivity="internal",
            discovered_by_actions=["a_inspect_deploy"],
        ),
        Fact(
            id="f_runbook_rollback",
            label="Rollback requires a compatibility check",
            detail="The ops runbook states rollback must not run until the migration is checked for compatibility.",
            sensitivity="internal",
            discovered_by_actions=["a_inspect_runbook"],
        ),
        Fact(
            id="f_business_impact",
            label="Business impact",
            detail=f"About {pct}% of customer requests are failing; checkout is degraded.",
            sensitivity="internal",
            initially_known_by=["manager"],
            keywords=["impact", "business"],
        ),
        Fact(
            id="f_reporting_deadline",
            label="Reporting deadline",
            detail="Leadership needs a written status update from the on-call engineer soon.",
            sensitivity="internal",
            initially_known_by=["manager"],
            keywords=["deadline"],
        ),
        Fact(
            id="f_migration_ran",
            label="A database migration shipped with the deploy",
            detail="This release included a database schema migration, not just application code.",
            sensitivity="internal",
            initially_known_by=["teammate"],
            keywords=["migration"],
        ),
        Fact(
            id="f_migration_incompatible",
            label="The migration is not backward compatible",
            detail=(
                "The migration removed/renamed a column the previous application version still "
                "expects, so a plain code rollback will keep failing until compatibility is restored."
            ),
            sensitivity="restricted",
            initially_known_by=["teammate"],
            keywords=["compatibility"],
        ),
        Fact(
            id="f_ci_skipped",
            label="Integration tests were skipped in CI",
            detail="The integration test suite was skipped on this pipeline run, so the breakage was not caught.",
            sensitivity="internal",
            initially_known_by=["qa"],
            keywords=["test"],
        ),
        Fact(
            id="f_client_impact",
            label="Client workflow is blocked",
            detail="The client's operations team cannot complete orders through the API.",
            sensitivity="internal",
            initially_known_by=["client_pm"],
            keywords=["client"],
        ),
    ]


def _objectives() -> list[Objective]:
    return [
        Objective(
            id="o_establish_impact",
            label="Establish the impact",
            description="Determine who is affected and how badly.",
            required=True,
            completed_by_facts=["f_business_impact"],
        ),
        Objective(
            id="o_gather_evidence",
            label="Investigate evidence",
            description="Inspect logs and/or metrics to find the likely cause.",
            required=True,
            completed_by_actions=["a_inspect_logs", "a_inspect_metrics"],
        ),
        Objective(
            id="o_identify_risk",
            label="Identify the rollback risk",
            description="Verify whether the migration is compatible before changing production.",
            required=True,
            completed_by_actions=["a_check_migration_compat"],
        ),
        Objective(
            id="o_choose_mitigation",
            label="Choose a safe mitigation",
            description="Apply a mitigation consistent with the migration's compatibility.",
            required=True,
            completed_by_actions=["a_apply_rollback", "a_apply_forward_fix"],
        ),
        Objective(
            id="o_communicate",
            label="Communicate a status update",
            description="Send stakeholders a clear written update.",
            required=True,
            completed_by_actions=["a_send_status_update"],
        ),
        Objective(
            id="o_followup",
            label="Document follow-up",
            description="Record a follow-up/prevention action.",
            required=False,
            completed_by_actions=["a_document_followup"],
        ),
    ]


def _actions() -> list[ActionDefinition]:
    return [
        ActionDefinition(
            id="a_inspect_dashboard",
            label="Inspect incident dashboard",
            description="Open the incident dashboard for current error rates and recent deploys.",
            action_type="inspect",
            kind="investigation",
            location_id="engineering_workspace",
            target_id="incident_dashboard",
            effects=Effect(reveal_fact_ids=["f_deploy_event"]),
        ),
        ActionDefinition(
            id="a_inspect_logs",
            label="Inspect application logs",
            description="Read recent application error logs.",
            action_type="inspect",
            kind="investigation",
            location_id="engineering_workspace",
            target_id="log_viewer",
            effects=Effect(
                reveal_fact_ids=["f_error_logs"],
                complete_objective_ids=["o_gather_evidence"],
                set_flag={"logs_inspected": "yes"},
            ),
            initially_available=True,
        ),
        ActionDefinition(
            id="a_inspect_metrics",
            label="Inspect database metrics",
            description="Check connection pool and error metrics.",
            action_type="inspect",
            kind="investigation",
            location_id="engineering_workspace",
            target_id="metrics_panel",
            effects=Effect(
                reveal_fact_ids=["f_connection_pool"],
                complete_objective_ids=["o_gather_evidence"],
                set_flag={"metrics_inspected": "yes"},
            ),
        ),
        ActionDefinition(
            id="a_inspect_deploy",
            label="Inspect deployment console",
            description="Review the deployment rollout and its stages.",
            action_type="inspect",
            kind="investigation",
            location_id="engineering_workspace",
            target_id="deploy_console",
            effects=Effect(reveal_fact_ids=["f_no_canary"], set_flag={"deploy_inspected": "yes"}),
        ),
        ActionDefinition(
            id="a_inspect_runbook",
            label="Read the ops runbook",
            description="Open the incident runbook pinned in the workspace.",
            action_type="inspect",
            kind="investigation",
            location_id="engineering_workspace",
            target_id="runbook",
            effects=Effect(reveal_fact_ids=["f_runbook_rollback"]),
        ),
        ActionDefinition(
            id="a_check_migration_compat",
            label="Check migration compatibility",
            description="Compare the shipped migration against the currently deployed application version.",
            action_type="mitigate",
            kind="decision",
            location_id="engineering_workspace",
            target_id="migration_notes",
            preconditions=[
                Precondition(
                    kind="fact_known",
                    ref="f_migration_ran",
                    failure_message=(
                        "You need to know what shipped in the deploy before checking the migration. "
                        "Talk to your teammate about the release."
                    ),
                )
            ],
            effects=Effect(
                reveal_fact_ids=["f_migration_incompatible"],
                complete_objective_ids=["o_identify_risk"],
                set_flag={"migration_checked": "yes"},
            ),
        ),
        ActionDefinition(
            id="a_apply_rollback",
            label="Roll back the deployment",
            description="Revert the application to the previous version.",
            action_type="mitigate",
            kind="mitigation",
            location_id="engineering_workspace",
            target_id="deploy_console",
            risk_level="high",
            preconditions=[
                Precondition(
                    kind="flag_equals",
                    ref="migration_checked",
                    value="yes",
                    failure_message=(
                        "Rolling back now is unsafe: the migration compatibility has not been checked. "
                        "Verify whether a rollback is safe first."
                    ),
                )
            ],
            effects=Effect(
                complete_objective_ids=["o_choose_mitigation"],
                set_flag={"mitigation": "rollback", "incident_status": "mitigated"},
            ),
        ),
        ActionDefinition(
            id="a_apply_forward_fix",
            label="Apply the forward fix",
            description="Ship a compatibility migration / hotfix rather than reverting.",
            action_type="mitigate",
            kind="mitigation",
            location_id="engineering_workspace",
            target_id="deploy_console",
            risk_level="low",
            preconditions=[
                Precondition(
                    kind="fact_known",
                    ref="f_migration_incompatible",
                    failure_message="Confirm the cause before applying a fix.",
                )
            ],
            effects=Effect(
                complete_objective_ids=["o_choose_mitigation"],
                set_flag={"mitigation": "forward_fix", "incident_status": "mitigated"},
            ),
        ),
        ActionDefinition(
            id="a_restart_service",
            label="Restart the service",
            description="Restart the affected service to clear the errors.",
            action_type="mitigate",
            kind="mitigation",
            location_id="engineering_workspace",
            target_id="deploy_console",
            risk_level="low",
            effects=Effect(set_flag={"mitigation": "restart"}),
        ),
        ActionDefinition(
            id="a_send_status_update",
            label="Send status update",
            description="Write and send a stakeholder status update.",
            action_type="communicate",
            kind="communication",
            requires_text=True,
            preconditions=[
                Precondition(
                    kind="fact_known",
                    ref="f_business_impact",
                    failure_message="Get the impact from your manager before writing the update.",
                )
            ],
            effects=Effect(
                complete_objective_ids=["o_communicate"],
                set_flag={"update_sent": "yes"},
            ),
        ),
        ActionDefinition(
            id="a_document_followup",
            label="Document follow-up action",
            description="Record a prevention/follow-up action on the incident.",
            action_type="communicate",
            kind="decision",
            location_id="engineering_workspace",
            target_id="incident_dashboard",
            preconditions=[
                Precondition(
                    kind="objective_complete",
                    ref="o_choose_mitigation",
                    failure_message="Decide on the mitigation before documenting follow-up.",
                )
            ],
            effects=Effect(complete_objective_ids=["o_followup"]),
        ),
    ]


def _objects() -> list[InteractiveObject]:
    return [
        InteractiveObject(id="incident_dashboard", label="Incident dashboard", location_id="engineering_workspace", marker="dashboard"),
        InteractiveObject(id="log_viewer", label="Application logs", location_id="engineering_workspace", marker="console"),
        InteractiveObject(id="metrics_panel", label="Database metrics", location_id="engineering_workspace", marker="console"),
        InteractiveObject(id="deploy_console", label="Deployment console", location_id="engineering_workspace", marker="console"),
        InteractiveObject(id="runbook", label="Ops runbook", location_id="engineering_workspace", marker="board"),
        InteractiveObject(id="migration_notes", label="Migration notes", location_id="engineering_workspace", marker="board"),
        InteractiveObject(id="team_board", label="Task board", location_id="collaboration_area", marker="board"),
        InteractiveObject(id="meeting_whiteboard", label="Whiteboard", location_id="meeting_room", marker="board"),
        InteractiveObject(id="coffee_machine", label="Coffee machine", location_id="break_area", marker="misc"),
        InteractiveObject(id="reception_desk", label="Reception desk", location_id="reception", marker="misc"),
    ]


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
    service = rng.choice(["checkout-api", "orders-service", "payments-gateway", "catalog-api"])
    deploy_minutes = rng.choice([6, 9, 12, 15])
    pct = rng.choice([18, 24, 31, 42])
    manager = rng.choice(["Priya Sharma", "Dana Whitfield", "Amara Osei"])
    teammate = rng.choice(["Marcus Chen", "Diego Alvarez", "Noah Kim"])
    qa = rng.choice(["Dana Okafor", "Ravi Iyer", "Lena Petrov"])
    client = rng.choice(["Leo Martins", "Sofia Almeida", "Hannah Berg"])

    difficulty_minutes = {"introductory": 8, "standard": 10, "challenging": 15}[difficulty]  # type: ignore[index]

    competency_goals = list(profile_goals or []) or [
        "technical_reasoning",
        "risk_management",
        "stakeholder_communication",
    ]

    blueprint = ScenarioBlueprint(
        family_slug=TEMPLATE_SLUG,
        version=1,
        title="Unexpected error spike after deployment",
        briefing=(
            f"You are on-call as a {role}. About {deploy_minutes} minutes ago a deployment of "
            f"{service} went to production. Error rates jumped immediately and customers are "
            "reporting failures. Investigate what happened, decide on a safe response, and keep "
            "stakeholders informed. You can walk the office, talk to people, and inspect consoles."
        ),
        role=role,
        difficulty=difficulty,  # type: ignore[arg-type]
        mode=mode,  # type: ignore[arg-type]
        estimated_minutes=difficulty_minutes,
        competency_goals=competency_goals,
        locations=_locations(),
        characters=_characters(rng, manager, teammate, qa, client),
        facts=_facts(rng, service, pct),
        objectives=_objectives(),
        actions=_actions(),
        objects=_objects(),
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
            summary_template="Establish impact, investigate the deploy, verify rollback risk, mitigate safely and update stakeholders.",
        ),
        reference_paths=[
            ReferencePath(
                id="preferred",
                steps=[
                    "a_inspect_dashboard",
                    "a_inspect_logs",
                    "a_inspect_deploy",
                    "a_check_migration_compat",
                    "a_apply_rollback",
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
            },
            "deadline_minutes": 18,
        },
        metadata={
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
    }
]
