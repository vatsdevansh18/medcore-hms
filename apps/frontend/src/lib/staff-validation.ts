import { z } from "zod";
import { FamilyHistoryCondition, Gender, MedicineForm, PrescriptionFrequency } from "@medcore/types";

/**
 * Form schemas for the staff workflow screens (Phase 13B). Each mirrors the
 * backend DTO's class-validator rules so staff see the same limits before
 * submitting; the server still validates everything (SEC-INPUT-001).
 * Optional text fields are strings in the form ("" means "not given") and
 * are dropped before sending.
 */

const text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const required = (label: string, max: number) => text(max).min(1, `Enter ${label}.`);
const email = z.string().trim().min(1, "Enter an email address.").email("Enter a valid email address.");
const phone = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "Use international format, e.g. +919812345678.");
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** An optional number field typed into an <input>: "" means not given. */
const optionalNumber = (min: number, max: number, { integer = false } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && (!integer || Number.isInteger(Number(v)))), integer ? "Enter a whole number." : "Enter a number.")
    .refine((v) => v === "" || (Number(v) >= min && Number(v) <= max), `Enter a value from ${min} to ${max}.`);

const requiredNumber = (label: string, min: number, max: number, { integer = false, decimals }: { integer?: boolean; decimals?: number } = {}) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .refine((v) => !Number.isNaN(Number(v)), "Enter a number.")
    .refine((v) => !integer || Number.isInteger(Number(v)), "Enter a whole number.")
    .refine((v) => decimals === undefined || !v.includes(".") || v.split(".")[1].length <= decimals, `Use at most ${decimals} decimal places.`)
    .refine((v) => Number(v) >= min && Number(v) <= max, `Enter a value from ${min} to ${max}.`);

/** Drops "" values and converts numeric strings for the request body. */
export function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined)) as Partial<T>;
}

// ── Front desk ──────────────────────────────────────────────────────────

/** RegisterPatientDto. */
export const patientSchema = z.object({
  firstName: required("the first name", 100),
  lastName: required("the last name", 100),
  email,
  phone,
  dob: z
    .string()
    .refine((v) => v === "" || (DATE_ONLY.test(v) && new Date(v) <= new Date()), "Enter a date of birth in the past."),
  gender: z.union([z.literal(""), z.enum(Object.values(Gender) as [Gender, ...Gender[]])]),
  bloodGroup: text(10),
  emergencyContactName: text(200),
  emergencyContactPhone: phone,
});
export type PatientValues = z.infer<typeof patientSchema>;

/** CreateEmergencyAppointmentDto / BookAppointmentDto reason. */
export const reasonSchema = z.object({ reasonForVisit: text(500) });
export type ReasonValues = z.infer<typeof reasonSchema>;

/** UpdateAppointmentStatusDto.cancelledReason, required by the desk when cancelling. */
export const cancelReasonSchema = z.object({ reason: required("a reason", 500) });
export type CancelReasonValues = z.infer<typeof cancelReasonSchema>;

// ── Encounter ───────────────────────────────────────────────────────────

/** CreateMedicalRecordDto. ICD-10 codes are typed comma-separated. */
export const encounterSchema = z.object({
  chiefComplaint: required("the chief complaint", 1000),
  presentingSymptoms: text(2000),
  diagnosisNotes: text(2000),
  icd10: z
    .string()
    .trim()
    .refine((v) => v === "" || v.split(",").every((code) => /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/i.test(code.trim())), "Use ICD-10 codes like J06.9, separated by commas.")
    .refine((v) => v === "" || v.split(",").length <= 20, "Use at most 20 codes."),
  treatmentPlan: text(2000),
  notes: text(5000),
});
export type EncounterValues = z.infer<typeof encounterSchema>;

export function icd10List(value: string): string[] {
  return value
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

/** RecordVitalsDto: every field optional, but at least one is needed. */
export const vitalsSchema = z
  .object({
    bpSystolic: optionalNumber(40, 300, { integer: true }),
    bpDiastolic: optionalNumber(20, 200, { integer: true }),
    pulse: optionalNumber(20, 250, { integer: true }),
    temperatureC: optionalNumber(25, 45),
    spo2: optionalNumber(0, 100, { integer: true }),
    heightCm: optionalNumber(20, 272),
    weightKg: optionalNumber(0.5, 500),
  })
  .refine((v) => Object.values(v).some((x) => x !== ""), { message: "Enter at least one reading.", path: ["bpSystolic"] })
  .refine((v) => (v.bpSystolic === "") === (v.bpDiastolic === ""), {
    message: "Enter both blood pressure numbers.",
    path: ["bpDiastolic"],
  });
export type VitalsValues = z.infer<typeof vitalsSchema>;

/** Form strings to the numeric RecordVitalsDto body. */
export function vitalsBody(values: VitalsValues): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => [k, Number(v)]),
  );
}

export const addendumSchema = z.object({ note: required("the note", 5000) });
export type AddendumValues = z.infer<typeof addendumSchema>;

export const allergySchema = z.object({
  allergen: required("the allergen", 200),
  reaction: text(500),
  severity: z.enum(["", "MILD", "MODERATE", "SEVERE"]),
});
export type AllergyValues = z.infer<typeof allergySchema>;

export const familyHistorySchema = z.object({
  condition: z.enum(Object.values(FamilyHistoryCondition) as [FamilyHistoryCondition, ...FamilyHistoryCondition[]]),
  notes: text(500),
});

/** PrescriptionItemDto, one line of the prescription form. */
export const prescriptionLineSchema = z.object({
  medicineId: z.string().min(1, "Choose a medicine."),
  medicineName: z.string(),
  dosage: required("the dose", 200),
  frequency: z.enum(Object.values(PrescriptionFrequency) as [PrescriptionFrequency, ...PrescriptionFrequency[]]),
  durationDays: requiredNumber("the number of days", 1, 365, { integer: true }),
  quantityPrescribed: requiredNumber("the quantity", 1, 1000, { integer: true }),
  specialInstructions: text(500),
});
export const prescriptionSchema = z.object({
  items: z.array(prescriptionLineSchema).min(1, "Add at least one medicine.").max(30, "Use at most 30 lines."),
});
export type PrescriptionValues = z.infer<typeof prescriptionSchema>;

// ── Laboratory ──────────────────────────────────────────────────────────

/** LabResultValueDto: one value per test (D-018). */
export const labResultSchema = z.object({
  value: requiredNumber("the value", -1_000_000, 1_000_000),
  unit: required("the unit", 30),
});
export type LabResultValues = z.infer<typeof labResultSchema>;

export const rejectSchema = z.object({ notes: required("why the result is rejected", 500) });

// ── Pharmacy ────────────────────────────────────────────────────────────

/** CreateMedicineDto / UpdateMedicineDto. */
export const medicineSchema = z.object({
  name: required("the name", 200),
  genericName: text(200),
  form: z.enum(Object.values(MedicineForm) as [MedicineForm, ...MedicineForm[]]),
  manufacturer: text(200),
  unit: required("the unit", 30),
  reorderLevel: optionalNumber(0, 1_000_000, { integer: true }),
});
export type MedicineValues = z.infer<typeof medicineSchema>;

/** ReceiveBatchDto. Expiry must be after manufacture; the server also
 * refuses an already-expired batch and a future manufacturing date. */
export const batchSchema = z
  .object({
    batchNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9/-]{0,49}$/, "Use 1-50 letters, digits, '-' or '/'."),
    manufacturingDate: z.string().regex(DATE_ONLY, "Enter the manufacturing date."),
    expiryDate: z.string().regex(DATE_ONLY, "Enter the expiry date."),
    quantity: requiredNumber("the quantity", 1, 1_000_000, { integer: true }),
    unitCost: requiredNumber("the unit cost", 0, 9_999_999, { decimals: 2 }),
    mrp: requiredNumber("the MRP", 0, 9_999_999, { decimals: 2 }),
  })
  .refine((v) => !v.manufacturingDate || !v.expiryDate || v.expiryDate > v.manufacturingDate, {
    message: "Expiry must be after the manufacturing date.",
    path: ["expiryDate"],
  });
export type BatchValues = z.infer<typeof batchSchema>;

// ── Billing desk ────────────────────────────────────────────────────────

/** AddInvoiceItemDto. A negative price is a credit line. */
export const invoiceItemSchema = z.object({
  sourceType: z.enum(["ROOM", "OTHER"]),
  description: required("a description", 500),
  quantity: requiredNumber("the quantity", 1, 1000, { integer: true }),
  unitPrice: requiredNumber("the unit price", -99_999, 99_999, { decimals: 2 }).refine((v) => Number(v) !== 0, "A line can't be zero."),
});
export type InvoiceItemValues = z.infer<typeof invoiceItemSchema>;

/** CashPaymentDto; the balance cap is checked against the invoice in the form. */
export const cashSchema = (balance: number) =>
  z.object({
    amount: requiredNumber("the amount", 0.01, 9_999_999, { decimals: 2 }).refine(
      (v) => Number(v) <= balance,
      `The balance due is ${balance.toFixed(2)}; enter that or less.`,
    ),
  });
export type CashValues = { amount: string };

// ── Hospital administration ─────────────────────────────────────────────

/** CreateStaffDto (non-doctor staff) and CreateDoctorDto share the person fields. */
export const staffSchema = z.object({
  firstName: required("the first name", 100),
  lastName: required("the last name", 100),
  email,
  phone,
  role: z.enum(["HOSPITAL_ADMIN", "NURSE", "RECEPTIONIST", "LAB_TECHNICIAN", "PHARMACIST", "ACCOUNTANT"]),
  employeeCode: required("the employee code", 50),
  departmentId: z.string(),
});
export type StaffValues = z.infer<typeof staffSchema>;

export const doctorSchema = z.object({
  firstName: required("the first name", 100),
  lastName: required("the last name", 100),
  email,
  phone,
  departmentId: z.string().min(1, "Choose a department."),
  specialization: text(100).min(2, "Enter the specialization."),
  licenseNumber: required("the licence number", 50),
  qualification: text(200),
  yearsOfExperience: optionalNumber(0, 70, { integer: true }),
  consultationFee: requiredNumber("the consultation fee", 0, 9_999_999, { decimals: 2 }),
});
export type DoctorValues = z.infer<typeof doctorSchema>;

export const departmentSchema = z.object({
  name: text(100).min(2, "Use at least 2 characters."),
  description: text(500),
});
export type DepartmentValues = z.infer<typeof departmentSchema>;

export const settingsSchema = z.object({
  patientRescheduleAllowed: z.boolean(),
  patientRescheduleCutoffHours: requiredNumber("the cutoff", 0, 720, { integer: true }),
});
export type SettingsValues = z.infer<typeof settingsSchema>;
