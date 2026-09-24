/**
 * Wall-clock ↔ instant conversion for a hospital's timezone, with `Intl`
 * only. The same algorithm as the API's `src/common/time/zoned-time.ts`
 * (docs/11-DECISIONS.md D-037); the dashboards need it to ask for "today's"
 * appointments as UTC instants.
 */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the clock in `timeZone` reads `hhmm` on `dateKey`. */
export function zonedWallTimeToUtc(dateKey: string, hhmm: string, timeZone: string): Date {
  const naive = new Date(`${dateKey}T${hhmm}:00.000Z`).getTime();
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** [start, end) of a calendar day in `timeZone`, as ISO instants. */
export function dayBounds(dateKey: string, timeZone: string): { from: string; to: string } {
  const start = zonedWallTimeToUtc(dateKey, "00:00", timeZone);
  const nextKey = new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const end = zonedWallTimeToUtc(nextKey, "00:00", timeZone);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}
