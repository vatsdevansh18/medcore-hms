import { describe, expect, it } from "vitest";
import { AppointmentStatus, AppointmentType, type AppointmentView, type HospitalSummary } from "@medcore/types";
import { canCancel, canReschedule } from "./appointment-rules";

const NOW = Date.parse("2027-03-01T00:00:00.000Z");
const hospital: HospitalSummary = {
  id: "h1",
  name: "City",
  timezone: "Asia/Kolkata",
  patientRescheduleAllowed: true,
  patientRescheduleCutoffHours: 24,
};

function appt(overrides: Partial<AppointmentView> = {}): AppointmentView {
  return {
    id: "a1",
    hospitalId: "h1",
    patientId: "p1",
    doctorId: "d1",
    departmentId: "dep1",
    scheduledStart: "2027-03-05T03:30:00.000Z",
    scheduledEnd: "2027-03-05T04:00:00.000Z",
    status: AppointmentStatus.CONFIRMED,
    type: AppointmentType.REGULAR,
    reasonForVisit: null,
    cancelledReason: null,
    createdAt: "2027-02-01T00:00:00.000Z",
    doctor: { id: "d1", specialization: "GP", user: { id: "u", firstName: "A", lastName: "B" } },
    patient: { id: "p1", user: null },
    ...overrides,
  };
}

describe("canReschedule (mirrors D-035)", () => {
  it("allows a PENDING or CONFIRMED visit outside the cutoff", () => {
    expect(canReschedule(appt(), hospital, NOW)).toEqual({ allowed: true });
    expect(canReschedule(appt({ status: AppointmentStatus.PENDING }), hospital, NOW).allowed).toBe(true);
  });

  it("hides the action without explanation for finished or cancelled visits", () => {
    for (const status of [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW, AppointmentStatus.IN_PROGRESS]) {
      expect(canReschedule(appt({ status }), hospital, NOW)).toEqual({ allowed: false, reason: null });
    }
  });

  it("explains the emergency, policy, and cutoff refusals", () => {
    expect(canReschedule(appt({ type: AppointmentType.EMERGENCY }), hospital, NOW)).toMatchObject({ allowed: false });
    expect(canReschedule(appt(), { ...hospital, patientRescheduleAllowed: false }, NOW).allowed).toBe(false);
    const inside = canReschedule(appt({ scheduledStart: "2027-03-01T20:00:00.000Z" }), hospital, NOW);
    expect(inside).toMatchObject({ allowed: false });
    expect(inside.allowed === false && inside.reason).toMatch(/24 hours/);
  });

  it("treats a zero cutoff as 'any time before it starts'", () => {
    const soon = appt({ scheduledStart: "2027-03-01T01:00:00.000Z" });
    expect(canReschedule(soon, { ...hospital, patientRescheduleCutoffHours: 0 }, NOW).allowed).toBe(true);
  });
});

describe("canCancel", () => {
  it("lets a patient cancel only a PENDING request (RBAC §3.3)", () => {
    expect(canCancel(appt({ status: AppointmentStatus.PENDING }))).toBe(true);
    expect(canCancel(appt({ status: AppointmentStatus.CONFIRMED }))).toBe(false);
  });
});
