// Deadlines: stored as absolute instants; shown in the viewer's time with the company's zone.

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Fri 31 Oct, 17:00" in `tz` (viewer's zone by default). */
export function formatWhen(iso: string, tz?: string | null, withYear = false): string {
  const d = new Date(iso);
  // The year is shown when asked, or when it isn't this year (so far-off dates aren't ambiguous).
  withYear = withYear || d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz || undefined,
  });
}

/** Short zone name for display, e.g. "GMT+5:30" or "PST". */
export function zoneAbbr(iso: string, tz?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, timeZoneName: "short" }).formatToParts(new Date(iso));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? (tz || "");
  } catch {
    return tz || "";
  }
}

/** "in 3 days", "in 5 h", "2 days ago". */
export function relative(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const h = abs / 3_600_000;
  const txt = h < 1 ? `${Math.max(1, Math.round(abs / 60_000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  return ms >= 0 ? `in ${txt}` : `${txt} ago`;
}

/** Urgency of a deadline for styling. */
export function urgency(iso: string | null, now = Date.now()): "none" | "past" | "soon" | "week" | "later" {
  if (!iso) return "none";
  const h = (new Date(iso).getTime() - now) / 3_600_000;
  return h < 0 ? "past" : h <= 48 ? "soon" : h <= 24 * 7 ? "week" : "later";
}

/** Convert a wall-clock time ("2026-10-31T17:00") in an IANA zone to an ISO instant. */
export function zonedToIso(local: string, tz: string): string {
  const [date, time = "00:00"] = local.split("T");
  const [y, mo, d] = date!.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hh!, mm!);
  // Offset of tz at that instant (applied twice to settle DST edges).
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t).toISOString();
}

/** The wall-clock value for <input type="datetime-local"> of an instant in a zone. */
export function isoToZoned(iso: string, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export const COMMON_ZONES = [
  "UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Sao_Paulo", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];
