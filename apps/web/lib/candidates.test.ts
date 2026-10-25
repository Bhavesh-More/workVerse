// Run with: node --test lib/candidates.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseCandidates } from "./candidates.ts";

test("free text: names in angle brackets, commas, duplicates, junk", () => {
  assert.deepEqual(parseCandidates("Asha Patel <ASHA@x.com>\nben@x.com, chen@x.com; asha@x.com\nnot an email"), [
    { email: "asha@x.com", name: "Asha Patel" },
    { email: "ben@x.com", name: undefined },
    { email: "chen@x.com", name: undefined },
  ]);
});

test("CSV with header: email + first/last name columns, quoted cells, bad rows skipped", () => {
  const csv = 'First Name,Last Name,Email\n"Li, Jr",Chen,chen@x.com\nDara,Kim,dara@x.com\n,,nope\n';
  assert.deepEqual(parseCandidates(csv), [
    { email: "chen@x.com", name: "Li, Jr Chen" },
    { email: "dara@x.com", name: "Dara Kim" },
  ]);
});

test("CSV with name,email header", () => {
  assert.deepEqual(parseCandidates("name,email\nAsha,asha@x.com"), [{ email: "asha@x.com", name: "Asha" }]);
});
