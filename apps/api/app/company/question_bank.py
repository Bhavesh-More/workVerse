"""Company question bank, demo version.

When a company attaches a CSV question bank while creating an assessment, the web app tags the
assessment's client_request_id with MARKER. Starting that assessment freezes the bank into the
scenario (blueprint.metadata["question_bank"]) and each AI colleague works its questions into the
conversation, one every other reply. Nothing about the bank is shown to candidates.

ponytail: hardcoded to the sample soft-skills bank (apps/web/public/samples/
soft-skills-question-bank.csv) and keyed off client_request_id so no migration is needed. Store
the parsed bank on the assessment when real uploads ship.
"""

from __future__ import annotations

from typing import Any

MARKER = "qb-"

# The sample bank, one entry per CSV row; ask_by is the role-card slot that asks it.
SAMPLE_BANK: list[dict[str, str]] = [
    {"id": "SS01", "skill": "communication", "ask_by": "manager", "question": "Give me a one-line status I can forward to leadership right now."},
    {"id": "SS04", "skill": "ownership", "ask_by": "manager", "question": "Who else needs to know about this, and have you told them?"},
    {"id": "SS09", "skill": "prioritisation", "ask_by": "manager", "question": "You have three things on fire. Which do you do first and why?"},
    {"id": "SS10", "skill": "decision making", "ask_by": "manager", "question": "What could go wrong with your plan, and how would you know?"},
    {"id": "SS05", "skill": "accountability", "ask_by": "manager", "question": "If this turns out to be your change, what do you do first?"},
    {"id": "SS12", "skill": "learning mindset", "ask_by": "manager", "question": "What would you do differently next time?"},
    {"id": "SS13", "skill": "active listening", "ask_by": "teammate", "question": "Repeat back what I just asked you to check."},
    {"id": "SS06", "skill": "teamwork", "ask_by": "teammate", "question": "I'm stuck on something else. What exactly do you need from me?"},
    {"id": "SS14", "skill": "critical thinking", "ask_by": "teammate", "question": "How do you know it's the database and not the network?"},
    {"id": "SS11", "skill": "adaptability", "ask_by": "teammate", "question": "New info: the error rate just doubled. What changes in your plan?"},
    {"id": "SS07", "skill": "conflict resolution", "ask_by": "teammate", "question": "I think rolling back is a mistake. Convince me otherwise."},
    {"id": "SS02", "skill": "communication", "ask_by": "client_pm", "question": "How would you explain this problem to a customer who isn't technical?"},
    {"id": "SS03", "skill": "stakeholder updates", "ask_by": "client_pm", "question": "When will you update me next, and what will you have by then?"},
    {"id": "SS08", "skill": "empathy", "ask_by": "client_pm", "question": "Customers are angry and support is overwhelmed. What do you say to the support lead?"},
    {"id": "SS15", "skill": "feedback", "ask_by": "client_pm", "question": "Your last update was too long. Can you try again in two sentences?"},
]


def for_assessment(client_request_id: str | None) -> list[dict[str, str]] | None:
    """The bank attached to an assessment, if the company added one."""
    return list(SAMPLE_BANK) if (client_request_id or "").startswith(MARKER) else None


def prompt_line(bank: list[dict[str, Any]] | None, slot: str, replies_so_far: int) -> str:
    """Instruction for this reply: on every other reply, ask this colleague's next bank question."""
    if not bank or replies_so_far % 2:
        return ""
    mine = [q for q in bank if q.get("ask_by") == slot]
    i = replies_so_far // 2
    if i >= len(mine):
        return ""
    q = mine[i]
    return (
        " THE HIRING COMPANY'S QUESTION FOR THIS REPLY: answer the learner first, then end your reply by "
        f'asking them this, in your own voice but keeping its meaning and key words: "{q["question"]}" '
        f"(it tests {q['skill']}). Tie it to the incident; never say it comes from a list, a bank or a test."
    )
