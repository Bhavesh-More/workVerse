import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { acceptAndStart, companyPage } from "./helpers";
import { testUser, type TestUser } from "./users";

// In-app notifications: a company delivers an assessment invite inside WorkVerse (no email), the
// signed-in candidate gets a live popup and a bell entry, opens the invite and starts; the company
// gets popups when the candidate starts and finishes. An invite to someone who hasn't signed in yet
// waits under their email and pops up on their first sign-in.
const API = "http://localhost:8000/api/v1";
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "notification-shots");
const RUN = Date.now();

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
async function token(page: Page): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session, null, { timeout: 30_000 });
  return page.evaluate(async () => {
    const c = (window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }).Clerk;
    return c.session.getToken();
  });
}
async function api(page: Page, request: APIRequestContext, method: string, p: string, data?: unknown) {
  const res = await request.fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${await token(page)}` }, data });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function signIn(browser: Browser, user: TestUser, where = "/sessions") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: user.ticket } });
  await page.goto(where);
  return page;
}

test("in-app invites, live popups and company alerts", async ({ browser, request }) => {
  test.setTimeout(600_000);
  const { page: co } = await companyPage(browser, request, `e2e-notify-${RUN}@gmail.com`, "Umbrella Talent");
  await expect(co).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
  // No SMTP at all: in-app delivery must not need it.
  const topic = await api(co, request, "POST", "/company/topics", { title: `Umbrella on-call ${RUN}`, description: "On-call incident.", track: "backend", difficulty: "standard", judges: {} });
  const assessment = await api(co, request, "POST", "/company/assessments", { topic_id: topic.body.id, title: `Umbrella round ${RUN}`, message: "Take it whenever you like this week." });
  expect(assessment.status).toBe(201);

  // A candidate who already uses WorkVerse is signed in and browsing.
  const candidate = await testUser(request, { preferEmail: `e2e-notify-cand-${RUN}@gmail.com` });
  const cand = await signIn(browser, candidate);
  await expect(cand.getByTestId("notification-bell").first()).toBeVisible({ timeout: 60_000 });
  // Their first poll records their verified email, so the invite reaches the profile directly.
  await cand.waitForTimeout(2500);

  // Company invites through the UI; "In WorkVerse" is the default channel.
  await co.goto(`/company/assessments/${assessment.body.id}`);
  await expect(co.getByTestId("channel-app")).toBeChecked();
  await co.getByLabel("Candidate 1 name").fill("Riley Chen");
  await co.getByLabel("Candidate 1 email").fill(candidate.email);
  await shot(co, "60-company-invite-in-app");
  await co.getByTestId("send-invites").click();
  await expect(co.getByTestId("invite-result")).toContainText("Delivered 1 invite in WorkVerse");
  await expect(co.getByTestId("invite-channel").first()).toHaveText("via WorkVerse");
  await expect(co.getByTestId("candidate-table")).toContainText("Invited");

  // Live popup on the candidate's open page (no reload), with the company and assessment.
  const popup = cand.getByTestId("notification-popup");
  await expect(popup).toBeVisible({ timeout: 30_000 });
  await expect(popup).toContainText("Umbrella Talent invited you to an assessment");
  await expect(popup).toContainText(`Umbrella round ${RUN}`);
  await expect(cand.getByTestId("notification-count").first()).toHaveText("1");
  await shot(cand, "61-candidate-live-popup");

  // Shown once: closed popups don't come back after a reload, but the bell keeps the invite.
  await popup.getByRole("button", { name: "Dismiss" }).click();
  await expect(popup).toHaveCount(0);
  await cand.waitForTimeout(500);
  await cand.reload();
  await expect(cand.getByTestId("notification-bell").first()).toBeVisible({ timeout: 30_000 });
  await expect(cand.getByTestId("notification-count").first()).toHaveText("1", { timeout: 20_000 });
  await cand.waitForTimeout(3000);
  await expect(popup).toHaveCount(0);
  await cand.getByTestId("notification-bell").first().click();
  await expect(cand.getByTestId("notification-panel")).toContainText("Umbrella Talent invited you");
  await shot(cand, "62-candidate-bell-panel");
  await cand.getByTestId("notification-item").first().click();
  // The notification opens the invitation review, never the test.
  await expect(cand).toHaveURL(/\/assessments\/[0-9a-f-]+$/);
  await expect(cand.getByTestId("accept-invitation")).toBeVisible({ timeout: 30_000 });

  // Starting the assessment (after accepting) pops up on the company's screen.
  await acceptAndStart(cand);
  await expect(cand.getByTestId("notification-count")).toHaveCount(0);
  const sessionId = new URL(cand.url()).searchParams.get("session")!;
  const coPopup = co.getByTestId("notification-popup");
  await expect(coPopup.filter({ hasText: "started" })).toBeVisible({ timeout: 30_000 });
  await expect(coPopup.filter({ hasText: "started" })).toContainText(`Riley Chen started Umbrella round ${RUN}`);
  await shot(co, "63-company-started-popup");

  // Finishing (forced here) pops up with the score and links to the report.
  const s = await api(cand, request, "GET", `/sessions/${sessionId}`);
  const done = await api(cand, request, "POST", `/sessions/${sessionId}/complete`, { expected_state_version: s.body.state_version, force: true });
  expect(done.status).toBe(200);
  const finished = coPopup.filter({ hasText: "finished" });
  await expect(finished).toBeVisible({ timeout: 30_000 });
  await expect(finished).toContainText(/Score \d+\/100/);
  await shot(co, "64-company-finished-popup");
  await finished.getByTestId("notification-popup-open").click();
  await expect(co).toHaveURL(/\/company\/assessments\/[0-9a-f-]+\/candidates\/[0-9a-f-]+/);

  // An invite to someone who hasn't used WorkVerse yet waits under their email...
  const later = await testUser(request, { preferEmail: `e2e-notify-late-${RUN}@gmail.com` });
  const sent = await api(co, request, "POST", `/company/assessments/${assessment.body.id}/invites`, { candidates: [{ email: later.email, name: "Sam Late" }], channel: "app" });
  expect(sent.body.sent).toBe(1);
  // (a reused test account may have signed in before, in which case it's delivered directly)
  // ...and pops up the first time they sign in.
  const late = await signIn(browser, later);
  await expect(late.getByTestId("notification-popup")).toContainText("Umbrella Talent invited you", { timeout: 40_000 });
  await shot(late, "65-late-signup-popup");
  await late.getByTestId("notification-popup-open").click();
  await expect(late).toHaveURL(/\/assessments\/[0-9a-f-]+$/);
  await expect(late.getByRole("heading", { name: new RegExp(`Umbrella round ${RUN}`) }).or(late.getByText(`Umbrella round ${RUN}`)).first()).toBeVisible();

  // Other users never see these.
  const outsider = await testUser(request, {});
  const out = await signIn(browser, outsider);
  await expect(out.getByTestId("notification-bell").first()).toBeVisible({ timeout: 60_000 });
  const list = await api(out, request, "GET", "/notifications");
  expect((list.body.items as { title: string }[]).some((n) => n.title.includes("Umbrella"))).toBe(false);
});
