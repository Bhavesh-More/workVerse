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
async function cam(page: Page) {
  const c = page.getByTestId("world-canvas");
  const [z, px, py] = await c.evaluate((el) => [el.dataset.zoom, el.dataset.panX, el.dataset.panY].map(Number));
  const box = (await c.boundingBox())!;
  return { z: z!, px: px!, py: py!, box };
}
async function tilePoint(page: Page, x: number, y: number, fx = 0.5, fy = 0.5) {
  const { z, px, py, box } = await cam(page);
  return { x: box.x + px + (x + fx) * 32 * z, y: box.y + py + (y + fy) * 32 * z };
}
async function dragFromLibrary(page: Page, testid: string, tx: number, ty: number, fx = 0.5, fy = 0.5) {
  const card = page.getByTestId(testid);
  await card.scrollIntoViewIfNeeded();
  const b = (await card.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 24, b.y + b.height / 2 + 8, { steps: 4 });
  const p = await tilePoint(page, tx, ty, fx, fy);
  await page.mouse.move(p.x, p.y, { steps: 14 });
  await page.mouse.up();
}
async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]) {
  const a = await tilePoint(page, from[0], from[1]);
  const b = await tilePoint(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}
async function clickTile(page: Page, x: number, y: number) {
  const p = await tilePoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}
/** After a change: wait for autosave to pick it up (pending/saving), then for the server to confirm. */
async function waitSaved(page: Page) {
  const status = page.getByTestId("save-status");
  await expect(status).toHaveAttribute("data-status", /pending|saving/, { timeout: 2_500 }).catch(() => {});
  await expect(status).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
}
type Doc = {
  name: string;
  width: number;
  height: number;
  floor: string[];
  rooms: { id: string; name: string; purpose: string; x: number; y: number; w: number; h: number }[];
  objects: { id: string; asset: string; x: number; y: number; ox?: number; oy?: number }[];
  people: { id: string; ref: string; x: number; y: number }[];
  spawn: { x: number; y: number };
};
async function draft(page: Page, request: APIRequestContext): Promise<{ doc: Doc; version: number; body: { mode: string | null; world: { published: boolean } } }> {
  const r = await api(page, request, "GET", "/company/workplace");
  return { doc: r.body.world.draft, version: r.body.world.draft_version, body: r.body };
}

/** UI onboarding straight to the editor with the given presets (others deselected). */
async function onboardCustom(page: Page, presetIds: string[]) {
  await expect(page).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
  await page.getByTestId("create-world").click();
  for (const id of ["open_plan", "meeting", "reception", "executive", "ops_lab", "lounge"]) {
    const pick = page.getByTestId(`preset-${id}`).locator(".ws-preset__pick");
    const on = (await pick.getAttribute("aria-pressed")) === "true";
    if (on !== presetIds.includes(id)) await pick.click();
  }
  await page.getByTestId("presets-continue").click();
  await page.getByTestId("open-editor").click();
  await expect(page).toHaveURL(/\/company\/workplace\/editor/, { timeout: 60_000 });
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await page.waitForTimeout(800);
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
  });

  test("editor: drag & drop, snapping, selection, inspector, undo/redo, zoom/pan, people, rooms, persistence, publish", async ({ browser, request }) => {
    test.setTimeout(900_000);
    const defaultMap = fs.readFileSync(path.join("public", "assets", "game", "map", "map.json"), "utf8");
    const { page, errors } = await companyPage(browser, request, `e2e-editor-${RUN}@gmail.com`, "Contoso Studio");
    await onboardCustom(page, ["reception", "ops_lab", "lounge"]);
    await waitSaved(page);
    let { doc } = await draft(page, request);
    const startObjects = doc.objects.length;

    // ---- Enlarge the world (inspector, nothing selected)
    await page.getByTestId("world-width").fill(String(doc.width + 18));
    await page.getByTestId("world-resize").click();
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    const W0 = doc.width - 18;
    expect(doc.width).toBe(W0 + 18);
    await page.keyboard.press("0");

    // ---- Drag a room preset onto empty space (top-left lands at RX, RY)
    const RX = W0 + 2;
    const RY = 4;
    await page.getByRole("tab", { name: "Rooms" }).click();
    await dragFromLibrary(page, "lib-preset-meeting", RX + 6, RY + 4);
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    const meeting = doc.rooms.find((r) => r.name === "Meeting & conference room")!;
    expect(meeting, "preset placed").toBeTruthy();
    expect([meeting.x, meeting.y, meeting.w, meeting.h]).toEqual([RX, RY, 12, 8]);
    expect(doc.objects.length).toBeGreaterThan(startObjects + 10);
    await page.waitForTimeout(400);
    await shot(page, "10-editor-preset-added");

    // ---- Drag a plant onto a floor tile: snaps to the grid
    await page.getByRole("tab", { name: "Furniture" }).click();
    const P1 = { x: RX + 5, y: RY + 6 };
    await dragFromLibrary(page, "lib-asset-plant_tall", P1.x, P1.y, 0.8, 0.7);
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    const plants = () => doc.objects.filter((o) => o.asset === "plant_tall" && o.x >= RX);
    expect(plants().map((o) => [o.x, o.y, o.ox ?? 0, o.oy ?? 0])).toContainEqual([P1.x, P1.y, 0, 0]);

    // ---- Snap off: free placement keeps an even sub-tile offset
    await page.getByTestId("toggle-snap").click();
    await expect(page.getByTestId("toggle-snap")).toHaveAttribute("aria-pressed", "false");
    await dragFromLibrary(page, "lib-asset-plant_snake", RX + 8, RY + 6, 0.3, 0.5);
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    const free = doc.objects.find((o) => o.asset === "plant_snake" && o.x >= RX)!;
    expect(free).toBeTruthy();
    expect((free.ox ?? 0) + (free.oy ?? 0)).toBeGreaterThan(0);
    expect((free.ox ?? 0) % 2).toBe(0);
    await page.getByTestId("toggle-snap").click();

    // ---- Invalid drop: furniture on a wall is refused before it lands
    const before = doc.objects.length;
    await dragFromLibrary(page, "lib-asset-plant_small", RX - 1, RY + 3);
    await expect(page.getByTestId("toast")).toContainText(/needs floor/i);
    await page.waitForTimeout(1600);
    doc = (await draft(page, request)).doc;
    expect(doc.objects.length).toBe(before);

    // ---- Select, then move by dragging; inspector shows it
    await clickTile(page, P1.x, P1.y);
    await expect(page.getByTestId("insp-title")).toHaveText("Tall plant");
    await shot(page, "11-editor-selected-inspector");
    await dragOnCanvas(page, [P1.x, P1.y], [RX + 2, RY + 6]);
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    const moved = plants().find((o) => o.y === RY + 6 && o.x === RX + 2);
    expect(moved, "plant moved by drag").toBeTruthy();
    // Inspector position edit
    await page.getByTestId("insp-pos-x").fill(String(RX + 1));
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    expect(doc.objects.find((o) => o.id === moved!.id)).toMatchObject({ x: RX + 1, y: RY + 6 });
    // Keyboard nudge
    await page.getByTestId("world-canvas").focus();
    await page.keyboard.press("ArrowRight");
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    expect(doc.objects.find((o) => o.id === moved!.id)).toMatchObject({ x: RX + 2 });

    // ---- Duplicate, delete, undo, redo
    const n0 = doc.objects.length;
    await page.getByTestId("insp-duplicate").click();
    await waitSaved(page);
    expect((await draft(page, request)).doc.objects.length).toBe(n0 + 1);
    await page.getByTestId("insp-delete").click();
    await waitSaved(page);
    expect((await draft(page, request)).doc.objects.length).toBe(n0);
    await page.getByTestId("undo").click();
    await waitSaved(page);
    expect((await draft(page, request)).doc.objects.length).toBe(n0 + 1);
    await page.getByTestId("redo").click();
    await waitSaved(page);
    expect((await draft(page, request)).doc.objects.length).toBe(n0);

    // ---- Multi-select with shift-click, move together with the keyboard
    doc = (await draft(page, request)).doc;
    const chairs = doc.objects.filter((o) => o.asset === "chair_n_teal" && o.x >= RX).sort((a, b) => a.x - b.x);
    await clickTile(page, chairs[0]!.x, chairs[0]!.y);
    const c2 = await tilePoint(page, chairs[1]!.x, chairs[1]!.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(c2.x, c2.y);
    await page.keyboard.up("Shift");
    await expect(page.getByTestId("insp-title")).toHaveText("2 selected");
    await page.getByTestId("world-canvas").focus();
    await page.keyboard.press("ArrowDown");
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    expect(doc.objects.find((o) => o.id === chairs[0]!.id)!.y).toBe(chairs[0]!.y + 1);
    expect(doc.objects.find((o) => o.id === chairs[1]!.id)!.y).toBe(chairs[1]!.y + 1);
    await page.keyboard.press("Escape");

    // ---- Move a judge: their placement moves, identity untouched
    const company0 = await api(page, request, "GET", "/company");
    const manager0 = doc.people.find((p) => p.ref === "judge:manager")!;
    await page.getByRole("tab", { name: "People" }).click();
    await dragFromLibrary(page, "lib-person-manager", RX + 9, RY + 7);
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    const manager1 = doc.people.find((p) => p.ref === "judge:manager")!;
    expect(manager1).toMatchObject({ id: manager0.id, x: RX + 9, y: RY + 7 });
    expect(doc.people.filter((p) => p.ref === "judge:manager")).toHaveLength(1);
    expect((await api(page, request, "GET", "/company")).body.company.judge_defaults).toEqual(company0.body.company.judge_defaults);

    // ---- Zoom and pan
    const z0 = (await cam(page)).z;
    await page.getByTestId("zoom-in").click();
    await expect.poll(async () => (await cam(page)).z).toBeGreaterThan(z0);
    await expect(page.getByTestId("zoom-level")).toHaveText(`${Math.round(z0 * 125)}%`);
    const pan0 = (await cam(page)).px;
    await page.getByTestId("tool-hand").click();
    const mid = await tilePoint(page, Math.floor(doc.width / 2), Math.floor(doc.height / 2));
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x - 160, mid.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await cam(page)).px).toBeLessThan(pan0 - 100);
    await page.getByTestId("tool-select").click();
    await page.keyboard.press("0");
    await page.waitForTimeout(200);

    // ---- Connect the new room: floor brush extends the corridor, doorway tool opens the wall
    const corridor = doc.rooms.find((r) => r.purpose === "corridor_main")!;
    await page.getByRole("tab", { name: "Build" }).click();
    await page.getByTestId("lib-floor-concrete").click();
    await dragOnCanvas(page, [corridor.x + corridor.w, corridor.y], [RX + 11, corridor.y + 2]);
    await waitSaved(page);
    await page.getByTestId("tool-door").click();
    await clickTile(page, RX + 4, RY + 8);
    await waitSaved(page);
    doc = (await draft(page, request)).doc;
    expect(doc.floor[RY + 8]![RX + 4]).not.toBe(".");
    expect(doc.floor[corridor.y]![RX + 4]).not.toBe(".");
    await page.getByTestId("tool-select").click();
    await page.getByTestId("issues-btn").click();
    await expect(page.getByTestId("issues-panel")).toBeVisible();
    await expect(page.getByTestId("issues-panel")).not.toContainText("Meeting & conference room isn't connected");
    await page.getByTestId("toggle-overlay").click();
    await page.waitForTimeout(300);
    await shot(page, "12-editor-walkable-overlay-issues");
    await page.getByTestId("toggle-overlay").click();
    await page.getByTestId("issues-panel").getByRole("button", { name: "Close" }).click();

    // ---- Rename a room in the inspector
    await clickTile(page, RX + 10, RY + 6);
    await expect(page.getByTestId("insp-title")).toHaveText("Meeting & conference room");
    await page.getByTestId("insp-room-name").fill("Boardroom");
    await page.getByTestId("insp-room-name").press("Enter");
    await waitSaved(page);
    expect((await draft(page, request)).doc.rooms.map((r) => r.name)).toContain("Boardroom");
    await page.keyboard.press("Escape");

    // ---- Refresh: everything comes back exactly
    const saved = (await draft(page, request)).doc;
    await page.reload();
    await expect(page.getByTestId("world-canvas")).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
    expect((await draft(page, request)).doc).toEqual(saved);
    await shot(page, "13-editor-after-reload");

    // ---- Play test in the real engine
    await page.getByTestId("preview-btn").click();
    await expect(page.getByTestId("preview-game").locator("canvas")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await shot(page, "14-play-test");
    await page.getByTestId("preview-close").click();

    // ---- Publish and activate
    await page.getByTestId("publish-btn").click();
    await expect(page.getByRole("dialog", { name: "Publish world" })).toBeVisible();
    await shot(page, "15-publish-review");
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("toast")).toContainText(/Published/);
    let wp = await draft(page, request);
    expect(wp.body.mode).toBe("custom");
    expect(wp.body.world.published).toBe(true);

    // ---- A failed save never shows "saved"; retry recovers
    await page.route("**/api/v1/company/workplace/draft", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "boom", message: "Server unavailable" } }) }));
    await clickTile(page, RX + 2, RY + 6);
    await page.getByTestId("world-canvas").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "error", { timeout: 15_000 });
    await expect(page.getByTestId("save-status")).toContainText("Couldn't save");
    await shot(page, "16-save-failed");
    expect((await draft(page, request)).doc.objects.find((o) => o.id === moved!.id)!.x).toBe(RX + 2);
    await page.unroute("**/api/v1/company/workplace/draft");
    await page.getByTestId("save-status").getByRole("button", { name: "Retry" }).click();
    await waitSaved(page);
    expect((await draft(page, request)).doc.objects.find((o) => o.id === moved!.id)!.x).toBe(RX + 1);

    // ---- Another tab saved meanwhile: conflict instead of a silent overwrite
    wp = await draft(page, request);
    const other = { ...wp.doc, name: "Renamed elsewhere" };
    expect((await api(page, request, "PUT", "/company/workplace/draft", { doc: other, base_version: wp.version })).status).toBe(200);
    expect((await api(page, request, "PUT", "/company/workplace/draft", { doc: other, base_version: wp.version })).status).toBe(409);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "conflict", { timeout: 15_000 });
    await expect(page.getByTestId("conflict-banner")).toContainText(/newer version/);
    await page.getByRole("button", { name: "Load latest" }).click();
    await expect(page.getByText("Renamed elsewhere").first()).toBeVisible();

    // ---- Invalid data can't get in
    wp = await draft(page, request);
    const bad = await api(page, request, "PUT", "/company/workplace/draft", { doc: { ...wp.doc, objects: [...wp.doc.objects, { id: "evil", asset: "../../secret.png", x: 1, y: 1 }] }, base_version: wp.version });
    expect(bad.status).toBe(422);
    expect((await draft(page, request)).doc).toEqual(wp.doc);
    const outside = await api(page, request, "PUT", "/company/workplace/draft", { doc: { ...wp.doc, people: [...wp.doc.people, { id: "p_far", ref: "judge:qa", x: 999, y: 1, face: "down" }] }, base_version: wp.version });
    expect(outside.status).toBe(422);

    // The shared default office is never touched.
    expect(fs.readFileSync(path.join("public", "assets", "game", "map", "map.json"), "utf8")).toBe(defaultMap);
    expect(errors.filter((e) => !/Download the React DevTools|favicon|status of 500|status of 409|status of 422/.test(e))).toEqual([]);
  });

  test("isolation: two companies have independent worlds", async ({ browser, request }) => {
    test.setTimeout(300_000);
    const a = await companyPage(browser, request, `e2e-iso-a-${RUN}@gmail.com`, "Alpha Co");
    await onboardCustom(a.page, ["meeting"]);
    await waitSaved(a.page);
    const aDoc = (await draft(a.page, request)).doc;

    const b = await companyPage(browser, request, `e2e-iso-b-${RUN}@gmail.com`, "Beta Co");
    await expect(b.page).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
    const bState = await api(b.page, request, "GET", "/company/workplace");
    expect(bState.body.world).toBeNull();
    expect(bState.body.mode).toBeNull();
    // B builds its own; A's stays exactly as it was.
    await onboardCustom(b.page, ["lounge", "reception"]);
    await waitSaved(b.page);
    const bDoc = (await draft(b.page, request)).doc;
    expect(bDoc.rooms.map((r) => r.name)).toContain("Breakout & collaboration lounge");
    expect((await draft(a.page, request)).doc).toEqual(aDoc);
    // B can't publish or switch A's world: every call is scoped to the caller's company.
    expect((await api(b.page, request, "PATCH", "/company/workplace", { mode: "custom" })).status).toBe(409);
    expect((await draft(a.page, request)).body.mode).toBeNull();
  });

  test("default world first, customise later; switching keeps the custom world", async ({ browser, request }) => {
    test.setTimeout(300_000);
    const { page } = await companyPage(browser, request, `e2e-default-${RUN}@gmail.com`, "Fabrikam");
    await expect(page).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
    await page.getByTestId("use-default").click();
    await expect(page).toHaveURL(/\/company\/workplace\?chosen=default/);
    await expect(page.getByTestId("active-world")).toContainText("The default office");
    await shot(page, "20-default-chosen");
    // The choice isn't asked again; the dashboard is reachable.
    await page.goto("/company");
    await expect(page.getByRole("heading", { name: /Assessment overview/ })).toBeVisible();

    // Later: build a custom world from Workplace.
    await page.getByRole("link", { name: "Workplace" }).click();
    await page.getByTestId("open-editor-hub").click();
    await onboardCustom(page, ["reception", "ops_lab"]);
    await waitSaved(page);
    await page.getByTestId("publish-btn").click();
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("toast")).toContainText(/Published/);
    await page.goto("/company/workplace");
    await expect(page.getByTestId("active-world")).toContainText("Your custom world");
    await shot(page, "21-hub-custom", true);
    // Back to default: the custom world is kept and can be re-activated.
    await page.getByTestId("switch-default").click();
    await expect(page.getByTestId("active-world")).toContainText("The default office");
    const st = await api(page, request, "GET", "/company/workplace");
    expect(st.body.mode).toBe("default");
    expect(st.body.world.published).toBe(true);
    await page.getByTestId("switch-custom").click();
    await expect(page.getByTestId("active-world")).toContainText("Your custom world");
  });
});
