"use client";

// Charts for the company portal. Same rules as Charts.tsx: one ink series per chart, recessive
// grid, values printed beside marks; band (status) colours only ever appear next to their label.
import { useState, type ReactNode } from "react";
import { BAND_COLORS, type CohortSummary } from "../lib/company";

const INK = "var(--color-ink)";
const OTHER = "#b5b5b5";

type Tip = { x: number; y: number; body: ReactNode } | null;

/** Hover tooltip anchored inside the chart's figure. */
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const box = (e.currentTarget as HTMLElement).closest("figure")!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, body });
  };
  const node = tip ? (
    <div className="cchart__tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.body}
    </div>
  ) : null;
  return { show, hide: () => setTip(null), node };
}

export function BandDot({ label }: { label?: string | null }) {
  if (!label) return <span className="muted">—</span>;
  return (
    <span className="band-dot">
      <i style={{ background: BAND_COLORS[label] ?? INK }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Invited → opened → started → completed, each bar as a share of invited. */
export function FunnelChart({ steps }: { steps: CohortSummary["funnel"] }) {
  const tip = useTip();
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <figure className="cchart">
      <ul className="list-reset cchart__rows">
        {steps.map((s, i) => {
          const pct = Math.round((s.count / top) * 100);
          const prev = i > 0 ? steps[i - 1]!.count : null;
          return (
            <li
              key={s.id}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <>
                    <strong>{s.label}</strong>
                    <br />
                    {s.count} candidate{s.count === 1 ? "" : "s"} · {pct}% of invited
                    {prev !== null && prev > 0 && (
                      <>
                        <br />
                        {Math.round((s.count / prev) * 100)}% of previous step
                      </>
                    )}
                  </>,
                )
              }
              onMouseLeave={tip.hide}
            >
              <span className="small">{s.label}</span>
              <span className="cchart__track">
                <span style={{ width: `${s.count ? Math.max(2, pct) : 0}%`, background: INK }} />
              </span>
              <span className="mono xsmall cchart__val">
                {s.count} <span className="muted">· {pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
      {tip.node}
    </figure>
  );
}

/** Candidates per score range. */
export function HistogramChart({ bins }: { bins: CohortSummary["histogram"] }) {
  const tip = useTip();
  // Narrow viewBox so the axis text renders near its CSS size at card width.
  const W = 400;
  const H = 190;
  const pad = { l: 6, r: 6, t: 22, b: 30 };
  const max = Math.max(1, ...bins.map((b) => b.count));
  const slot = (W - pad.l - pad.r) / bins.length;
  const bw = Math.min(52, slot - 12);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <figure className="cchart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score distribution: ${bins.map((b) => `${b.range}: ${b.count}`).join(", ")}`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--color-hairline)" />
        {bins.map((b, i) => {
          const x = pad.l + i * slot + (slot - bw) / 2;
          const top = y(b.count);
          const r = Math.min(4, (y(0) - top) / 2);
          return (
            <g
              key={b.range}
              onMouseMove={(e) => tip.show(e, <><strong>Score {b.range}</strong><br />{b.count} candidate{b.count === 1 ? "" : "s"}</>)}
              onMouseLeave={tip.hide}
            >
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {b.count > 0 && (
                <path
                  d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z`}
                  fill={INK}
                />
              )}
              {b.count > 0 && (
                <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="chart__note">
                  {b.count}
                </text>
              )}
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" className="chart__axis">
                {b.range}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="xsmall muted chart__legend">
        <span>Overall score (0–100) · bar = number of candidates</span>
      </figcaption>
      {tip.node}
    </figure>
  );
}

/** How the completed cohort splits across recommendation bands: one stacked bar plus a labelled legend. */
export function BandStack({ bands }: { bands: CohortSummary["bands"] }) {
  const tip = useTip();
  const total = bands.reduce((n, b) => n + b.count, 0);
  if (!total) return <p className="small muted">No completed candidates yet.</p>;
  return (
    <figure className="cchart">
      <div className="cchart__stack" role="img" aria-label={bands.map((b) => `${b.label}: ${b.count}`).join(", ")}>
        {bands
          .filter((b) => b.count)
          .map((b) => (
            <span
              key={b.label}
              style={{ flex: b.count, background: BAND_COLORS[b.label] }}
              onMouseMove={(e) => tip.show(e, <><strong>{b.label}</strong> · {b.count} ({Math.round((b.count / total) * 100)}%)<br />{b.advice}</>)}
              onMouseLeave={tip.hide}
            />
          ))}
      </div>
      <ul className="list-reset cchart__bandlegend">
        {bands.map((b) => (
          <li key={b.label}>
            <BandDot label={b.label} />
            <strong className="mono">{b.count}</strong>
            <span className="xsmall muted">{b.advice}</span>
          </li>
        ))}
      </ul>
      {tip.node}
    </figure>
  );
}

/** Skill averages (0-100). With `compare`, each row pairs this candidate (ink) with the group (grey). */
export function SkillBars({
  skills,
  values,
  compare,
}: {
  skills: { id: string; name: string; description: string }[];
  values: Record<string, number | null>;
  compare?: Record<string, number | null>;
}) {
  const tip = useTip();
  return (
    <figure className="cchart">
      <ul className="list-reset cchart__rows">
        {skills.map((s) => {
          const v = values[s.id] ?? null;
          const c = compare ? (compare[s.id] ?? null) : undefined;
          return (
            <li
              key={s.id}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <>
                    <strong>{s.name}</strong>: {v === null ? "no evidence" : `${v}/100`}
                    {c !== undefined && <> · group {c === null ? "—" : c}</>}
                    <br />
                    <span className="muted">{s.description}</span>
                  </>,
                )
              }
              onMouseLeave={tip.hide}
            >
              <span className="small">{s.name}</span>
              <span className={`cchart__pair${compare ? " is-pair" : ""}`}>
                <span className="cchart__track">
                  {v !== null && <span style={{ width: `${Math.max(2, v)}%`, background: INK }} />}
                </span>
                {compare && (
                  <span className="cchart__track cchart__track--thin">
                    {c !== null && c !== undefined && <span style={{ width: `${Math.max(2, c)}%`, background: OTHER }} />}
                  </span>
                )}
              </span>
              <span className="mono xsmall cchart__val">{v === null ? "no evidence" : v}</span>
            </li>
          );
        })}
      </ul>
      {compare && (
        <figcaption className="xsmall muted chart__legend">
          <span><i style={{ background: INK }} /> this candidate</span>
          <span><i style={{ background: OTHER }} /> group average</span>
        </figcaption>
      )}
      {tip.node}
    </figure>
  );
}

/** Completed candidates ranked by overall score. */
export function RankingBars({ ranking, onPick }: { ranking: CohortSummary["ranking"]; onPick?: (id: string) => void }) {
  const tip = useTip();
  if (!ranking.length) return <p className="small muted">Rankings appear once candidates finish.</p>;
  return (
    <figure className="cchart">
      <ul className="list-reset cchart__rows">
        {ranking.slice(0, 12).map((r, i) => (
          <li
            key={r.id}
            className={onPick ? "is-clickable" : undefined}
            onClick={() => onPick?.(r.id)}
            onMouseMove={(e) => tip.show(e, <><strong>#{i + 1} {r.name}</strong><br />{r.score}/100 · {r.band}</>)}
            onMouseLeave={tip.hide}
          >
            <span className="small">
              <span className="mono muted">{i + 1}.</span> {r.name}
            </span>
            <span className="cchart__track">
              <span style={{ width: `${Math.max(2, r.score)}%`, background: INK }} />
            </span>
            <span className="xsmall cchart__val">
              <span className="mono">{r.score}</span> <BandDot label={r.band} />
            </span>
          </li>
        ))}
      </ul>
      {tip.node}
    </figure>
  );
}
