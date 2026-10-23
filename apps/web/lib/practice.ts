// Pure practice-loop helpers shared by the pages. No React, no DOM: run by `node --test`.
import type {
  CompetencyTrend,
  Objective,
  ProgressResponse,
  SessionView,
  WorldAction,
} from "./types.ts";

export type GuideStep = { title: string; body: string; room?: string; character?: string };

/** Ordered coaching steps for what the learner still has to do in the incident scenario. */
export function buildGuideSteps(session: SessionView): GuideStep[] {
  const done = (id: string) => session.objectives.find((o) => o.id === id)?.status === "completed";
  const knows = (id: string) => session.facts_known.some((f) => f.id === id);
  const steps: GuideStep[] = [];
  if (!done("o_establish_impact"))
    steps.push({
      title: "Establish the impact",
      body: "Open the chat with your manager and ask what the customer impact and reporting deadline are.",
      character: "manager",
    });
  if (!knows("f_migration_ran"))
    steps.push({
      title: "Find out what shipped",
      body: "Ask your engineering teammate whether the deployment included a database migration.",
      character: "teammate",
    });
  if (!done("o_gather_evidence"))
    steps.push({
      title: "Investigate evidence",
      body: "Walk to the engineering workspace and inspect the application logs (walk up to the console and press E, or click it).",
      room: "engineering_workspace",
    });
  if (!done("o_identify_risk"))
    steps.push({
      title: "Check rollback safety",
      body: "Open the migration notes and check whether the migration is compatible before reverting.",
      room: "engineering_workspace",
    });
  if (!done("o_choose_mitigation"))
    steps.push({
      title: "Mitigate safely",
      body: "At the deployment console, choose your mitigation — roll back or apply the forward fix.",
      room: "engineering_workspace",
    });
  if (!done("o_communicate"))
    steps.push({
      title: "Update stakeholders",
      body: "Write a clear status update in the “Stakeholder update” panel: impact, cause, action, next update and owner.",
    });
  steps.push({
    title: "Finish and debrief",
    body: "When every required objective is complete, hit “Complete & debrief” to get your evidence-grounded report.",
  });
  return steps;
}

/** The objective to highlight: first unfinished required one, else first unfinished at all. */
export function nextObjective(objectives: Objective[]): Objective | undefined {
  return (
    objectives.find((o) => o.required && o.status !== "completed") ??
    objectives.find((o) => o.status !== "completed")
  );
}

/** In-world (non-navigation) actions keyed by the object they target. */
export function actionsByObject(actions: WorldAction[]): Map<string, WorldAction[]> {
  const map = new Map<string, WorldAction[]>();
  for (const a of actions) {
    if (!a.target_id || a.action_type === "navigate") continue;
    const list = map.get(a.target_id) ?? [];
    list.push(a);
    map.set(a.target_id, list);
  }
  return map;
}

/** Human label for where the route overlay is pointing. */
export function destinationLabel(session: SessionView): string {
  const nav = session.navigation;
  if (!nav) return "Destination";
  if (nav.target_type === "character" && nav.target_id)
    return session.world.characters.find((c) => c.id === nav.target_id)?.name ?? nav.objective_label;
  if (nav.target_type === "object" && nav.target_id)
    return (
      session.world.objects.find((o) => o.id === nav.target_id)?.label ??
      nav.action_label ??
      nav.objective_label
    );
  return nav.action_label ?? nav.objective_label ?? "Destination";
}

/** Rounded mean of scored attempts; null when nothing has been scored yet. */
export function averageScore(evaluations: ProgressResponse["evaluations"]): number | null {
  const scored = evaluations.filter((e) => e.overall_score !== null);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((s, e) => s + (e.overall_score ?? 0), 0) / scored.length);
}

/** Highest-scoring criterion that has enough data to be meaningful. */
export function strongestCriterion(trends: CompetencyTrend[]): CompetencyTrend | undefined {
  return trends
    .filter((t) => t.sufficient_data && t.average_score !== null)
    .sort((a, b) => (b.average_score ?? 0) / b.score_max - (a.average_score ?? 0) / a.score_max)[0];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export const LEVELS: { value: string; label: string }[] = [
  { value: "beginner", label: "Student / just starting" },
  { value: "early_career", label: "Early career (0–2 yrs)" },
  { value: "intermediate", label: "Intermediate (2–5 yrs)" },
  { value: "experienced", label: "Experienced (5+ yrs)" },
  { value: "unspecified", label: "Prefer not to say" },
];

/** Toggle membership of a value in a list without mutating it. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Split a comma-separated field into trimmed, non-empty, de-duplicated entries. */
export function splitList(text: string): string[] {
  return [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
}

// Short, human-sized openers per colleague. `fact` = what the question tends to unlock;
// ones whose fact is already known drop to the back so suggestions stay useful.
const QUESTIONS: Record<string, { q: string; fact?: string }[]> = {
  manager: [
    { q: "How many customers are affected?", fact: "f_business_impact" },
    { q: "When do you need an update from me?", fact: "f_reporting_deadline" },
    { q: "I'll own this. Anything I should know?" },
  ],
  teammate: [
    { q: "Did this deploy include a migration?", fact: "f_migration_ran" },
    { q: "Is a rollback safe with that migration?", fact: "f_migration_incompatible" },
    { q: "What would you check first?" },
  ],
  qa: [
    { q: "Did CI run the integration tests?", fact: "f_ci_skipped" },
    { q: "What would have caught this?" },
  ],
  client_pm: [
    { q: "Which of your workflows are blocked?", fact: "f_client_impact" },
    { q: "We're on it — can I update you in 15 minutes?" },
  ],
  coworker: [{ q: "Seen anything odd this morning?" }],
};

/** Up to three short questions to ask this colleague, unknown-fact ones first. */
export function suggestedQuestions(session: SessionView, characterId: string): string[] {
  const known = new Set(session.facts_known.map((f) => f.id));
  const list = QUESTIONS[characterId] ?? [];
  return [...list.filter((x) => !x.fact || !known.has(x.fact)), ...list.filter((x) => x.fact && known.has(x.fact))]
    .slice(0, 3)
    .map((x) => x.q);
}

/** Word count used for the "keep it short" nudge; matches the backend's rough tokenizer. */
export function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9']+/g) ?? []).length;
}
