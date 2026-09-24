/**
 * Wall-clock <-> instant conversion for a hospital's IANA timezone, using only
 * `Intl` (no date library). Doctor schedules are stored as local wall-clock
 * times ("09:00") and appointments as UTC instants, so every conversion
 * between the two goes through here (docs/11-DECISIONS.md D-037).
 */

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (IST = +5h30m). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads `hhmm` on the
 * calendar date `dateKey` (YYYY-MM-DD). Two passes settle the offset when a
 * DST change falls between the naive guess and the answer. A wall-clock time
 * skipped by a spring-forward gap resolves to the instant just after it.
 */
export function zonedWallTimeToUtc(dateKey: string, hhmm: string, timeZone: string): Date {
  const naive = new Date(`${dateKey}T${hhmm}:00.000Z`).getTime();
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The calendar date (YYYY-MM-DD) that `instant` falls on in `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Day of week (0 = Sunday) of a calendar date. A date's weekday doesn't
 * depend on any timezone. */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

/** The calendar date `days` after `dateKey`. */
export function addDaysToKey(dateKey: string, days: number): string {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
