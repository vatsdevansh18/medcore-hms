/** One editable weekly window: a weekday and wall-clock times in the
 * hospital's timezone. `key` is only for React lists. */
export interface HoursRow {
  key: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: string;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Problems with the weekly hours, keyed by row, mirroring the API
 * (`SetAvailabilityDto` and `AvailabilityService.setAvailability`): times
 * HH:mm with start before end, a 5–240 minute slot, and windows on the same
 * day that may touch but not overlap.
 */
export function hoursProblems(rows: HoursRow[]): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const row of rows) {
    const minutes = Number(row.slotDurationMinutes);
    if (!TIME.test(row.startTime) || !TIME.test(row.endTime)) problems[row.key] = "Enter both times.";
    else if (row.startTime >= row.endTime) problems[row.key] = "The end must be after the start.";
    else if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) problems[row.key] = "Appointments last 5 to 240 minutes.";
  }
  const sorted = rows.filter((r) => !problems[r.key]).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.dayOfWeek === cur.dayOfWeek && cur.startTime < prev.endTime) {
      problems[cur.key] = `Overlaps ${prev.startTime}–${prev.endTime} on ${WEEKDAYS[cur.dayOfWeek]}.`;
    }
  }
  return problems;
}

/** Rows to the `PUT /doctors/:id/availability` body, ordered by day and time. */
export function toSlots(rows: HoursRow[]) {
  return [...rows]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, slotDurationMinutes: Number(r.slotDurationMinutes) }));
}
