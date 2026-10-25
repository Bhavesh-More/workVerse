import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { companyPage } from "./helpers";
import { testUser, type TestUser } from "./users";

// The Company assessments journey end to end: a company describes itself, publishes an
// assessment through the wizard (scenario, brief, deadline, candidates, review); candidates find
// it grouped by company, read the briefing, accept (nothing starts), start through a confirmation
// (one attempt, however often they retry), decline, and the company tracks every response.
// Also: email and in-app paths converge, authorization, withdrawals, deadline changes, empty and
// error states, and separation from normal learning.
const API = "http://localhost:8000/api/v1";
const MAILPIT = "http://127.0.0.1:8025";
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "company-assessments-shots");
const RUN = Date.now();
const CO = "Northwind Labs";
const TITLE = `Northwind on-call ${RUN}`;

async function shot(page: Page, name: string, fullPage = false) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}
async function token(page: Page): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session, null, { timeout: 30_000 });
  return page.evaluate(async () => (window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }).Clerk.session.getToken());
}
async function api(page: Page, request: APIRequestContext, method: string, p: string, data?: unknown) {
  const res = await request.fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${await token(page)}` }, data });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function signIn(browser: Browser, user: TestUser, where: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: user.ticket } });
  await page.goto(where);
  return page;
}
async function mineFor(page: Page, request: APIRequestContext, companyName = CO) {
  const r = await api(page, request, "GET", "/me/company-assessments");
  return (r.body.assignments as { id: string; title: string; company_name: string; session_id: string | null; state: { stage: string } }[]).filter(
    (a) => a.company_name === companyName && a.title === TITLE,
  );
}

test("company assessments: publish, review, accept, start, decline, track", async ({ browser, request }) => {
  test.setTimeout(900_000);

  // ---------------------------------------------------------------- company: profile + topic
  const { page: co } = await companyPage(browser, request, `e2e-ca-${RUN}@gmail.com`, CO);
  await expect(co).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
  expect((await api(co, request, "PATCH", "/company", { smtp: { host: "127.0.0.1", port: 1025, security: "none", from_email: "hiring@northwind.test", from_name: CO } })).status).toBe(200);
  await co.goto("/company/settings");
  await co.getByTestId("pf-tagline").fill("We build logistics software that keeps deliveries on time.");
  await co.getByTestId("pf-about").fill("Northwind Labs makes route planning and tracking tools for 400 regional couriers. We're a team of 60 across London and Pune.");
  await co.getByTestId("pf-mission").fill("Make every delivery predictable.");
  await co.getByTestId("pf-vision").fill("Couriers of any size running on software as good as the global carriers'.");
  await co.getByTestId("pf-values").fill("Calm under pressure, write things down, customers first.");
  await co.getByTestId("pf-industry").fill("Logistics software");
  await co.getByTestId("pf-website").fill("northwind.example");
  await co.getByTestId("save-profile").click();
  await expect(co.getByText("Profile saved.")).toBeVisible();
  await expect(co.getByTestId("pf-website")).toHaveValue("https://northwind.example");
  await shot(co, "69-company-profile");
  const companyId = (await api(co, request, "GET", "/company")).body.company.id as string;
  const topic = await api(co, request, "POST", "/company/topics", { title: `On-call incident ${RUN}`, description: "Checkout fails after a deploy; the candidate is on call.", track: "backend", difficulty: "standard", judges: {} });
  expect(topic.status).toBe(201);

  // Candidates: A and B have accounts; C doesn't (the invitation waits for them).
  const A = await testUser(request, { preferEmail: `e2e-ca-a-${RUN}@gmail.com` });
  const B = await testUser(request, { preferEmail: `e2e-ca-b-${RUN}@gmail.com` });
  const C = `e2e-ca-nobody-${RUN}@gmail.com`;

  // ---------------------------------------------------------------- company: wizard
  await co.goto(`/company/assessments/new?topic=${topic.body.id}`);
  await expect(co.getByTestId("preview-valid")).toHaveText(/Checked/, { timeout: 30_000 });
  await expect(co.getByTestId("scenario-preview")).toContainText("Who they meet");
  await shot(co, "70-wizard-scenario");
  await co.getByTestId("wizard-next").click();
  await co.getByTestId("field-title").fill(TITLE);
  await co.getByTestId("field-description").fill("A short simulated on-call shift. We use it as the second step for backend roles.");
  await co.getByTestId("field-expectations").fill("Gather facts from the team before acting, check the fix is safe, and keep stakeholders updated in plain words.");
  await co.getByTestId("skill-diagnosis").click();
  await co.getByTestId("skill-communication").click();
  await co.getByTestId("field-instructions").fill("Use a quiet place. Headphones help if you try a voice call.");
  await co.getByTestId("no-deadline").uncheck();
  await co.getByTestId("field-tz").selectOption("Asia/Kolkata");
  await co.getByTestId("field-due").fill("2031-03-14T17:30");
  await expect(co.getByTestId("due-summary")).toContainText("2031");
  await expect(co.getByTestId("profile-card")).toContainText("We build logistics software");
  await shot(co, "71-wizard-brief", true);
  await co.getByTestId("wizard-next").click();
  await co.getByRole("tab", { name: "Paste list" }).click();
  await co.getByLabel("Emails").fill(`Ann Ahmed <${A.email}>, Ben Brooks <${B.email}>, Cara Cole <${C}>`);
  await expect(co.getByText("3 candidates ready")).toBeVisible();
  await co.waitForTimeout(400);
  await shot(co, "72-wizard-people");
  await co.getByTestId("wizard-next").click();
  await expect(co.getByTestId("review-due")).toContainText("2031");
  await expect(co.getByTestId("review-people")).toContainText(A.email);
  await expect(co.getByTestId("nw-channel-both")).toBeChecked();
  await co.waitForTimeout(500); // step transition
  await shot(co, "73-wizard-review", true);
  await co.getByTestId("publish-assessment").click();
  await expect(co.getByTestId("published")).toBeVisible({ timeout: 60_000 });
  await expect(co.getByTestId("publish-result")).toContainText("3 of 3");
  await shot(co, "74-published");
  await co.getByTestId("open-assessment").click();
  await expect(co).toHaveURL(/\/company\/assessments\/[0-9a-f-]+$/);
  const assessmentId = co.url().split("/").pop()!;
  await expect(co.getByTestId("assessment-deadline")).toContainText("2031");
  await expect(co.getByTestId("candidate-table")).toContainText("Invited");
  await expect(co.getByTestId("assessment-brief")).toContainText("Gather facts from the team");

  // Publishing is idempotent: the same request id never makes a second assessment.
  const body = { topic_id: topic.body.id, title: `Idempotent ${RUN}`, message: "", client_request_id: `e2e-${RUN}-idem` };
  const first = await api(co, request, "POST", "/company/assessments", body);
  const again = await api(co, request, "POST", "/company/assessments", body);
  expect(first.body.created).toBe(true);
  expect(again.body.created).toBe(false);
  expect(again.body.id).toBe(first.body.id);
  // A deadline in the past is rejected.
  expect((await api(co, request, "POST", "/company/assessments", { ...body, client_request_id: `e2e-${RUN}-past`, due_at: "2020-01-01T00:00:00Z" })).status).toBe(422);

  // ---------------------------------------------------------------- candidate A: find it
  const a = await signIn(browser, A, "/assessments");
  const companyCard = a.getByTestId(`company-card-${companyId}`);
  await expect(companyCard).toBeVisible({ timeout: 60_000 });
  await expect(companyCard).toContainText(CO);
  await expect(companyCard).toContainText("1 new");
  await expect(a.getByTestId("up-next")).toContainText(TITLE);
  await shot(a, "75-ca-landing");
  const [mine] = await mineFor(a, request);
  expect(mine!.state.stage).toBe("invited");
  expect(mine!.session_id).toBeNull();
  await companyCard.click();
  await expect(a).toHaveURL(new RegExp(`/assessments/company/${companyId}$`));
  await expect(a.getByRole("heading", { name: CO, exact: true })).toBeVisible();
  const card = a.getByTestId(`assignment-card-${mine!.id}`);
  await expect(card.getByTestId("stage-pill")).toHaveAttribute("data-stage", "invited");
  await expect(card).toContainText("2031");
  await shot(a, "76-ca-company");

  // ---------------------------------------------------------------- briefing: read-only
  await card.getByRole("button", { name: /Open details/ }).click();
  await expect(a).toHaveURL(new RegExp(`/assessments/${mine!.id}$`));
  await expect(a.getByTestId("briefing-title")).toHaveText(TITLE);
  await expect(a.getByTestId("sec-expectations")).toContainText("Gather facts from the team");
  await expect(a.getByTestId("sec-skills")).toContainText(`Chosen by ${CO}`);
  await expect(a.getByTestId("sec-skills").locator("li")).toHaveCount(2);
  await expect(a.getByTestId("sec-instructions")).toContainText("quiet place");
  await expect(a.getByTestId("sec-company")).toContainText("Make every delivery predictable.");
  await expect(a.getByTestId("sec-company")).toContainText("Couriers of any size");
  await expect(a.getByTestId("briefing-deadline")).toContainText("2031");
  await expect(a.getByTestId("accept-invitation")).toBeVisible();
  await expect(a.getByTestId("start-assessment")).toHaveCount(0); // can't skip acceptance
  await shot(a, "77-briefing-invitation");
  await shot(a, "77b-briefing-invitation-full", true);
  // Viewing and refreshing never creates an attempt.
  await a.reload();
  await expect(a.getByTestId("briefing-title")).toHaveText(TITLE);
  expect((await mineFor(a, request))[0]!.session_id).toBeNull();
  // Starting before accepting is refused by the server too.
  expect((await api(a, request, "POST", `/me/company-assessments/${mine!.id}/start`)).status).toBe(409);

  // ---------------------------------------------------------------- accept (nothing starts)
  await a.getByTestId("accept-invitation").click();
  await expect(a.getByTestId("briefing-notice")).toContainText("nothing has started");
  await expect(a.getByTestId("stage-pill").first()).toHaveAttribute("data-stage", "ready");
  expect((await mineFor(a, request))[0]!.session_id).toBeNull();
  await a.reload();
  await expect(a.getByTestId("stage-pill").first()).toHaveAttribute("data-stage", "ready");
  await expect(a.getByTestId("start-assessment")).toBeVisible();
  // Accepting again (another tab, the email link) changes nothing.
  const twice = await api(a, request, "POST", `/me/company-assessments/${mine!.id}/accept`);
  expect(twice.status).toBe(200);
  expect(twice.body.changed).toBe(false);
  await shot(a, "78-briefing-ready");
  const companyView = await api(co, request, "GET", `/company/assessments/${assessmentId}`);
  const statusOf = (rows: { email: string; status: string }[], email: string) => rows.find((r) => r.email === email)?.status;
  expect(statusOf(companyView.body.candidates, A.email)).toBe("accepted");

  // ---------------------------------------------------------------- start: confirm, once
  await a.getByTestId("start-assessment").click();
  await expect(a.getByRole("dialog", { name: "Start the assessment" })).toBeVisible();
  await a.waitForTimeout(400);
  await shot(a, "79-start-confirm");
  await a.getByRole("button", { name: "Not yet" }).click();
  await expect(a.getByRole("dialog", { name: "Start the assessment" })).toHaveCount(0);
  expect((await mineFor(a, request))[0]!.session_id).toBeNull();
  await a.getByTestId("start-assessment").click();
  await a.getByTestId("confirm-start").click();
  await expect(a).toHaveURL(/\/briefing\/.*session=/, { timeout: 120_000 });
  const sessionId = new URL(a.url()).searchParams.get("session")!;
  const retry = await api(a, request, "POST", `/me/company-assessments/${mine!.id}/start`);
  expect(retry.body.session_id).toBe(sessionId);
  expect(retry.body.resumed).toBe(true);
  await a.goto(`/assessments/${mine!.id}`);
  await expect(a.getByTestId("stage-pill").first()).toHaveAttribute("data-stage", "in_progress");
  await expect(a.getByTestId("continue-assessment")).toHaveAttribute("href", `/session/${sessionId}`);
  await shot(a, "80-briefing-in-progress");

  // The emailed link converges on the same assignment (no second invitation or attempt).
  let link = "";
  for (let i = 0; i < 30 && !link; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${A.email}" subject:"${TITLE}"`)}`)).json();
    const msg = list.messages?.[0];
    if (msg) {
      const full = await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      expect(full.Text as string).toContain("doesn't start the assessment");
      expect(full.Text as string).toContain("2031");
      link = /\/invite\/[A-Za-z0-9_-]+/.exec(full.Text as string)?.[0] ?? "";
    }
    if (!link) await a.waitForTimeout(1000);
  }
  expect(link).toBeTruthy();
  await a.goto(link);
  await expect(a).toHaveURL(new RegExp(`/assessments/${mine!.id}$`), { timeout: 30_000 });
  await expect(a.getByTestId("stage-pill").first()).toHaveAttribute("data-stage", "in_progress");
  expect((await mineFor(a, request)).length).toBe(1);

  // Company runs stay out of practice: not in Sessions.
  await a.goto("/sessions");
  await expect(a.getByRole("heading", { name: "Previous sessions" })).toBeVisible();
  await expect(a.getByText(TITLE)).toHaveCount(0);

  // ---------------------------------------------------------------- candidate B: declines
  const b = await signIn(browser, B, "/assessments");
  const [bMine] = await mineFor(b, request);
  await b.goto(`/assessments/${bMine!.id}`);
  await b.getByTestId("decline-invitation").click();
  await b.getByLabel(`Note to ${CO} (optional)`).fill("I've accepted another offer, thank you.");
  await shot(b, "81-decline-dialog");
  await b.getByTestId("confirm-decline").click();
  await expect(b.getByTestId("stage-pill").first()).toHaveAttribute("data-stage", "declined");
  await expect(b.getByTestId("no-action")).toBeVisible();
  await shot(b, "82-declined");

  // ---------------------------------------------------------------- authorization
  // Another candidate's assignment is invisible (404, never 403), by URL or API.
  expect((await api(b, request, "GET", `/me/company-assessments/${mine!.id}`)).status).toBe(404);
  expect((await api(b, request, "POST", `/me/company-assessments/${mine!.id}/accept`)).status).toBe(404);
  expect((await api(b, request, "POST", `/me/company-assessments/${mine!.id}/start`)).status).toBe(404);
  expect((await api(b, request, "GET", `/me/company-assessments/not-a-uuid`)).status).toBe(404);
  await b.goto(`/assessments/${mine!.id}`);
  await expect(b.getByTestId("briefing-missing")).toBeVisible({ timeout: 30_000 });
  await shot(b, "83-briefing-not-available");
  // Candidates can't read company data; another company can't touch this one's assessment.
  expect((await api(b, request, "GET", `/company/assessments/${assessmentId}`)).status).toBe(404);
  const { page: other } = await companyPage(browser, request, `e2e-ca-other-${RUN}@gmail.com`, "Contoso Rival");
  expect((await api(other, request, "GET", `/company/assessments/${assessmentId}`)).status).toBe(404);
  expect((await api(other, request, "PATCH", `/company/assessments/${assessmentId}`, { status: "closed" })).status).toBe(404);
  expect((await api(other, request, "POST", `/company/assessments/${assessmentId}/invites/${mine!.id}/revoke`)).status).toBe(404);
  await other.context().close();

  // ---------------------------------------------------------------- company tracks responses
  await co.reload();
  await expect(co.getByTestId(`status-${A.email}`)).toHaveText("In progress");
  await expect(co.getByTestId(`status-${B.email}`)).toHaveText("Declined");
  await expect(co.getByTestId("candidate-table")).toContainText("accepted another offer");
  await expect(co.getByTestId("kpi-responses")).toContainText("1 accepted · 1 declined");
  co.once("dialog", (d) => void d.accept());
  await co.getByTestId(`revoke-${C}`).click();
  await expect(co.getByTestId(`status-${C}`)).toHaveText("Withdrawn");
  await shot(co, "84-company-tracking", true);

  // Moving the deadline tells people who still have work to do (A is in progress).
  await co.getByTestId("edit-assessment").click();
  await co.getByTestId("edit-dialog").getByTestId("field-due").fill("2031-04-01T12:00");
  await expect(co.getByTestId("due-change-note")).toBeVisible();
  await shot(co, "85-edit-deadline");
  await co.getByTestId("save-assessment").click();
  await expect(co.getByTestId("assessment-deadline")).toContainText("Apr");
  await expect
    .poll(async () => ((await api(a, request, "GET", "/notifications")).body.items as { title: string }[]).some((n) => n.title === `New deadline for ${TITLE}`), { timeout: 20_000 })
    .toBe(true);
  // A declined candidate isn't bothered about it.
  expect(((await api(b, request, "GET", "/notifications")).body.items as { title: string }[]).some((n) => n.title === `New deadline for ${TITLE}`)).toBe(false);

  // Withdrawing closes it to new starts and new invitations; A's run in progress continues.
  await co.getByTestId("withdraw-assessment").click();
  await co.getByTestId("withdraw-yes").click();
  await expect(co.getByText("closed", { exact: true }).first()).toBeVisible();
  expect((await api(co, request, "POST", `/company/assessments/${assessmentId}/invites`, { candidates: [{ email: `e2e-late-${RUN}@gmail.com` }], channel: "app" })).status).toBe(409);
  await a.goto(`/assessments/${mine!.id}`);
  await expect(a.getByTestId("continue-assessment")).toBeVisible();
  await expect(a.getByRole("note")).toContainText("closed this assessment");

  // Phone width: the briefing stacks (next step first), lists stay readable.
  await a.setViewportSize({ width: 390, height: 844 });
  await a.waitForTimeout(400);
  await shot(a, "89-phone-briefing");
  await a.goto("/assessments");
  await expect(a.getByTestId(`company-card-${companyId}`)).toBeVisible({ timeout: 30_000 });
  await shot(a, "90-phone-landing");
  await a.goto(`/assessments/company/${companyId}`);
  await expect(a.getByTestId(`assignment-card-${mine!.id}`)).toBeVisible({ timeout: 30_000 });
  await shot(a, "91-phone-company");
});

test("empty state, invalid links and the signed-out invitation", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const U = await testUser(request, {});
  const page = await signIn(browser, U, "/dashboard");
  // Empty state (the API answer is replaced so this account's real invitations don't matter).
  await page.route("**/api/v1/me/company-assessments", (r) => r.fulfill({ json: { companies: [], assignments: [], now: new Date().toISOString() } }));
  await page.goto("/assessments");
  await expect(page.getByTestId("ca-empty")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Company assessments/ })).toHaveAttribute("aria-current", "page");
  await shot(page, "86-ca-empty");
  await page.unroute("**/api/v1/me/company-assessments");
  // Loading state of the briefing (held response), then a missing one.
  await page.route("**/api/v1/me/company-assessments/00000000-0000-4000-8000-000000000000", async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await page.goto("/assessments/00000000-0000-4000-8000-000000000000");
  await shot(page, "87-briefing-loading");
  await expect(page.getByTestId("briefing-missing")).toBeVisible({ timeout: 30_000 });
  // Practice is unaffected.
  await page.goto("/scenarios");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByTestId("stat-attempts")).toBeVisible({ timeout: 30_000 });

  // A broken invitation link explains itself.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/invite/this-is-not-a-real-token-1234");
  await expect(anon.getByTestId("invite-invalid")).toBeVisible({ timeout: 30_000 });
  await shot(anon, "88-invite-invalid");
});
