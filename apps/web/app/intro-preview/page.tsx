"use client";

// Dev-only preview of the team intro with real generated characters (no sign-in needed).
import { notFound } from "next/navigation";
import { useState } from "react";
import { TeamIntro } from "../../components/TeamIntro";
import type { WorldCharacter } from "../../lib/types";
import mock from "./mock.json";

export default function IntroPreview() {
  const [key, setKey] = useState(0);
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main style={{ padding: 24 }}>
      <button className="btn" onClick={() => setKey((k) => k + 1)}>
        Replay intro
      </button>
      <TeamIntro key={key} characters={mock.characters as WorldCharacter[]} title={mock.title} onDone={() => {}} />
    </main>
  );
}
