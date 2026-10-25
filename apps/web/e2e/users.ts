import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";

// Test accounts for E2E specs. The Clerk development instance caps users at 100, so instead of
// creating a new account every run, specs reuse existing E2E test accounts (emails starting with
// "e2e") and only create one when there's quota left. Accounts that became company owners are
// remembered (a Clerk user can own one company) so "fresh company" tests get a clean owner.
const CLERK = "https://api.clerk.com/v1";
const STATE = path.join("node_modules", ".cache", "e2e-users.json");
const auth = () => ({ Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` });

type ClerkUser = { id: string; email_addresses: { email_address: string }[] };
type State = { owners: string[]; onboarded?: string[] };

function load(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8")) as State;
  } catch {
    return { owners: [] };
  }
}
function save(s: State) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s));
}

const usedThisRun = new Set<string>();

async function listUsers(request: APIRequestContext): Promise<ClerkUser[]> {
  const out: ClerkUser[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const r = await request.get(`${CLERK}/users?limit=100&offset=${offset}&order_by=created_at`, { headers: auth() });
    const page = (await r.json()) as ClerkUser[];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

async function ticketFor(request: APIRequestContext, userId: string): Promise<string> {
  const t = await request.post(`${CLERK}/sign_in_tokens`, { headers: auth(), data: { user_id: userId, expires_in_seconds: 3600 } });
  expect(t.ok(), await t.text()).toBeTruthy();
  return (await t.json()).token as string;
}

export type TestUser = { id: string; email: string; ticket: string; reused: boolean };

/** Record that this learner account finished onboarding (can't be "first-time" again). */
export function markOnboarded(user: TestUser) {
  const s = load();
  s.onboarded = [...new Set([...(s.onboarded ?? []), user.id])];
  save(s);
}

/** Record that this account now owns a company (so later runs don't pick it as a fresh owner). */
export function markOwner(user: TestUser) {
  const s = load();
  if (!s.owners.includes(user.id)) s.owners.push(user.id);
  save(s);
}

/**
 * A test account. `owner: true` means it will create a company, so it must never have owned one.
 * `preferEmail` creates that address when quota allows (useful for readable mail in mailpit).
 */
export async function testUser(request: APIRequestContext, opts: { owner?: boolean; preferEmail?: string; clerkTestEmail?: boolean; fresh?: boolean } = {}): Promise<TestUser> {
  const state = load();
  const users = await listUsers(request);
  if (users.length < 98 && opts.preferEmail) {
    const created = await request.post(`${CLERK}/users`, {
      headers: auth(),
      data: { email_address: [opts.preferEmail], password: "WorkVerse!234", skip_password_checks: true },
    });
    if (created.ok()) {
      const u = (await created.json()) as ClerkUser;
      usedThisRun.add(u.id);
      return { id: u.id, email: opts.preferEmail, ticket: await ticketFor(request, u.id), reused: false };
    }
  }
  const pick = users.find((u) => {
    const emails = u.email_addresses.map((e) => e.email_address);
    if (!emails.length || !emails.every((e) => e.startsWith("e2e"))) return false; // never touch real people
    if (usedThisRun.has(u.id)) return false;
    // Owning a company only rules an account out for tests that create a company.
    if (opts.owner && state.owners.includes(u.id)) return false;
    if (opts.clerkTestEmail && !emails.some((e) => e.includes("+clerk_test@"))) return false;
    // A first-time learner: never onboarded (learner-journey accounts all were; candidates weren't).
    if (opts.fresh && ((state.onboarded ?? []).includes(u.id) || emails.some((e) => /^e2e\d+@/.test(e)))) return false;
    // Accounts created as company owners by earlier runs (before this pool existed).
    if (opts.owner && emails.some((e) => /^e2e-(company|world|editor|iso-[ab]|default|play)-\d+@/.test(e))) return false;
    return true;
  });
  if (!pick && opts.owner) return recycleOwner(request, users, state);
  if (!pick) throw new Error("No reusable E2E test account left. Delete old e2e-* users in the Clerk dashboard to free quota.");
  usedThisRun.add(pick.id);
  return { id: pick.id, email: pick.email_addresses[0]!.email_address, ticket: await ticketFor(request, pick.id), reused: true };
}

/** Give a reused account a known password (for UI log-in paths). */
export async function setPassword(request: APIRequestContext, userId: string, password: string) {
  const r = await request.patch(`${CLERK}/users/${userId}`, { headers: auth(), data: { password, skip_password_checks: true } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

/**
 * No fresh owner left: free the longest-used E2E owner account by deleting the test company it
 * owns (and that company's assessments, topics and world). Only accounts whose emails all start
 * with "e2e" are ever touched; real companies are never deleted.
 */
async function recycleOwner(request: APIRequestContext, users: ClerkUser[], state: State): Promise<TestUser> {
  const owners = state.owners
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is ClerkUser => !!u && u.email_addresses.length > 0 && u.email_addresses.every((e) => e.email_address.startsWith("e2e")))
    .filter((u) => !usedThisRun.has(u.id));
  const victim = owners[0];
  if (!victim) throw new Error("No E2E owner account can be recycled. Delete old e2e-* users in the Clerk dashboard to free quota.");
  const env = fs.readFileSync(path.join("..", "api", ".env"), "utf8");
  const url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.replace(/^["']|["']$/g, "").replace("postgresql+asyncpg", "postgresql");
  if (!url) throw new Error("DATABASE_URL not found in apps/api/.env");
  const sql =
    "begin; " +
    "delete from public.assessments where company_id in (select c.id from public.companies c join public.profiles p on p.id = c.owner_profile_id where p.clerk_user_id = :'uid'); " +
    "delete from public.companies where owner_profile_id in (select id from public.profiles where clerk_user_id = :'uid'); " +
    "commit;";
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-v", `uid=${victim.id}`, "-q", "-c", sql.replaceAll(":'uid'", `'${victim.id.replace(/[^A-Za-z0-9_]/g, "")}'`)], { stdio: "pipe" });
  state.owners = state.owners.filter((id) => id !== victim.id);
  save(state);
  usedThisRun.add(victim.id);
  return { id: victim.id, email: victim.email_addresses[0]!.email_address, ticket: await ticketFor(request, victim.id), reused: true };
}
