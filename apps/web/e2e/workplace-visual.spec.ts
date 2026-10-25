import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { companyPage } from "./helpers";

// Visual states of the editor that interaction tests don't capture: drag ghosts, room handles,
// high zoom, the walkability overlay, the minimap and the narrow-screen library drawer.
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "workplace-shots");
const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};
async function cam(page: Page) {
  const c = page.getByTestId("world-canvas");
  const [z, px, py] = await c.evaluate((el) => [el.dataset.zoom, el.dataset.panX, el.dataset.panY].map(Number));
  return { z: z!, px: px!, py: py!, box: (await c.boundingBox())! };
}
async function at(page: Page, x: number, y: number) {
  const { z, px, py, box } = await cam(page);
  return { x: box.x + px + (x + 0.5) * 32 * z, y: box.y + py + (y + 0.5) * 32 * z };
}

test("editor visual states", async ({ browser, request }) => {
  test.setTimeout(400_000);
  const { page } = await companyPage(browser, request, `e2e-visual-${Date.now()}@gmail.com`, "Visual QA");
  await expect(page).toHaveURL(/\/company\/workplace\/setup/, { timeout: 30_000 });
  await page.getByTestId("create-world").click();
  await page.getByTestId("presets-continue").click();
  await page.getByTestId("open-editor").click();
  await expect(page.getByTestId("world-canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  const doc = await page.evaluate(async () => {
    const c = (window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }).Clerk;
    const t = await c.session.getToken();
    return (await (await fetch("http://localhost:8000/api/v1/company/workplace", { headers: { Authorization: `Bearer ${t}` } })).json()).world.draft;
  });
  const lounge = doc.rooms.find((r: { purpose: string }) => r.purpose === "break_area");

  // Mid-drag ghost over valid floor, then over a wall.
  await page.getByRole("tab", { name: "Furniture" }).click();
  const card = (await page.getByTestId("lib-asset-sofa_s_teal").boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(card.x + 60, card.y + 20, { steps: 4 });
  const ok = await at(page, lounge.x + 6, lounge.y + 5);
  await page.mouse.move(ok.x, ok.y, { steps: 10 });
  await page.waitForTimeout(250);
  await shot(page, "40-drag-ghost-valid");
  const bad = await at(page, lounge.x - 1, lounge.y + 4);
  await page.mouse.move(bad.x, bad.y, { steps: 6 });
  await page.waitForTimeout(250);
  await shot(page, "41-drag-ghost-invalid");
  await page.keyboard.press("Escape");
  await page.mouse.up();

  // Room selected: handles + inspector.
  const r = await at(page, lounge.x + 1, lounge.y + 3);
  await page.mouse.click(r.x, r.y);
  await expect(page.getByTestId("insp-title")).toHaveText("Breakout & collaboration lounge");
  await page.waitForTimeout(200);
  await shot(page, "42-room-selected");

  // 200% zoom is pixel-crisp; minimap appears once the world no longer fits.
  for (let i = 0; i < 6; i++) await page.getByTestId("zoom-in").click();
  await expect.poll(async () => (await cam(page)).z).toBeGreaterThan(1.9);
  await expect(page.getByTestId("minimap")).toBeVisible();
  await page.keyboard.press("o");
  await page.waitForTimeout(300);
  await shot(page, "43-zoomed-overlay-minimap");
  // Minimap click recentres the view.
  const before = (await cam(page)).px;
  const mm = (await page.getByTestId("minimap").boundingBox())!;
  await page.mouse.click(mm.x + 6, mm.y + mm.height / 2);
  await expect.poll(async () => (await cam(page)).px).not.toBe(before);
  await page.keyboard.press("o");
  await page.keyboard.press("0");
  await expect(page.getByTestId("minimap")).toBeHidden();

  // Narrow screen: library becomes a drawer; tools still reachable.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(500);
  await shot(page, "44-narrow");
  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.locator(".we-libwrap.is-open")).toBeVisible();
  await shot(page, "45-narrow-library-open");
  await page.getByRole("button", { name: "Close library" }).click();
  await expect(page.locator(".we-libwrap.is-open")).toHaveCount(0);
});
