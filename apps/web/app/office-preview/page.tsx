"use client";

// Dev-only preview of the office game with the intro mock's colleagues (no sign-in, no API):
// /office-preview. Used to check art, scale and movement in isolation.
import { notFound } from "next/navigation";
import { useRef, useState } from "react";
import { PhaserGame, type PhaserGameHandle } from "../../game/PhaserGame";
import { ImochaHub } from "../../components/ImochaHub";
import type { WorldCharacter, WorldView } from "../../lib/types";
import mock from "../intro-preview/mock.json";

const OBJECTS: [string, string, string][] = [
  ["incident_dashboard", "Incident dashboard", "engineering_workspace"],
  ["log_viewer", "Log viewer", "engineering_workspace"],
  ["metrics_panel", "Metrics panel", "engineering_workspace"],
  ["deploy_console", "Deploy console", "engineering_workspace"],
  ["runbook", "Ops runbook", "engineering_workspace"],
  ["migration_notes", "Migration notes", "engineering_workspace"],
  ["team_board", "Task board", "collaboration_area"],
  ["meeting_whiteboard", "Whiteboard", "meeting_room"],
  ["coffee_machine", "Coffee machine", "break_area"],
  ["reception_desk", "Reception desk", "reception"],
];

const WORLD: WorldView = {
  locations: [],
  characters: mock.characters as unknown as WorldCharacter[],
  objects: OBJECTS.map(([id, label, location_id]) => ({ id, label, location_id, marker: "misc" })),
  actions: [],
};

export default function OfficePreview() {
  const ref = useRef<PhaserGameHandle>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [hub, setHub] = useState(false);
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div style={{ height: "100svh", display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
      <div className="mono" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span>Office preview</span>
        <span>{prompt ? `E · ${prompt}` : "WASD / arrows · Shift to hurry"}</span>
        {["reception", "meeting_room", "manager_office", "engineering_workspace", "collaboration_area", "break_area", "imocha_hub"].map((id) => (
          <button key={id} type="button" onClick={() => ref.current?.travelTo(id)}>
            {id}
          </button>
        ))}
      </div>
      <div className="sim-full__game" style={{ flex: 1 }}>
        <PhaserGame
          ref={ref}
          world={WORLD}
          sessionId="preview"
          playerTexture="player"
          onPrompt={setPrompt}
          onNearCharacter={() => {}}
          onInteractCharacter={() => {}}
          onVoiceCharacter={() => {}}
          onInteractObject={() => {}}
          onOpenHub={() => setHub(true)}
          onLocationChange={() => {}}
          onReady={() => {
            (window as unknown as { __office?: PhaserGameHandle | null }).__office = ref.current;
          }}
        />
      </div>
      {hub && <ImochaHub onClose={() => setHub(false)} />}
    </div>
  );
}
