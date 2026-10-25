import type { APIRequestContext, Browser } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { markOwner, testUser } from "./users";

/** Sign in a test account that has no company yet and create one called `name`. */
export async function companyPage(browser: Browser, request: APIRequestContext, _email: string, name: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  // Reused test accounts: if one turns out to own a company already, take the next.
  for (let attempt = 0; attempt < 6; attempt++) {
    const user = await testUser(request, { owner: true, preferEmail: _email });
    await page.goto("/company/login");
    await setupClerkTestingToken({ page });
    await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: user.ticket } });
    await page.goto("/company");
    const setup = page.getByRole("heading", { name: /Set up your company|Assessment overview|Where will candidates work/ });
    await setup.first().waitFor({ timeout: 60_000 });
    if (await page.getByRole("heading", { name: /Set up your company/ }).isVisible()) {
      await page.getByLabel("Company name").fill(name);
      await page.getByRole("button", { name: /Create company/ }).click();
      markOwner(user);
      return { page, errors, email: user.email };
    }
    markOwner(user); // already owned a company before the pool existed
    await page.context().clearCookies();
  }
  throw new Error("Could not find a test account without a company.");
}

/**
 * On a company assessment briefing (/assessments/<id>): accept the invitation if it's pending,
 * then start through the confirmation. Ends on the scenario briefing (/briefing/...?session=).
 */
export async function acceptAndStart(page: import("@playwright/test").Page) {
  const { expect } = await import("@playwright/test");
  await expect(page).toHaveURL(/\/assessments\/[0-9a-f-]+$/, { timeout: 60_000 });
  await page.getByTestId("next-step").waitFor({ timeout: 60_000 });
  if (await page.getByTestId("accept-invitation").count()) {
    await page.getByTestId("accept-invitation").click();
    await expect(page.getByTestId("start-assessment")).toBeVisible({ timeout: 30_000 });
  }
  await page.getByTestId("start-assessment").click();
  await page.getByTestId("confirm-start").click();
  await expect(page).toHaveURL(/\/briefing\/.*session=/, { timeout: 120_000 });
}
