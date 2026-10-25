import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { companyPage } from "./helpers";
import { testUser } from "./users";

// Company AI judges: the full-screen roster editor from workplace setup (any number of judges,
// free names, avatars, voices, prefilled behaviour), persistence, the AI judges page, the world
// editor, and a candidate meeting the company's own judges in its office.
const API = "http://localhost:8000/api/v1";
const MAILPIT = "http://127.0.0.1:8025";
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "judges-shots");
const RUN = Date.now();

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
async function token(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const c = (window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }).Clerk;
    return c.session.getToken();
  });
}
async function api(page: Page, request: APIRequestContext, method: string, p: string, data?: unknown) {
  const res = await request.fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${await token(page)}` }, data });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

test("company configures its own AI judges and a candidate meets them", async ({ browser, request }) => {
  test.setTimeout(600_000);
  const { page, errors } = await companyPage(browser, request, `e2e-judges-${RUN}@gmail.com`, "Initech Hiring");
  await expect(page).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
  await page.getByTestId("create-world").click();
  await page.getByTestId("presets-continue").click();
  await expect(page.getByTestId("roster-summary")).toBeVisible();
  await expect(page.getByTestId("judge-badge")).toHaveText("5 · simulated");

  // The modal opens full screen (not a navigation to the AI judges page).
  await page.getByTestId("configure-judges").click();
  const modal = page.getByTestId("judge-modal");
  await expect(modal).toBeVisible();
  await expect(page).toHaveURL(/\/company\/workplace\/setup/);
  const box = (await modal.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(1400);
  expect(box.height).toBeGreaterThanOrEqual(880);
  await expect(page.getByTestId("judge-count")).toHaveText("5 / 12");
  // Defaults are real, editable values.
  await expect(page.getByTestId("judge-personality")).not.toHaveValue("");
  await expect(page.getByTestId("judge-greeting")).not.toHaveValue("");
  await expect(page.getByTestId("judge-focus")).not.toHaveValue("");
  await expect(page.getByTestId("voice-hope")).toBeVisible();
  await expect(page.locator('[data-testid^="voice-"]')).toHaveCount(6);
  await shot(page, "50-judges-modal-default");

  // Judge 1: custom name, avatar, voice and personality.
  await page.getByTestId("judge-name").fill("Zara Quinn");
  await page.getByTestId("avatar-amara-osei").click();
  await page.getByTestId("voice-tony").getByRole("radio").click();
  await page.getByTestId("judge-personality").fill("Calm, precise and fair. Wants numbers before opinions.");
  await expect(page.getByTestId("judge-personality-reset")).toBeVisible();
  await page.getByTestId("judge-focus").fill("Asks how sure the candidate is and what evidence backs it.");
  await expect(page.getByTestId("judge-item-0")).toContainText("Zara Quinn");
  await expect(page.getByTestId("judge-item-0")).toContainText("Tony");

  // Add two judges (6, 7): a second teammate and a second QA.
  await page.getByTestId("add-judge").click();
  await expect(page.getByTestId("judge-count")).toHaveText("6 / 12");
  await page.getByTestId("judge-role").selectOption("teammate");
  await page.getByTestId("judge-name").fill("Lee Roy");
  await page.getByTestId("voice-brayden").getByRole("radio").click();
  await page.getByTestId("add-judge").click();
  await page.getByTestId("judge-role").selectOption("qa");
  await page.getByTestId("judge-name").fill("Mina Park");
  await expect(page.getByTestId("judge-count")).toHaveText("7 / 12");

  // Remove the coworker: the incident stays solvable and the editor says who covers.
  await page.getByTestId("judge-item-4").click();
  await page.getByTestId("judge-delete").click();
  await page.getByTestId("judge-delete-confirm").click();
  await expect(page.getByTestId("judge-count")).toHaveText("6 / 12");
  await expect(page.getByTestId("cover-note")).toContainText("Zara Quinn");

  // Validation: an empty name blocks saving.
  await page.getByTestId("judge-item-1").click();
  const teammateName = await page.getByTestId("judge-name").inputValue();
  await page.getByTestId("judge-name").fill("");
  await expect(page.getByTestId("judge-issues")).toContainText("needs a name");
  await expect(page.getByTestId("judge-save")).toBeDisabled();
  await page.getByTestId("judge-name").fill(teammateName);
  await shot(page, "51-judges-modal-edited");

  await page.getByTestId("judge-save").click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId("judge-badge")).toHaveText("6 · simulated");
  await expect(page.getByTestId("roster-summary")).toContainText("Zara Quinn");
  await expect(page.getByTestId("roster-summary")).toContainText("Lee Roy");
  await shot(page, "52-people-step-with-roster");

  // Persisted server-side, in order, with the chosen values.
  const company = (await api(page, request, "GET", "/company")).body.company;
  const roster = company.judge_roster as { id: string; name: string; role: string; voice: string; avatar: string; personality: string }[];
  expect(roster.map((j) => j.name)).toEqual(["Zara Quinn", roster[1]!.name, roster[2]!.name, roster[3]!.name, "Lee Roy", "Mina Park"]);
  expect(roster[0]).toMatchObject({ role: "manager", voice: "tony", avatar: "Amara Osei", personality: "Calm, precise and fair. Wants numbers before opinions." });
  expect(roster.some((j) => j.role === "coworker")).toBe(false);
  // Server-side validation is enforced too.
  expect((await api(page, request, "PATCH", "/company", { judge_roster: [] })).status).toBe(422);

  // Reopen: saved values load; cancelling with changes asks first.
  await page.getByTestId("configure-judges").click();
  await expect(page.getByTestId("judge-name")).toHaveValue("Zara Quinn");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot(page, "57-judges-modal-phone");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("judge-name").fill("Changed");
  await page.getByTestId("judge-cancel").click();
  await page.getByTestId("judge-discard").click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId("roster-summary")).toContainText("Zara Quinn");

  // The world editor places all six judges, with their names.
  await page.getByTestId("open-editor").click();
  await expect(page.getByTestId("world-canvas")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "People" }).click();
  const lee = roster.find((j) => j.name === "Lee Roy")!;
  await expect(page.getByTestId(`lib-person-${lee.id}`)).toContainText("Lee Roy");
  await expect(page.getByTestId(`lib-person-${lee.id}`)).toContainText("Placed");
  await expect(page.locator('[data-testid^="lib-person-"]')).toHaveCount(6);
  await shot(page, "53-editor-people-roster");
  await page.waitForTimeout(1600); // autosave settles
  await page.getByTestId("publish-btn").click();
  await page.getByTestId("publish-confirm").click();
  await expect(page.getByTestId("toast")).toContainText(/Published/);

  // AI judges page uses the same editor and shows the saved team.
  await page.goto("/company/judges");
  await expect(page.getByTestId("judge-count")).toHaveText("6 / 12");
  await expect(page.getByTestId("judge-item-0")).toContainText("Zara Quinn");
  await shot(page, "54-judges-page");

  // Topics list every configured judge; this scenario leaves Mina out and tunes Lee.
  await page.goto("/company/topics/new");
  await page.getByLabel("Topic", { exact: true }).fill(`Initech on-call ${RUN}`);
  await page.getByLabel("Description").fill("On-call incident.");
  await expect(page.locator('[data-testid^="topic-judge-toggle-"]')).toHaveCount(6);
  const mina = roster.find((j) => j.name === "Mina Park")!;
  await expect(page.getByTestId(`topic-judge-${mina.id}`)).toContainText("Mina Park");
  await page.getByTestId(`topic-judge-toggle-${mina.id}`).uncheck({ force: true });
  await expect(page.getByTestId("topic-judge-summary")).toContainText("5 of 6 judges");
  await page.getByTestId(`topic-judge-tune-${lee.id}`).click();
  await page.getByTestId(`topic-judge-focus-${lee.id}`).fill("Checks whether the candidate reads the release diff first.");
  await shot(page, "58-topic-judges");
  await page.getByTestId("save-topic").click();
  await expect(page).toHaveURL(/\/company\/topics\/[0-9a-f-]+/);
  const topicId = /topics\/([0-9a-f-]+)/.exec(page.url())![1]!;
  const savedTopic = (await api(page, request, "GET", `/company/topics/${topicId}`)).body;
  expect(savedTopic.judge_ids).toHaveLength(5);
  expect(savedTopic.judge_ids).not.toContain(mina.id);
  expect(savedTopic.judges[lee.id].focus).toContain("release diff");
  expect((await api(page, request, "PUT", `/company/topics/${topicId}`, { ...savedTopic, judge_ids: [] })).status).toBe(422);

  // A candidate invited now meets these judges, placed where the company put them.
  expect((await api(page, request, "PATCH", "/company", { smtp: { host: "127.0.0.1", port: 1025, security: "none", from_email: "hiring@initech.test", from_name: "Initech" } })).status).toBe(200);
  const topic = { body: savedTopic };
  const assessment = await api(page, request, "POST", "/company/assessments", { topic_id: topic.body.id, title: `Initech round ${RUN}`, message: "" });
  const candidate = await testUser(request, { preferEmail: `e2e-judges-cand-${RUN}@gmail.com` });
  expect((await api(page, request, "POST", `/company/assessments/${assessment.body.id}/invites`, { candidates: [{ email: candidate.email, name: "Casey" }] })).body.sent).toBe(1);
  let link = "";
  for (let i = 0; i < 30 && !link; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${candidate.email}"`)}`)).json();
    const msg = list.messages?.[0];
    if (msg) link = /\/invite\/[A-Za-z0-9_-]+/.exec((await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()).Text as string)?.[0] ?? "";
    if (!link) await page.waitForTimeout(1000);
  }
  expect(link).toBeTruthy();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cand = await ctx.newPage();
  await cand.goto("/login");
  await setupClerkTestingToken({ page: cand });
  await clerk.signIn({ page: cand, signInParams: { strategy: "ticket", ticket: candidate.ticket } });
  await cand.goto(link);
  await cand.getByTestId("start-assessment").click();
  await expect(cand).toHaveURL(/\/briefing\/.*session=/, { timeout: 120_000 });
  const sessionId = new URL(cand.url()).searchParams.get("session")!;
  const session = await cand.evaluate(async (sid) => {
    const c = (window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }).Clerk;
    const t = await c.session.getToken();
    return (await fetch(`http://localhost:8000/api/v1/sessions/${sid}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  }, sessionId);
  const chars = session.world.characters as { id: string; name: string; profile?: { voice?: string; portrait?: string } }[];
  expect(chars.map((c) => c.name)).toEqual(expect.arrayContaining(["Zara Quinn", "Lee Roy"]));
  expect(chars.some((c) => c.name === "Mina Park")).toBe(false); // left out of this topic
  expect(chars.find((c) => c.name === "Lee Roy")!.id).toBe("teammate_2");
  expect(chars.find((c) => c.name === "Zara Quinn")!.profile).toMatchObject({ voice: "tony" });
  expect(chars.find((c) => c.name === "Zara Quinn")!.profile!.portrait).toContain("amara-osei");
  expect(chars.some((c) => c.id === "coworker")).toBe(false);
  const refs = (session.world.map.doc.people as { ref: string }[]).map((p) => p.ref).filter((r) => r.startsWith("judge:"));
  expect(refs.sort()).toEqual(chars.map((c) => `judge:${c.id}`).sort()); // Mina's placement is dropped too

  await cand.getByRole("button", { name: "Enter the office" }).click();
  await expect(cand).toHaveURL(/\/session\//, { timeout: 60_000 });
  const intro = cand.getByRole("dialog", { name: "Meet your team" });
  if (await intro.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) {
    await expect(intro).toContainText("Zara Quinn");
    await cand.waitForTimeout(1200);
    await shot(cand, "55-candidate-team-intro");
    await cand.getByRole("button", { name: /Skip intro/i }).click();
    await expect(intro).toBeHidden({ timeout: 15_000 });
  }
  await cand.waitForTimeout(1500);
  await shot(cand, "56-candidate-office-with-judges");
  expect(errors.filter((e) => !/Download the React DevTools|favicon|401|Failed to load resource/.test(e))).toEqual([]);
});
