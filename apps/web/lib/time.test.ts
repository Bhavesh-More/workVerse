import assert from "node:assert/strict";
import { test } from "node:test";
import { isoToZoned, relative, urgency, zonedToIso } from "./time.ts";

test("zoned wall time converts to the right instant, DST included", () => {
  assert.equal(zonedToIso("2026-10-31T17:00", "Europe/London"), "2026-10-31T17:00:00.000Z"); // GMT after DST ends
  assert.equal(zonedToIso("2026-07-01T09:30", "Europe/London"), "2026-07-01T08:30:00.000Z"); // BST
  assert.equal(zonedToIso("2026-10-31T17:00", "Asia/Kolkata"), "2026-10-31T11:30:00.000Z");
  assert.equal(isoToZoned("2026-10-31T11:30:00.000Z", "Asia/Kolkata"), "2026-10-31T17:00");
});

test("relative and urgency", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(relative("2026-10-25T15:00:00Z", now), "in 3 h");
  assert.equal(relative("2026-10-30T12:00:00Z", now), "in 5 days");
  assert.equal(relative("2026-10-24T12:00:00Z", now), "24 h ago");
  assert.equal(urgency("2026-10-26T12:00:00Z", now), "soon");
  assert.equal(urgency("2026-10-20T12:00:00Z", now), "past");
  assert.equal(urgency(null, now), "none");
});
