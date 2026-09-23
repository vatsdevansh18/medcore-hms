/**
 * Enums shared between the NestJS backend and the Next.js frontend.
 * These mirror the Prisma schema's enum definitions exactly (see
 * docs/06-DATABASE-DESIGN.md) — the Prisma schema is generated to match
 * this file's values, not the other way around, so this package stays
 * the single source of truth for the contract.
 */

/** The nine platform roles — see docs/07-RBAC-MATRIX.md */
export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  HOSPITAL_ADMIN = "HOSPITAL_ADMIN",
  DOCTOR = "DOCTOR",
  NURSE = "NURSE",
  RECEPTIONIST = "RECEPTIONIST",
  LAB_TECHNICIAN = "LAB_TECHNICIAN",
  PHARMACIST = "PHARMACIST",
  ACCOUNTANT = "ACCOUNTANT",
  PATIENT = "PATIENT",
}

export enum UserStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  DISABLED = "DISABLED",
}

export enum HospitalStatus {
  PENDING_VERIFICATION = "PENDING_VERIFICATION",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
}

export enum AppointmentStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  NO_SHOW = "NO_SHOW",
}

export enum AppointmentType {
  REGULAR = "REGULAR",
  EMERGENCY = "EMERGENCY",
  FOLLOW_UP = "FOLLOW_UP",
}

export enum PrescriptionStatus {
  ISSUED = "ISSUED",
  PARTIALLY_DISPENSED = "PARTIALLY_DISPENSED",
  DISPENSED = "DISPENSED",
  CANCELLED = "CANCELLED",
}

export enum MedicineForm {
  TABLET = "TABLET",
  CAPSULE = "CAPSULE",
  SYRUP = "SYRUP",
  INJECTION = "INJECTION",
  TOPICAL = "TOPICAL",
  OTHER = "OTHER",
}

export enum PrescriptionFrequency {
  OD = "OD",
  BD = "BD",
  TDS = "TDS",
  QID = "QID",
  SOS = "SOS",
  OTHER = "OTHER",
}

export enum MedicineBatchStatus {
  ACTIVE = "ACTIVE",
  QUARANTINED = "QUARANTINED",
  DEPLETED = "DEPLETED",
}

export enum LabOrderItemStatus {
  ORDERED = "ORDERED",
  SAMPLE_COLLECTED = "SAMPLE_COLLECTED",
  IN_PROGRESS = "IN_PROGRESS",
  RESULT_UPLOADED = "RESULT_UPLOADED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export enum LabOrderPriority {
  ROUTINE = "ROUTINE",
  URGENT = "URGENT",
}

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  FINALIZED = "FINALIZED",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  PAID = "PAID",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
}

export enum InvoiceItemSourceType {
  CONSULTATION = "CONSULTATION",
  LAB = "LAB",
  PHARMACY = "PHARMACY",
  ROOM = "ROOM",
  OTHER = "OTHER",
}

export enum PaymentMethod {
  STRIPE = "STRIPE",
  RAZORPAY = "RAZORPAY",
  CASH = "CASH",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export enum NotificationChannel {
  EMAIL = "EMAIL",
  SMS = "SMS",
  IN_APP = "IN_APP",
}

export enum NotificationStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  FAILED = "FAILED",
}

/** A patient's self-identified gender. Distinct from ReferenceRangeGender. */
export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  OTHER = "OTHER",
}

/** The gender bucket a lab reference range applies to — not a person's gender. */
export enum ReferenceRangeGender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  ANY = "ANY",
}

export enum RoomType {
  GENERAL = "GENERAL",
  PRIVATE = "PRIVATE",
  ICU = "ICU",
  OT = "OT",
}

export enum BedStatus {
  VACANT = "VACANT",
  OCCUPIED = "OCCUPIED",
  MAINTENANCE = "MAINTENANCE",
}

export enum FamilyHistoryCondition {
  DIABETES = "DIABETES",
  HYPERTENSION = "HYPERTENSION",
  CANCER = "CANCER",
  CARDIAC = "CARDIAC",
  OTHER = "OTHER",
}

export enum AttachmentOwnerType {
  MEDICAL_RECORD = "MEDICAL_RECORD",
  LAB_RESULT = "LAB_RESULT",
  PRESCRIPTION = "PRESCRIPTION",
}

/** Data model only in v1 — no adjudication workflow (see docs/11-DECISIONS.md D-011). */
export enum InsuranceClaimStatus {
  SUBMITTED = "SUBMITTED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  PAID = "PAID",
}
