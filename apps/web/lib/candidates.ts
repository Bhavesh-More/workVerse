// Candidate list parsing for invites (pure, so node --test can run it).

/** Parse pasted text or CSV into candidates. Accepts "Name <email>", "email, name", "name, email" or bare emails. */
export function parseCandidates(text: string): { email: string; name?: string }[] {
  const out: { email: string; name?: string }[] = [];
  const seen = new Set<string>();
  const emailRx = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/;
  const lines = text.split(/\r?\n/);
  // A CSV header row tells us which column is which.
  const header = lines[0]?.toLowerCase() ?? "";
  const hasHeader = /email/.test(header) && !emailRx.test(header);
  const cols = hasHeader ? splitCsv(header).map((c) => c.trim()) : [];
  const emailCol = cols.findIndex((c) => c.includes("email"));
  const nameCol = cols.findIndex((c) => c === "name" || c.includes("full name") || c === "candidate");
  const firstCol = cols.findIndex((c) => c.includes("first"));
  const lastCol = cols.findIndex((c) => c.includes("last"));
  for (const raw of hasHeader ? lines.slice(1) : lines) {
    const line = raw.trim();
    if (!line) continue;
    if (hasHeader && emailCol >= 0) {
      const cells = splitCsv(line);
      const email = cells[emailCol]?.trim().toLowerCase();
      const name =
        nameCol >= 0
          ? cells[nameCol]?.trim()
          : [firstCol >= 0 ? cells[firstCol] : "", lastCol >= 0 ? cells[lastCol] : ""].join(" ").trim();
      if (email && emailRx.test(email) && !seen.has(email)) {
        seen.add(email);
        out.push({ email, name: name || undefined });
      }
      continue;
    }
    // Free text: a line may hold several emails separated by commas/semicolons/spaces.
    const parts = line.split(/[;,](?![^<]*>)/);
    for (const part of parts) {
      const m = emailRx.exec(part);
      if (!m) continue;
      const email = m[0].toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      const name = part.replace(m[0], "").replace(/[<>"']/g, "").trim();
      out.push({ email, name: name || undefined });
    }
  }
  return out;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
