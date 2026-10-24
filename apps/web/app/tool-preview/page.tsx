"use client";

// Dev-only preview of the tool findings popup (no sign-in needed): /tool-preview?tool=log_viewer
import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ToolPopup } from "../../components/ToolPopup";

const TOOLS: Record<string, string> = {
  log_viewer: "Inspect application logs",
  metrics_panel: "Inspect database metrics",
  incident_dashboard: "Inspect incident dashboard",
  deploy_console: "Inspect deployment console",
  runbook: "Read the ops runbook",
};
const FINDING = {
  id: "f_error_logs",
  label: "Error logs point to the database",
  detail: "Application logs show failed database queries referencing a column that does not exist yet.",
  new: true,
};

function Preview() {
  const tool = useSearchParams().get("tool") ?? "log_viewer";
  const [open, setOpen] = useState(true);
  return (
    <main style={{ padding: 24 }}>
      <button className="btn" onClick={() => setOpen(true)}>
        Open {tool}
      </button>
      {open && (
        <ToolPopup tool={{ id: tool, label: TOOLS[tool] ?? tool, findings: [FINDING], service: "checkout-api" }} onClose={() => setOpen(false)} />
      )}
    </main>
  );
}

export default function ToolPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}
