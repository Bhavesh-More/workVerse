import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { markOwner, setPassword, testUser, type TestUser } from "./users";
import { acceptAndStart } from "./helpers";

// Company assessment journey. Needs web + api + database + Ollama, and a local SMTP catcher
// (mailpit: SMTP on 127.0.0.1:1025, API on 127.0.0.1:8025) so invites can be read back.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "company-shots");
const RUN = Date.now();

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function signedInPage(browser: Browser, request: APIRequestContext, user: TestUser, landing = "/login") {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(landing);
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: user.ticket } });
  return page;
}

type MailSummary = { ID: string; To: { Address: string }[]; Subject: string };

async function inviteLink(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 30; i += 1) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    const msg = (list.messages as MailSummary[]).find((m) => m.Subject.includes("invited you"));
    if (msg) {
      const full = await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const link = /https?:\/\/[^\s"<]+\/invite\/[A-Za-z0-9_-]+/.exec(full.Text as string)?.[0];
      if (link) return link.replace(/^https?:\/\/[^/]+/, "");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No invite email for ${to}`);
}

async function dismissFinding(page: Page, waitMs = 8_000) {
  const popup = page.locator(".px-backdrop");
  try {
    await popup.waitFor({ state: "visible", timeout: waitMs });
  } catch {
    return;
  }
  // A second finding can open right after the first closes; keep dismissing until none is left.
  for (let i = 0; i < 4 && (await popup.isVisible()); i += 1) {
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden", timeout: 4_000 }).catch(() => {});
  }
  await expect(popup).toBeHidden({ timeout: 10_000 });
}

function waitForApi(page: Page, part: string, method = "POST") {
  return page.waitForResponse((r) => r.url().includes(part) && r.request().method() === method, { timeout: 120_000 });
}

/** A candidate plays the scenario. `thorough` does the full safe path; otherwise a weaker run. */
async function playAssessment(page: Page, link: string, name: string, thorough: boolean) {
  await page.goto(link);
  // The emailed link opens the briefing in Company assessments; nothing starts until confirmed.
  await expect(page.getByTestId("briefing-title")).toContainText(`Backend on-call ${RUN}`, { timeout: 60_000 });
  await shot(page, `20-${name}-invite`);
  await acceptAndStart(page);
  await expect(page.getByText(/Assessment by E2E Hiring Co/)).toBeVisible();
  await shot(page, `21-${name}-briefing`);
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
  await expect(page.getByTestId("complete")).toBeVisible({ timeout: 30_000 });
  const intro = page.getByRole("dialog", { name: "Meet your team" });
  if (await intro.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Skip intro/i }).click();
    await expect(intro).toBeHidden({ timeout: 15_000 });
  }

  // The configured manager is the one we picked in the topic.
  await page.getByTestId("talk-manager").click();
  await page.getByTestId("chat-input").fill(thorough ? "What is the customer impact, and when do you need an update?" : "how bad is it");
  const t1 = waitForApi(page, "/turns");
  await page.getByTestId("chat-send").click();
  expect((await t1).ok()).toBeTruthy();
  await dismissFinding(page);
  await shot(page, `22-${name}-chat-manager`);

  await page.getByTestId("talk-teammate").click();
  await page.getByTestId("chat-input").fill("Did the deploy include a database migration?");
  const t2 = waitForApi(page, "/turns");
  await page.getByTestId("chat-send").click();
  expect((await t2).ok()).toBeTruthy();
  await dismissFinding(page);

  const actions = thorough
    ? ["a_inspect_dashboard", "a_inspect_logs", "a_inspect_metrics", "a_check_migration_compat", "a_apply_forward_fix"]
    : ["a_inspect_logs", "a_check_migration_compat", "a_apply_forward_fix"];
  for (const actionId of actions) {
    await dismissFinding(page, 1_500);
    const resp = waitForApi(page, "/actions");
    const button = page.getByTestId(`action-${actionId}`);
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
    expect((await resp).ok()).toBeTruthy();
    await dismissFinding(page);
  }
  await page.getByTestId("status-update").fill(
    thorough
      ? "Impact: about a quarter of checkout requests fail since the deploy. Cause: a backward-incompatible migration. Action: shipping a forward fix now. Next update in 15 minutes. Owner: me."
      : "We are looking into it, should be fine soon.",
  );
  const update = waitForApi(page, "/actions");
  await page.getByTestId("send-status-update").click();
  expect((await update).ok()).toBeTruthy();
  await dismissFinding(page, 1_500);
  const complete = waitForApi(page, "/complete");
  await page.getByTestId("complete").click();
  expect((await complete).ok()).toBeTruthy();
  await page.getByRole("button", { name: /See your debrief/i }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/debrief/, { timeout: 120_000 });
  await expect(page.getByText(/shared with E2E Hiring Co/i)).toBeVisible({ timeout: 30_000 });
  await shot(page, `23-${name}-debrief`);
}

test.describe("Company assessments", () => {
  test("company sets up judges, topic and assessment, invites by email/paste/CSV, candidates play, HR exports PDF+CSV", async ({
    browser,
    request,
  }) => {
    test.setTimeout(1_200_000);
    await request.delete(`${MAILPIT}/api/v1/messages`);

    // ---- company account -------------------------------------------------------------
    let co!: Page;
    for (let attempt = 0; attempt < 6; attempt++) {
      const owner = await testUser(request, { owner: true, preferEmail: `e2e-company-${RUN}@gmail.com` });
      co = await signedInPage(browser, request, owner, "/company/login");
      await co.goto("/company");
      await co.getByRole("heading", { name: /Set up your company|Assessment overview|Where will candidates work/ }).first().waitFor({ timeout: 60_000 });
      markOwner(owner);
      if (await co.getByRole("heading", { name: /Set up your company/ }).isVisible()) break;
      await co.context().close(); // reused account already owns a company: take the next one
    }
    await expect(co.getByRole("heading", { name: /Set up your company/ })).toBeVisible({ timeout: 60_000 });
    await co.getByLabel("Company name").fill("E2E Hiring Co");
    await co.getByRole("button", { name: /Create company/ }).click();
    // New companies choose their virtual workplace first; the default keeps this spec focused.
    await expect(co).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
    await co.getByTestId("use-default").click();
    await expect(co).toHaveURL(/\/company\/workplace/);
    await co.goto("/company");
    await expect(co.getByRole("heading", { name: /Assessment overview/ })).toBeVisible();
    await expect(co.getByText("Getting started")).toBeVisible();
    await shot(co, "01-overview-empty");

    // ---- SMTP settings + test email ----------------------------------------------------
    await co.getByRole("link", { name: "Settings" }).click();
    await co.getByLabel("Host").fill("127.0.0.1");
    await co.getByLabel("Port").fill("1025");
    await co.getByLabel("Security").selectOption("none");
    await co.getByLabel("Username").fill("hiring");
    await co.getByLabel("Password").fill("secret");
    await co.getByLabel("From email").fill("hiring@e2e-hiring.test");
    await co.getByLabel("From name").fill("E2E Hiring Team");
    await co.getByTestId("save-settings").click();
    await expect(co.getByText("Settings saved.")).toBeVisible();
    await co.getByLabel("Send a test email to").fill("hr@e2e-hiring.test");
    await co.getByRole("button", { name: "Send test email" }).click();
    await expect(co.getByText("Test email sent to hr@e2e-hiring.test.")).toBeVisible();
    await shot(co, "02-settings-smtp");

    // ---- the company's judges ------------------------------------------------------------
    await co.getByRole("link", { name: "AI judges" }).click();
    await co.getByTestId("judge-item-2").click(); // QA
    const qa = co.getByTestId("judge-form");
    await qa.getByLabel("Tone").selectOption("warm");
    await qa.getByTestId("judge-personality").fill("Patient mentor who explains what testing covers.");
    await co.getByTestId("judge-item-0").click(); // manager
    await qa.getByTestId("judge-name").fill("Amara Osei");
    await qa.getByTestId("avatar-amara-osei").click();
    await co.getByTestId("save-judges").click();
    await expect(co.getByText(/Saved. Every new assessment session/)).toBeVisible();
    await shot(co, "03-judges-defaults");

    // ---- topic: sample fill, then customise the manager --------------------------------
    await co.getByRole("link", { name: "Topics" }).click();
    await co.getByRole("link", { name: "New topic" }).first().click();
    await co.getByTestId("fill-sample").click();
    await expect(co.getByLabel("Topic", { exact: true })).not.toHaveValue("");
    await expect(co.getByLabel("Description")).not.toHaveValue("");
    await co.getByLabel("Topic", { exact: true }).fill(`Backend on-call ${RUN}`);
    // Every configured judge is listed; the roster owns names, a topic picks who joins and tunes behaviour.
    await expect(co.locator('[data-testid^="topic-judge-toggle-"]')).toHaveCount(5);
    const manager = co.getByTestId("topic-judge-manager");
    await expect(manager).toContainText("Amara Osei");
    await co.getByTestId("topic-judge-tune-manager").click();
    await manager.getByLabel("Tone").selectOption("blunt");
    await manager.getByLabel(/How demanding/).fill("5");
    await manager.getByLabel("What they probe for").fill("Never accepts an update without an ETA and an owner.");
    await expect(manager.getByText("Tuned")).toBeVisible();
    await shot(co, "04-topic-form");
    await co.getByTestId("save-topic").click();
    await expect(co).toHaveURL(/\/company\/topics\/[0-9a-f-]+/);
    await expect(co.getByRole("heading", { name: `Backend on-call ${RUN}` })).toBeVisible();

    // ---- assessment ---------------------------------------------------------------------
    await co.getByRole("button", { name: /Create assessment from this topic/ }).click();
    await expect(co).toHaveURL(/\/company\/assessments\/new/);
    await expect(co.getByTestId("preview-valid")).toHaveText(/Checked/, { timeout: 30_000 });
    await co.getByTestId("wizard-next").click();
    await co.getByTestId("field-title").fill(`Backend on-call ${RUN}`);
    await co.getByLabel("Personal note in the invitation (optional)").fill("Please finish within a week. It takes about 15 minutes.");
    await co.getByTestId("wizard-next").click();
    await co.getByTestId("wizard-next").click(); // invite from the assessment page below
    await co.getByTestId("publish-assessment").click();
    await co.getByTestId("open-assessment").click();
    await expect(co).toHaveURL(/\/company\/assessments\/[0-9a-f-]+$/);
    const assessmentUrl = co.url();

    // ---- invites: type, paste, CSV --------------------------------------------------------
    // Candidate 3 signs up through the UI, so it uses a Clerk test address (code 424242).
    // Candidates 1-2 sign in with tickets; 3 logs in through the UI (a +clerk_test account, code 424242);
    // 4 is only invited.
    const U1 = await testUser(request, { preferEmail: `e2e-cand1-${RUN}@gmail.com` });
    const U2 = await testUser(request, { preferEmail: `e2e-cand2-${RUN}@gmail.com` });
    const U3 = await testUser(request, { clerkTestEmail: true });
    const U3_PASSWORD = `WorkVerse!${RUN}`;
    await setPassword(request, U3.id, U3_PASSWORD);
    const cand = (n: number) => ({ 1: U1.email, 2: U2.email, 3: U3.email } as Record<number, string>)[n] ?? `e2e-cand${n}-${RUN}@gmail.com`;
    await co.getByTestId("channel-both").check(); // email (read from mailpit below) and in-app
    await co.getByLabel("Candidate 1 name").fill("Asha Patel");
    await co.getByLabel("Candidate 1 email").fill(cand(1));
    await co.getByRole("tab", { name: "Paste list" }).click();
    await co.getByLabel("Emails").fill(`Ben Ortiz <${cand(2)}>`);
    await expect(co.getByText("1 candidate ready")).toBeVisible();
    await co.getByTestId("send-invites").click();
    await expect(co.getByTestId("invite-result")).toContainText("Sent 1 invite");

    await co.getByRole("tab", { name: "Type" }).click();
    await co.getByLabel("Candidate 1 name").fill("Asha Patel");
    await co.getByLabel("Candidate 1 email").fill(cand(1));
    await co.getByTestId("send-invites").click();
    await expect(co.getByTestId("invite-result")).toContainText("Sent 1 invite");

    await co.getByRole("tab", { name: "Upload CSV" }).click();
    await co.getByTestId("csv-input").setInputFiles({
      name: "candidates.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`First Name,Last Name,Email\nChen,Li,${cand(3)}\nDara,Kim,${cand(4)}\n,,not-an-email\n`),
    });
    await expect(co.getByText("2 candidates ready")).toBeVisible();
    await shot(co, "05-invite-csv");
    await co.getByTestId("send-invites").click();
    await expect(co.getByTestId("invite-result")).toContainText("Sent 2 invites");
    await expect(co.getByTestId("kpi-invited")).toHaveText("4");
    await shot(co, "06-assessment-invited");

    // Re-inviting the same people sends nothing new.
    await co.getByRole("tab", { name: "Paste list" }).click();
    await co.getByLabel("Emails").fill(`${cand(1)}, ${cand(2)}`);
    await co.getByTestId("send-invites").click();
    await expect(co.getByTestId("invite-result")).toContainText("2 already invited");

    // ---- candidates (two play: one strong, one weak) --------------------------------------
    const link1 = await inviteLink(request, cand(1));
    const link2 = await inviteLink(request, cand(2));
    await inviteLink(request, cand(3));
    await inviteLink(request, cand(4));

    const c1 = await signedInPage(browser, request, U1);
    await playAssessment(c1, link1, "cand1", true);
    const c2 = await signedInPage(browser, request, U2);
    await playAssessment(c2, link2, "cand2", false);

    // Signed-out visitors to company pages land on the company log-in.
    const anon = await browser.newPage();
    await anon.goto("/company/assessments");
    await expect(anon).toHaveURL(/\/company\/login\?redirect=%2Fcompany%2Fassessments/);
    await expect(anon.getByRole("heading", { name: /Hiring dashboard/ })).toBeVisible();

    // A third candidate opens the invite signed out, logs in through the UI and comes back to it.
    const c3page = await browser.newPage();
    const link3 = await inviteLink(request, cand(3));
    await c3page.goto(link3);
    await setupClerkTestingToken({ page: c3page });
    await expect(c3page.getByTestId("invite-signup")).toBeVisible({ timeout: 60_000 });
    await shot(c3page, "24-cand3-invite-signed-out");
    await c3page.getByTestId("invite-login").click();
    await expect(c3page).toHaveURL(/\/login\?redirect=/);
    await c3page.getByLabel("Email address").fill(cand(3));
    await c3page.getByLabel("Password", { exact: true }).fill(U3_PASSWORD);
    await c3page.getByRole("button", { name: /Log in/ }).click();
    const code = c3page.getByLabel("Verification code");
    // Clerk asks new devices for an email code (always 424242 for +clerk_test addresses).
    const needsCode = await Promise.race([
      code.waitFor({ timeout: 20_000 }).then(() => true),
      c3page.waitForURL(/\/(invite|assessments)\//, { timeout: 20_000 }).then(() => false),
    ]).catch(() => false);
    if (needsCode) {
      await code.fill("424242");
      await c3page.getByRole("button", { name: /Verify/ }).click();
    }
    // Back from sign-in, the link opens the invitation in Company assessments (not started).
    await expect(c3page).toHaveURL(/\/assessments\/[0-9a-f-]+$/, { timeout: 60_000 });
    await expect(c3page.getByTestId("accept-invitation")).toBeVisible({ timeout: 60_000 });
    await shot(c3page, "25-cand3-invite-after-login");

    // ---- HR analytics ----------------------------------------------------------------------
    await co.goto(assessmentUrl);
    await expect(co.getByTestId("kpi-completed")).toHaveText("2", { timeout: 60_000 });
    await expect(co.getByTestId("candidate-table")).toContainText("Asha Patel");
    await expect(co.getByTestId("candidate-table")).toContainText("Opened invite");
    await expect(co.getByText("Score distribution")).toBeVisible();
    await shot(co, "07-assessment-results");

    // Exports: CSV, then the reports dialog (pick the report and the candidates).
    const pdfPages = (file: string) => (fs.readFileSync(file).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    {
      const dl = co.waitForEvent("download", { timeout: 120_000 });
      await co.getByTestId("export-csv").click();
      const target = path.join(SHOTS, "report.csv");
      await (await dl).saveAs(target);
      const csv = fs.readFileSync(target, "utf8");
      expect(csv).toContain("Overall score (0-100)");
      expect(csv).toContain(cand(1));
    }
    const saveDownload = async (name: string) => {
      const dl = co.waitForEvent("download", { timeout: 180_000 });
      await co.getByTestId("report-download").click();
      const target = path.join(SHOTS, name);
      await (await dl).saveAs(target);
      expect(fs.readFileSync(target).subarray(0, 4).toString()).toBe("%PDF");
      return target;
    };
    await co.getByTestId("export-pdf").click();
    const dialog = co.getByTestId("report-dialog");
    await expect(dialog).toBeVisible();
    await expect(co.getByTestId("report-kind-summary").locator("input")).toBeChecked();
    // Only people who finished can be picked; both completed candidates are pre-selected.
    await expect(co.getByTestId("report-candidates").locator("li")).toHaveCount(2);
    await expect(co.getByTestId("report-summary")).toContainText("2 candidates");
    await co.getByTestId("report-select-none").click();
    await expect(co.getByTestId("report-download")).toBeDisabled();
    await co.getByTestId(`report-pick-${cand(1)}`).check();
    await expect(co.getByTestId("report-summary")).toContainText("1 candidate · one PDF · 1 page");
    await shot(co, "07b-report-dialog");
    // One candidate's single summary is exactly one page.
    expect(pdfPages(await saveDownload("summary-one.pdf"))).toBe(1);
    // Both candidates' in-detail reviews: a long, multi-page document.
    await co.getByTestId("export-pdf").click();
    await co.getByTestId("report-kind-detailed").click();
    await co.getByTestId("report-select-all").click();
    expect(pdfPages(await saveDownload("detailed-all.pdf"))).toBeGreaterThanOrEqual(8);
    // The whole assessment: a one-page group summary, and the detailed group overview.
    await co.getByTestId("export-pdf").click();
    await co.getByTestId("report-kind-group-summary").click();
    await expect(co.getByTestId("report-candidates")).toHaveCount(0);
    expect(pdfPages(await saveDownload("group-summary.pdf"))).toBe(1);
    await co.getByTestId("export-pdf").click();
    await co.getByTestId("report-kind-group-detailed").click();
    expect(pdfPages(await saveDownload("group-detailed.pdf"))).toBeGreaterThanOrEqual(4);

    // Candidate drill-down, with that candidate's two PDFs.
    await co.getByTestId("candidate-table").getByRole("link", { name: "View report" }).first().click();
    await expect(co.getByText("Skill profile vs. group")).toBeVisible();
    await expect(co.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await shot(co, "08-candidate-report");
    for (const [testId, name] of [["candidate-summary-pdf", "cand-summary.pdf"], ["candidate-detailed-pdf", "cand-detailed.pdf"]] as const) {
      const dl = co.waitForEvent("download", { timeout: 180_000 });
      await co.getByTestId(testId).click();
      const target = path.join(SHOTS, name);
      await (await dl).saveAs(target);
      expect(fs.readFileSync(target).subarray(0, 4).toString()).toBe("%PDF");
      if (testId === "candidate-summary-pdf") expect(pdfPages(target)).toBe(1);
    }

    // Company-wide candidates: everyone across assessments, filters and exports
    await co.getByRole("link", { name: "Candidates", exact: true }).click();
    await expect(co.getByTestId("all-total")).toHaveText("4");
    await expect(co.getByTestId("all-completed")).toHaveText("2");
    await expect(co.getByTestId("all-candidates-table")).toContainText(`Backend on-call ${RUN}`);
    await co.getByLabel("Search candidates").fill("asha");
    await expect(co.getByTestId("all-candidates-table").locator("tbody tr")).toHaveCount(1);
    await co.getByLabel("Search candidates").fill("");
    await co.getByLabel("Filter by status").selectOption("completed");
    await expect(co.getByTestId("all-candidates-table").locator("tbody tr")).toHaveCount(2);
    await shot(co, "10-all-candidates");
    for (const [testId, ext] of [["export-all-csv", "csv"], ["export-all-pdf", "pdf"]] as const) {
      const dl = co.waitForEvent("download", { timeout: 120_000 });
      await co.getByTestId(testId).click();
      const target = path.join(SHOTS, `all-candidates.${ext}`);
      await (await dl).saveAs(target);
      const head = fs.readFileSync(target).subarray(0, 64).toString("utf8");
      if (ext === "csv") expect(head).toContain("Rank,Assessment,Name");
      else expect(head.startsWith("%PDF")).toBeTruthy();
    }

    // Overview reflects the round
    await co.goto("/company");
    await expect(co.getByText(`Backend on-call ${RUN}`).first()).toBeVisible();
    await shot(co, "09-overview-filled");
  });
});
