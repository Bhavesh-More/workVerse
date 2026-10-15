import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load apps/web/.env then .env.local (same precedence as Next) so Clerk testing helpers and
// the app share configuration. These values deliberately override any stale shell exports
// that would otherwise cause Clerk Backend API calls to fail with "authorization_invalid".
for (const envPath of [".env", ".env.local"].map((f) => path.join(here, f))) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = (match[2] ?? "").trim();
    if (key) process.env[key] = value;
  }
}
if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error(
    "CLERK_SECRET_KEY is missing. Copy .env.example to apps/web/.env.local (or .env) and set the Clerk keys.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
    actionTimeout: 20_000,
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
