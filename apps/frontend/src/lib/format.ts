/**
 * Display formatting. Times are always shown in the hospital's timezone
 * (from `/auth/me`), not the browser's: an appointment at a hospital in
 * Asia/Kolkata is 09:00 whatever device the patient opens the portal on.
 */

const FALLBACK_TZ = "Asia/Kolkata";

export function formatDate(iso: string | null | undefined, timeZone = FALLBACK_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}

export function formatTime(iso: string, timeZone = FALLBACK_TZ): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: true }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string | null | undefined, timeZone = FALLBACK_TZ): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** A YYYY-MM-DD calendar date (no timezone involved), e.g. "Thu, 4 Mar". */
export function formatDateKey(key: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...options,
  }).format(new Date(`${key}T00:00:00.000Z`));
}

/** A DATE column value (UTC midnight) shown as its calendar date. */
export function formatCalendarDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDateKey(iso.slice(0, 10), { weekday: undefined, year: "numeric" });
}

/** Today's date in `timeZone`, as YYYY-MM-DD. */
export function todayKey(timeZone = FALLBACK_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(key: string, days: number): string {
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Money arrives as a decimal string ("1250.00"). */
export function formatMoney(amount: string | number, currency = "INR"): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}

export function personName(person: { firstName: string; lastName: string } | null | undefined): string {
  return person ? `${person.firstName} ${person.lastName}` : "—";
}

export function doctorName(user: { firstName: string; lastName: string } | null | undefined): string {
  return user ? `Dr. ${user.firstName} ${user.lastName}` : "Your doctor";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
