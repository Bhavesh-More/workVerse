import { expect, test, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

/**
 * Verifies the real browser path for starting a voice meeting:
 * walk adjacent to an NPC, press E, and hit the voice-session endpoint.
 *
 * The external ElevenLabs call is credential-gated. When the configured key is valid the
 * overlay connects; when it is not (401/403) the API returns a controlled 503 and the UI
 * shows a recoverable error. Either way the endpoint must never 500 and the app must keep
 * working, which is what this test asserts.
 */

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

async function signInAndEnterOffice(page: Page, request: Page["request"]): Promise<void> {
  const email = `e2e-voice${Date.now()}@gmail.com`;
  const password = "WorkVerse!234";

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

  await page.goto("/login"); // Clerk loads only on app routes, not the landing page
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket } });

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  await page.getByLabel("Target role").selectOption({ label: "Junior Backend Engineer" });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Enter WorkVerse" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });

  await page.goto("/scenarios");
  await page.getByRole("button", { name: "standard", exact: true }).click();
  await page.getByRole("button", { name: "Start practice" }).first().click();
  await expect(page).toHaveURL(/\/briefing\//, { timeout: 90_000 });
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
  await expect(page.getByTestId("complete")).toBeVisible({ timeout: 30_000 });
    // First entry shows the "Meet your team" intro; skip it like a learner would.
    const intro = page.getByRole("dialog", { name: "Meet your team" });
    if (await intro.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /Skip intro/i }).click();
      await expect(intro).toBeHidden({ timeout: 15_000 });
    }
}

test.describe("WorkVerse voice meeting", () => {
  test("pressing E next to an NPC hits the voice-session endpoint without a server error", async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await signInAndEnterOffice(page, request);

    // Selecting the manager moves the player adjacent to them (existing focus behaviour).
    await page.getByTestId("talk-manager").click();

    // Phaser must report the nearby character and show the voice prompt.
    await expect(page.getByText(/Press E to talk to/i)).toBeVisible({ timeout: 20_000 });

    const voiceRequest = page.waitForResponse(
      (r) => r.url().includes("/voice-sessions") && r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.keyboard.press("e");
    const response = await voiceRequest;

    // The original bug surfaced as a 500 ("relation voice_sessions does not exist").
    const status = response.status();
    expect(status).not.toBe(500);
    expect([201, 401, 403, 503]).toContain(status);

    if (status === 201) {
      // Live path: the overlay renders and the SDK reaches a known status.
      await expect(page.getByTestId("voice-meeting")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("voice-status")).toBeVisible();
    } else {
      // Credential-gated path: the API returns the standard error envelope and the UI
      // shows a recoverable error while text chat stays available.
      const body = await response.json();
      expect(body.error.code).toMatch(/voice_/);
      await expect(page.getByTestId("voice-error")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("chat-input")).toBeVisible();
    }

    expect(consoleErrors.join("\n")).not.toMatch(/voice_sessions|Internal Server Error/i);
  });
});
