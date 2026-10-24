"use client";

// Dev-only preview of the team intro with real generated characters (no sign-in needed).
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { ShiftComplete } from "../../components/ShiftComplete";
import { TeamIntro } from "../../components/TeamIntro";
import type { WorldCharacter } from "../../lib/types";
import mock from "./mock.json";

const END_OBJECTIVES = ["Establish the impact", "Investigate evidence", "Identify the rollback risk", "Choose a safe mitigation", "Communicate a status update"].map(
  (label, i) => ({ id: `o${i}`, label, status: "completed", required: true }),
);

const END_STATS = {
  facts: ["Checkout errors after the release", "Migration ran at 14:02", "Schema change is not backward compatible", "Revenue at risk", "Status update due 16:00"].map((label, i) => ({ id: `f${i}`, label })),
  talks: [
    { id: "manager", count: 6 },
    { id: "teammate", count: 9 },
    { id: "qa", count: 3 },
  ],
  seconds: 754,
};

export default function IntroPreview() {
  const [key, setKey] = useState(0);
  const [end, setEnd] = useState(false);
  useEffect(() => setEnd(new URLSearchParams(window.location.search).has("end")), []);
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main style={{ padding: 24 }}>
      <button className="btn" onClick={() => setKey((k) => k + 1)}>
        Replay intro
      </button>
      {/* ?end=1 previews the "Shift complete" end card instead. */}
      {end ? (
        <ShiftComplete key={key} characters={mock.characters as WorldCharacter[]} title={mock.title} objectives={END_OBJECTIVES} stats={END_STATS} onDone={() => {}} />
      ) : (
        <TeamIntro key={key} characters={mock.characters as WorldCharacter[]} title={mock.title} onDone={() => {}} />
      )}
    </main>
  );
}
