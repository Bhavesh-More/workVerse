import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:8000";

async function waitForApi(page: Page, path: string, method = "POST") {
  return page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === method,
    { timeout: 120_000 },
  );
}

test.describe("WorkVerse learner journey", () => {
  test("sign up, run the production incident scenario, and receive an evidence-grounded debrief", async ({
    page,
  }) => {
    const email = `e2e${Date.now()}@gmail.com`;
    const password = "TestPass123!";

    // --- sign up ---
    await page.goto("/signup");
    await page.getByLabel("Display name").fill("E2E Learner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel(/Password/).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/profile/, { timeout: 60_000 });

    // --- profile ---
    await page.getByLabel("Target role").fill("Junior Backend Developer");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible({ timeout: 30_000 });

    // --- catalogue ---
    await page.goto("/scenarios");
    await page.getByRole("button", { name: "standard", exact: true }).click();
    await page.getByRole("button", { name: "Start practice" }).first().click();
    await expect(page).toHaveURL(/\/briefing\//, { timeout: 90_000 });
    await expect(page.getByText("Situation")).toBeVisible();

    // --- enter the office ---
    await page.getByRole("button", { name: "Enter the office" }).click();
    await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
    await expect(page.getByTestId("complete")).toBeVisible({ timeout: 30_000 });

    // --- talk to the teammate about the deploy ---
    await page.getByTestId("talk-teammate").click();
    await page.getByTestId("chat-input").fill("Did the deploy include a database migration?");
    const turn1 = waitForApi(page, "/turns");
    await page.getByTestId("chat-send").click();
    expect((await turn1).ok()).toBeTruthy();
    await expect(page.getByTestId("chat-log")).toContainText(/migration|deploy|release/i, {
      timeout: 60_000,
    });

    // --- talk to the manager about impact and deadline ---
    await page.getByTestId("talk-manager").click();
    await page.getByTestId("chat-input").fill(
      "What is the customer impact and what is our reporting deadline?",
    );
    const turn2 = waitForApi(page, "/turns");
    await page.getByTestId("chat-send").click();
    expect((await turn2).ok()).toBeTruthy();

    // --- investigate logs (server-authoritative action) ---
    const inspect = waitForApi(page, "/actions");
    await page.getByTestId("action-a_inspect_logs").click();
    expect((await inspect).ok()).toBeTruthy();

    // --- verify rollback compatibility, then roll back safely ---
    const compat = waitForApi(page, "/actions");
    await page.getByTestId("action-a_check_migration_compat").click();
    expect((await compat).ok()).toBeTruthy();

    const rollback = waitForApi(page, "/actions");
    await page.getByTestId("action-a_apply_rollback").click();
    expect((await rollback).ok()).toBeTruthy();

    // --- send a stakeholder update deliverable ---
    await page.getByTestId("status-update").fill(
      "Impact: customers cannot complete orders since the deploy. Cause: a backward-incompatible migration. " +
        "We verified compatibility and rolled back; error rates are recovering. Next update in 15 minutes. Owner: on-call.",
    );
    const update = waitForApi(page, "/actions");
    await page.getByTestId("send-status-update").click();
    expect((await update).ok()).toBeTruthy();

    // --- complete and receive the debrief ---
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
