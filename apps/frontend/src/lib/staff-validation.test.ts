import { describe, expect, it } from "vitest";
import {
  batchSchema,
  cashSchema,
  encounterSchema,
  icd10List,
  invoiceItemSchema,
  patientSchema,
  vitalsBody,
  vitalsSchema,
} from "./staff-validation";

const emptyVitals = { bpSystolic: "", bpDiastolic: "", pulse: "", temperatureC: "", spo2: "", heightCm: "", weightKg: "" };

describe("staff form rules mirror the API DTOs", () => {
  it("vitals: needs one reading, both BP numbers together, and the DTO's ranges", () => {
    expect(vitalsSchema.safeParse(emptyVitals).success).toBe(false);
    expect(vitalsSchema.safeParse({ ...emptyVitals, pulse: "72" }).success).toBe(true);
    expect(vitalsSchema.safeParse({ ...emptyVitals, bpSystolic: "120" }).success).toBe(false);
    expect(vitalsSchema.safeParse({ ...emptyVitals, spo2: "101" }).success).toBe(false);
    expect(vitalsSchema.safeParse({ ...emptyVitals, pulse: "72.5" }).success).toBe(false);
    expect(vitalsBody({ ...emptyVitals, temperatureC: "37.2", pulse: "80" })).toEqual({ temperatureC: 37.2, pulse: 80 });
  });

  it("batch: expiry after manufacture, whole quantities, money to 2 places", () => {
    const ok = { batchNumber: "B-01/2026", manufacturingDate: "2026-01-01", expiryDate: "2027-01-01", quantity: "100", unitCost: "1.50", mrp: "2" };
    expect(batchSchema.safeParse(ok).success).toBe(true);
    expect(batchSchema.safeParse({ ...ok, expiryDate: "2025-12-31" }).success).toBe(false);
    expect(batchSchema.safeParse({ ...ok, quantity: "1.5" }).success).toBe(false);
    expect(batchSchema.safeParse({ ...ok, mrp: "2.005" }).success).toBe(false);
    expect(batchSchema.safeParse({ ...ok, batchNumber: "-bad" }).success).toBe(false);
  });

  it("cash: positive, at most the balance due", () => {
    const schema = cashSchema(250);
    expect(schema.safeParse({ amount: "250" }).success).toBe(true);
    expect(schema.safeParse({ amount: "250.01" }).success).toBe(false);
    expect(schema.safeParse({ amount: "0" }).success).toBe(false);
  });

  it("invoice lines: credits allowed, zero refused", () => {
    const line = { sourceType: "OTHER" as const, description: "Dressing", quantity: "1", unitPrice: "150" };
    expect(invoiceItemSchema.safeParse(line).success).toBe(true);
    expect(invoiceItemSchema.safeParse({ ...line, unitPrice: "-50" }).success).toBe(true);
    expect(invoiceItemSchema.safeParse({ ...line, unitPrice: "0" }).success).toBe(false);
    expect(invoiceItemSchema.safeParse({ ...line, quantity: "0" }).success).toBe(false);
  });

  it("encounter: ICD-10 codes are validated and normalised", () => {
    const base = { chiefComplaint: "Fever", presentingSymptoms: "", diagnosisNotes: "", treatmentPlan: "", notes: "" };
    expect(encounterSchema.safeParse({ ...base, icd10: "J06.9, r50.9" }).success).toBe(true);
    expect(encounterSchema.safeParse({ ...base, icd10: "flu" }).success).toBe(false);
    expect(encounterSchema.safeParse({ ...base, chiefComplaint: " ", icd10: "" }).success).toBe(false);
    expect(icd10List(" j06.9 ,R50.9,")).toEqual(["J06.9", "R50.9"]);
  });

  it("patient: a future date of birth and a local phone format are refused", () => {
    const p = {
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@example.com",
      phone: "",
      dob: "",
      gender: "" as const,
      bloodGroup: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
    };
    expect(patientSchema.safeParse(p).success).toBe(true);
    expect(patientSchema.safeParse({ ...p, dob: "2999-01-01" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...p, phone: "9812345678" }).success).toBe(false);
    expect(patientSchema.safeParse({ ...p, phone: "+919812345678" }).success).toBe(true);
  });
});
