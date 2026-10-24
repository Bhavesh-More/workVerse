import { expect, test, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { markOnboarded, testUser } from "./users";

/**
 * The office game as a signed-in learner sees it.
 *
 * Regression: the map/atlas JSON under /assets was routed through the auth middleware, which
 * redirects signed-in users on public routes to /dashboard, so Phaser received HTML instead of
 * JSON ("Unexpected token '<'") and the scene crashed in create(). Anonymous checks never saw it.
 */

const CLERK = "https://api.clerk.com/v1";
const ASSET_ERRORS = /Failed to process file|File failed|is not valid JSON|reading 'width'|Office map assets failed/i;

type Scene = {
  player: { x: number; y: number };
  currentTarget: { id: string } | null;
  placePlayerAt: (tile: { x: number; y: number }) => void;
};

async function scene<T>(page: Page, fn: (s: Scene) => T): Promise<T> {
  return page.evaluate(
    (src) => {
      const s = (window as unknown as { __officeScene: Scene }).__officeScene;
      return new Function("s", `return (${src})(s)`)(s);
    },
    fn.toString(),
  ) as Promise<T>;
}

test("signed-in learner: office assets load, the player walks, and colleagues and objects are reachable", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  const auth = { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` };
  const user = await testUser(request, { preferEmail: `e2e-office${Date.now()}@gmail.com`, fresh: true });
  const userId = user.id;

  try {
    const ticket = user.ticket;
    await page.goto("/login");
    await setupClerkTestingToken({ page });
    await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });

    // The direct regression: with a session cookie, game data must still be JSON.
    for (const file of ["map.json", "props.json"]) {
      const res = await page.request.get(`/assets/game/map/${file}`, { maxRedirects: 0 });
      expect(res.status(), file).toBe(200);
      expect(res.headers()["content-type"], file).toContain("application/json");
    }

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
    await page.getByLabel("Target role").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Enter WorkVerse" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    markOnboarded(user);

    await page.goto("/scenarios");
    await page.getByRole("button", { name: "standard", exact: true }).click();
    await page.getByRole("button", { name: "Start practice" }).first().click();
    await expect(page).toHaveURL(/\/briefing\//, { timeout: 90_000 });
    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });

    // The scene finished create(): canvas up, loading cover gone, dev handle published.
    await expect(page.locator(".sim-full__game canvas")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".game-loading")).toBeHidden({ timeout: 60_000 });
    await page.waitForFunction(() => "__officeScene" in window, null, { timeout: 30_000 });
    expect(errors.join("\n")).not.toMatch(ASSET_ERRORS);

    // Canvas is not CSS-stretched: drawing buffer matches its on-screen box.
    const box = await page.locator(".sim-full__game canvas").evaluate((c: HTMLCanvasElement) => ({
      w: c.width,
      h: c.height,
      cw: c.clientWidth,
      ch: c.clientHeight,
    }));
    expect(Math.abs(box.w - box.cw)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.h - box.ch)).toBeLessThanOrEqual(1);

    // First entry shows the "Meet your team" intro; skip it like a learner would.
    const intro = page.getByRole("dialog", { name: "Meet your team" });
    if (await intro.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /Skip intro/i }).click();
      await expect(intro).toBeHidden({ timeout: 15_000 });
    }

    // Walking: put the player in the open corridor and hold D.
    await scene(page, (s) => s.placePlayerAt({ x: 20, y: 15 }));
    const before = await scene(page, (s) => ({ x: s.player.x, y: s.player.y }));
    await page.locator(".sim-full__game canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.down("d");
    await page.waitForTimeout(700);
    await page.keyboard.up("d");
    const after = await scene(page, (s) => ({ x: s.player.x, y: s.player.y }));
    expect(after.x - before.x, "player should walk right").toBeGreaterThan(40);

    // Holding Shift hurries: same time, clearly more ground.
    await scene(page, (s) => s.placePlayerAt({ x: 10, y: 15 }));
    const runStart = await scene(page, (s) => s.player.x);
    await page.keyboard.down("Shift");
    await page.keyboard.down("d");
    await page.waitForTimeout(700);
    await page.keyboard.up("d");
    await page.keyboard.up("Shift");
    const ran = (await scene(page, (s) => s.player.x)) - runStart;
    expect(ran, "Shift should be much faster than walking").toBeGreaterThan((after.x - before.x) * 1.5);

    // Colleagues: the side-panel shortcut puts you next to them and the voice prompt appears.
    await page.getByTestId("talk-manager").click();
    await expect(page.getByText(/Press E to talk to/i)).toBeVisible({ timeout: 20_000 });

    // Objects: stand in front of the log viewer; it becomes the interaction target.
    await page.keyboard.press("Escape");
    await scene(page, (s) => s.placePlayerAt({ x: 3, y: 24 }));
    await expect.poll(() => scene(page, (s) => s.currentTarget?.id ?? null), { timeout: 10_000 }).toBe("log_viewer");

    expect(errors.join("\n")).not.toMatch(ASSET_ERRORS);
  } finally {
    // Only remove an account this run created; reused test accounts stay for later runs.
    if (!user.reused) await request.delete(`${CLERK}/users/${userId}`, { headers: auth });
  }
});
