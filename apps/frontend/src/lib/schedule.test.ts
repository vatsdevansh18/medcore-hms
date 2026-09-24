import { describe, expect, it } from "vitest";
import { hoursProblems, toSlots, type HoursRow } from "./schedule";

const row = (key: string, dayOfWeek: number, startTime: string, endTime: string, slotDurationMinutes = "30"): HoursRow => ({
  key,
  dayOfWeek,
  startTime,
  endTime,
  slotDurationMinutes,
});

describe("weekly hours rules mirror the API", () => {
  it("accepts separate and touching windows", () => {
    expect(hoursProblems([row("a", 1, "09:00", "12:00"), row("b", 1, "12:00", "15:00"), row("c", 2, "09:00", "12:00")])).toEqual({});
  });

  it("flags overlapping windows on the same day only", () => {
    expect(hoursProblems([row("a", 1, "09:00", "12:00"), row("b", 1, "11:00", "13:00")])).toEqual({ b: "Overlaps 09:00–12:00 on Monday." });
    expect(hoursProblems([row("a", 1, "09:00", "12:00"), row("b", 2, "11:00", "13:00")])).toEqual({});
  });

  it("flags missing times, reversed times, and slot lengths outside 5–240", () => {
    expect(hoursProblems([row("a", 1, "", "12:00")]).a).toBe("Enter both times.");
    expect(hoursProblems([row("a", 1, "12:00", "09:00")]).a).toBe("The end must be after the start.");
    expect(hoursProblems([row("a", 1, "09:00", "12:00", "4")]).a).toBe("Appointments last 5 to 240 minutes.");
    expect(hoursProblems([row("a", 1, "09:00", "12:00", "241")]).a).toBe("Appointments last 5 to 240 minutes.");
  });

  it("sends slots ordered by day and time with numeric durations", () => {
    expect(toSlots([row("b", 3, "14:00", "16:00", "15"), row("a", 1, "09:00", "12:00")])).toEqual([
      { dayOfWeek: 1, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 30 },
      { dayOfWeek: 3, startTime: "14:00", endTime: "16:00", slotDurationMinutes: 15 },
    ]);
  });
});
