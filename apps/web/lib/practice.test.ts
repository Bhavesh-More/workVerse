// Run with: node --test lib/practice.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  actionsByObject,
  averageScore,
  buildGuideSteps,
  destinationLabel,
  initials,
  nextObjective,
  splitList,
  strongestCriterion,
  suggestedQuestions,
  wordCount,
  toggle,
} from "./practice.ts";
import type { CompetencyTrend, SessionView, WorldAction } from "./types.ts";

function action(id: string, target_id: string | null, action_type = "inspect"): WorldAction {
  return {
    id,
    label: id,
    description: "",
    action_type,
    kind: "tool",
    location_id: null,
    target_id,
    risk_level: "low",
    requires_text: false,
    available: true,
    ready: true,
    locked_reason: null,
  };
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  const ids = [
    "o_establish_impact",
    "o_gather_evidence",
    "o_identify_risk",
    "o_choose_mitigation",
    "o_communicate",
  ];
  return {
    id: "s1",
    status: "active",
    state_version: 1,
    current_location_id: "reception",
    active_character_id: null,
    phase: "investigate",
    objectives: ids.map((id) => ({ id, label: id, status: "pending", required: true })),
    tasks: {},
    facts_known: [],
    incident: {},
    available_locations: [],
    world: {
      locations: [],
      characters: [{ id: "manager", name: "Priya Shah", role: "Manager", sprite: "", location_id: "manager_office", greeting: "" }],
      objects: [{ id: "log_viewer", label: "Log viewer", location_id: "engineering_workspace", marker: "" }],
      actions: [],
    },
    navigation: null,
    completion: { ready: false, required_objectives: [], completed_objectives: [], missing_objectives: [], missing_actions: [] },
    completed: false,
    ...overrides,
  };
}

test("guide covers every unfinished step and always ends with the debrief", () => {
  const steps = buildGuideSteps(session());
  assert.equal(steps.length, 7);
  assert.equal(steps[0]?.character, "manager");
  assert.equal(steps.at(-1)?.title, "Finish and debrief");
});

test("guide drops steps the learner has already done", () => {
  const s = session();
  s.objectives = s.objectives.map((o) => ({ ...o, status: "completed" }));
  s.facts_known = [{ id: "f_migration_ran", label: "Migration ran", detail: "" }];
  const steps = buildGuideSteps(s);
  assert.deepEqual(steps.map((x) => x.title), ["Finish and debrief"]);
});

test("next objective prefers unfinished required objectives", () => {
  const objectives = [
    { id: "a", label: "a", status: "completed", required: true },
    { id: "b", label: "b", status: "pending", required: false },
    { id: "c", label: "c", status: "pending", required: true },
  ];
  assert.equal(nextObjective(objectives)?.id, "c");
  assert.equal(nextObjective(objectives.slice(0, 2))?.id, "b");
  assert.equal(nextObjective([objectives[0]!]), undefined);
});

test("actions are grouped by target and navigation is excluded", () => {
  const map = actionsByObject([
    action("a_inspect_logs", "log_viewer"),
    action("a_tail_logs", "log_viewer"),
    action("a_walk", "log_viewer", "navigate"),
    action("a_free", null),
  ]);
  assert.deepEqual([...map.keys()], ["log_viewer"]);
  assert.deepEqual(map.get("log_viewer")?.map((a) => a.id), ["a_inspect_logs", "a_tail_logs"]);
});

test("destination label resolves characters and objects by id", () => {
  const nav = {
    objective_id: "o",
    objective_label: "Gather evidence",
    action_id: null,
    action_label: "Inspect logs",
    target_type: "character" as const,
    target_id: "manager",
    location_id: null,
    ready: true,
    reason: null,
  };
  assert.equal(destinationLabel(session({ navigation: nav })), "Priya Shah");
  assert.equal(
    destinationLabel(session({ navigation: { ...nav, target_type: "object", target_id: "log_viewer" } })),
    "Log viewer",
  );
  assert.equal(
    destinationLabel(session({ navigation: { ...nav, target_type: "object", target_id: "gone" } })),
    "Inspect logs",
  );
  assert.equal(destinationLabel(session()), "Destination");
});

test("average score ignores unscored attempts instead of counting them as zero", () => {
  const ev = (overall_score: number | null) => ({
    session_id: "s",
    overall_score,
    rubric_version: "1",
    difficulty: "standard",
    completed_at: "",
  });
  assert.equal(averageScore([]), null);
  assert.equal(averageScore([ev(null)]), null);
  assert.equal(averageScore([ev(60), ev(null), ev(81)]), 71);
});

test("strongest criterion only considers criteria with enough data", () => {
  const t = (criterion_name: string, average_score: number | null, sufficient_data: boolean): CompetencyTrend => ({
    criterion_id: criterion_name,
    criterion_name,
    attempts: 3,
    average_score,
    score_max: 4,
    rubric_version: "1",
    sufficient_data,
  });
  assert.equal(strongestCriterion([t("noisy", 4, false), t("comms", 2.5, true), t("risk", 3, true)])?.criterion_name, "risk");
  assert.equal(strongestCriterion([t("noisy", 4, false)]), undefined);
});

test("initials, toggle and list splitting", () => {
  assert.equal(initials("ada lovelace byron"), "AL");
  assert.equal(initials("  "), "?");
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggle(["a"], "b"), ["a", "b"]);
  assert.deepEqual(splitList(" Python, ,FastAPI,Python "), ["Python", "FastAPI"]);
});

test("suggestedQuestions puts questions for unknown facts first", () => {
  const s = { facts_known: [{ id: "f_migration_ran", label: "", detail: "" }] } as unknown as SessionView;
  const qs = suggestedQuestions(s, "teammate");
  assert.equal(qs[0], "Is a rollback safe with that migration?");
  assert.equal(qs.at(-1), "Did this deploy include a migration?");
  assert.deepEqual(suggestedQuestions(s, "nobody"), []);
});

test("suggestedQuestions prefers the scenario's role-specific questions", () => {
  const s = {
    facts_known: [],
    world: { characters: [{ id: "teammate", questions: [{ q: "Did an upstream table change?", fact: "f_migration_ran" }] }] },
  } as unknown as SessionView;
  assert.deepEqual(suggestedQuestions(s, "teammate"), ["Did an upstream table change?"]);
});

test("wordCount counts words not whitespace", () => {
  assert.equal(wordCount("  Did it   ship? "), 3);
  assert.equal(wordCount(""), 0);
});
