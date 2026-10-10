import { expect, test, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

const API = "http://localhost:8000";

async function waitForApi(page: Page, path: string, method = "POST") {
  return page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === method,
    { timeout: 120_000 },
  );
}

test.describe("WorkVerse learner journey", () => {
  test("sign up, onboard, run the incident scenario, and receive an evidence-grounded debrief", async ({
    page,
    request,
  }) => {
    const email = `e2e${Date.now()}@gmail.com`;
    const password = "WorkVerse!234";

    // Create a Clerk user via the Backend API, then sign in with a one-time ticket so the
    // test does not depend on email/OTP delivery.
    const created = await request.post("https://api.clerk.com/v1/users", {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      data: { email_address: [email], password, skip_password_checks: true },
    });
    expect(created.ok()).toBeTruthy();
    const userId = (await created.json()).id;
    const ticketRes = await request.post("https://api.clerk.com/v1/sign_in_tokens", {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      data: { user_id: userId, expires_in_seconds: 3600 },
    });
    expect(ticketRes.ok()).toBeTruthy();
    const ticket = (await ticketRes.json()).token;

    await page.goto("/");
    await setupClerkTestingToken({ page });
    await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });

    // First-time users are routed through onboarding before the dashboard.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });

    await page.getByLabel("Target role").fill("Junior Backend Engineer");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Enter WorkVerse" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });

    // --- catalogue ---
    await page.goto("/scenarios");
    await page.getByRole("button", { name: "standard", exact: true }).click();
    await page.getByRole("button", { name: "Start practice" }).first().click();
    await expect(page).toHaveURL(/\/briefing\//, { timeout: 90_000 });
    await expect(page.getByText("Situation")).toBeVisible();

    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
    await expect(page.getByTestId("complete")).toBeVisible({ timeout: 30_000 });

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

    // --- talk to the manager ---
    await page.getByTestId("talk-manager").click();
    await page.getByTestId("chat-input").fill("What is the customer impact and reporting deadline?");
    const turn2 = waitForApi(page, "/turns");
    await page.getByTestId("chat-send").click();
    expect((await turn2).ok()).toBeTruthy();

    // --- investigate + mitigate ---
    for (const actionId of [
      "a_inspect_logs",
      "a_check_migration_compat",
      "a_apply_rollback",
    ]) {
      const resp = waitForApi(page, "/actions");
      await page.getByTestId(`action-${actionId}`).click();
      expect((await resp).ok()).toBeTruthy();
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
    await expect(page).toHaveURL(/\/debrief/, { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Practice report" })).toBeVisible();
    await expect(page.getByText("Criterion feedback")).toBeVisible();
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
