// Small, dependency-free charts for the report and progress pages.
// One ink series per chart; status colour (ember) only ever appears with a text label.
import type { ConversationStats } from "../lib/types";

const INK = "var(--color-ink)";
const OTHER = "#b5b5b5";
const WARN = "var(--color-ember)";

/** Horizontal bars: one row per skill, value printed beside the bar. */
export function ScoreBars({
  items,
}: {
  items: { id: string; name: string; score: number | null; max: number }[];
}) {
  return (
    <ul className="list-reset chart-bars">
      {items.map((it) => (
        <li key={it.id} title={it.score === null ? `${it.name}: not enough evidence` : `${it.name}: ${it.score} of ${it.max}`}>
          <span className="small">{it.name}</span>
          <span className="chart-bars__track" aria-hidden="true">
            {it.score !== null && (
              <span style={{ width: `${Math.max(4, (it.score / it.max) * 100)}%`, background: INK }} />
            )}
          </span>
          <span className="mono xsmall">{it.score === null ? "no evidence" : `${it.score}/${it.max}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Words per learner turn, with the natural spoken range shaded and the "too long" line. */
export function TurnLengths({ stats, names }: { stats: ConversationStats; names: Map<string, string> }) {
  const turns = stats.turns;
  if (turns.length === 0) return <p className="small muted">No conversation turns this session.</p>;
  const W = 640;
  const H = 200;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const maxY = Math.max(stats.long_turn_words + 10, ...turns.map((t) => t.words));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / maxY);
  const slot = (W - pad.l - pad.r) / turns.length;
  const barW = Math.max(3, Math.min(28, slot - 2));
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Words per message: average ${stats.avg_words}, ${stats.long_turns} over ${stats.long_turn_words} words`}>
        <rect x={pad.l} y={y(25)} width={W - pad.l - pad.r} height={y(5) - y(25)} fill="var(--color-mist)" />
        <text x={W - pad.r - 4} y={y(25) + 12} textAnchor="end" className="chart__note">natural range 5–25</text>
        <line x1={pad.l} x2={W - pad.r} y1={y(stats.long_turn_words)} y2={y(stats.long_turn_words)} stroke={WARN} strokeDasharray="4 4" strokeWidth={1.5} />
        <text x={pad.l + 4} y={y(stats.long_turn_words) - 4} className="chart__note">too long ({stats.long_turn_words}+)</text>
        {[0, Math.round(maxY / 2), maxY].map((v) => (
          <text key={v} x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart__axis">{v}</text>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--color-hairline)" />
        {turns.map((t, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          const top = y(t.words);
          return (
            <a key={t.message_id} href={`#msg-${t.message_id}`}>
              <title>{`Message ${i + 1} to ${names.get(t.character_id ?? "") ?? "colleague"}: ${t.words} words${t.question ? " · asked a question" : ""}${t.long ? " · too long" : ""}`}</title>
              <rect x={x - 2} y={pad.t} width={barW + 4} height={H - pad.t - pad.b} fill="transparent" />
              <path
                d={`M${x},${y(0)} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + barW - 4} Q${x + barW},${top} ${x + barW},${top + 4} V${y(0)} Z`}
                fill={t.long ? WARN : INK}
              />
              {t.question && <circle cx={x + barW / 2} cy={top - 7} r={3.5} fill="none" stroke={INK} strokeWidth={1.5} />}
            </a>
          );
        })}
      </svg>
      <figcaption className="xsmall muted chart__legend">
        <span><i style={{ background: INK }} /> your message</span>
        <span><i style={{ background: WARN }} /> over {stats.long_turn_words} words</span>
        <span><i className="chart__ring" /> asked a question</span>
        <span>Click a bar to jump to it in the transcript.</span>
      </figcaption>
    </figure>
  );
}

/** Who did the talking with each colleague: your words vs theirs. */
export function TalkBalance({ people }: { people: ConversationStats["people"] }) {
  if (people.length === 0) return <p className="small muted">You didn&apos;t talk to anyone this time.</p>;
  return (
    <figure className="chart">
      <ul className="list-reset chart-bars">
        {people.map((p) => {
          const total = Math.max(1, p.learner_words + p.npc_words);
          return (
            <li key={p.character_id} title={`${p.name}: you ${p.learner_words} words in ${p.learner_turns} turns, them ${p.npc_words} words`}>
              <span className="small">{p.name}</span>
              <span className="chart-bars__track chart-bars__track--split" aria-hidden="true">
                <span style={{ width: `${(p.learner_words / total) * 100}%`, background: INK }} />
                <span style={{ width: `${(p.npc_words / total) * 100}%`, background: OTHER }} />
              </span>
              <span className="mono xsmall">{Math.round((p.learner_words / total) * 100)}% you</span>
            </li>
          );
        })}
      </ul>
      <figcaption className="xsmall muted chart__legend">
        <span><i style={{ background: INK }} /> your words</span>
        <span><i style={{ background: OTHER }} /> their words</span>
        <span>Good conversations are roughly balanced — you ask, they answer.</span>
      </figcaption>
    </figure>
  );
}

/** Overall score per attempt, oldest → newest. */
export function ScoreLine({ points }: { points: { label: string; score: number }[] }) {
  if (points.length < 2) return <p className="small muted">Complete two attempts to see your score trend.</p>;
  const W = 640;
  const H = 180;
  const pad = { l: 34, r: 16, t: 14, b: 24 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  const last = points[points.length - 1]!;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score trend over ${points.length} attempts, latest ${last.score}`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-mist)" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart__axis">{v}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <title>{`${p.label}: ${p.score}`}</title>
            <circle cx={x(i)} cy={y(p.score)} r={12} fill="transparent" />
            <circle cx={x(i)} cy={y(p.score)} r={4.5} fill={INK} stroke="var(--color-paper)" strokeWidth={2} />
          </g>
        ))}
        <text x={x(points.length - 1)} y={y(last.score) - 10} textAnchor="end" className="chart__note">{last.score}</text>
      </svg>
    </figure>
  );
}

/** Share of requests failing, as a ring. */
export function ImpactRing({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <figure className="chart chart--ring">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${v}% of requests failing`}>
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--color-mist)" strokeWidth={14} />
        <circle
          className="chart__ring-fill"
          cx={70}
          cy={70}
          r={r}
          fill="none"
          stroke={WARN}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ ["--ring-off" as string]: c * (1 - v / 100), ["--ring-c" as string]: c }}
          transform="rotate(-90 70 70)"
        />
        <text x={70} y={68} textAnchor="middle" className="chart__big">{v}%</text>
        <text x={70} y={90} textAnchor="middle" className="chart__axis">failing</text>
      </svg>
    </figure>
  );
}

/** Error rate before and after the deploy: flat at zero, then a step to the impact level. */
export function DeployTimeline({ minutesAgo, pct }: { minutesAgo: number; pct: number }) {
  const W = 420;
  const H = 150;
  const pad = { l: 34, r: 14, t: 16, b: 28 };
  const span = Math.max(minutesAgo * 2, 10); // equal time before and after the deploy
  const x = (min: number) => pad.l + ((span - min) / span) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  const top = Math.max(pct, 1);
  const d = `M${x(span)},${y(0)} L${x(minutesAgo)},${y(0)} L${x(minutesAgo)},${y(top)} L${x(0)},${y(top)}`;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Errors jumped to ${pct}% when the deploy went out ${minutesAgo} minutes ago`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-mist)" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="chart__axis">{v}%</text>
          </g>
        ))}
        <line x1={x(minutesAgo)} x2={x(minutesAgo)} y1={pad.t} y2={H - pad.b} stroke={INK} strokeDasharray="3 4" />
        <text x={x(minutesAgo)} y={H - 8} textAnchor="middle" className="chart__note">deploy · {minutesAgo}m ago</text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="chart__axis">now</text>
        <path className="chart__draw" d={d} pathLength={1} fill="none" stroke={WARN} strokeWidth={3} strokeLinejoin="round" />
        <circle cx={x(0)} cy={y(top)} r={5} fill={WARN} className="chart__pulse" />
        <circle cx={x(0)} cy={y(top)} r={5} fill={WARN} />
      </svg>
    </figure>
  );
}

const LEVELS = ["low", "medium", "high", "critical"];

/** Severity as a four-step meter with the current level labelled. */
export function SeverityMeter({ level }: { level: string }) {
  const at = LEVELS.indexOf(level.toLowerCase());
  return (
    <figure className="chart">
      <div className="sev-meter" role="img" aria-label={`Severity ${level}`}>
        {LEVELS.map((l, i) => (
          <span key={l} className={i <= at ? "is-on" : ""} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <figcaption className="chart__legend">
        {LEVELS.map((l, i) => (
          <span key={l} className={`mono${i === at ? "" : " muted"}`}>{l}</span>
        ))}
      </figcaption>
    </figure>
  );
}
