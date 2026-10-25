import { MARK, PIXEL_COLORS, lockup } from "../lib/imocha";

const LOCKUP = lockup();

/** The iMocha logo as crisp pixel art (same grid the office signs are drawn from). */
export function PixelLogo({
  variant = "lockup",
  height = 24,
  mono,
  title = "iMocha",
}: {
  variant?: "lockup" | "mark";
  height?: number;
  /** Draw every pixel in one colour (e.g. white on dark). */
  mono?: string;
  title?: string;
}) {
  const rows = variant === "mark" ? MARK : LOCKUP;
  const w = rows[0]!.length;
  const h = rows.length;
  return (
    <svg
      className="pixel-logo"
      viewBox={`0 0 ${w} ${h}`}
      height={height}
      width={(height * w) / h}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
    >
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          PIXEL_COLORS[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={mono ?? PIXEL_COLORS[ch]} /> : null,
        ),
      )}
    </svg>
  );
}
