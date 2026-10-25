import { expect, test, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { markOnboarded, testUser } from "./users";

const API = "http://localhost:8000";

async function waitForApi(page: Page, path: string, method = "POST") {
  return page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === method,
    { timeout: 120_000 },
  );
}

/** Findings (a colleague's "told you" card, a tool's findings window) open a pixel popup over the
 * office; close it with Esc, the way a keyboard learner dismisses it. */
async function dismissFinding(page: Page, waitMs = 8_000) {
  const popup = page.locator(".px-backdrop");
  try {
    await popup.waitFor({ state: "visible", timeout: waitMs });
  } catch {
    return; // nothing new this time
  }
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden({ timeout: 10_000 });
}

test.describe("WorkVerse learner journey", () => {
  test("sign up, onboard, run the incident scenario, and receive an evidence-grounded debrief", async ({
    page,
    request,
  }) => {
    // A test account (reused when the Clerk dev instance is at its user cap), signed in with a
    // one-time ticket so the test doesn't depend on email/OTP delivery.
    const user = await testUser(request, { preferEmail: `e2e${Date.now()}@gmail.com`, fresh: true });
    await page.goto("/login"); // Clerk loads only on app routes, not the landing page
    await setupClerkTestingToken({ page });
    await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: user.ticket } });

    // First-time users are routed through onboarding before the dashboard.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });

    await page.getByLabel("Target role").selectOption({ label: "Junior Backend Engineer" });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Enter WorkVerse" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    markOnboarded(user);

    // --- catalogue ---
    await page.goto("/scenarios");
    await page.getByRole("button", { name: "standard", exact: true }).click();
    await page.getByRole("button", { name: "Start practice" }).first().click();
    await expect(page).toHaveURL(/\/briefing\//, { timeout: 90_000 });
    await expect(page.getByText("Situation")).toBeVisible();

    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
    await expect(page.getByTestId("complete")).toBeVisible({ timeout: 30_000 });
    // First entry shows the "Meet your team" intro; skip it like a learner would.
    const intro = page.getByRole("dialog", { name: "Meet your team" });
    if (await intro.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /Skip intro/i }).click();
      await expect(intro).toBeHidden({ timeout: 15_000 });
    }

    // --- guide toggle ---
    await page.getByRole("button", { name: /Show guide/i }).click();
    await expect(page.getByText(/Guide · step/i)).toBeVisible();
    await page.getByRole("button", { name: "Stop guide" }).click();

    // --- talk to the teammate ---
    await page.getByTestId("talk-teammate").click();
    await page.getByTestId("chat-input").fill("Did the deploy include a database migration?");
    const turn1 = waitForApi(page, "/turns");
    await page.getByTestId("chat-send").click();
    expect((await turn1).ok()).toBeTruthy();
    await expect(page.getByTestId("chat-log")).toContainText(/migration|deploy|release/i, { timeout: 60_000 });
    await dismissFinding(page);

    // --- talk to the manager ---
    await page.getByTestId("talk-manager").click();
    await page.getByTestId("chat-input").fill("What is the customer impact and reporting deadline?");
    const turn2 = waitForApi(page, "/turns");
    await page.getByTestId("chat-send").click();
    expect((await turn2).ok()).toBeTruthy();
    await dismissFinding(page);

    // --- investigate + mitigate ---
    for (const actionId of [
      "a_inspect_logs",
      "a_check_migration_compat",
      "a_apply_forward_fix",
    ]) {
      // A colleague's fact check runs asynchronously and can open its card at any moment.
      await dismissFinding(page, 1_500);
      const resp = waitForApi(page, "/actions");
      // The full action list is visually hidden (keyboard/screen-reader path), so activate it
      // the way those users do rather than with a pointer click.
      const button = page.getByTestId(`action-${actionId}`);
      await expect(button).toBeEnabled();
      await button.focus();
      await page.keyboard.press("Enter");
      expect((await resp).ok()).toBeTruthy();
      await dismissFinding(page);
    }

    // --- stakeholder update deliverable ---
    await page.getByTestId("status-update").fill(
      "Impact: customers cannot complete orders since the deploy. Cause: a backward-incompatible migration. " +
        "We verified compatibility and rolled back; error rates are recovering. Next update in 15 minutes. Owner: on-call.",
    );
    const update = waitForApi(page, "/actions");
    await page.getByTestId("send-status-update").click();
    expect((await update).ok()).toBeTruthy();

    // --- complete + debrief ---
    const complete = waitForApi(page, "/complete");
    await page.getByTestId("complete").click();
    expect((await complete).ok()).toBeTruthy();
    // The "Shift complete" end card plays first; continue from it to the report.
    await page.getByRole("button", { name: /See your debrief/i }).click({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/debrief/, { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Practice report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Skill scores" })).toBeVisible();
    await expect(page.getByText(/formative practice feedback/i).first()).toBeVisible();
  });

  test("protected pages redirect anonymous visitors to sign in", async ({ page }) => {
    await page.goto("/progress");
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  test("anonymous API calls are rejected with a 401 envelope", async ({ request }) => {
    const res = await request.get(`${API}/api/v1/me`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });
});
