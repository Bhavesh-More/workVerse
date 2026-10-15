import { expect, test } from "@playwright/test";

// Public pages only: no Clerk user, API or model calls needed.
test.describe("public pages", () => {
  test("landing explains the product and routes to sign-up", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "WorkVerse" })).toBeVisible();
    await expect(page.getByText(/students & early-career engineers/i)).toBeVisible();
    // Office polaroids come from the real game map.
    await expect(page.getByRole("img", { name: /engineering floor/i }).first()).toBeVisible();

    await page.getByRole("link", { name: /Start practising — create a free account/i }).click();
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByRole("heading", { name: /Start practising/i })).toBeVisible();
  });

  test("landing in-page nav jumps to sections", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "What we assess" }).click();
    await expect(page).toHaveURL(/#assess$/);
    await expect(page.getByText("Stakeholder communication")).toBeInViewport();
  });

  test("sign-up password helper counts down to the 15-character minimum", async ({ page }) => {
    await page.goto("/signup");
    const hint = page.getByTestId("password-hint");
    await expect(hint).toContainText("At least 15 characters");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await expect(hint).toHaveText("10 more characters to go.");
    await page.getByLabel("Password", { exact: true }).fill("a long enough phrase");
    await expect(hint).toContainText("Long enough");
  });

  test("password visibility toggle reveals and hides the value", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("log-in and sign-up link to each other", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create a free account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("landing fits a phone screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
