/**
 * `MedicineBatch.expiryDate`/`manufacturingDate` are Postgres `DATE`
 * columns — calendar dates with no time or zone. Prisma materialises them as
 * a JS `Date` at UTC midnight of that calendar day, so every comparison here
 * is done against the same representation: "today" as a UTC-midnight `Date`.
 *
 * "Today" is the hospital's own local calendar date (`Hospital.timezone`),
 * not the server's UTC date — a batch labelled "expires 2026-09-24" in an
 * Asia/Kolkata hospital is still usable at 02:00 IST on the 24th, when the
 * UTC date would already say otherwise in the opposite direction for a
 * western timezone. An expiry date is inclusive: the batch is usable through
 * the end of that day and expired from the next (docs/11-DECISIONS.md D-023).
 */
export function hospitalToday(timezone: string, now: Date = new Date()): Date {
  // `en-CA` formats as YYYY-MM-DD, which `Date.parse` treats as UTC midnight.
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${localDate}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** YYYY-MM-DD of a UTC-midnight date — used as the date-scoped idempotency key. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses a strict `YYYY-MM-DD` DTO string to its UTC-midnight `Date`. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
