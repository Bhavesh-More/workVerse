import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { markOnboarded, testUser, type TestUser } from "./users";

// Learner context builder (PR #3): documents, scraped links, the AI-built context, the
// personalised scenario plan, staleness, and starting a personalised scenario. Real API, real
// model, real scrapers (GitHub, LinkedIn, example.com) — so it needs network access.
const API = "http://localhost:8000/api/v1";
const FX = path.join("e2e", "fixtures", "context");
const SHOTS = process.env.E2E_SHOTS_DIR ?? path.join("test-results", "learner-context-shots");
const SPOILERS = ["migration", "rollback", "roll back", "revert", "schema", "column", "root cause"];

async function shot(page: Page, name: string, fullPage = false) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}
async function token(page: Page): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session, null, { timeout: 30_000 });
  return page.evaluate(async () => (window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }).Clerk.session.getToken());
}
async function api(page: Page, request: APIRequestContext, method: string, p: string, data?: unknown) {
  const res = await request.fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${await token(page)}` }, data, timeout: 180_000 });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function upload(page: Page, request: APIRequestContext, kind: string, file: string, mime = "application/octet-stream") {
  const res = await request.post(`${API}/me/documents/${kind}`, {
    headers: { Authorization: `Bearer ${await token(page)}` },
    multipart: { file: { name: path.basename(file), mimeType: mime, buffer: fs.readFileSync(path.join(FX, file)) } },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function signIn(browser: Browser, user: TestUser, where: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await setupClerkTestingToken({ page });
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: user.ticket } });
  await page.goto(where);
  return page;
}

type View = {
  status: "empty" | "ready" | "stale";
  context: { headline: string; tech_stack: string[]; summary: string } | null;
  scenarios: { id: string; kind: string; title: string; why: string; story: string; track: string; company: string; product: string }[];
  sources: { kind: string; ok: boolean; error: string | null; found: string[]; links: Record<string, string> | null }[];
  builder: string | null;
  built_at: string | null;
};
const source = (v: View, kind: string) => v.sources.find((s) => s.kind === kind);

test("API: documents, link sources, build, staleness, personalised scenario", async ({ browser, request }) => {
  test.setTimeout(900_000);
  const U = await testUser(request, {});
  const page = await signIn(browser, U, "/profile");

  // ---- documents
  const pdf = await upload(page, request, "cv", "cv.pdf", "application/pdf");
  expect(pdf.status).toBe(201);
  expect(pdf.body.source.ok).toBe(true);
  expect(pdf.body.source.links).toMatchObject({ github: "https://github.com/octocat", portfolio: "https://example.com" });
  const docx = await upload(page, request, "linkedin_pdf", "cv.docx");
  expect(docx.status).toBe(201);
  expect(docx.body.source.links.github).toBe("https://github.com/torvalds");
  for (const [file, code] of [["scanned.pdf", "unreadable_document"], ["corrupt.pdf", "unreadable_document"], ["photo.png", "unreadable_document"], ["big.txt", "file_too_large"]] as const) {
    const r = await upload(page, request, "cv", file);
    expect(r.status, file).toBe(422);
    expect(JSON.stringify(r.body), file).toContain(code);
  }
  expect((await upload(page, request, "passport", "cv.txt")).status).toBe(422);
  expect((await api(page, request, "DELETE", "/me/documents/linkedin_pdf")).status).toBe(204);
  expect((await api(page, request, "DELETE", "/me/documents/linkedin_pdf")).status).toBe(404);
  // A rejected upload never replaced the good CV.
  let view = (await api(page, request, "GET", "/me/context")).body as View;
  expect(source(view, "cv")?.ok).toBe(true);

  // ---- link sources (live scraping)
  expect(
    (await api(page, request, "PATCH", "/me", {
      target_role: "Backend Engineer",
      github_url: "github.com/octocat",
      linkedin_url: "https://www.linkedin.com/in/this-person-does-not-exist-zz9",
      portfolio_url: "example.com",
      custom_situation: "Explaining a delay to an anxious client",
    })).status,
  ).toBe(200);
  view = (await api(page, request, "POST", "/me/sources/refresh", {})).body as View;
  // GitHub allows 60 unauthenticated requests an hour (no GITHUB_TOKEN here): when it's
  // rate-limited the source must say so politely rather than fail the build.
  const gh = source(view, "github")!;
  if (gh.ok) expect(gh.found.join(" ")).toMatch(/repositories/);
  else expect(gh.error).toContain("rate-limiting");
  console.log("github source:", gh.ok ? gh.found.join(" · ") : gh.error);
  expect(source(view, "portfolio")).toMatchObject({ ok: true });
  expect(source(view, "linkedin")).toBeDefined(); // usually blocked by LinkedIn; must fail politely
  if (!source(view, "linkedin")!.ok) expect(source(view, "linkedin")!.error).toContain("LinkedIn");

  // ---- build: context + plan
  const t0 = Date.now();
  view = (await api(page, request, "POST", "/me/context/build", {})).body as View;
  console.log(`build took ${((Date.now() - t0) / 1000).toFixed(1)}s, builder=${view.builder}`);
  expect(view.status).toBe("ready");
  expect(view.context?.headline).toBeTruthy();
  const kinds = view.scenarios.map((s) => s.kind);
  expect(kinds.filter((k) => k === "major").length).toBe(3); // every incident type of the role's track
  expect(kinds).toContain("custom");
  for (const s of view.scenarios) {
    for (const w of SPOILERS) expect(`${s.title} ${s.why} ${s.story}`.toLowerCase(), `spoiler "${w}" in ${s.id}`).not.toContain(w);
  }
  console.log(JSON.stringify({ headline: view.context?.headline, stack: view.context?.tech_stack, scenarios: view.scenarios.map((s) => [s.kind, s.track, s.title, s.company]) }, null, 1));

  // Unchanged inputs: no rebuild.
  const again = (await api(page, request, "POST", "/me/context/build", {})).body as View;
  expect(again.built_at).toBe(view.built_at);
  // A profile change makes it stale; the next build refreshes it.
  await api(page, request, "PATCH", "/me", { custom_situation: "Pushing back on a teammate who wants a risky fix" });
  expect(((await api(page, request, "GET", "/me/context")).body as View).status).toBe("stale");
  const rebuilt = (await api(page, request, "POST", "/me/context/build", {})).body as View;
  expect(rebuilt.status).toBe("ready");
  expect(rebuilt.built_at).not.toBe(view.built_at);

  // ---- unsafe links fail safely (no internal fetch, no crash)
  await api(page, request, "PATCH", "/me", { portfolio_url: "http://169.254.169.254/latest/meta-data" });
  view = (await api(page, request, "POST", "/me/sources/refresh", {})).body as View;
  expect(source(view, "portfolio")).toMatchObject({ ok: false, error: "That address isn't a public website." });
  await api(page, request, "PATCH", "/me", { portfolio_url: "javascript:alert(1)" });
  view = (await api(page, request, "POST", "/me/sources/refresh", {})).body as View;
  console.log("javascript: link ->", source(view, "portfolio")?.error);
  expect(source(view, "portfolio")?.ok).toBe(false);
  // Clearing a link forgets what it said.
  await api(page, request, "PATCH", "/me", { github_url: "", portfolio_url: "" });
  view = (await api(page, request, "POST", "/me/sources/refresh", {})).body as View;
  expect(source(view, "github")).toBeUndefined();
  expect(source(view, "portfolio")).toBeUndefined();

  // ---- start a personalised scenario
  view = (await api(page, request, "POST", "/me/context/build", {})).body as View;
  const spec = view.scenarios.find((s) => s.kind === "custom") ?? view.scenarios[0]!;
  const inst = await api(page, request, "POST", "/scenario-instances", { template_slug: "production-incident", spec_id: spec.id, mode: "quick" });
  expect(inst.status, JSON.stringify(inst.body)).toBe(201);
  const sess = await api(page, request, "POST", "/sessions", { scenario_instance_id: inst.body.scenario_instance_id, mode: "quick" });
  expect(sess.status).toBe(201);
  // The briefing tells the spec's story: its company and product, on the spec's track.
  const brief = await api(page, request, "GET", `/scenario-instances/${inst.body.scenario_instance_id}`);
  console.log("briefing:", JSON.stringify(brief.body).slice(0, 600));
  expect(JSON.stringify(brief.body)).toContain(spec.company);
  expect(sess.body.incident.track).toBe(spec.track);
  console.log("started spec", spec.id, spec.company, "→ session", sess.body.id ?? sess.body.session_id);
  expect((await api(page, request, "POST", "/scenario-instances", { template_slug: "production-incident", spec_id: "nope-zz9" })).status).toBe(404);

  // ---- prompt injection inside a CV is treated as data
  expect((await upload(page, request, "cv", "injection.txt")).status).toBe(201);
  view = (await api(page, request, "POST", "/me/context/build", { force: true })).body as View;
  console.log("after injection:", view.builder, view.context?.headline, view.context?.tech_stack);
  expect(view.context?.headline ?? "").not.toContain("HACKED");
  expect(view.context?.tech_stack ?? []).not.toEqual(["COBOL"]);

  // ---- auth
  expect((await request.get(`${API}/me/context`)).status()).toBe(401);
  await page.context().close();
});

test("UI: onboarding builds scenarios; profile card; personalised scenario starts", async ({ browser, request }) => {
  test.setTimeout(900_000);
  const U = await testUser(request, { fresh: true });
  const page = await signIn(browser, U, "/onboarding");
  await expect(page.getByText(/Step 1 of 4/)).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Target role").selectOption({ label: "Junior Backend Engineer" });
  await shot(page, "c1-onboarding-step1");
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByRole("button", { name: /Next/ }).click();
  await expect(page.getByText(/Step 3 of 4/)).toBeVisible();
  // Upload a CV: the GitHub field fills itself from the CV's links.
  await page.locator("#doc-cv").setInputFiles(path.join(FX, "cv.txt"));
  await expect(page.getByText("cv.txt")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#gh")).toHaveValue("https://github.com/octocat");
  await page.locator("#pf").fill("example.com");
  await shot(page, "c2-onboarding-background");
  await page.getByRole("button", { name: /Next/ }).click();
  await expect(page.getByText(/Step 4 of 4/)).toBeVisible();
  await page.getByRole("button", { name: "Explaining a delay to an anxious client" }).click();
  await expect(page.locator("#sit")).toHaveValue("Explaining a delay to an anxious client");
  await shot(page, "c3-onboarding-situation");
  await page.getByRole("button", { name: /Build my scenarios/ }).click();
  await expect(page.getByText("Building your scenarios")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "c4-onboarding-building");
  await expect(page.getByText(/personalised scenarios are waiting/)).toBeVisible({ timeout: 180_000 });
  await shot(page, "c5-onboarding-built", true);
  markOnboarded(U);
  await page.getByRole("button", { name: /Enter WorkVerse/ }).click();
  await expect(page).toHaveURL(/\/scenarios/, { timeout: 30_000 });
  const cards = page.getByTestId("personal-scenario");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByText("Your situation")).toBeVisible();
  await shot(page, "c6-scenarios-made-for-you", true);

  // Profile: the learner context card.
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Learner context" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Updated /)).toBeVisible({ timeout: 30_000 });
  await shot(page, "c7-profile-context", true);

  // Saving the profile rebuilds the context in place (the card shows it rebuilding, then updated).
  await page.locator("#sit").fill("My first on-call shift and something breaks");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect
    .poll(async () => {
      const v = (await api(page, request, "GET", "/me/context")).body as View & { custom_situation: string };
      return `${v.status}|${v.custom_situation}`;
    }, { timeout: 180_000 })
    .toBe("ready|My first on-call shift and something breaks");
  await expect(page.getByText(/^Updated /)).toBeVisible({ timeout: 30_000 });

  // A change made elsewhere leaves it stale; the scenarios page offers to update it.
  await api(page, request, "PATCH", "/me", { custom_situation: "Explaining a delay to an anxious client" });
  await page.goto("/scenarios");
  const update = page.getByRole("button", { name: "Update my scenarios" });
  await expect(update).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Out of date/)).toBeVisible();
  await shot(page, "c8-scenarios-stale");
  await update.click();
  await expect(update).toBeHidden({ timeout: 180_000 });
  await expect(page.getByText(/Built for:/)).toBeVisible();

  // Start a personalised scenario.
  await cards.first().getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/briefing\//, { timeout: 120_000 });
  await shot(page, "c9-personal-briefing", true);
  await page.getByRole("button", { name: "Enter the office" }).click();
  await expect(page).toHaveURL(/\/session\//, { timeout: 60_000 });
});
