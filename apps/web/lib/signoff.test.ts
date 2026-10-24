import assert from "node:assert/strict";
import { test } from "node:test";
import { isSignOff } from "./signoff.ts";

test("goodbye lines end the call; questions and normal replies don't", () => {
  assert.ok(isSignOff("Alright, talk at eleven."));
  assert.ok(isSignOff("Alright, talk before evening. Thanks."));
  assert.ok(isSignOff("I'll wait for your update. If anything changes before then, ping me."));
  assert.ok(isSignOff("Okay, bye!"));
  assert.ok(!isSignOff("Thanks. I'll expect your update at eleven. Anything else you need from me right now?"));
  assert.ok(!isSignOff("About 31% of customer requests are failing."));
});
