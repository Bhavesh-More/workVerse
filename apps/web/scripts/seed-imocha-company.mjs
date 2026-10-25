// Seed a demo company account for iMocha on the Clerk *development* instance and fill it with
// dummy data through the WorkVerse API. Re-runnable: reuses the account and skips what exists.
//   node --env-file=.env scripts/seed-imocha-company.mjs
// Credentials are written to imocha-demo.local.json (gitignored), never printed.
/* global process */
import crypto from "node:crypto";
import fs from "node:fs";

const CLERK = "https://api.clerk.com/v1";
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
// eslint-disable-next-line turbo/no-undeclared-env-vars -- local seed script, not a turbo task
const KEY = process.env.CLERK_SECRET_KEY ?? "";
if (!KEY.startsWith("sk_test_")) throw new Error("Refusing to run: CLERK_SECRET_KEY is not a development (sk_test_) key.");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(API)) throw new Error(`Refusing to run against non-local API ${API}`);

const EMAIL = "imocha.talent+clerk_test@example.com";
const OUT = new URL("../imocha-demo.local.json", import.meta.url);
const clerk = async (method, path, body) => {
  const r = await fetch(`${CLERK}${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`Clerk ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

// 1. Account
let saved = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
let [user] = await clerk("GET", `/users?email_address=${encodeURIComponent(EMAIL)}`);
if (!user) {
  const password = `Im-${crypto.randomBytes(9).toString("base64url")}`;
  user = await clerk("POST", "/users", { email_address: [EMAIL], password, first_name: "iMocha", last_name: "Talent Team", skip_password_checks: true });
  saved = { email: EMAIL, password, note: "Clerk dev instance; +clerk_test emails also accept OTP 424242." };
  fs.writeFileSync(OUT, JSON.stringify(saved, null, 2));
}
console.log("account:", EMAIL, user.id, saved ? "(credentials in imocha-demo.local.json)" : "(existing; password unknown here)");

// 2. Short-lived API tokens via a backend-created session (dev instances only)
const session = await clerk("POST", "/sessions", { user_id: user.id });
const api = async (method, path, body) => {
  const { jwt } = await clerk("POST", `/sessions/${session.id}/tokens`);
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`API ${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
};

// 3. Company + profile + default office
let { company } = await api("GET", "/company");
if (!company) ({ company } = await api("POST", "/company", { name: "iMocha" }));
await api("PATCH", "/company", {
  profile: {
    tagline: "The Context Layer for Skills & Work Intelligence",
    about: "iMocha helps enterprises see what their people can do — and what they need next — with Skills Intelligence and Work Intelligence.",
    mission: "Help every organisation become skills-first.",
    vision: "One defensible view of the workforce, for every talent decision.",
    values: "Evidence over claims · Candidate respect · Always learning",
    industry: "HR technology",
    website: "https://www.imocha.io",
  },
});
await api("PATCH", "/company/workplace", { mode: "default" });
console.log("company:", company.name);

// 4. Topics
const existing = (await api("GET", "/company/topics")).items;
const TOPICS = [
  { title: "Checkout outage after a release", description: "A frontend release broke checkout; the candidate is on call and must find the cause and keep stakeholders posted.", track: "frontend", difficulty: "standard", judges: {} },
  { title: "API latency spike on payments", description: "Payment API latency jumps after a database migration; the candidate investigates and picks a safe fix.", track: "backend", difficulty: "challenging", judges: {} },
  { title: "Dashboard numbers don't add up", description: "A weekly revenue dashboard shows a sudden drop; the candidate checks the data pipeline and explains it to the business.", track: "data", difficulty: "introductory", judges: {} },
];
const topics = [];
for (const t of TOPICS) topics.push(existing.find((e) => e.title === t.title) ?? (await api("POST", "/company/topics", t)));
console.log("topics:", topics.length);

// 5. Assessments with dummy candidates (in-app invites only: no email is sent)
const have = (await api("GET", "/company/assessments")).items.map((a) => a.title);
const due = (days) => new Date(Date.now() + days * 864e5).toISOString();
const people = (names) => names.map((n) => ({ name: n, email: `${n.toLowerCase().replace(/\s+/g, ".")}+clerk_test@example.com` }));
const ASSESSMENTS = [
  { topic: 0, title: "Frontend Engineer — Campus Hiring 2026", days: 14, skills: ["diagnosis", "stakeholder_communication"], candidates: people(["Aarav Sharma", "Diya Patel", "Kabir Mehta", "Ananya Rao", "Rohan Iyer"]) },
  { topic: 1, title: "Backend On-call Readiness", days: 7, skills: ["risk_decision", "ownership"], candidates: people(["Ishaan Gupta", "Meera Nair", "Vivaan Singh"]) },
  { topic: 2, title: "Data Analyst Internship", days: 21, skills: [], candidates: people(["Sara Khan", "Arjun Das", "Nisha Verma", "Leo Fernandes"]) },
];
for (const a of ASSESSMENTS) {
  if (have.includes(a.title)) continue;
  await api("POST", "/company/assessments", {
    topic_id: topics[a.topic].id,
    title: a.title,
    message: "Thanks for applying to iMocha! This is a short simulated workday — there are no trick questions.",
    description: TOPICS[a.topic].description,
    expectations: "Ask good questions, make a safe call, and keep people informed.",
    instructions: "Take it in one sitting (about 15 minutes). Talk to your colleagues in the office.",
    skills: a.skills,
    due_at: due(a.days),
    timezone: "Asia/Kolkata",
    candidates: a.candidates,
    channel: "app",
    client_request_id: crypto.randomUUID(),
  });
}
console.log("assessments:", ASSESSMENTS.length);
await clerk("POST", `/sessions/${session.id}/revoke`);
console.log("done");
