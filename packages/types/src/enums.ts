/**
 * Enums shared between the NestJS backend and the Next.js frontend.
 * These mirror the Prisma schema's enum definitions exactly (see
 * docs/06-DATABASE-DESIGN.md) — the Prisma schema is generated to match
 * this file's values, not the other way around, so this package stays
 * the single source of truth for the contract.
 *
 * Deliberately `as const` objects + derived union types, not real TS
 * `enum` declarations. Two `enum` declarations with identical members are
 * NOT mutually assignable in TypeScript — since Prisma generates its own
 * enum types from schema.prisma independent of this file, using real
 * enums here made every Prisma query result (typed with Prisma's own
 * enums) fail to type-check against service/DTO signatures typed with
 * these, even though the runtime string values are identical (found in
 * Phase 3, see docs/phase-reviews/PHASE-3-REVIEW.md). This pattern's
 * derived types are plain string-literal unions, which Prisma's enum
 * members — themselves just branded string literals — are structurally
 * assignable to without a cast. `Object.values(UserRole)` and
 * `UserRole.DOCTOR` both still work exactly as they would with a real enum;
 * only cross-file nominal assignability changes.
 */

/** The nine platform roles — see docs/07-RBAC-MATRIX.md */
export const UserRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  HOSPITAL_ADMIN: "HOSPITAL_ADMIN",
  DOCTOR: "DOCTOR",
  NURSE: "NURSE",
  RECEPTIONIST: "RECEPTIONIST",
  LAB_TECHNICIAN: "LAB_TECHNICIAN",
  PHARMACIST: "PHARMACIST",
  ACCOUNTANT: "ACCOUNTANT",
  PATIENT: "PATIENT",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = { PENDING: "PENDING", ACTIVE: "ACTIVE", DISABLED: "DISABLED" } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const HospitalStatus = {
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type HospitalStatus = (typeof HospitalStatus)[keyof typeof HospitalStatus];

export const AppointmentStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const AppointmentType = {
  REGULAR: "REGULAR",
  EMERGENCY: "EMERGENCY",
  FOLLOW_UP: "FOLLOW_UP",
} as const;
export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType];

export const PrescriptionStatus = {
  ISSUED: "ISSUED",
  PARTIALLY_DISPENSED: "PARTIALLY_DISPENSED",
  DISPENSED: "DISPENSED",
  CANCELLED: "CANCELLED",
} as const;
export type PrescriptionStatus = (typeof PrescriptionStatus)[keyof typeof PrescriptionStatus];

export const MedicineForm = {
  TABLET: "TABLET",
  CAPSULE: "CAPSULE",
  SYRUP: "SYRUP",
  INJECTION: "INJECTION",
  TOPICAL: "TOPICAL",
  OTHER: "OTHER",
} as const;
export type MedicineForm = (typeof MedicineForm)[keyof typeof MedicineForm];

export const PrescriptionFrequency = {
  OD: "OD",
  BD: "BD",
  TDS: "TDS",
  QID: "QID",
  SOS: "SOS",
  OTHER: "OTHER",
} as const;
export type PrescriptionFrequency =
  (typeof PrescriptionFrequency)[keyof typeof PrescriptionFrequency];

export const MedicineBatchStatus = {
  ACTIVE: "ACTIVE",
  QUARANTINED: "QUARANTINED",
  DEPLETED: "DEPLETED",
} as const;
export type MedicineBatchStatus = (typeof MedicineBatchStatus)[keyof typeof MedicineBatchStatus];

export const LabOrderItemStatus = {
  ORDERED: "ORDERED",
  SAMPLE_COLLECTED: "SAMPLE_COLLECTED",
  IN_PROGRESS: "IN_PROGRESS",
  RESULT_UPLOADED: "RESULT_UPLOADED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type LabOrderItemStatus = (typeof LabOrderItemStatus)[keyof typeof LabOrderItemStatus];

export const LabOrderPriority = { ROUTINE: "ROUTINE", URGENT: "URGENT" } as const;
export type LabOrderPriority = (typeof LabOrderPriority)[keyof typeof LabOrderPriority];

/** Per-structured-value range-check outcome, FR-LAB-003. `NO_REFERENCE_RANGE`
 * covers a LabTest with no matching LabTestReferenceRange row for the
 * patient's gender/age — the value is stored but never flagged out-of-range,
 * since there is nothing to compare it against. */
export const LabResultFlag = {
  NORMAL: "NORMAL",
  LOW: "LOW",
  HIGH: "HIGH",
  NO_REFERENCE_RANGE: "NO_REFERENCE_RANGE",
} as const;
export type LabResultFlag = (typeof LabResultFlag)[keyof typeof LabResultFlag];

/** FR-LAB-004 four-eyes approval decision. */
export const LabResultDecision = { APPROVED: "APPROVED", REJECTED: "REJECTED" } as const;
export type LabResultDecision = (typeof LabResultDecision)[keyof typeof LabResultDecision];

export const InvoiceStatus = {
  DRAFT: "DRAFT",
  FINALIZED: "FINALIZED",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const InvoiceItemSourceType = {
  CONSULTATION: "CONSULTATION",
  LAB: "LAB",
  PHARMACY: "PHARMACY",
  ROOM: "ROOM",
  OTHER: "OTHER",
} as const;
export type InvoiceItemSourceType =
  (typeof InvoiceItemSourceType)[keyof typeof InvoiceItemSourceType];

export const PaymentMethod = { STRIPE: "STRIPE", RAZORPAY: "RAZORPAY", CASH: "CASH" } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const NotificationChannel = { EMAIL: "EMAIL", SMS: "SMS", IN_APP: "IN_APP" } as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = { PENDING: "PENDING", SENT: "SENT", FAILED: "FAILED" } as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

/** `Notification.type` values. `Notification.type` is a plain `String`
 * column (not a Prisma enum), so these are the canonical spellings shared
 * by every producer instead of ad hoc string literals. */
export const NotificationType = {
  LAB_RESULT_APPROVED: "LAB_RESULT_APPROVED",
  LOW_STOCK_ALERT: "LOW_STOCK_ALERT",
  MEDICINE_EXPIRY_DIGEST: "MEDICINE_EXPIRY_DIGEST",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** A patient's self-identified gender. Distinct from ReferenceRangeGender. */
export const Gender = { MALE: "MALE", FEMALE: "FEMALE", OTHER: "OTHER" } as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

/** The gender bucket a lab reference range applies to — not a person's gender. */
export const ReferenceRangeGender = { MALE: "MALE", FEMALE: "FEMALE", ANY: "ANY" } as const;
export type ReferenceRangeGender = (typeof ReferenceRangeGender)[keyof typeof ReferenceRangeGender];

export const RoomType = { GENERAL: "GENERAL", PRIVATE: "PRIVATE", ICU: "ICU", OT: "OT" } as const;
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export const BedStatus = {
  VACANT: "VACANT",
  OCCUPIED: "OCCUPIED",
  MAINTENANCE: "MAINTENANCE",
} as const;
export type BedStatus = (typeof BedStatus)[keyof typeof BedStatus];

export const FamilyHistoryCondition = {
  DIABETES: "DIABETES",
  HYPERTENSION: "HYPERTENSION",
  CANCER: "CANCER",
  CARDIAC: "CARDIAC",
  OTHER: "OTHER",
} as const;
export type FamilyHistoryCondition =
  (typeof FamilyHistoryCondition)[keyof typeof FamilyHistoryCondition];

export const AttachmentOwnerType = {
  MEDICAL_RECORD: "MEDICAL_RECORD",
  LAB_RESULT: "LAB_RESULT",
  PRESCRIPTION: "PRESCRIPTION",
} as const;
export type AttachmentOwnerType = (typeof AttachmentOwnerType)[keyof typeof AttachmentOwnerType];

/** Data model only in v1 — no adjudication workflow (see docs/11-DECISIONS.md D-011). */
export const InsuranceClaimStatus = {
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PAID: "PAID",
} as const;
export type InsuranceClaimStatus = (typeof InsuranceClaimStatus)[keyof typeof InsuranceClaimStatus];

/** Online checkout providers (a subset of PaymentMethod: CASH is staff-recorded). */
export const PaymentProvider = { STRIPE: "STRIPE", RAZORPAY: "RAZORPAY" } as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];
