// Company question bank (CSV) -> assessment plan.
// ponytail: demo only. The "AI analysis" is deterministic keyword rules run in the browser, and the
// plan isn't stored or sent to the AI colleagues yet. Swap analyzeBank() for an API call when the
// backend lands; the QuestionPlan shape is what the UI renders.

export const SAMPLE_CSV_URL = "/samples/soft-skills-question-bank.csv";
export const SAMPLE_CSV_NAME = "soft-skills-question-bank.csv";

export type Slot = "manager" | "teammate" | "client";
export type BankQuestion = { id: string; skill: string; skillId: string; question: string; askBy: Slot; lookFor: string; difficulty: string };
export type QuestionPlan = {
  source: string;
  questions: BankQuestion[];
  skills: { id: string; name: string; count: number }[];
  bySlot: Record<Slot, BankQuestion[]>;
  rounds: { title: string; detail: string; questions: number }[];
  summary: string;
  expectations: string;
};

const SKILL_NAMES: Record<string, string> = {
  diagnosis: "Problem solving",
  risk_decision: "Judgement under risk",
  communication: "Communication",
  ownership: "Ownership & teamwork",
  adaptation: "Adaptability",
};
const SKILL_RULES: [string[], string][] = [
  [["communicat", "listen", "present", "writing", "stakeholder", "update", "feedback"], "communication"],
  [["ownership", "accountab", "teamwork", "collaborat", "responsib", "empathy", "conflict"], "ownership"],
  [["adapt", "change", "resilien", "learn", "ambigu"], "adaptation"],
  [["judgement", "judgment", "decision", "risk", "priorit", "ethic"], "risk_decision"],
  [["problem", "analy", "critical", "diagnos", "curios"], "diagnosis"],
];
const DEFAULT_ASKER: Record<string, Slot> = { communication: "client", ownership: "manager", risk_decision: "manager", adaptation: "teammate", diagnosis: "teammate" };

/** Minimal RFC 4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const skillId = (t: string) => SKILL_RULES.find(([w]) => w.some((k) => t.toLowerCase().includes(k)))?.[1] ?? "communication";
function asker(t: string, sid: string): Slot {
  const v = t.trim().toLowerCase();
  if (/manager|lead|boss/.test(v)) return "manager";
  if (/team|peer|colleague|engineer/.test(v)) return "teammate";
  if (/client|pm|product|stakeholder|customer/.test(v)) return "client";
  return DEFAULT_ASKER[sid] ?? "manager";
}

/** Validate the CSV and build the plan. Throws a readable Error for a bad file. */
export function analyzeBank(csv: string, source: string): QuestionPlan {
  const [head, ...body] = parseCsv(csv);
  const cols = (head ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => cols.indexOf(name);
  if (col("skill") < 0 || col("question") < 0) throw new Error("The CSV needs at least a “skill” and a “question” column.");
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
  const questions: BankQuestion[] = body
    .filter((r) => get(r, "question"))
    .slice(0, 50)
    .map((r, i) => {
      const sid = skillId(get(r, "skill"));
      return {
        id: get(r, "id") || `Q${i + 1}`,
        skill: get(r, "skill") || SKILL_NAMES[sid]!,
        skillId: sid,
        question: get(r, "question"),
        askBy: asker(get(r, "ask_by"), sid),
        lookFor: get(r, "look_for"),
        difficulty: get(r, "difficulty") || "standard",
      };
    });
  if (!questions.length) throw new Error("No questions found in that CSV.");

  const counts = new Map<string, number>();
  questions.forEach((q) => counts.set(q.skillId, (counts.get(q.skillId) ?? 0) + 1));
  const skills = [...counts].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, name: SKILL_NAMES[id]!, count }));
  const bySlot: Record<Slot, BankQuestion[]> = { manager: [], teammate: [], client: [] };
  questions.forEach((q) => bySlot[q.askBy].push(q));
  const top = skills.slice(0, 3).map((s) => s.name);
  const n = (k: string) => questions.filter((q) => q.difficulty.toLowerCase() === k).length;

  return {
    source,
    questions,
    skills,
    bySlot,
    // How the scenario is paced around the bank (hardcoded design for the demo).
    rounds: [
      { title: "Warm-up", detail: "First contact: listening and clarifying questions while the incident lands.", questions: n("introductory") },
      { title: "Under pressure", detail: "Colleagues probe priorities, ownership and updates as the incident unfolds.", questions: n("standard") },
      { title: "Stretch", detail: "Push-back and curveballs: conflict, trade-offs and changing information.", questions: n("challenging") },
    ],
    summary: `${questions.length} questions across ${skills.length} scored skills, led by ${top.join(", ")}. Your AI colleagues ask them in character during the incident instead of as a quiz.`,
    expectations: `Demonstrate ${top.join(", ").toLowerCase()}: ${questions
      .slice(0, 3)
      .map((q) => q.lookFor.toLowerCase())
      .filter(Boolean)
      .join("; ")}.`.slice(0, 600),
  };
}
