// iMocha brand: colours from docs/iMocha.md and a pixel-art logo shared by the office (Phaser
// textures) and the app (SVG). Art is a grid of chars: "o" orange mark, "p" purple wordmark.

export const IM = {
  orange: "#FD5B0E",
  orangeLight: "#FF7F42",
  violet: "#491AEB",
  lavender: "#A77BFF",
  purple: "#220032",
  ink: "#1E1925",
} as const;

/** The ring: four quarter arcs with gaps at the cardinal points, a dot cutting into the top-right arc. */
function mark(): string[] {
  const n = 20;
  const c = 9.5;
  const [rin, rout] = [6, 9.3];
  const mid = (rin + rout) / 2;
  const dot = { x: c + mid * Math.SQRT1_2, y: c - mid * Math.SQRT1_2, r: 2.7 };
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const dd = Math.hypot(x - dot.x, y - dot.y);
      const ring = d >= rin && d <= rout && Math.abs(dx) > 1 && Math.abs(dy) > 1;
      if (dd <= dot.r) row += "o";
      else if (dd <= dot.r + 1) row += "."; // the cut around the dot
      else row += ring ? "o" : ".";
    }
    rows.push(row);
  }
  return rows;
}

// 7-row bitmap glyphs, 2 px strokes so the wordmark reads heavy like the real one.
const GLYPHS: Record<string, string[]> = {
  i: ["##", "..", "##", "##", "##", "##", "##"],
  M: ["##...##", "###.###", "#######", "##.#.##", "##...##", "##...##", "##...##"],
  o: [".....", ".....", ".###.", "##.##", "##.##", "##.##", ".###."],
  c: ["....", "....", ".###", "##..", "##..", "##..", ".###"],
  h: ["##...", "##...", "####.", "##.##", "##.##", "##.##", "##.##"],
  a: [".....", ".....", ".###.", "...##", ".####", "##.##", ".####"],
  H: ["##.##", "##.##", "##.##", "#####", "##.##", "##.##", "##.##"],
  u: [".....", ".....", "##.##", "##.##", "##.##", "##.##", ".####"],
  b: ["##...", "##...", "####.", "##.##", "##.##", "##.##", "####."],
};

/** Wordmark rows; each glyph pixel becomes a scale×scale block. */
export function word(text: string, scale: number): string[] {
  const rows = Array.from({ length: 7 }, () => "");
  [...text].forEach((ch, i) => {
    GLYPHS[ch]!.forEach((r, y) => (rows[y] += (i ? "." : "") + r.replaceAll("#", "p")));
  });
  return rows.flatMap((r) => Array<string>(scale).fill([...r].map((ch) => ch.repeat(scale)).join("")));
}

export const MARK = mark();
export const WORDMARK = word("iMocha", 2);

/** Mark + wordmark side by side, wordmark vertically centred on the mark. */
export function lockup(): string[] {
  const top = Math.floor((MARK.length - WORDMARK.length) / 2);
  return MARK.map((r, y) => r + "....." + (WORDMARK[y - top] ?? ".".repeat(WORDMARK[0]!.length)));
}

/** Half-size mark (every other pixel) for small signs and badges. */
export const MARK_SMALL = MARK.filter((_, i) => i % 2 === 0).map((r) => [...r].filter((_, i) => i % 2 === 0).join(""));

export const PIXEL_COLORS: Record<string, string> = { o: IM.orange, p: IM.purple };
export const BOARD_COLORS: Record<string, string> = { w: "#ffffff", k: "#2b2232", O: IM.orange, v: IM.violet, s: "#b9b3c4" };
export const KIOSK_COLORS: Record<string, string> = { n: "#2a1840", g: "#30a81d", m: "#4a4458" };

/** Roll-up standee: violet header, mark, orange/violet stripes, a two-foot stand. */
export const STANDEE: string[] = (() => {
  const W = 26;
  const pad = (r: string) => {
    const l = Math.floor((W - r.length) / 2);
    return "w".repeat(l) + r.replaceAll(".", "w") + "w".repeat(W - r.length - l);
  };
  const fill = (n: number, c: string) => Array<string>(n).fill(`k${c.repeat(W)}k`);
  return [
    "k".repeat(W + 2),
    ...fill(3, "v"),
    ...fill(3, "w"),
    ...MARK.map((r) => `k${pad(r)}k`),
    ...fill(4, "w"),
    ...fill(3, "O"),
    ...fill(3, "v"),
    "k".repeat(W + 2),
    ...Array<string>(4).fill(`${".".repeat(5)}kk${".".repeat(W - 12)}kk${".".repeat(5)}`),
    `${".".repeat(3)}${"s".repeat(W - 4)}${".".repeat(3)}`,
  ];
})();

/** Pixel monitor kiosk (the iMocha Hub screen): bezel, branded screen, stand and foot. */
export const MONITOR: string[] = (() => {
  const SW = 40;
  const screen = Array.from({ length: 20 }, (_, y) => {
    const band = y < 3 ? "v" : y > 16 ? "O" : "n";
    const art = MARK_SMALL[y - 4];
    const row = band.repeat(SW);
    if (!art) return row;
    const l = Math.floor((SW - art.length) / 2);
    return row.slice(0, l) + [...art].map((ch) => (ch === "o" ? "o" : band)).join("") + row.slice(l + art.length);
  });
  return [
    "k".repeat(SW + 4),
    ...screen.map((r) => `kk${r}kk`),
    "k".repeat(SW + 4),
    `${"k".repeat(SW / 2)}gg${"k".repeat(SW / 2 + 2)}`,
    ...Array<string>(6).fill(`${".".repeat(SW / 2 - 1)}kmmk${".".repeat(SW / 2 - 1)}`),
    `${".".repeat(8)}${"k".repeat(SW - 12)}${".".repeat(8)}`,
    `${".".repeat(8)}${"s".repeat(SW - 12)}${".".repeat(8)}`,
  ];
})();
