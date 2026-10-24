"""Role tracks: the same incident mechanics, re-told for the learner's chosen role.

Every track keeps the engine's ids (facts, actions, objectives, characters) so the simulation,
evidence ledger and guide work unchanged. Only the story changes: what broke, who the colleagues
are, what they know and say, what the consoles are called, and which questions to suggest.
Strings may use {role}, {service}, {pct} and {minutes}.
"""

from __future__ import annotations

from typing import Any

_ROLE_TRACK = {
    "frontend": ("frontend", "mobile", "qa", "test", "ios", "android", "web developer", "ui engineer"),
    "data": ("data", "ml", "machine learning", "analytics", "scientist", "ai engineer"),
    "product": ("product", "design", "ux", "ui/ux", "business", "marketing", "growth", "manager"),
}


def track_for(role: str) -> str:
    r = (role or "").lower()
    for track, words in _ROLE_TRACK.items():
        if any(w in r for w in words):
            return track
    return "backend"


def _profile(years: int, personality: str, traits: list[str], power: str, weakness: str, stats: dict[str, int]) -> dict[str, Any]:
    return {"years": years, "personality": personality, "traits": traits, "power": power, "weakness": weakness, "stats": stats}


TRACKS: dict[str, dict[str, Any]] = {
    # ------------------------------------------------------------------ backend / ops (original)
    "backend": {
        "label": "Production incident",
        "title": "Unexpected error spike after deployment",
        "services": ["checkout-api", "orders-service", "payments-gateway", "catalog-api"],
        "briefing": (
            "You are on-call as a {role}. About {minutes} minutes ago a deployment of {service} went to "
            "production. Error rates jumped immediately and customers are reporting failures. Investigate "
            "what happened, decide on a safe response, and keep stakeholders informed."
        ),
        "incident_line": "{service} is failing; a deploy went out {minutes} minutes ago",
        "workspace": ("Engineering Workspace", "Open-plan desks, incident dashboard and observability consoles."),
        "names": {
            "manager": ["Priya Sharma", "Dana Whitfield", "Amara Osei"],
            "teammate": ["Marcus Chen", "Diego Alvarez", "Noah Kim"],
            "qa": ["Dana Okafor", "Ravi Iyer", "Lena Petrov"],
            "client_pm": ["Leo Martins", "Sofia Almeida", "Hannah Berg"],
            "coworker": ["Sam Rivera", "Kai Tanaka", "Zoe Laurent"],
        },
        "characters": {
            "manager": {
                "role": "Engineering Manager",
                "style": "Direct, supportive, focused on impact and timelines.",
                "greeting": "Thanks for jumping on this. Customers are hitting errors at checkout. Find out what changed and bring me a plan.",
                "keywords": {
                    "f_business_impact": ["impact", "customer", "affected", "how bad", "users", "revenue", "business", "how many"],
                    "f_reporting_deadline": ["deadline", "when", "update", "how long", "time", "report", "escalat"],
                },
                "profile": _profile(11, "Calm commander. Wants the headline first, details second.", ["Decisive", "Fair", "Impatient with waffle"], "Turns chaos into a 3-line plan", "Hates surprises in front of leadership", {"Calm": 88, "Focus": 80, "Empathy": 72, "Speed": 65}),
            },
            "teammate": {
                "role": "Senior Backend Engineer",
                "style": "Precise, slightly blunt, prefers facts over reassurance.",
                "greeting": "Hey — yeah, the 500s started right after the deploy. Want me to walk you through what changed?",
                "keywords": {
                    "f_migration_ran": ["migration", "schema", "deploy", "database", "db", "change", "release", "shipped"],
                    "f_migration_incompatible": ["rollback", "roll back", "compatible", "safe", "forward", "revert"],
                },
                "profile": _profile(7, "Quiet expert. Answers exactly what you ask — ask well.", ["Precise", "Blunt", "Secretly kind"], "Reads stack traces like poetry", "Assumes you already know the context", {"Calm": 76, "Focus": 95, "Empathy": 48, "Speed": 82}),
            },
            "qa": {
                "role": "QA Engineer",
                "style": "Detail-oriented, a little frustrated about process gaps.",
                "greeting": "If you're looking into the checkout failures, the pipeline has a story to tell.",
                "keywords": {"f_ci_skipped": ["test", "ci", "pipeline", "qa", "check", "regression", "skipped"]},
                "profile": _profile(5, "The team's memory. Remembers every corner that was cut.", ["Meticulous", "Honest", "Slightly salty"], "Finds the bug nobody tested for", "Says 'I told you so' (politely)", {"Calm": 62, "Focus": 90, "Empathy": 66, "Speed": 58}),
            },
            "client_pm": {
                "role": "Client Product Manager",
                "style": "Anxious, focused on their own customers.",
                "greeting": "My team can't complete orders. What is happening, and when will it be fixed?",
                "keywords": {"f_client_impact": ["customer", "impact", "checkout", "orders", "client", "workflow", "when", "blocked"]},
                "profile": _profile(9, "Under pressure from their own boss. Needs honesty and a time.", ["Anxious", "Loyal", "Direct"], "Calms down fast once given a clear ETA", "Escalates when ignored", {"Calm": 35, "Focus": 70, "Empathy": 60, "Speed": 75}),
            },
            "coworker": {
                "role": "Product Designer",
                "style": "Chatty and friendly, offers general context.",
                "greeting": "Rough morning! Everyone's been sprinting between the war room and the dashboard.",
                "keywords": {},
                "profile": _profile(4, "Office sunshine. Knows the gossip, not the root cause.", ["Friendly", "Curious", "Distracting"], "Keeps morale up mid-incident", "Has no idea what a migration is", {"Calm": 80, "Focus": 40, "Empathy": 92, "Speed": 50}),
            },
        },
        "facts": {
            "f_initial_5xx": ("Service returning HTTP 500s", "{service} is returning HTTP 500 responses in production."),
            "f_deploy_event": ("Deployment just completed", "The incident dashboard shows error rates spiking within minutes of the most recent deployment."),
            "f_error_logs": ("Error logs point to the database", "Application logs show failed database queries referencing a column that does not exist yet."),
            "f_connection_pool": ("Connection pool is saturated", "The database connection pool is exhausted by retries, amplifying the failure."),
            "f_no_canary": ("Deploy went straight to 100%", "The deployment was applied to all instances with no canary stage."),
            "f_runbook_rollback": ("Rollback requires a compatibility check", "The ops runbook states rollback must not run until the migration is checked for compatibility."),
            "f_business_impact": ("Business impact", "About {pct}% of customer requests are failing; checkout is degraded."),
            "f_reporting_deadline": ("Reporting deadline", "Leadership needs a written status update from the on-call engineer soon."),
            "f_migration_ran": ("A database migration shipped with the deploy", "This release included a database schema migration, not just application code."),
            "f_migration_incompatible": ("The migration is not backward compatible", "The migration removed/renamed a column the previous application version still expects, so a plain code rollback will keep failing until compatibility is restored."),
            "f_ci_skipped": ("Integration tests were skipped in CI", "The integration test suite was skipped on this pipeline run, so the breakage was not caught."),
            "f_client_impact": ("Client workflow is blocked", "The client's operations team cannot complete orders through the API."),
        },
        "actions": {
            "a_inspect_dashboard": ("Inspect incident dashboard", "Open the incident dashboard for current error rates and recent deploys."),
            "a_inspect_logs": ("Inspect application logs", "Read recent application error logs."),
            "a_inspect_metrics": ("Inspect database metrics", "Check connection pool and error metrics."),
            "a_inspect_deploy": ("Inspect deployment console", "Review the deployment rollout and its stages."),
            "a_inspect_runbook": ("Read the ops runbook", "Open the incident runbook pinned in the workspace."),
            "a_check_migration_compat": ("Check migration compatibility", "Compare the shipped migration against the currently deployed application version."),
            "a_apply_rollback": ("Roll back the deployment", "Revert the application to the previous version."),
            "a_apply_forward_fix": ("Apply the forward fix", "Ship a compatibility migration / hotfix rather than reverting."),
            "a_restart_service": ("Restart the service", "Restart the affected service to clear the errors."),
            "a_send_status_update": ("Send status update", "Write and send a stakeholder status update."),
            "a_document_followup": ("Document follow-up action", "Record a prevention/follow-up action on the incident."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what shipped in the deploy before checking the migration. Talk to your teammate about the release.",
            "a_apply_rollback": "Rolling back now is unsafe: the migration compatibility has not been checked. Verify whether a rollback is safe first.",
        },
        "objects": {
            "incident_dashboard": "Incident dashboard",
            "log_viewer": "Application logs",
            "metrics_panel": "Database metrics",
            "deploy_console": "Deployment console",
            "runbook": "Ops runbook",
            "migration_notes": "Migration notes",
        },
        "objectives": {
            "o_identify_risk": ("Identify the rollback risk", "Verify whether the migration is compatible before changing production."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Apply a mitigation consistent with the migration's compatibility."),
        },
        "questions": {
            "manager": [("How many customers are affected?", "f_business_impact"), ("When do you need an update from me?", "f_reporting_deadline"), ("I'll own this. Anything I should know?", None)],
            "teammate": [("Did this deploy include a migration?", "f_migration_ran"), ("Is a rollback safe with that migration?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Did CI run the integration tests?", "f_ci_skipped"), ("What would have caught this?", None)],
            "client_pm": [("Which of your workflows are blocked?", "f_client_impact"), ("We're on it — can I update you in 15 minutes?", None)],
            "coworker": [("Seen anything odd this morning?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I roll back, is the migration backward compatible?"),
            "talked_qa": ("qa", "Did CI run the integration tests on this release?"),
            "right_fix": ("teammate", "Rollback won't fix the schema. Can we ship a forward fix instead?"),
            "update_sent": ("stakeholders", "Impact: X% of checkout failing. Cause: migration. Action: forward fix. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check that a rollback is safe before you press it.",
        "people_knows": {
            "manager": "Customer impact and the reporting deadline",
            "teammate": "What shipped in the deploy",
            "qa": "What testing missed",
            "client_pm": "Which client workflows are blocked",
            "coworker": "Office gossip — friendly, not much more",
        },
    },
    # ------------------------------------------------------------------ frontend / mobile / QA
    "frontend": {
        "label": "Broken release",
        "title": "Customers can't pay after a frontend release",
        "services": ["checkout-web", "shopping app", "storefront", "account portal"],
        "briefing": (
            "You are on-call as a {role}. About {minutes} minutes ago a new release of the {service} went "
            "live. Customers tap 'Pay' and nothing happens. Find out why, pick a safe fix and keep "
            "everyone posted."
        ),
        "incident_line": "the {service} release went live {minutes} minutes ago and the Pay button fails",
        "workspace": ("Frontend Pod", "Desks with the error tracker, real-user monitoring and release console."),
        "names": {
            "manager": ["Meera Kapoor", "Olivia Grant", "Aiko Mori"],
            "teammate": ["Arjun Nair", "Lucas Ferreira", "Ethan Park"],
            "qa": ["Fatima Noor", "Tom Becker", "Ines Duarte"],
            "client_pm": ["Rahul Desai", "Clara Novak", "James Whitaker"],
            "coworker": ["Mia Collins", "Yuki Sato", "Omar Haddad"],
        },
        "characters": {
            "manager": {
                "role": "Frontend Engineering Manager",
                "style": "Warm but time-boxed; wants numbers, not guesses.",
                "greeting": "Payments are tanking and people can't check out. Find out what broke; ask me if you need numbers.",
                "keywords": {
                    "f_business_impact": ["impact", "customer", "how many", "affected", "revenue", "checkout", "users", "bad"],
                    "f_reporting_deadline": ["deadline", "when", "update", "time", "report", "leadership"],
                },
                "profile": _profile(10, "Protects the team, expects crisp updates in return.", ["Supportive", "Numbers-first", "Time-boxed"], "Clears blockers in one Slack message", "Glazes over at long explanations", {"Calm": 84, "Focus": 78, "Empathy": 80, "Speed": 70}),
            },
            "teammate": {
                "role": "Senior Frontend Engineer",
                "style": "Fast talker, pragmatic, thinks in components and contracts.",
                "greeting": "The Pay button died right after the release. Ask me what changed — I've got a hunch.",
                "keywords": {
                    "f_migration_ran": ["api", "contract", "field", "release", "change", "changed", "backend", "response", "schema", "deploy"],
                    "f_migration_incompatible": ["rollback", "roll back", "revert", "compatible", "safe", "old version", "hotfix", "fix"],
                },
                "profile": _profile(6, "Ships fast, debugs faster. Loves a clean API contract.", ["Pragmatic", "Witty", "Restless"], "Spots a broken prop from across the room", "Skips writing tests when excited", {"Calm": 60, "Focus": 85, "Empathy": 58, "Speed": 96}),
            },
            "qa": {
                "role": "QA Engineer",
                "style": "Methodical, quietly frustrated the E2E suite was skipped.",
                "greeting": "Funny thing about this release… the end-to-end run never happened.",
                "keywords": {"f_ci_skipped": ["test", "e2e", "end-to-end", "qa", "check", "skipped", "regression", "ci"]},
                "profile": _profile(5, "Breaks things for a living so customers don't.", ["Methodical", "Patient", "Dry humour"], "Reproduces any bug in 3 clicks", "Gets ignored until something breaks", {"Calm": 78, "Focus": 92, "Empathy": 64, "Speed": 55}),
            },
            "client_pm": {
                "role": "Client Product Manager",
                "style": "Stressed, watching their sales dashboard drop live.",
                "greeting": "Our shoppers are abandoning carts at payment. When does this get fixed?",
                "keywords": {"f_client_impact": ["customer", "shoppers", "impact", "cart", "checkout", "client", "blocked", "when"]},
                "profile": _profile(8, "Measures everything in lost revenue per minute.", ["Stressed", "Sharp", "Fair once informed"], "Turns a clear ETA into instant trust", "Refreshes the sales chart every 10 seconds", {"Calm": 32, "Focus": 74, "Empathy": 55, "Speed": 80}),
            },
            "coworker": {
                "role": "UX Writer",
                "style": "Chatty, creative, knows the copy changes but not the code.",
                "greeting": "Did you see the new checkout copy? Shame nobody can reach it right now.",
                "keywords": {},
                "profile": _profile(3, "Wordsmith with opinions on every button label.", ["Creative", "Chatty", "Optimistic"], "Writes an apology banner in 30 seconds", "Thinks every bug is a copy problem", {"Calm": 82, "Focus": 45, "Empathy": 90, "Speed": 60}),
            },
        },
        "facts": {
            "f_initial_5xx": ("Pay button failing", "In the {service}, the Pay button throws a JavaScript error for customers."),
            "f_deploy_event": ("Errors started with the release", "The error tracker shows the spike began minutes after the latest release."),
            "f_error_logs": ("Console errors point to the API response", "Browser logs show the app reading an undefined price field from the checkout API."),
            "f_connection_pool": ("Crash-free sessions are collapsing", "Real-user monitoring shows crash-free sessions dropping and retries piling up."),
            "f_no_canary": ("Release went to 100% at once", "The release skipped the staged 5% rollout."),
            "f_runbook_rollback": ("Checklist: check the API contract before rolling back", "The release checklist says not to roll back until the API contract is checked."),
            "f_business_impact": ("Business impact", "About {pct}% of checkouts are failing; revenue is dropping by the minute."),
            "f_reporting_deadline": ("Update deadline", "Leadership wants a written update from the on-call engineer soon."),
            "f_migration_ran": ("The API contract changed in this release", "The backend renamed the price field to amount in the same release."),
            "f_migration_incompatible": ("Rolling back the frontend won't help", "The old frontend still expects the price field, which the API no longer sends, so a plain rollback keeps failing."),
            "f_ci_skipped": ("End-to-end tests were skipped", "The checkout end-to-end tests were skipped on this release."),
            "f_client_impact": ("Client's shoppers can't pay", "The client's customers abandon carts at the payment step."),
        },
        "actions": {
            "a_inspect_dashboard": ("Open the error tracker", "See error counts and when they started."),
            "a_inspect_logs": ("Read browser console logs", "Read the JavaScript errors customers are hitting."),
            "a_inspect_metrics": ("Check real-user monitoring", "Look at crash-free sessions and retries."),
            "a_inspect_deploy": ("Open the release console", "Review how the release rolled out."),
            "a_inspect_runbook": ("Read the release checklist", "Open the team's release checklist."),
            "a_check_migration_compat": ("Check API contract compatibility", "Compare what the frontend expects with what the API now sends."),
            "a_apply_rollback": ("Roll back the web release", "Put the previous frontend build back live."),
            "a_apply_forward_fix": ("Ship a hotfix that reads both fields", "Release a small fix that accepts both price and amount."),
            "a_restart_service": ("Clear the CDN cache", "Purge cached assets and hope it helps."),
            "a_send_status_update": ("Send status update", "Write and send a stakeholder status update."),
            "a_document_followup": ("Document follow-up action", "Record a prevention/follow-up action."),
        },
        "blocked": {
            "a_check_migration_compat": "You don't know what changed yet. Ask your teammate what shipped in the release.",
            "a_apply_rollback": "Rolling back now is risky: nobody has checked the API contract. Check compatibility first.",
        },
        "objects": {
            "incident_dashboard": "Error tracker",
            "log_viewer": "Browser console logs",
            "metrics_panel": "Real-user monitoring",
            "deploy_console": "Release console",
            "runbook": "Release checklist",
            "migration_notes": "API change notes",
        },
        "objectives": {
            "o_identify_risk": ("Identify the rollback risk", "Check whether the old frontend works with the changed API."),
            "o_choose_mitigation": ("Choose a safe fix", "Pick a fix that works with the API as it is now."),
        },
        "questions": {
            "manager": [("How many checkouts are failing?", "f_business_impact"), ("When do you need an update?", "f_reporting_deadline"), ("I'll own this. Anything I should know?", None)],
            "teammate": [("Did the API change in this release?", "f_migration_ran"), ("Is rolling back the frontend safe?", "f_migration_incompatible"), ("Where would you look first?", None)],
            "qa": [("Did the end-to-end tests run?", "f_ci_skipped"), ("What test would have caught this?", None)],
            "client_pm": [("Which of your shoppers are blocked?", "f_client_impact"), ("We're on it — update in 15 minutes?", None)],
            "coworker": [("Noticed anything weird today?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I roll back, does the old build still work with the new API?"),
            "right_fix": ("teammate", "A rollback won't fix the field rename. Can we hotfix to read both?"),
            "update_sent": ("stakeholders", "Impact: X% of checkouts failing. Cause: API field rename. Action: hotfix. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check the API contract before rolling a release back.",
        "people_knows": {
            "manager": "How many checkouts fail and when leadership needs an update",
            "teammate": "What changed in the release",
            "qa": "Which tests were skipped",
            "client_pm": "What their shoppers are seeing",
            "coworker": "Copy changes and chatter",
        },
    },
    # ------------------------------------------------------------------ data / analytics / ML
    "data": {
        "label": "Data incident",
        "title": "The numbers look wrong before the leadership review",
        "services": ["revenue dashboard", "weekly KPI report", "churn model", "sales forecast"],
        "briefing": (
            "You are the {role} on duty. The {service} suddenly shows a {pct}% drop, and leadership reviews "
            "it within the hour. A pipeline change ran {minutes} minutes ago. Find out if the drop is real, "
            "fix the data safely and tell people which numbers to trust."
        ),
        "incident_line": "the {service} shows a sudden {pct}% drop after a pipeline change {minutes} minutes ago",
        "workspace": ("Data Lab", "Screens with the freshness dashboard, pipeline logs and quality checks."),
        "names": {
            "manager": ["Ananya Rao", "Grace Liu", "Nadia Petrova"],
            "teammate": ["Vikram Singh", "Mateo Rossi", "Daniel Cho"],
            "qa": ["Sara Lindqvist", "Kabir Mehta", "Elena Vasquez"],
            "client_pm": ["Robert Hale", "Neha Joshi", "Marta Kowalski"],
            "coworker": ["Jordan Blake", "Aisha Bello", "Felix Wagner"],
        },
        "characters": {
            "manager": {
                "role": "Analytics Manager",
                "style": "Analytical, calm, wants to know what leadership can trust.",
                "greeting": "Leadership is about to quote these numbers. Find out if they're real before the review.",
                "keywords": {
                    "f_business_impact": ["impact", "how bad", "numbers", "drop", "leadership", "budget", "decision", "affected"],
                    "f_reporting_deadline": ["deadline", "when", "update", "time", "review", "meeting", "report"],
                },
                "profile": _profile(12, "Trusts data, distrusts surprises. Asks 'how do you know?'.", ["Analytical", "Calm", "Skeptical"], "Spots a bad metric from the chart's shape", "Wants confidence intervals on everything", {"Calm": 90, "Focus": 86, "Empathy": 62, "Speed": 60}),
            },
            "teammate": {
                "role": "Senior Data Engineer",
                "style": "Precise, thinks in tables and lineage, slightly sleep-deprived.",
                "greeting": "The pipeline ran green last night, which is exactly what worries me.",
                "keywords": {
                    "f_migration_ran": ["schema", "column", "table", "upstream", "pipeline", "change", "changed", "source", "renamed", "release"],
                    "f_migration_incompatible": ["revert", "rollback", "roll back", "compatible", "safe", "backfill", "old", "fix"],
                },
                "profile": _profile(8, "Plumber of the data world. Knows where every number comes from.", ["Precise", "Sleepy", "Reliable"], "Traces any metric back to its source", "Speaks fluent SQL, broken small talk", {"Calm": 74, "Focus": 94, "Empathy": 50, "Speed": 72}),
            },
            "qa": {
                "role": "Data Quality Analyst",
                "style": "Careful, frustrated the schema tests were switched off.",
                "greeting": "My quality checks would've screamed — if they'd been turned on.",
                "keywords": {"f_ci_skipped": ["test", "check", "quality", "validation", "null", "skipped", "alert"]},
                "profile": _profile(4, "Guardian of the null rate. Allergic to silent failures.", ["Careful", "Principled", "Blunt"], "Writes a data test faster than you can blink", "Takes skipped checks personally", {"Calm": 66, "Focus": 93, "Empathy": 58, "Speed": 54}),
            },
            "client_pm": {
                "role": "Head of Finance",
                "style": "Formal, worried about the board pack already sent.",
                "greeting": "I've put these numbers in the board pack. Tell me I don't have to pull them.",
                "keywords": {"f_client_impact": ["shared", "board", "finance", "report", "numbers", "impact", "sent", "when"]},
                "profile": _profile(15, "Accountable to the board. Needs certainty, fast.", ["Formal", "Exacting", "Reasonable"], "Fixes the narrative once given facts", "Panics at the word 'probably'", {"Calm": 45, "Focus": 82, "Empathy": 50, "Speed": 70}),
            },
            "coworker": {
                "role": "Marketing Analyst",
                "style": "Friendly, curious, uses the dashboard but doesn't build it.",
                "greeting": "Is the dashboard broken? My campaign suddenly looks terrible.",
                "keywords": {},
                "profile": _profile(2, "Enthusiastic dashboard power-user.", ["Curious", "Friendly", "Chart-obsessed"], "Notices drops before anyone else", "Assumes every dip is their campaign", {"Calm": 70, "Focus": 50, "Empathy": 88, "Speed": 66}),
            },
        },
        "facts": {
            "f_initial_5xx": ("Dashboard shows a sudden drop", "The {service} shows a {pct}% drop nobody expected."),
            "f_deploy_event": ("Drop started after the pipeline run", "The freshness dashboard shows the drop began right after the latest pipeline run."),
            "f_error_logs": ("Pipeline logs show NULL values", "Job logs show a key column arriving as NULL after an upstream change."),
            "f_connection_pool": ("Quality checks are failing", "The null rate on the revenue column jumped from 0% to 38%, and retries keep re-queuing jobs."),
            "f_no_canary": ("The change skipped staging", "The pipeline change went straight to production without a staging run."),
            "f_runbook_rollback": ("Playbook: check the schema before reverting", "The data incident playbook says not to revert until the schema change is understood."),
            "f_business_impact": ("Business impact", "Leadership is about to make budget calls on numbers that look {pct}% too low."),
            "f_reporting_deadline": ("Review deadline", "The leadership review starts soon and needs a note on which numbers can be trusted."),
            "f_migration_ran": ("An upstream table schema changed", "The source team renamed the revenue column to gross_revenue last night."),
            "f_migration_incompatible": ("Reverting the pipeline won't fix the data", "The old transform still looks for the revenue column, which no longer exists upstream, so a plain revert keeps producing NULLs."),
            "f_ci_skipped": ("Schema tests were switched off", "The pipeline's schema tests were disabled for this run."),
            "f_client_impact": ("Finance already shared the numbers", "Finance pasted the wrong numbers into the board pack."),
        },
        "actions": {
            "a_inspect_dashboard": ("Check the freshness dashboard", "See when each table last updated."),
            "a_inspect_logs": ("Read pipeline job logs", "Read last night's job logs."),
            "a_inspect_metrics": ("Run data-quality checks", "Check null rates and row counts."),
            "a_inspect_deploy": ("Open the pipeline orchestrator", "Review how the pipeline change was released."),
            "a_inspect_runbook": ("Read the data incident playbook", "Open the team's data incident playbook."),
            "a_check_migration_compat": ("Compare old vs new table schema", "Check whether the transform matches the new upstream schema."),
            "a_apply_rollback": ("Revert the pipeline to yesterday", "Put yesterday's pipeline code back."),
            "a_apply_forward_fix": ("Patch the transform and backfill", "Map the renamed column and re-run the affected days."),
            "a_restart_service": ("Re-run the failed job", "Just run the job again."),
            "a_send_status_update": ("Send data status update", "Tell stakeholders which numbers to trust."),
            "a_document_followup": ("Document follow-up action", "Record a prevention/follow-up action."),
        },
        "blocked": {
            "a_check_migration_compat": "You don't know what changed upstream yet. Ask the data engineer about the pipeline change.",
            "a_apply_rollback": "Reverting now is risky: nobody has compared the schemas. Check compatibility first.",
        },
        "objects": {
            "incident_dashboard": "Freshness dashboard",
            "log_viewer": "Pipeline job logs",
            "metrics_panel": "Data-quality checks",
            "deploy_console": "Pipeline orchestrator",
            "runbook": "Data incident playbook",
            "migration_notes": "Schema change notes",
        },
        "objectives": {
            "o_identify_risk": ("Identify the revert risk", "Check whether reverting the pipeline would actually fix the data."),
            "o_choose_mitigation": ("Choose a safe data fix", "Fix the data in a way that matches the new upstream schema."),
        },
        "questions": {
            "manager": [("How bad is the drop for leadership?", "f_business_impact"), ("When is the review?", "f_reporting_deadline"), ("I'll own this. Anything I should know?", None)],
            "teammate": [("Did an upstream table or schema change?", "f_migration_ran"), ("Is reverting the pipeline safe?", "f_migration_incompatible"), ("Which table would you check first?", None)],
            "qa": [("Were the quality checks running?", "f_ci_skipped"), ("What check would have caught this?", None)],
            "client_pm": [("Have these numbers been shared yet?", "f_client_impact"), ("Can I confirm the real numbers in 30 minutes?", None)],
            "coworker": [("Did your charts look odd today?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before we revert, does the old transform match the new schema?"),
            "right_fix": ("teammate", "Reverting won't bring the column back. Can we patch and backfill?"),
            "update_sent": ("stakeholders", "Impact: revenue looks X% low. Cause: upstream column rename. Action: patch + backfill. Next update 30 min. Owner: me."),
        },
        "tip_risk": "Check the schema before you revert a pipeline.",
        "people_knows": {
            "manager": "What leadership will decide and when",
            "teammate": "What changed upstream",
            "qa": "Which checks were switched off",
            "client_pm": "Where the wrong numbers went",
            "coworker": "How the charts looked to users",
        },
    },
    # ------------------------------------------------------------------ product / design / business
    "product": {
        "label": "Launch gone wrong",
        "title": "Sign-ups crashed after a launch",
        "services": ["new onboarding flow", "sign-up redesign", "pricing page launch", "referral feature"],
        "briefing": (
            "You are the {role} on the launch team. {minutes} minutes ago the {service} rolled out to every "
            "user. Sign-ups dropped {pct}% and support is flooded. Figure out what happened, choose a safe "
            "fix and keep everyone aligned."
        ),
        "incident_line": "sign-ups dropped {pct}% after the {service} launched {minutes} minutes ago",
        "workspace": ("Product Studio", "Launch dashboard, support inbox, funnel analytics and the feature-flag console."),
        "names": {
            "manager": ["Kavya Menon", "Rachel Adams", "Lina Haddad"],
            "teammate": ["Rohan Gupta", "Ben Carter", "Hiro Yamada"],
            "qa": ["Tara Brooks", "Imran Qureshi", "Julia Santos"],
            "client_pm": ["Aditya Bose", "Emma Laurent", "Chris Ng"],
            "coworker": ["Nina Patel", "Leo Schmidt", "Maya Cohen"],
        },
        "characters": {
            "manager": {
                "role": "Head of Product",
                "style": "Energetic, outcome-focused, hates vague answers.",
                "greeting": "Our big launch is bleeding sign-ups. Find out why and bring me a plan I can share.",
                "keywords": {
                    "f_business_impact": ["impact", "how bad", "sign-ups", "signups", "users", "affected", "campaign", "numbers"],
                    "f_reporting_deadline": ["deadline", "when", "update", "time", "vp", "standup", "report"],
                },
                "profile": _profile(13, "Visionary with a stopwatch. Big picture, short attention span.", ["Energetic", "Bold", "Outcome-driven"], "Sells any plan to the exec team", "Wants answers before questions finish", {"Calm": 70, "Focus": 76, "Empathy": 74, "Speed": 90}),
            },
            "teammate": {
                "role": "Lead Engineer, Growth",
                "style": "Practical, knows exactly what the launch changed under the hood.",
                "greeting": "The launch changed more than the screens. Want to know what's different?",
                "keywords": {
                    "f_migration_ran": ["changed", "change", "verification", "phone", "sms", "flow", "launch", "release", "different", "new"],
                    "f_migration_incompatible": ["turn off", "flag", "rollback", "roll back", "revert", "safe", "old flow", "fix", "kill"],
                },
                "profile": _profile(9, "Builds experiments at speed; respects data over opinions.", ["Practical", "Fast", "Candid"], "Ships a safe toggle in minutes", "Forgets to tell support what changed", {"Calm": 72, "Focus": 88, "Empathy": 60, "Speed": 92}),
            },
            "qa": {
                "role": "Customer Support Lead",
                "style": "Empathetic, overwhelmed by tickets, has the user's voice.",
                "greeting": "My inbox exploded. Want to hear what users are actually saying?",
                "keywords": {"f_ci_skipped": ["test", "tested", "tickets", "support", "country", "countries", "complaints", "check"]},
                "profile": _profile(7, "Voice of the customer. Reads 300 tickets before lunch.", ["Empathetic", "Organised", "Protective of users"], "Finds the pattern in a flood of tickets", "Gets launches dumped on them without warning", {"Calm": 64, "Focus": 80, "Empathy": 96, "Speed": 70}),
            },
            "client_pm": {
                "role": "Partner Marketing Manager",
                "style": "Worried about a live paid campaign and the partner relationship.",
                "greeting": "Our partner is paying to send people into this sign-up. Should I pause it?",
                "keywords": {"f_client_impact": ["partner", "campaign", "traffic", "paid", "marketing", "impact", "pause", "when"]},
                "profile": _profile(6, "Relationship keeper. Every wasted click costs a partner's trust.", ["Persuasive", "Worried", "Collaborative"], "Can pause a campaign in two minutes", "Overpromises to partners when nervous", {"Calm": 40, "Focus": 72, "Empathy": 78, "Speed": 76}),
            },
            "coworker": {
                "role": "Data Analyst",
                "style": "Friendly, has charts, light on context.",
                "greeting": "The funnel chart looks like a ski slope today. Not the fun kind.",
                "keywords": {},
                "profile": _profile(3, "Chart wizard who loves a good funnel.", ["Friendly", "Nerdy", "Helpful"], "Builds a funnel view on request", "Lost without a SQL prompt", {"Calm": 76, "Focus": 66, "Empathy": 80, "Speed": 58}),
            },
        },
        "facts": {
            "f_initial_5xx": ("Sign-ups dropped sharply", "Sign-ups are down {pct}% since the {service} went live."),
            "f_deploy_event": ("The drop lines up with the launch", "The launch dashboard shows sign-ups falling right as the launch hit 100%."),
            "f_error_logs": ("Tickets say the SMS code never arrives", "Most new support tickets say the phone verification code never arrives."),
            "f_connection_pool": ("Funnel stalls at the verify step", "Funnel analytics show users stuck retrying on the phone verification screen."),
            "f_no_canary": ("Launch went to 100% with no A/B test", "The launch skipped the 10% experiment and went to everyone."),
            "f_runbook_rollback": ("Checklist: check user impact before killing a flag", "The launch checklist says not to switch a launch off until you know who it strands."),
            "f_business_impact": ("Business impact", "About {pct}% fewer people finish sign-up; the paid campaign is wasting budget."),
            "f_reporting_deadline": ("Update deadline", "The VP wants a written launch update before the campaign standup."),
            "f_migration_ran": ("The launch made phone verification mandatory", "The new flow requires a phone code, and new accounts are now created phone-first."),
            "f_migration_incompatible": ("Switching the launch off strands new users", "Turning the launch flag off would lock out everyone who already signed up in the new flow, because the old flow can't read phone-first accounts."),
            "f_ci_skipped": ("Only local numbers were tested", "SMS delivery was only tested with local numbers; other countries were never checked."),
            "f_client_impact": ("A partner campaign is live", "A partner is sending paid traffic straight into the broken sign-up."),
        },
        "actions": {
            "a_inspect_dashboard": ("Open the launch dashboard", "See sign-ups since the launch."),
            "a_inspect_logs": ("Read new support tickets", "Skim what users are reporting."),
            "a_inspect_metrics": ("Check the sign-up funnel", "See where users drop off."),
            "a_inspect_deploy": ("Open the feature-flag console", "See how the launch was rolled out."),
            "a_inspect_runbook": ("Read the launch checklist", "Open the team's launch checklist."),
            "a_check_migration_compat": ("Check who signed up in the new flow", "Find out what switching the launch off would do to new accounts."),
            "a_apply_rollback": ("Turn the launch flag off for everyone", "Switch every user back to the old flow."),
            "a_apply_forward_fix": ("Make phone verification optional", "Let users verify by email when the SMS code fails."),
            "a_restart_service": ("Refresh the sign-up page cache", "Clear the page cache and hope."),
            "a_send_status_update": ("Send launch update", "Tell stakeholders what's happening with the launch."),
            "a_document_followup": ("Document follow-up action", "Record a prevention/follow-up action."),
        },
        "blocked": {
            "a_check_migration_compat": "You don't know what the launch changed yet. Ask the growth engineer what's different.",
            "a_apply_rollback": "Switching the launch off now is risky: you don't know who it would strand. Check that first.",
        },
        "objects": {
            "incident_dashboard": "Launch dashboard",
            "log_viewer": "Support inbox",
            "metrics_panel": "Sign-up funnel",
            "deploy_console": "Feature-flag console",
            "runbook": "Launch checklist",
            "migration_notes": "Launch change notes",
        },
        "objectives": {
            "o_identify_risk": ("Identify the switch-off risk", "Find out who would be stranded if the launch is switched off."),
            "o_choose_mitigation": ("Choose a safe fix", "Fix sign-ups without locking out new users."),
        },
        "questions": {
            "manager": [("How many sign-ups are we losing?", "f_business_impact"), ("When do you need an update?", "f_reporting_deadline"), ("I'll own this. Anything I should know?", None)],
            "teammate": [("What did the launch change?", "f_migration_ran"), ("Is it safe to turn the flag off?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("What are the tickets saying? Was this tested?", "f_ci_skipped"), ("Which users are hit hardest?", None)],
            "client_pm": [("Is the partner campaign still live?", "f_client_impact"), ("Can we pause it while I fix this?", None)],
            "coworker": [("What does the funnel look like?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before we switch it off, who would that lock out?"),
            "right_fix": ("teammate", "Switching off strands new users. Can we make SMS optional instead?"),
            "update_sent": ("stakeholders", "Impact: sign-ups down X%. Cause: SMS verification failing. Action: making it optional. Next update 20 min. Owner: me."),
        },
        "tip_risk": "Find out who a switch-off would strand before you flip it.",
        "people_knows": {
            "manager": "How many sign-ups are lost and when the VP needs an update",
            "teammate": "What the launch changed under the hood",
            "qa": "What users are reporting",
            "client_pm": "Whether paid traffic is still flowing in",
            "coworker": "Funnel charts",
        },
    },
}

# Shared "say this next time" lines that don't depend on the track.
COMMON_SAY_NEXT_TIME = {
    "impact_known": ("manager", "Quick one: how bad is the impact, and when do you need an update?"),
    "migration_known": ("teammate", "What changed right before this started?"),
    "talked_qa": ("qa", "What did testing or support see?"),
    "talked_client": ("client_pm", "We're on it. I'll update you by the top of the hour."),
}


# Voice casting. Names are drawn per run, so gender comes from the first name; every voice is an
# ElevenLabs library voice picked to fit the slot's personality (see docs/CHARACTERS.md).
_MALE_FIRST_NAMES = {
    "Marcus", "Diego", "Noah", "Arjun", "Lucas", "Ethan", "Vikram", "Mateo", "Daniel", "Rohan", "Ben",
    "Hiro", "Leo", "Rahul", "James", "Robert", "Aditya", "Chris", "Ravi", "Tom", "Kabir", "Imran",
    "Sam", "Kai", "Omar", "Jordan", "Felix",
}

VOICES: dict[str, tuple[str, str]] = {  # name -> (voice_id, label)
    "brayden": ("wToR447ojQ91QCc7UqnX", "Brayden - Ambitious Office Manager"),
    "hope": ("WAhoMTNdLdMoq1j3wf3I", "Hope - Smooth, Engaging and Kind"),
    "tony": ("q1OMOTZNtqpS50TIQtu4", "Tony Smyles - The Voice of Trust"),
    "sia": ("CUvmi6RSy4BQr6vnMyEw", "Sia - Counselor & Friend"),
    "siren": ("eXpIbVcVbLo8ZJQDlDnl", "Siren - Natural realistic conversational voice"),
    "jeremy": ("V2aW90aP6L5wBvSqWbDm", "Real Jeremy - Conversational"),
}

CASTING: dict[str, dict[str, str]] = {  # slot -> gender -> voice name
    "manager": {"female": "hope", "male": "tony"},  # Arabella needs a paid ElevenLabs plan
    "teammate": {"male": "brayden", "female": "sia"},
    "client_pm": {"female": "sia", "male": "tony"},
    "qa": {"female": "siren", "male": "jeremy"},
    "coworker": {"female": "siren", "male": "jeremy"},
}


def gender_of(name: str) -> str:
    return "male" if name.split(" ")[0] in _MALE_FIRST_NAMES else "female"


def voice_for(slot: str, name: str) -> str:
    """Voice name for a colleague, e.g. 'arabella'."""
    return CASTING.get(slot, CASTING["coworker"])[gender_of(name)]


# ---------------------------------------------------------------------- incident variants
# Each track's base story is one incident type; these are more. A variant is a text overlay merged
# into the track, so the mechanics stay identical and validated: something shipped (f_migration_ran),
# a plain undo can't fix it (f_migration_incompatible, found by a_check_migration_compat), and the
# forward fix is the safe move. Only keys that change are listed.
TRACKS["backend"]["variants"] = [
    {
        "id": "queue_format",
        "title": "Orders stuck after a message format change",
        "briefing": (
            "You are on-call as a {role}. About {minutes} minutes ago a deployment of {service} went to "
            "production. Orders stopped completing and the job queue is backing up. Investigate what "
            "happened, decide on a safe response, and keep stakeholders informed."
        ),
        "incident_line": "{service} orders are stuck and the queue is growing; a deploy went out {minutes} minutes ago",
        "facts": {
            "f_initial_5xx": ("Orders aren't completing", "{service} accepts orders but they never finish processing."),
            "f_error_logs": ("Workers can't read queue messages", "Worker logs show 'unknown message version: 2' on every order event."),
            "f_connection_pool": ("Queue backlog is growing", "Thousands of messages are piling up and being retried, so the backlog keeps growing."),
            "f_runbook_rollback": ("Rollback requires a message check", "The runbook says check what is already in the queue before rolling back a producer change."),
            "f_migration_ran": ("The deploy changed the message format", "This release started writing order events in a new version 2 format."),
            "f_migration_incompatible": ("Rolling back leaves broken messages behind", "Thousands of version 2 messages are already in the queue, and the old workers can't read them either, so a plain rollback keeps orders stuck."),
            "f_ci_skipped": ("No test covered old and new formats together", "The contract tests between the API and the workers were disabled last sprint."),
            "f_client_impact": ("Client orders are stuck", "The client's customers are charged but their orders never confirm."),
        },
        "actions": {
            "a_inspect_metrics": ("Inspect queue metrics", "Check queue depth, retries and worker errors."),
            "a_check_migration_compat": ("Check messages already in the queue", "See whether the old workers could read the messages written since the deploy."),
            "a_apply_forward_fix": ("Ship workers that read both formats", "Release a worker fix that accepts version 1 and version 2 messages."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what changed in the deploy first. Ask your teammate about the release.",
            "a_apply_rollback": "Rolling back now is unsafe: you haven't checked what's already in the queue.",
        },
        "objects": {"metrics_panel": "Queue metrics", "migration_notes": "Message format notes"},
        "objectives": {
            "o_identify_risk": ("Identify the rollback risk", "Check whether old code can read the messages already queued."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that also clears the messages already in the queue."),
        },
        "questions": {
            "teammate": [("Did this deploy change any message formats?", "f_migration_ran"), ("Would a rollback read what's already queued?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Do we test the API and workers together?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I roll back, can the old workers read what's already in the queue?"),
            "right_fix": ("teammate", "Rollback leaves the new messages stuck. Can we make the workers read both formats?"),
            "update_sent": ("stakeholders", "Impact: orders stuck. Cause: new message format. Action: workers read both. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check what's already in the queue before you roll back.",
        "characters": {
            "teammate": {
                "greeting": "Yeah, the workers started choking right after the deploy. Want to know what changed?",
                "keywords": {
                    "f_migration_ran": ["message", "format", "queue", "event", "deploy", "change", "release", "shipped", "version"],
                    "f_migration_incompatible": ["rollback", "roll back", "revert", "safe", "already", "stuck", "old workers"],
                },
            },
            "qa": {"greeting": "If it's the order queue, ask me about our contract tests.", "keywords": {"f_ci_skipped": ["test", "contract", "ci", "pipeline", "check", "covered"]}},
        },
    },
    {
        "id": "key_rotation",
        "title": "Payments failing after a key rotation",
        "briefing": (
            "You are on-call as a {role}. About {minutes} minutes ago a deployment of {service} went to "
            "production. Card payments started failing right away. Investigate what happened, decide on a "
            "safe response, and keep stakeholders informed."
        ),
        "incident_line": "{service} card payments fail; a deploy went out {minutes} minutes ago",
        "facts": {
            "f_initial_5xx": ("Card payments are failing", "{service} returns errors whenever a customer pays by card."),
            "f_error_logs": ("Payment provider rejects our key", "Logs show the payment provider answering '401 invalid API key' on every charge."),
            "f_connection_pool": ("Customers retry and get charged attempts", "Customers retry over and over, flooding the provider with rejected attempts."),
            "f_runbook_rollback": ("Rollback requires a credentials check", "The runbook says check which keys are still valid before rolling back a credentials change."),
            "f_migration_ran": ("The deploy rotated the payment key", "This release switched to a new payment provider key, and the old key was revoked at the provider."),
            "f_migration_incompatible": ("The old key is dead", "The old key was revoked when the new one was issued, so rolling back the code brings back a key the provider no longer accepts."),
            "f_ci_skipped": ("Staging uses a different key", "Staging runs on a test key, so nothing exercised the new live key before release."),
            "f_client_impact": ("Client can't take payments", "The client's customers can't pay, and their support line is filling up."),
        },
        "actions": {
            "a_inspect_metrics": ("Inspect payment metrics", "Check payment success rate and provider error codes."),
            "a_check_migration_compat": ("Check which keys are valid", "Ask the provider dashboard which keys still work."),
            "a_apply_forward_fix": ("Deploy the new key everywhere", "Put the new, valid key into every server's config."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what changed in the deploy first. Ask your teammate about the release.",
            "a_apply_rollback": "Rolling back now is unsafe: you haven't checked whether the old key still works.",
        },
        "objects": {"metrics_panel": "Payment metrics", "migration_notes": "Key rotation notes"},
        "objectives": {
            "o_identify_risk": ("Identify the rollback risk", "Check whether the old key would still work after a rollback."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that uses a key the provider accepts."),
        },
        "questions": {
            "teammate": [("Did this deploy change any credentials?", "f_migration_ran"), ("Does the old key still work?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Did staging test the live key?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I roll back, is the old key still valid?"),
            "right_fix": ("teammate", "The old key is revoked. Can we roll the new key out everywhere instead?"),
            "update_sent": ("stakeholders", "Impact: card payments failing. Cause: rotated key. Action: new key everywhere. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check whether the old credentials still work before you roll back.",
        "characters": {
            "teammate": {
                "greeting": "Payments went red the minute the deploy finished. Ask me what was in it.",
                "keywords": {
                    "f_migration_ran": ["key", "credential", "secret", "rotate", "deploy", "change", "release", "shipped", "config"],
                    "f_migration_incompatible": ["rollback", "roll back", "revert", "old key", "valid", "revoked", "safe"],
                },
            },
            "qa": {"greeting": "Staging was green. Which tells you something about staging.", "keywords": {"f_ci_skipped": ["test", "staging", "ci", "check", "live", "key"]}},
        },
    },
]

TRACKS["frontend"]["variants"] = [
    {
        "id": "service_worker",
        "title": "Users stuck on a broken cached app",
        "briefing": (
            "You are on-call as a {role}. About {minutes} minutes ago a new release of the {service} went "
            "live. Many users see a blank page at checkout, even after refreshing. Find out why, pick a safe "
            "fix and keep everyone posted."
        ),
        "incident_line": "users see a blank checkout on the {service} since a release {minutes} minutes ago",
        "facts": {
            "f_initial_5xx": ("Checkout shows a blank page", "Users on the {service} get a blank checkout page."),
            "f_error_logs": ("Browsers load an old script", "The error tracker shows 'chunk failed to load': browsers ask for script files that no longer exist."),
            "f_connection_pool": ("Refreshing doesn't help", "Affected users stay broken after refreshing; only clearing site data fixes it."),
            "f_runbook_rollback": ("Rollback requires a cache check", "The release runbook says check what users' browsers have cached before rolling back."),
            "f_migration_ran": ("The release added a service worker", "This release added a service worker that caches the app in users' browsers."),
            "f_migration_incompatible": ("Rolling back can't reach cached users", "The service worker keeps serving its cached copy, so a server rollback never reaches users who are already stuck."),
            "f_ci_skipped": ("Tests always start with a fresh browser", "The end-to-end tests run in a clean browser, so they never see a returning visitor's cache."),
        },
        "actions": {
            "a_inspect_metrics": ("Inspect real-user monitoring", "Check error rates for new vs returning visitors."),
            "a_check_migration_compat": ("Check what browsers have cached", "See what a returning visitor's browser serves after a rollback."),
            "a_apply_forward_fix": ("Ship a service worker that clears the cache", "Release an updated service worker that deletes the old cache and reloads."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what the release changed first. Ask your teammate.",
            "a_apply_rollback": "Rolling back now is unsafe: you haven't checked what users' browsers have cached.",
        },
        "objects": {"metrics_panel": "Real-user monitoring", "migration_notes": "Service worker notes"},
        "objectives": {
            "o_identify_risk": ("Identify the rollback risk", "Check whether a rollback reaches users with a cached app."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that reaches users who are already stuck."),
        },
        "questions": {
            "teammate": [("Did this release change caching?", "f_migration_ran"), ("Would a rollback reach users who are stuck?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Do our tests cover returning visitors?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I roll back, will it reach users whose browsers cached the app?"),
            "right_fix": ("teammate", "Rollback can't reach cached users. Can we ship a worker that clears the cache?"),
            "update_sent": ("stakeholders", "Impact: blank checkout for returning users. Cause: cached app. Action: cache-clearing fix. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check what users' browsers have cached before you roll back.",
        "characters": {
            "teammate": {
                "greeting": "It works on my machine, which is exactly the problem. Ask me what the release changed.",
                "keywords": {
                    "f_migration_ran": ["cache", "service worker", "offline", "release", "change", "shipped", "deploy", "pwa"],
                    "f_migration_incompatible": ["rollback", "roll back", "revert", "reach", "stuck", "safe", "already"],
                },
            },
            "qa": {"greeting": "Our tests pass every time. They also start with a brand-new browser every time.", "keywords": {"f_ci_skipped": ["test", "e2e", "returning", "cache", "browser", "check", "ci"]}},
        },
    },
    {
        "id": "app_store",
        "title": "The new app version crashes at checkout",
        "services": ["Android app", "iOS app", "shopping app", "mobile checkout"],
        "briefing": (
            "You are on-call as a {role}. About {minutes} minutes ago a new version of the {service} reached "
            "users. It crashes when people open checkout. Find out why, pick a safe fix and keep everyone posted."
        ),
        "incident_line": "the new {service} version crashes at checkout since it reached users {minutes} minutes ago",
        "facts": {
            "f_initial_5xx": ("The app crashes at checkout", "The new {service} version crashes as soon as checkout opens."),
            "f_error_logs": ("Crash reports point to the new checkout screen", "Crash reports all come from the redesigned checkout screen on older phones."),
            "f_connection_pool": ("Crashes are concentrated on older phones", "Most crashes come from phones running older OS versions."),
            "f_runbook_rollback": ("Rollback requires an install check", "The mobile runbook says check what users already have installed before pulling a release."),
            "f_migration_ran": ("The release shipped a new checkout screen", "This version replaced the checkout screen with a redesigned one."),
            "f_migration_incompatible": ("You can't un-install an app", "Pulling the store release doesn't remove it from phones that already updated, so they keep crashing."),
            "f_ci_skipped": ("Older phones weren't in the test run", "The device lab run only covered recent phones this time."),
        },
        "actions": {
            "a_inspect_metrics": ("Inspect crash analytics", "Check crash rate by app version and phone model."),
            "a_check_migration_compat": ("Check who already updated", "See how many users already installed the new version."),
            "a_apply_forward_fix": ("Switch the new screen off remotely", "Use remote config to send installed apps back to the old checkout screen."),
            "a_apply_rollback": ("Pull the release from the stores", "Stop the store rollout and restore the previous version."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what the release changed first. Ask your teammate.",
            "a_apply_rollback": "Pulling the release now is unsafe: you haven't checked who already installed it.",
        },
        "objects": {"metrics_panel": "Crash analytics", "migration_notes": "Release notes"},
        "objectives": {
            "o_identify_risk": ("Identify the rollback risk", "Check whether pulling the release helps people who already updated."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that reaches phones that already updated."),
        },
        "questions": {
            "teammate": [("What changed in this app version?", "f_migration_ran"), ("Does pulling the release help people who updated?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Which phones did we test on?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before we pull the release, does that help people who already updated?"),
            "right_fix": ("teammate", "Pulling it won't fix installed apps. Can we switch the screen off remotely?"),
            "update_sent": ("stakeholders", "Impact: app crashes at checkout. Cause: new screen. Action: switched off remotely. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check who already installed it before you pull a release.",
        "characters": {
            "teammate": {
                "greeting": "Crash reports went vertical after the release. Ask me what's in this version.",
                "keywords": {
                    "f_migration_ran": ["screen", "version", "release", "change", "shipped", "checkout", "redesign", "update"],
                    "f_migration_incompatible": ["rollback", "roll back", "pull", "revert", "installed", "updated", "safe"],
                },
            },
            "qa": {"greeting": "Ask me which phones were in the device lab this time. You won't like it.", "keywords": {"f_ci_skipped": ["test", "phone", "device", "older", "lab", "check", "ci"]}},
        },
    },
]

TRACKS["data"]["variants"] = [
    {
        "id": "timezone",
        "title": "Daily numbers shifted after a timezone change",
        "incident_line": "the {service} numbers shifted {pct}% after a pipeline change {minutes} minutes ago",
        "facts": {
            "f_error_logs": ("Hourly totals look shifted", "Pipeline logs show hours landing in the wrong day since the last run."),
            "f_connection_pool": ("Some days double-count hours", "The day of the change counts some hours twice and others not at all."),
            "f_runbook_rollback": ("Revert requires a partition check", "The data runbook says check which days were already written before reverting a transform."),
            "f_migration_ran": ("The pipeline switched to UTC", "Last night's change moved all timestamps from local time to UTC."),
            "f_migration_incompatible": ("Reverting leaves mixed days behind", "Days already written in UTC stay that way, so a plain revert mixes local and UTC days and the numbers stay wrong."),
            "f_ci_skipped": ("No check compares day totals", "Quality checks look for empty values, not for totals jumping between days."),
        },
        "actions": {
            "a_check_migration_compat": ("Check which days were written in UTC", "Find out which partitions the new code already wrote."),
            "a_apply_forward_fix": ("Fix the timezone and backfill", "Make every day use one timezone and re-run the affected days."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what the pipeline change was first. Ask your teammate.",
            "a_apply_rollback": "Reverting now is unsafe: you haven't checked which days were already written.",
        },
        "objects": {"migration_notes": "Timezone change notes"},
        "objectives": {
            "o_identify_risk": ("Identify the revert risk", "Check which days a revert would leave mixed."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that makes every day consistent."),
        },
        "questions": {
            "teammate": [("Did the pipeline change how it handles time?", "f_migration_ran"), ("Would a revert fix days already written?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Do we check totals between days?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I revert, which days were already written in UTC?"),
            "right_fix": ("teammate", "A revert leaves mixed days. Can we fix the timezone and backfill?"),
            "update_sent": ("stakeholders", "Impact: daily numbers shifted. Cause: timezone change. Action: backfill. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check which days were already written before you revert.",
        "characters": {
            "teammate": {
                "greeting": "The numbers moved overnight, but not where you'd think. Ask me about the change.",
                "keywords": {
                    "f_migration_ran": ["time", "timezone", "utc", "date", "change", "pipeline", "release", "shipped"],
                    "f_migration_incompatible": ["revert", "rollback", "roll back", "already", "written", "days", "safe"],
                },
            },
        },
    },
    {
        "id": "duplicates",
        "title": "Revenue doubled overnight and nobody believes it",
        "briefing": (
            "You are the {role} on duty. The {service} suddenly shows a {pct}% jump, and leadership reviews "
            "it within the hour. A pipeline change ran {minutes} minutes ago. Find out if the jump is real, "
            "fix the data safely and tell people which numbers to trust."
        ),
        "incident_line": "the {service} shows a sudden {pct}% jump after a pipeline change {minutes} minutes ago",
        "facts": {
            "f_error_logs": ("The same events appear twice", "Pipeline logs show many orders arriving twice with the same event id."),
            "f_connection_pool": ("Row counts jumped overnight", "Yesterday's table has far more rows than orders actually placed."),
            "f_runbook_rollback": ("Revert requires a source check", "The data runbook says check whether bad rows come from us or the source before reverting."),
            "f_migration_ran": ("The source started retrying events", "The checkout team changed their event sender to retry on timeouts, so some orders are sent twice."),
            "f_migration_incompatible": ("Reverting our pipeline won't remove duplicates", "The duplicates come from the source, so reverting our pipeline still loads them twice."),
            "f_ci_skipped": ("No uniqueness check on event ids", "Quality checks never tested that each event id appears only once."),
        },
        "actions": {
            "a_check_migration_compat": ("Check where duplicates come from", "Compare the raw source events with what the pipeline loaded."),
            "a_apply_forward_fix": ("Deduplicate and backfill", "Keep one row per event id and re-run the affected days."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what changed first. Ask your teammate.",
            "a_apply_rollback": "Reverting now is unsafe: you haven't checked where the duplicates come from.",
        },
        "objects": {"migration_notes": "Source change notes"},
        "objectives": {
            "o_identify_risk": ("Identify the revert risk", "Check whether a revert removes the duplicates."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that removes duplicates at the source."),
        },
        "questions": {
            "teammate": [("Did anything change in the source data?", "f_migration_ran"), ("Would a revert remove the duplicates?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Do we check event ids are unique?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before I revert, are the duplicates coming from us or the source?"),
            "right_fix": ("teammate", "A revert still loads duplicates. Can we dedupe by event id and backfill?"),
            "update_sent": ("stakeholders", "Impact: revenue overstated. Cause: duplicate events. Action: dedupe and backfill. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check where bad rows come from before you revert.",
        "characters": {
            "teammate": {
                "greeting": "Great news, revenue doubled. Except it didn't. Ask me what changed.",
                "keywords": {
                    "f_migration_ran": ["source", "retry", "duplicate", "twice", "change", "sender", "event", "upstream"],
                    "f_migration_incompatible": ["revert", "rollback", "roll back", "remove", "still", "safe"],
                },
            },
        },
    },
]

TRACKS["product"]["variants"] = [
    {
        "id": "promo_code",
        "title": "The launch promo code doesn't work",
        "services": ["spring sale", "launch promo", "welcome offer", "loyalty campaign"],
        "briefing": (
            "You are the {role} on the launch team. {minutes} minutes ago the {service} email went to every "
            "customer with a promo code. The code fails at checkout and conversions dropped {pct}%. Figure out "
            "what happened, choose a safe fix and keep everyone aligned."
        ),
        "incident_line": "the {service} code fails at checkout; conversions down {pct}% since the email {minutes} minutes ago",
        "facts": {
            "f_error_logs": ("Checkout rejects the code", "Checkout logs show 'code not valid in your region' for most customers."),
            "f_connection_pool": ("Support is flooded", "Support tickets about the code doubled in the last half hour."),
            "f_runbook_rollback": ("Pulling a campaign needs a check", "The launch runbook says check who already received a campaign before pulling it."),
            "f_migration_ran": ("The code was set up for one region only", "The promo code was configured for one region, but the email went to every customer."),
            "f_migration_incompatible": ("You can't unsend an email", "Turning the campaign off doesn't unsend the email; customers would click a dead link and get even angrier."),
            "f_ci_skipped": ("Nobody tested the code outside one region", "The launch checklist only tested the code from the home region."),
        },
        "actions": {
            "a_check_migration_compat": ("Check who received the email", "See how many customers already have the code."),
            "a_apply_forward_fix": ("Make the code valid everywhere", "Change the code's rules so every emailed customer can use it."),
            "a_apply_rollback": ("Turn the campaign off", "Disable the promo code and its landing page."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know how the code was set up first. Ask your teammate.",
            "a_apply_rollback": "Turning it off now is unsafe: you haven't checked who already received the email.",
        },
        "objects": {"migration_notes": "Campaign setup notes"},
        "objectives": {
            "o_identify_risk": ("Identify the switch-off risk", "Check what turning the campaign off does to people who got the email."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that works for everyone who received the code."),
        },
        "questions": {
            "teammate": [("How was the promo code set up?", "f_migration_ran"), ("What happens if we turn the campaign off?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Where did we test the code?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before we turn it off, who already got the email?"),
            "right_fix": ("teammate", "We can't unsend the email. Can we make the code valid everywhere?"),
            "update_sent": ("stakeholders", "Impact: promo code failing. Cause: region rule. Action: code valid everywhere. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check who already received it before you switch a campaign off.",
        "characters": {
            "teammate": {
                "greeting": "The email went out beautifully. The code, less so. Ask me how it was set up.",
                "keywords": {
                    "f_migration_ran": ["code", "promo", "region", "setup", "set up", "rule", "config", "campaign"],
                    "f_migration_incompatible": ["turn off", "switch off", "campaign off", "pull", "disable", "unsend", "email", "safe"],
                },
            },
            "qa": {"greeting": "We tested the code. From one office. In one country.", "keywords": {"f_ci_skipped": ["test", "region", "country", "checklist", "check", "where"]}},
        },
    },
    {
        "id": "google_login",
        "title": "Customers locked out after a new login launch",
        "services": ["Google sign-in launch", "new login page", "one-tap sign-in", "account redesign"],
        "briefing": (
            "You are the {role} on the launch team. {minutes} minutes ago the {service} rolled out to every "
            "user. Logins dropped {pct}% and support is flooded with locked-out customers. Figure out what "
            "happened, choose a safe fix and keep everyone aligned."
        ),
        "incident_line": "logins dropped {pct}% after the {service} launched {minutes} minutes ago",
        "facts": {
            "f_error_logs": ("Password users can't find their way in", "Support tickets say 'I don't have a Google account, how do I log in?'"),
            "f_connection_pool": ("Password resets are spiking", "Password reset requests are ten times normal, but the reset link leads to the new page too."),
            "f_runbook_rollback": ("Switch-off needs an account check", "The launch runbook says check which accounts changed before turning a login launch off."),
            "f_migration_ran": ("The launch hid email login", "The new page shows only 'Continue with Google', and linking converted some accounts to Google-only."),
            "f_migration_incompatible": ("Switching off strands Google-only accounts", "Turning the launch off brings back email login, but accounts converted to Google-only would then be locked out."),
            "f_ci_skipped": ("Nobody tested an account without Google", "Launch testing used staff accounts, which all have Google."),
        },
        "actions": {
            "a_check_migration_compat": ("Check which accounts changed", "Find out how many accounts are now Google-only."),
            "a_apply_forward_fix": ("Bring back email login next to Google", "Show both options on the new login page."),
            "a_apply_rollback": ("Turn the launch off", "Switch back to the old login page."),
        },
        "blocked": {
            "a_check_migration_compat": "You need to know what the launch changed first. Ask your teammate.",
            "a_apply_rollback": "Turning it off now is unsafe: you haven't checked which accounts changed.",
        },
        "objects": {"migration_notes": "Login launch notes"},
        "objectives": {
            "o_identify_risk": ("Identify the switch-off risk", "Check who a switch-off would lock out."),
            "o_choose_mitigation": ("Choose a safe mitigation", "Pick a fix that lets every customer log in."),
        },
        "questions": {
            "teammate": [("What did the launch change about logging in?", "f_migration_ran"), ("Who would a switch-off lock out?", "f_migration_incompatible"), ("What would you check first?", None)],
            "qa": [("Did we test an account without Google?", "f_ci_skipped"), ("What would have caught this?", None)],
        },
        "say_next_time": {
            "compat_checked": ("teammate", "Before we switch it off, which accounts are Google-only now?"),
            "right_fix": ("teammate", "Switching off locks out Google-only accounts. Can we show both login options?"),
            "update_sent": ("stakeholders", "Impact: logins down. Cause: email login hidden. Action: both options back. Next update 15 min. Owner: me."),
        },
        "tip_risk": "Check whose accounts changed before you switch a launch off.",
        "characters": {
            "teammate": {
                "greeting": "Logins fell off a cliff right after the launch. Ask me what we changed.",
                "keywords": {
                    "f_migration_ran": ["login", "google", "email", "password", "change", "launch", "hidden", "sign in"],
                    "f_migration_incompatible": ["turn off", "switch off", "switch-off", "rollback", "roll back", "lock", "google-only", "safe"],
                },
            },
            "qa": {"greeting": "Every test account we have is a staff account. Think about that.", "keywords": {"f_ci_skipped": ["test", "account", "staff", "google", "check", "without"]}},
        },
    },
]
