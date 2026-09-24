import { describe, expect, it } from "vitest";
import type { AppointmentTrend, RevenueTrend } from "@medcore/types";
import { appointmentSeries, monthGrid, monthRange, occupancyPercent, revenueSeries } from "./chart-data";
import { dayBounds, zonedWallTimeToUtc } from "./zoned-time";

describe("chart data", () => {
  it("fills every status for every day so stacked bars line up", () => {
    const trend: AppointmentTrend = {
      scope: "HOSPITAL",
      from: "2026-03-02",
      to: "2026-03-03",
      timezone: "Asia/Kolkata",
      days: [
        { date: "2026-03-02", total: 3, byStatus: { COMPLETED: 2, CANCELLED: 1 } },
        { date: "2026-03-03", total: 0, byStatus: {} },
      ],
    };
    const series = appointmentSeries(trend);
    expect(series[0]).toMatchObject({ date: "2026-03-02", total: 3, COMPLETED: 2, CANCELLED: 1, PENDING: 0, NO_SHOW: 0 });
    expect(series[1]).toMatchObject({ total: 0, COMPLETED: 0 });
  });

  it("turns decimal-string money into numbers for plotting", () => {
    const trend = {
      days: [{ date: "2026-03-02", collected: "1250.50", invoiced: "2000.00", byMethod: {} }],
    } as unknown as RevenueTrend;
    expect(revenueSeries(trend)[0]).toMatchObject({ collected: 1250.5, invoiced: 2000 });
  });

  it("lays a month out in Monday-first weeks with padding", () => {
    // September 2026 starts on a Tuesday and has 30 days.
    const weeks = monthGrid(2026, 9, new Map([["2026-09-24", 4]]));
    expect(weeks[0][0]).toEqual({ date: null, count: 0 });
    expect(weeks[0][1]).toEqual({ date: "2026-09-01", count: 0 });
    expect(weeks.flat().find((c) => c.date === "2026-09-24")?.count).toBe(4);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((c) => c.date).length).toBe(30);
  });

  it("knows each month's last day, including leap Februaries", () => {
    expect(monthRange("2028-02-10")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-09-24")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", year: 2026, month: 9 });
  });

  it("computes occupancy without dividing by zero", () => {
    expect(occupancyPercent({ VACANT: 1, OCCUPIED: 3, MAINTENANCE: 0 })).toBe(75);
    expect(occupancyPercent({ VACANT: 0, OCCUPIED: 0, MAINTENANCE: 0 })).toBe(0);
  });
});

describe("zoned time (mirrors the API's D-037 helper)", () => {
  it("converts hospital wall-clock time to UTC", () => {
    expect(zonedWallTimeToUtc("2026-09-24", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-09-24T03:30:00.000Z");
    // New York is on daylight time in July (UTC-4) and standard time in January (UTC-5).
    expect(zonedWallTimeToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("gives a local day's bounds as UTC instants", () => {
    expect(dayBounds("2026-09-24", "Asia/Kolkata")).toEqual({
      from: "2026-09-23T18:30:00.000Z",
      to: "2026-09-24T18:29:59.999Z",
    });
  });
});
