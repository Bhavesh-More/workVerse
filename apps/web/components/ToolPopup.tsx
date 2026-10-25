"use client";

import { useEffect } from "react";
import { m } from "framer-motion";
import { Press_Start_2P, VT323 } from "next/font/google";

const pixelTitle = Press_Start_2P({ weight: "400", subsets: ["latin"], display: "swap" });
const pixelBody = VT323({ weight: "400", subsets: ["latin"], display: "swap" });

export type Finding = { id: string; label: string; detail: string; new?: boolean };
export type ToolView = {
  id: string;
  label: string;
  findings: Finding[];
  service?: string;
  portrait?: string;
  /** Dialogue only: who told you (character id). */
  from?: string;
  /** Where to go next, shown in the footer with a button that takes you there. */
  next?: { text: string; label: string; onGo: () => void };
};

// Which "screen" each workplace tool opens as. Unknown tools fall back to a plain document.
type Kind = "terminal" | "chart" | "pipeline" | "document" | "dialogue" | "board" | "whiteboard" | "coffee" | "desk";
const KIND: Record<string, Kind> = {
  log_viewer: "terminal",
  metrics_panel: "chart",
  incident_dashboard: "chart",
  deploy_console: "pipeline",
  runbook: "document",
  migration_notes: "document",
  dialogue: "dialogue", // a colleague told you something
  // Ambient objects: their own screen even when the scenario gives them nothing to reveal.
  team_board: "board",
  meeting_whiteboard: "whiteboard",
  coffee_machine: "coffee",
  reception_desk: "desk",
};
// Footer line for ambient objects with nothing to reveal (tools say "Nothing new since last time").
const AMBIENT_NOTE: Partial<Record<Kind, string>> = {
  board: "Nothing assigned to you yet",
  whiteboard: "Free for your next meeting",
  coffee: "No clues here, just caffeine",
  desk: "All quiet at the front desk",
};

/** Pixel-art window that shows what a workplace tool revealed, styled like that tool. */
export function ToolPopup({ tool, onClose }: { tool: ToolView; onClose: () => void }) {
  const kind = KIND[tool.id] ?? "document";

  useEffect(() => {
    // Capture phase so the game underneath doesn't also react to Esc/Enter/Space.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="px-backdrop" role="dialog" aria-modal="true" aria-label={tool.label} onClick={onClose}>
      <m.div
        className={`px-window px-window--${kind} ${pixelBody.className}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, transform: "scale(0.92)" }}
        animate={{ opacity: 1, transform: "scale(1)" }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className={`px-titlebar ${pixelTitle.className}`}>
          <span className="px-titlebar__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="px-titlebar__name">{tool.label}</span>
        </div>
        <div className="px-body">
          {kind === "terminal" && <Terminal tool={tool} />}
          {kind === "chart" && <Chart tool={tool} />}
          {kind === "pipeline" && <Pipeline tool={tool} />}
          {kind === "document" && <Document tool={tool} />}
          {kind === "dialogue" && <Dialogue tool={tool} />}
          {kind === "board" && <Board tool={tool} />}
          {kind === "whiteboard" && <Whiteboard tool={tool} />}
          {kind === "coffee" && <Coffee />}
          {kind === "desk" && <Desk tool={tool} />}
        </div>
        {tool.next && (
          <div className="px-next" data-testid="popup-next">
            <span className={pixelTitle.className}>Next ▶</span> {tool.next.text}
          </div>
        )}
        <div className="px-footer">
          <span>
            {tool.findings.some((f) => f.new)
              ? "★ New finding added to “What you know”"
              : (!tool.findings.length && AMBIENT_NOTE[kind]) || "Nothing new since last time"}
          </span>
          <span className="px-footer__btns">
            {tool.next && (
              <button className={`px-btn px-btn--ghost ${pixelTitle.className}`} onClick={onClose}>
                Stay
              </button>
            )}
            <button
              className={`px-btn ${pixelTitle.className}`}
              data-testid="popup-go"
              onClick={() => {
                onClose();
                tool.next?.onGo();
              }}
              autoFocus
            >
              {tool.next ? tool.next.label : "Got it"}
            </button>
          </span>
        </div>
      </m.div>
    </div>
  );
}

function stamp(i: number) {
  const d = new Date(Date.now() - (6 - i) * 1700);
  return d.toTimeString().slice(0, 8);
}

function Terminal({ tool }: { tool: ToolView }) {
  const svc = tool.service ?? "app";
  const lines: { cls: string; text: string }[] = [{ cls: "px-cmd", text: `$ tail -n 200 ${svc}.log | grep -iE "error|warn"` }];
  if (tool.findings.length === 0) lines.push({ cls: "px-dim", text: "(no errors in the last 200 lines)" });
  tool.findings.forEach((f, n) => {
    // The same failure repeating is what real logs look like during an incident.
    for (let i = 0; i < 3; i++) lines.push({ cls: "px-err", text: `[${stamp(i + n * 3)}] ERROR ${f.detail}` });
    lines.push({ cls: "px-ok", text: `# finding: ${f.label}` });
  });
  return (
    <div className="px-terminal">
      {lines.map((l, i) => (
        <div key={i} className={`px-line ${l.cls}`} style={{ animationDelay: `${i * 120}ms` }}>
          {l.text}
        </div>
      ))}
      <span className="px-cursor" style={{ animationDelay: `${lines.length * 120}ms` }} aria-hidden="true">
        █
      </span>
    </div>
  );
}

// Steady, then erratic: "something changed here" without claiming a direction the facts don't state.
const SPIKE = [5, 5, 6, 5, 5, 6, 5, 2, 11, 3, 12, 2];

function Chart({ tool }: { tool: ToolView }) {
  return (
    <div className="px-chart">
      <div className="px-bars" aria-hidden="true">
        {SPIKE.map((h, i) => (
          <span key={i} className={i >= 7 ? "is-hot" : ""} style={{ height: `${h * 6}px`, animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
      <Findings findings={tool.findings} prefix="▲ ALERT" />
    </div>
  );
}

function Pipeline({ tool }: { tool: ToolView }) {
  // Neutral stages: the release went out and production is unhealthy; the findings say the rest.
  const stages = [
    ["Build", "ok"],
    ["Release", "ok"],
    ["Production", "bad"],
  ];
  return (
    <div className="px-pipeline">
      <div className="px-stages" aria-hidden="true">
        {stages.map(([name, s], i) => (
          <span key={name} className={`px-stage px-stage--${s}`} style={{ animationDelay: `${i * 140}ms` }}>
            {s === "ok" ? "✓" : "✕"} {name}
          </span>
        ))}
      </div>
      <Findings findings={tool.findings} prefix="▶" />
    </div>
  );
}

function Dialogue({ tool }: { tool: ToolView }) {
  return (
    <div className="px-dialogue">
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
      {tool.portrait && <img className="px-dialogue__face" src={tool.portrait} alt="" draggable={false} />}
      <div className="px-dialogue__speech">
        <span className="px-dialogue__name">{tool.label.split(" ")[0]} told you</span>
        {tool.findings.length ? (
          <Findings findings={tool.findings} prefix="»" />
        ) : (
          <p className="px-dim">They&apos;ve already told you everything they know.</p>
        )}
      </div>
    </div>
  );
}

function Document({ tool }: { tool: ToolView }) {
  return (
    <div className="px-doc">
      <Findings findings={tool.findings} prefix="§" />
    </div>
  );
}

function Board({ tool }: { tool: ToolView }) {
  return (
    <div className="px-board">
      {["To do", "Doing", "Done"].map((col, c) => (
        <section key={col}>
          <h3>{col}</h3>
          {c === 0 && tool.findings.length ? (
            tool.findings.map((f) => (
              <p key={f.id} className="px-card">
                {f.label}
              </p>
            ))
          ) : (
            <p className="px-dim">{c === 0 ? "No tasks for now" : "—"}</p>
          )}
        </section>
      ))}
    </div>
  );
}

function Whiteboard({ tool }: { tool: ToolView }) {
  return (
    <div className="px-whiteboard">
      {tool.findings.length ? <Findings findings={tool.findings} prefix="✎" /> : <p className="px-dim">The board is wiped clean. Nothing written yet.</p>}
      <span className="px-markers" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function Coffee() {
  return (
    <div className="px-coffee">
      <span className="px-cup" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p>Coffee&apos;s ready. Take a breath — then back to it.</p>
    </div>
  );
}

function Desk({ tool }: { tool: ToolView }) {
  return (
    <div className="px-doc">
      <p className="px-desk__head">Visitor log · today</p>
      {tool.findings.length ? <Findings findings={tool.findings} prefix="›" /> : <p className="px-dim">No visitors expected today.</p>}
    </div>
  );
}

function Findings({ findings, prefix }: { findings: Finding[]; prefix: string }) {
  if (findings.length === 0) return <p className="px-dim">Nothing unusual here.</p>;
  return (
    <ul className="px-findings">
      {findings.map((f, i) => (
        <li key={f.id} style={{ animationDelay: `${300 + i * 150}ms` }}>
          <strong>
            {prefix} {f.label}
            {f.new && <em> NEW</em>}
          </strong>
          <span>{f.detail}</span>
        </li>
      ))}
    </ul>
  );
}
