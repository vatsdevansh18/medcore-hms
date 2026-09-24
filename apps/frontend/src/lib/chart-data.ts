import type { AppointmentTrend, RevenueTrend } from "@medcore/types";
import { formatDateKey } from "./format";

/** Appointment statuses in the order they stack, bottom to top. */
export const STATUS_SERIES = ["COMPLETED", "IN_PROGRESS", "CONFIRMED", "PENDING", "NO_SHOW", "CANCELLED"] as const;

export type AppointmentPoint = { date: string; label: string; total: number } & Record<(typeof STATUS_SERIES)[number], number>;

/** One stacked bar per day; every status present (0 when absent). */
export function appointmentSeries(trend: AppointmentTrend): AppointmentPoint[] {
  return trend.days.map((day) => {
    const point = { date: day.date, label: formatDateKey(day.date, { month: undefined }), total: day.total } as AppointmentPoint;
    for (const status of STATUS_SERIES) point[status] = day.byStatus[status] ?? 0;
    return point;
  });
}

export interface RevenuePoint {
  date: string;
  label: string;
  collected: number;
  invoiced: number;
}

export function revenueSeries(trend: RevenueTrend): RevenuePoint[] {
  return trend.days.map((day) => ({
    date: day.date,
    label: formatDateKey(day.date, { weekday: undefined }),
    collected: Number(day.collected),
    invoiced: Number(day.invoiced),
  }));
}

export interface CalendarCell {
  /** YYYY-MM-DD, or null for padding before the 1st / after the last day. */
  date: string | null;
  count: number;
}

/**
 * A month as calendar weeks starting on Monday, for the doctor's mini
 * calendar. `counts` maps YYYY-MM-DD to a number of appointments.
 */
export function monthGrid(year: number, month: number, counts: Map<string, number>): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: CalendarCell[] = Array.from({ length: lead }, () => ({ date: null, count: 0 }));
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date, count: counts.get(date) ?? 0 });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, count: 0 });
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** First and last calendar date of the month containing `dateKey`. */
export function monthRange(dateKey: string): { from: string; to: string; year: number; month: number } {
  const [year, month] = dateKey.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}`, year, month };
}

/** Share of beds occupied, as a whole percentage (0 when there are none). */
export function occupancyPercent(counts: { VACANT: number; OCCUPIED: number; MAINTENANCE: number }): number {
  const total = counts.VACANT + counts.OCCUPIED + counts.MAINTENANCE;
  return total === 0 ? 0 : Math.round((counts.OCCUPIED / total) * 100);
}
