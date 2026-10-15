// Run with: node --test lib/api.test.ts
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, clearCache, peek, revalidate, setTokenGetter } from "./api.ts";

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;

function mockFetch(responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  }) as typeof fetch;
  return calls;
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  globalThis.fetch = realFetch;
  setTokenGetter(null);
  clearCache();
});

test("sends the session token and JSON body", async () => {
  setTokenGetter(async () => "tok_123");
  const calls = mockFetch([json(200, { id: "p1" })]);
  await api.updateMe({ display_name: "Ada" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/me$/);
  assert.equal(calls[0]!.init.method, "PATCH");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok_123");
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { display_name: "Ada" });
});

test("maps the API error envelope to an ApiError", async () => {
  mockFetch([json(409, { error: { code: "stale_state", message: "Session changed", request_id: "r1" } })]);
  await assert.rejects(api.getSession("s1"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 409);
    assert.equal(err.code, "stale_state");
    assert.equal(err.message, "Session changed");
    assert.equal(err.requestId, "r1");
    return true;
  });
});

test("retries a 401 while a fresh Clerk token becomes available", async () => {
  const calls = mockFetch([json(401, {}), json(200, { items: [] })]);
  const res = await api.listSessions();
  assert.deepEqual(res, { items: [] });
  assert.equal(calls.length, 2);
});

test("a network failure becomes a friendly ApiError", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(api.getMe(), { name: "Error", code: "network_error", status: 0 });
});

test("a non-JSON error page (e.g. a proxy 502) still becomes an ApiError", async () => {
  mockFetch([() => new Response("<html>Bad gateway</html>", { status: 502 })]);
  await assert.rejects(api.getMe(), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("204 responses resolve to undefined", async () => {
  mockFetch([() => new Response(null, { status: 204 })]);
  assert.equal(await api.deleteSkill("sk1"), undefined);
});

test("cache: concurrent reads share one request and later reads are instant", async () => {
  const calls = mockFetch([json(200, { items: [1] })]);
  const [a, b] = await Promise.all([
    revalidate("/sessions", api.listSessions),
    revalidate("/sessions", api.listSessions),
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(peek("/sessions"), { items: [1] });
});

test("cache: a successful write clears cached reads", async () => {
  mockFetch([json(200, { id: "p1", display_name: "Old" }), json(200, { id: "p1", display_name: "New" })]);
  await revalidate("/me", api.getMe);
  assert.ok(peek("/me"));
  await api.updateMe({ display_name: "New" });
  assert.equal(peek("/me"), undefined);
});

test("cache: a read that was in flight during a write is not cached", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    if ((init.method ?? "GET") === "GET") await gate;
    return json(200, { id: "p1" })();
  }) as typeof fetch;
  const read = revalidate("/me", api.getMe);
  await api.updateMe({ display_name: "x" });
  release();
  await read;
  assert.equal(peek("/me"), undefined);
});

test("cache: failed reads are not cached and can be retried", async () => {
  mockFetch([json(500, {}), json(200, { items: [] })]);
  await assert.rejects(revalidate("/progress/competencies", api.competencies));
  assert.equal(peek("/progress/competencies"), undefined);
  assert.deepEqual(await revalidate("/progress/competencies", api.competencies), { items: [] });
});
