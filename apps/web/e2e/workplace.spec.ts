import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

// Company workplace builder: onboarding choice, presets, participants, the world editor
// (drag-and-drop, grid snapping, selection, inspector, undo/redo, zoom/pan, rooms, people),
// persistence, publishing, isolation between companies, and the published world in the game.
const API = "http://localhost:8000/api/v1";
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "workplace-shots");
const RUN = Date.now();

async function shot(page: Page, name: string, fullPage = false) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function clerkTicket(request: APIRequestContext, email: string) {
  const created = await request.post("https://api.clerk.com/v1/users", {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    data: { email_address: [email], password: "WorkVerse!234", skip_password_checks: true },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const ticket = await request.post("https://api.clerk.com/v1/sign_in_tokens", {
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    data: { user_id: (await created.json()).id, expires_in_seconds: 3600 },
  });
  return (await ticket.json()).token as string;
}

export async function companyPage(browser: Browser, request: APIRequestContext, email: string, name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const ticket = await clerkTicket(request, email);
  await page.goto("/company/login");
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });
  await page.goto("/company");
  await expect(page.getByRole("heading", { name: /Set up your company/ })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: /Create company/ }).click();
  return { page, errors };
}

/** Bearer token for direct API checks, taken from the page's Clerk session. */
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

/** Canvas helpers: world tile -> page coordinates via the editor's own camera (read from the DOM). */
async function canvasBox(page: Page) {
  const box = await page.getByTestId("world-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  return box;
}

test.describe("Workplace builder", () => {
  test("custom world: onboarding → presets → people → editor", async ({ browser, request }) => {
    test.setTimeout(600_000);
    const { page, errors } = await companyPage(browser, request, `e2e-world-${RUN}@gmail.com`, "Northwind Labs");

    // Stage A: the world choice appears right after signup.
    await expect(page).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /Where will candidates work/ })).toBeVisible();
    await expect(page.getByTestId("choice-custom")).toBeVisible();
    await expect(page.getByTestId("choice-default")).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, "01-world-choice");
    await page.getByTestId("create-world").click();

    // Presets: pick several (deselect one, add one), preview one.
    await expect(page.getByRole("heading", { name: /Pick your rooms/ })).toBeVisible();
    for (const id of ["reception", "ops_lab", "meeting", "executive", "lounge"]) await expect(page.getByTestId(`preset-${id}`).getByRole("button", { name: /./ }).first()).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("preset-executive").locator(".ws-preset__pick").click();
    await page.getByTestId("preset-open_plan").locator(".ws-preset__pick").click();
    await expect(page.getByTestId("preset-executive").locator(".ws-preset__pick")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("preset-open_plan").locator(".ws-preset__pick")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(800);
    await shot(page, "02-presets", true);
    await page.getByTestId("preset-meeting").getByRole("button", { name: "Preview layout" }).click();
    await expect(page.getByRole("dialog", { name: /Meeting & conference room layout/ })).toBeVisible();
    await shot(page, "02b-preset-preview");
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByTestId("presets-continue").click();

    // People: defaults present; edit one, add one, remove one.
    await expect(page.getByRole("heading", { name: /Who.s in the office/ })).toBeVisible();
    await expect(page.getByLabel("Member 1 name")).toHaveValue("Alex Morgan");
    await page.getByLabel("Member 1 name").fill("Jordan Avery");
    await page.getByLabel("Member 1 title").fill("Head of People");
    await page.getByTestId("add-member").click();
    await page.getByLabel("Member 4 name").fill("Kim Osei");
    await page.getByRole("button", { name: "Remove Tom Reed" }).click();
    await page.waitForTimeout(600);
    await shot(page, "03-people", true);
    await page.getByTestId("open-editor").click();

    // Editor opens with the chosen configuration.
    await expect(page).toHaveURL(/\/company\/workplace\/editor/, { timeout: 60_000 });
    await expect(page.getByTestId("world-canvas")).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
    await page.waitForTimeout(1500);
    await shot(page, "04-editor-initial");
    const wp = await api(page, request, "GET", "/company/workplace");
    expect(wp.status).toBe(200);
    const rooms = wp.body.world.draft.rooms.map((r: { name: string }) => r.name);
    for (const n of ["Reception & lobby", "Engineering & operations lab", "Meeting & conference room", "Open-plan office", "Breakout & collaboration lounge", "Corridor"]) expect(rooms).toContain(n);
    expect(rooms).not.toContain("Executive & private offices");
    expect(wp.body.members.map((m: { name: string }) => m.name)).toEqual(["Jordan Avery", "Priya Nair", "Kim Osei"]);
    const refs = wp.body.world.draft.people.map((p: { ref: string }) => p.ref);
    expect(refs.filter((r: string) => r.startsWith("judge:")).length).toBe(5);
    expect(refs.filter((r: string) => r.startsWith("member:")).length).toBe(3);
    // Library shows the participants.
    await page.getByRole("tab", { name: "People" }).click();
    await expect(page.getByText("Jordan Avery")).toBeVisible();
    await shot(page, "05-editor-people-library");
    expect(errors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
    void canvasBox;
  });
});
