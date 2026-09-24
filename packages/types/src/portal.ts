import type {
  AppointmentStatus,
  AppointmentType,
  FamilyHistoryCondition,
  Gender,
  InvoiceItemSourceType,
  InvoiceStatus,
  LabOrderItemStatus,
  LabOrderPriority,
  LabResultFlag,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PrescriptionFrequency,
  PrescriptionStatus,
  UserRole,
  UserStatus,
} from "./enums";

/**
 * Response shapes the patient portal reads (Phase 12, FR-PORTAL-001..003).
 * Timestamps are ISO-8601 strings and money is a decimal string with two
 * places (JSON has no Date/Decimal). Fields the portal doesn't read may be
 * present in a response without being listed here.
 */

/** A person's display name. Contact details are left out on purpose: a
 * patient gets a doctor's name, never their email or phone. */
export interface PersonName {
  id: string;
  firstName: string;
  lastName: string;
}

/** `GET /auth/me`. `patientProfileId` is set for PATIENT accounts only. */
export interface CurrentUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  hospitalId: string | null;
  status: UserStatus;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  createdAt: string;
  patientProfileId: string | null;
  /** DOCTOR only, else null (Phase 13B, D-041). */
  doctorProfileId: string | null;
  hospital: HospitalSummary | null;
}

export interface HospitalSummary {
  id: string;
  name: string;
  timezone: string;
  /** Whether patients may reschedule their own appointments (D-035). */
  patientRescheduleAllowed: boolean;
  /** Minimum hours before the current start time for a patient reschedule. */
  patientRescheduleCutoffHours: number;
}

/** `GET /hospitals/directory` (public): hospitals accepting registrations. */
export interface HospitalDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  city: string | null;
}

export interface DepartmentSummary {
  id: string;
  name: string;
}

/** `GET /doctors` / `GET /doctors/:id`. */
export interface DoctorView {
  id: string;
  specialization: string;
  qualification: string | null;
  yearsOfExperience: number | null;
  consultationFee: string;
  bio: string | null;
  hasSignature: boolean;
  department: DepartmentSummary;
  user: PersonName & { email?: string; phone?: string | null };
}

export interface SlotView {
  start: string;
  end: string;
}

/** `GET /doctors/:id/availability?dateFrom&dateTo`. `date` is the hospital's
 * local calendar date (YYYY-MM-DD); slot instants are UTC. */
export interface DaySlotsView {
  date: string;
  slots: SlotView[];
}

export interface AppointmentView {
  id: string;
  hospitalId: string;
  patientId: string;
  doctorId: string;
  departmentId: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: AppointmentStatus;
  type: AppointmentType;
  reasonForVisit: string | null;
  cancelledReason: string | null;
  createdAt: string;
  doctor: { id: string; specialization: string; user: PersonName };
  patient: { id: string; user: PersonName | null };
}

/** `POST /appointments` (patient: no `patientId`). */
export interface BookAppointmentRequest {
  doctorId: string;
  scheduledStart: string;
  scheduledEnd: string;
  reasonForVisit?: string;
  patientId?: string;
}

/** `PATCH /appointments/:id/reschedule` (D-035). */
export interface RescheduleAppointmentRequest {
  scheduledStart: string;
  scheduledEnd: string;
}

export interface VitalsView {
  id: string;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  temperatureC: string | null;
  spo2: number | null;
  heightCm: string | null;
  weightKg: string | null;
  bmi: string | null;
  recordedAt: string;
}

/** Decrypted server-side for an authorized reader. */
export interface AddendumView {
  id: string;
  note: string;
  createdAt: string;
}

/** An EMR attachment. The storage key is never returned; download through
 * `GET /medical-records/:id/attachments/:attachmentId/download-url`. */
export interface AttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface MedicalRecordView {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  chiefComplaint: string | null;
  presentingSymptoms: string | null;
  diagnosisNotes: string | null;
  confirmedDiagnosisIcd10: string[];
  treatmentPlan: string | null;
  /** Decrypted clinical notes. */
  notes: string | null;
  createdAt: string;
  vitals: VitalsView[];
  addenda: AddendumView[];
  attachments: AttachmentView[];
}

export interface AllergyView {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: string | null;
  recordedAt: string;
}

export interface VaccinationView {
  id: string;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  batchNumber: string | null;
  nextDueDate: string | null;
}

export interface FamilyHistoryView {
  id: string;
  condition: FamilyHistoryCondition;
  notes: string | null;
}

export interface PrescriptionItemView {
  id: string;
  dosage: string;
  frequency: PrescriptionFrequency;
  durationDays: number;
  specialInstructions: string | null;
  quantityPrescribed: number;
  medicine: { id: string; name: string; genericName: string | null; form: string; unit: string };
}

/** A prescription. Storage keys (PDF, signature) are never returned;
 * `pdfReady` says whether `GET /prescriptions/:id/pdf` will succeed. */
export interface PrescriptionView {
  id: string;
  medicalRecordId: string;
  patientId: string;
  doctorId: string;
  status: PrescriptionStatus;
  supersedesId: string | null;
  pdfReady: boolean;
  createdAt: string;
  items: PrescriptionItemView[];
  doctor?: { id: string; specialization: string; user: PersonName };
}

export interface LabValueView {
  parameter: string;
  value: number;
  unit: string;
  flag: LabResultFlag;
}

export interface LabResultView {
  id: string;
  structuredValues: LabValueView[] | null;
  isOutOfRange: boolean;
  approvedAt: string | null;
  /** Pre-signed, short-lived link to the report file, if one was uploaded. */
  downloadUrl: string | null;
}

export interface LabOrderItemView {
  id: string;
  status: LabOrderItemStatus;
  labTest: { id: string; name: string; code?: string | null };
  /** Null until the result is visible to the caller (patient: APPROVED only, D-021). */
  result: LabResultView | null;
}

export interface LabOrderView {
  id: string;
  medicalRecordId: string;
  patientId: string;
  doctorId: string;
  priority: LabOrderPriority;
  createdAt: string;
  items: LabOrderItemView[];
  doctor?: { id: string; specialization: string; user: PersonName };
}

/** `GET /lab-orders` list row for a patient. */
export interface LabOrderSummaryView {
  id: string;
  priority: LabOrderPriority;
  createdAt: string;
  doctor: { id: string; specialization: string; user: PersonName };
  items: { id: string; status: LabOrderItemStatus; labTest: { id: string; name: string } }[];
}

export interface InvoiceItemView {
  id: string;
  sourceType: InvoiceItemSourceType;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  createdAt: string;
}

export interface PaymentView {
  id: string;
  method: PaymentMethod;
  amount: string;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
}

export interface InvoiceView {
  id: string;
  appointmentId: string;
  patientId: string;
  status: InvoiceStatus;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  currency: string;
  finalizedAt: string | null;
  createdAt: string;
  items: InvoiceItemView[];
  payments: PaymentView[];
  amountPaid: string;
  balanceDue: string;
}

/** `GET /invoices` list row. */
export interface InvoiceSummaryView {
  id: string;
  appointmentId: string;
  status: InvoiceStatus;
  total: string;
  currency: string;
  finalizedAt: string | null;
  createdAt: string;
}

/** `POST /invoices/:id/checkout-session`. */
export interface CheckoutSessionRequest {
  provider: PaymentProvider;
}

export interface CheckoutSessionView {
  paymentId: string;
  provider: PaymentProvider;
  reference: string;
  checkoutUrl: string | null;
  keyId: string | null;
  amount: string;
  currency: string;
}

/** `GET /prescriptions/:id/pdf`, `GET /payments/:id/receipt`. */
export interface DownloadUrlView {
  downloadUrl: string;
}

export interface PatientProfileView {
  id: string;
  hospitalId: string;
  dob: string | null;
  gender: Gender | null;
  bloodGroup: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  user: PersonName & { email: string; phone: string | null };
}
