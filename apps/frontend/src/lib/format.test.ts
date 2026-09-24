import { describe, expect, it } from "vitest";
import { addDays, formatMoney, formatTime, todayKey } from "./format";

describe("format", () => {
  it("shows times in the hospital's timezone, not the browser's", () => {
    // 03:30Z is 09:00 in Asia/Kolkata and 22:30 the previous day in New York.
    expect(formatTime("2027-03-04T03:30:00.000Z", "Asia/Kolkata")).toMatch(/^0?9:00\s?am$/i);
    expect(formatTime("2027-03-04T03:30:00.000Z", "America/New_York")).toMatch(/^10:30\s?pm$/i);
  });

  it("computes today's date in the hospital's timezone", () => {
    const lateUtc = new Date("2027-03-04T20:00:00.000Z"); // already the 5th in India
    expect(todayKey("Asia/Kolkata", lateUtc)).toBe("2027-03-05");
    expect(todayKey("UTC", lateUtc)).toBe("2027-03-04");
  });

  it("adds calendar days across a month boundary", () => {
    expect(addDays("2027-02-27", 3)).toBe("2027-03-02");
  });

  it("formats decimal-string money as rupees", () => {
    expect(formatMoney("1250.50")).toMatch(/₹\s?1,250\.50/);
  });
});
