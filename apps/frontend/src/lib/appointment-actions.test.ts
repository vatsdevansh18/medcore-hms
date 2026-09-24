import { describe, expect, it } from "vitest";
import { AppointmentStatus, UserRole } from "@medcore/types";
import { actionTarget, appointmentActions, canBill, canOpenEncounter } from "./appointment-actions";

describe("appointmentActions mirrors the API state machine", () => {
  it("lets the front desk confirm, cancel, and mark a no-show, never start a visit", () => {
    expect(appointmentActions(UserRole.RECEPTIONIST, AppointmentStatus.PENDING)).toEqual(["CONFIRM", "CANCEL"]);
    expect(appointmentActions(UserRole.RECEPTIONIST, AppointmentStatus.CONFIRMED)).toEqual(["NO_SHOW", "CANCEL"]);
    expect(appointmentActions(UserRole.RECEPTIONIST, AppointmentStatus.IN_PROGRESS)).toEqual([]);
  });

  it("limits a nurse to check-in and a doctor to their clinical moves", () => {
    expect(appointmentActions(UserRole.NURSE, AppointmentStatus.CONFIRMED)).toEqual(["CHECK_IN"]);
    expect(appointmentActions(UserRole.NURSE, AppointmentStatus.PENDING)).toEqual([]);
    expect(appointmentActions(UserRole.DOCTOR, AppointmentStatus.CONFIRMED)).toEqual(["CHECK_IN", "NO_SHOW"]);
    expect(appointmentActions(UserRole.DOCTOR, AppointmentStatus.CONFIRMED)).not.toContain("CANCEL");
  });

  it("offers nothing on a finished visit or to roles outside the matrix", () => {
    for (const status of [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW]) {
      expect(appointmentActions(UserRole.HOSPITAL_ADMIN, status)).toEqual([]);
    }
    expect(appointmentActions(UserRole.PHARMACIST, AppointmentStatus.PENDING)).toEqual([]);
    expect(appointmentActions(UserRole.PATIENT, AppointmentStatus.PENDING)).toEqual([]);
  });

  it("maps each action to the status the API expects", () => {
    expect(actionTarget("CHECK_IN")).toBe("IN_PROGRESS");
    expect(actionTarget("CANCEL")).toBe("CANCELLED");
  });

  it("opens the encounter to clinicians once a visit has started, and bills only live visits", () => {
    expect(canOpenEncounter(UserRole.DOCTOR, AppointmentStatus.IN_PROGRESS)).toBe(true);
    expect(canOpenEncounter(UserRole.NURSE, AppointmentStatus.COMPLETED)).toBe(true);
    expect(canOpenEncounter(UserRole.DOCTOR, AppointmentStatus.CONFIRMED)).toBe(false);
    expect(canOpenEncounter(UserRole.RECEPTIONIST, AppointmentStatus.IN_PROGRESS)).toBe(false);
    expect(canBill(UserRole.RECEPTIONIST, AppointmentStatus.COMPLETED)).toBe(true);
    expect(canBill(UserRole.RECEPTIONIST, AppointmentStatus.CANCELLED)).toBe(false);
    expect(canBill(UserRole.DOCTOR, AppointmentStatus.COMPLETED)).toBe(false);
  });
});
