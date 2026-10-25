"use client";

// Shared pieces of the Company assessments area: company mark, status pill, deadline label.
import type { StageInfo } from "../../lib/candidate";
import { formatWhen, relative, urgency, zoneAbbr } from "../../lib/time";

const MARK_COLORS = ["#fecc33", "#9fd7b9", "#b7c7ff", "#ffb48a", "#e3b5f0", "#a6e3e9"];

/** A company's mark: its initials on a stable colour (no logo upload exists, so none is invented). */
export function CompanyMark({ name, size = 44 }: { name: string; size?: number }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="ca-mark" style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: MARK_COLORS[h % MARK_COLORS.length] }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function StagePill({ state, small = false }: { state: StageInfo; small?: boolean }) {
  return (
    <span className={`ca-pill ca-pill--${state.tone}${small ? " is-small" : ""}`} data-testid="stage-pill" data-stage={state.stage}>
      <span className="ca-pill__dot" aria-hidden="true" />
      {state.label}
    </span>
  );
}

/** "Due Fri 31 Oct, 17:00 · in 3 days", coloured by urgency; times in the viewer's zone. */
export function DueLabel({ due, done = false, compact = false }: { due: string | null; done?: boolean; compact?: boolean }) {
  if (!due) return <span className="ca-due ca-due--none">No deadline</span>;
  const u = done ? "later" : urgency(due);
  return (
    <span className={`ca-due ca-due--${u}`} title={`${formatWhen(due, undefined, true)} ${zoneAbbr(due)}`} data-testid="due-label">
      {u === "past" && !done ? "Was due " : "Due "}
      {formatWhen(due)}
      {!compact && !done && <span className="ca-due__rel"> · {relative(due)}</span>}
    </span>
  );
}

/** What the main button on a card does, by stage. */
export function actionLabel(state: StageInfo): string {
  if (state.can_accept) return "Review invitation";
  if (state.can_start) return "View details & start";
  if (state.can_continue) return "Continue";
  if (state.can_view_results) return state.stage === "evaluated" ? "View results" : "View submission";
  return "View details";
}
