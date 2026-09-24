import { describe, expect, it } from "vitest";
import { UserRole } from "@medcore/types";
import { canOpen, navFor } from "./staff-nav";
import { ROUTES } from "@/constants";
import { toQuery } from "@/services/staff";

describe("staff navigation mirrors the RBAC matrix", () => {
  it("gives each role only its own destinations", () => {
    const labels = (role: UserRole) => navFor(role).map((i) => i.label);
    expect(labels(UserRole.PHARMACIST)).toEqual(["Overview", "Dispensing queue", "Medicines", "Stock alerts"]);
    expect(labels(UserRole.LAB_TECHNICIAN)).toEqual(["Overview", "Lab queue"]);
    expect(labels(UserRole.SUPER_ADMIN)).toEqual(["Overview", "Hospitals", "Audit log"]);
    expect(labels(UserRole.DOCTOR)).toContain("My practice");
    expect(canOpen(UserRole.HOSPITAL_ADMIN, ROUTES.hospitals)).toBe(false);
    expect(canOpen(UserRole.NURSE, ROUTES.practice)).toBe(false);
  });

  it("lets pages refuse a hand-typed URL outside the role's workspace", () => {
    expect(canOpen(UserRole.ACCOUNTANT, ROUTES.paymentList)).toBe(true);
    expect(canOpen(UserRole.RECEPTIONIST, ROUTES.paymentList)).toBe(false);
    expect(canOpen(UserRole.PHARMACIST, ROUTES.invoiceQueue)).toBe(false);
    expect(canOpen(UserRole.NURSE, ROUTES.beds)).toBe(true);
    expect(canOpen(UserRole.DOCTOR, ROUTES.auditLog)).toBe(false);
  });

  it("opens workflow screens only to the roles whose API calls they make", () => {
    expect(canOpen(UserRole.RECEPTIONIST, "/dashboard/patients/new")).toBe(true);
    expect(canOpen(UserRole.NURSE, "/dashboard/patients/new")).toBe(false);
    expect(canOpen(UserRole.DOCTOR, "/dashboard/encounters/:id")).toBe(true);
    expect(canOpen(UserRole.RECEPTIONIST, "/dashboard/encounters/:id")).toBe(false);
    expect(canOpen(UserRole.LAB_TECHNICIAN, "/dashboard/lab-orders/:id")).toBe(true);
    expect(canOpen(UserRole.PHARMACIST, "/dashboard/lab-orders/:id")).toBe(false);
    expect(canOpen(UserRole.PHARMACIST, "/dashboard/prescriptions/:id")).toBe(true);
    expect(canOpen(UserRole.ACCOUNTANT, "/dashboard/invoices/:id")).toBe(true);
    expect(canOpen(UserRole.DOCTOR, "/dashboard/invoices/:id")).toBe(false);
    expect(canOpen(UserRole.HOSPITAL_ADMIN, ROUTES.staffDirectory)).toBe(true);
    expect(canOpen(UserRole.RECEPTIONIST, ROUTES.staffDirectory)).toBe(false);
    expect(canOpen(UserRole.PATIENT, "/dashboard/appointments/:id")).toBe(false);
  });

  it("never shows a patient any staff destination beyond the overview", () => {
    expect(navFor(UserRole.PATIENT).map((i) => i.href)).toEqual([ROUTES.dashboard]);
  });
});

describe("toQuery", () => {
  it("joins status lists with commas and drops empty filters", () => {
    expect(toQuery({ status: ["FINALIZED", "PARTIALLY_PAID"], doctorId: undefined, method: [] })).toEqual({
      status: "FINALIZED,PARTIALLY_PAID",
      doctorId: undefined,
      method: undefined,
    });
  });
});
