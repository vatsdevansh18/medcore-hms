import { describe, expect, it } from "vitest";
import { UserRole } from "@medcore/types";
import { canOpen, navFor } from "./staff-nav";
import { ROUTES } from "@/constants";
import { toQuery } from "@/services/staff";

describe("staff navigation mirrors the RBAC matrix", () => {
  it("gives each role only its own destinations", () => {
    const labels = (role: UserRole) => navFor(role).map((i) => i.label);
    expect(labels(UserRole.PHARMACIST)).toEqual(["Overview", "Dispensing queue", "Inventory"]);
    expect(labels(UserRole.LAB_TECHNICIAN)).toEqual(["Overview", "Lab queue"]);
    expect(labels(UserRole.SUPER_ADMIN)).toEqual(["Overview", "Audit log"]);
  });

  it("lets pages refuse a hand-typed URL outside the role's workspace", () => {
    expect(canOpen(UserRole.ACCOUNTANT, ROUTES.paymentList)).toBe(true);
    expect(canOpen(UserRole.RECEPTIONIST, ROUTES.paymentList)).toBe(false);
    expect(canOpen(UserRole.PHARMACIST, ROUTES.invoiceQueue)).toBe(false);
    expect(canOpen(UserRole.NURSE, ROUTES.beds)).toBe(true);
    expect(canOpen(UserRole.DOCTOR, ROUTES.auditLog)).toBe(false);
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
