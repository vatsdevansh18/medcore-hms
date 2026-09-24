import type {
  AppointmentType,
  FamilyHistoryCondition,
  Gender,
  InvoiceItemSourceType,
  LabOrderPriority,
  LabResultDecision,
  MedicineBatchStatus,
  MedicineForm,
  PrescriptionFrequency,
  ReferenceRangeGender,
  UserRole,
  UserStatus,
} from "./enums";
import type {
  DepartmentSummary,
  InvoiceView,
  LabOrderItemView,
  LabOrderView,
  LabResultView,
  PersonName,
  PrescriptionItemView,
  PrescriptionView,
} from "./portal";

/**
 * Request and response shapes for the staff workflow screens (Phase 13B,
 * docs/11-DECISIONS.md D-041). Requests mirror the backend DTOs field for
 * field; the server validates everything again.
 */

// ── Front desk ──────────────────────────────────────────────────────────

/** `POST /patients` (Receptionist, Hospital Admin). */
export interface RegisterPatientRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dob?: string;
  gender?: Gender;
  bloodGroup?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

/** `POST /appointments/emergency` (Doctor, Receptionist). */
export interface EmergencyAppointmentRequest {
  patientId: string;
  doctorId: string;
  reasonForVisit?: string;
}

/** `PATCH /appointments/:id/status`. */
export interface UpdateAppointmentStatusRequest {
  status: "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  cancelledReason?: string;
}

/** Re-exported for screens that switch on the appointment type. */
export type { AppointmentType };

// ── Encounter (EMR) ─────────────────────────────────────────────────────

/** `POST /medical-records` (Doctor, own IN_PROGRESS appointment). */
export interface CreateMedicalRecordRequest {
  appointmentId: string;
  chiefComplaint?: string;
  presentingSymptoms?: string;
  diagnosisNotes?: string;
  confirmedDiagnosisIcd10?: string[];
  treatmentPlan?: string;
  notes?: string;
}

/** `POST /medical-records/:id/vitals`. BMI is always computed by the server. */
export interface RecordVitalsRequest {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  temperatureC?: number;
  spo2?: number;
  heightCm?: number;
  weightKg?: number;
}

export interface AddendumRequest {
  note: string;
}

export interface AllergyRequest {
  allergen: string;
  reaction?: string;
  severity?: string;
}

export interface FamilyHistoryRequest {
  condition: FamilyHistoryCondition;
  notes?: string;
}

/** `POST /prescriptions`. */
export interface CreatePrescriptionRequest {
  medicalRecordId: string;
  items: {
    medicineId: string;
    dosage: string;
    frequency: PrescriptionFrequency;
    durationDays: number;
    quantityPrescribed: number;
    specialInstructions?: string;
  }[];
  supersedesId?: string;
}

/** `POST /lab-orders`. */
export interface CreateLabOrderRequest {
  medicalRecordId: string;
  priority?: LabOrderPriority;
  items: { labTestId: string }[];
}

/** `GET /lab-tests` row: the hospital's test catalog. */
export interface LabTestView {
  id: string;
  name: string;
  code: string;
  sampleType: string | null;
  price: string;
  turnaroundHours: number | null;
  referenceRanges: {
    id: string;
    gender: ReferenceRangeGender;
    ageMin: number | null;
    ageMax: number | null;
    lowValue: string;
    highValue: string;
    unit: string;
  }[];
}

// ── Laboratory ──────────────────────────────────────────────────────────

/** A result as a lab technician sees it: who entered and who approved it
 * (four-eyes, FR-LAB-004), plus the portal fields. */
export interface StaffLabResultView extends LabResultView {
  enteredBy: string;
  approvedBy: string | null;
  createdAt: string;
}

export interface StaffLabOrderItemView extends Omit<LabOrderItemView, "result" | "labTest"> {
  labTest: { id: string; name: string; code: string; referenceRanges: LabTestView["referenceRanges"] };
  result: StaffLabResultView | null;
}

/** `GET /lab-orders/:id` for staff. */
export interface StaffLabOrderView extends Omit<LabOrderView, "items"> {
  items: StaffLabOrderItemView[];
  patient: { id: string; dob: string | null; gender: Gender | null; user: PersonName };
}

/** `PATCH /lab-orders/:id/items/:itemId/result`: exactly one value (D-018). */
export interface EnterLabResultRequest {
  values: { parameter: string; value: number; unit: string }[];
}

export interface ApproveLabResultRequest {
  decision: LabResultDecision;
  notes?: string;
}

// ── Pharmacy ────────────────────────────────────────────────────────────

/** `GET /prescriptions/:id` for staff: each line with what's been dispensed. */
export interface StaffPrescriptionView extends Omit<PrescriptionView, "items"> {
  items: (PrescriptionItemView & { dispensedQuantity: number })[];
  patient?: PersonName | null;
}

/** `POST /prescriptions/:id/dispense`. Omit `batchId` for FEFO allocation. */
export interface DispenseRequest {
  items: { prescriptionItemId: string; quantity: number; batchId?: string }[];
}

/** `GET /medicines` row. */
export interface MedicineView {
  id: string;
  name: string;
  genericName: string | null;
  form: MedicineForm;
  manufacturer: string | null;
  unit: string;
  reorderLevel: number;
  availableQuantity: number;
}

export interface MedicineRequest {
  name: string;
  genericName?: string;
  form: MedicineForm;
  manufacturer?: string;
  unit: string;
  reorderLevel?: number;
}

/** `GET /medicines/:id/batches` row, in FEFO order. */
export interface MedicineBatchView {
  id: string;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  quantityOnHand: number;
  unitCost: string;
  mrp: string;
  status: MedicineBatchStatus;
  createdAt: string;
}

/** `POST /medicines/:id/batches`. Dates are YYYY-MM-DD. */
export interface ReceiveBatchRequest {
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  quantity: number;
  unitCost: number;
  mrp: number;
}

// ── Billing desk ────────────────────────────────────────────────────────

/** `GET /invoices/:id` for staff. */
export interface StaffInvoiceView extends InvoiceView {
  patient: PersonName | null;
}

/** `POST /invoices/:id/items`. A negative `unitPrice` is a credit line. */
export interface AddInvoiceItemRequest {
  sourceType: Extract<InvoiceItemSourceType, "ROOM" | "OTHER">;
  description: string;
  quantity: number;
  unitPrice: number;
}

/** `POST /invoices/:id/cash-payment` response. */
export interface CashPaymentView {
  receipt: { paymentId: string; method: "CASH"; amount: string; currency: string; recordedAt: string };
  invoice: InvoiceView;
}

// ── Hospital administration ─────────────────────────────────────────────

/** `GET /users` row: the Hospital Admin's staff directory. */
export interface StaffMemberView {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  staffProfile: { employeeCode: string; department: DepartmentSummary | null } | null;
  doctorProfile: { id: string; specialization: string; department: DepartmentSummary } | null;
}

/** `POST /users`: non-doctor staff. */
export interface CreateStaffRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Exclude<UserRole, "SUPER_ADMIN" | "DOCTOR" | "PATIENT">;
  employeeCode: string;
  departmentId?: string;
}

/** `POST /doctors`. */
export interface CreateDoctorRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  departmentId: string;
  specialization: string;
  licenseNumber: string;
  qualification?: string;
  yearsOfExperience?: number;
  consultationFee: number;
}

/** `GET /hospitals/:id/departments` row. */
export interface DepartmentView {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface DepartmentRequest {
  name: string;
  description?: string;
}

/** `GET /hospitals/:id` (the fields the settings screen edits). */
export interface HospitalSettingsView {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  timezone: string;
  patientRescheduleAllowed: boolean;
  patientRescheduleCutoffHours: number;
}

/** `PATCH /hospitals/:id`. */
export interface UpdateHospitalRequest {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  timezone?: string;
  patientRescheduleAllowed?: boolean;
  patientRescheduleCutoffHours?: number;
}

// ── Phase 13B follow-up (D-042) ─────────────────────────────────────────

export interface AvailabilitySlotView {
  id: string;
  /** 0 = Sunday … 6 = Saturday. Times are the hospital's wall-clock HH:mm. */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  isActive: boolean;
}

export interface AvailabilityExceptionView {
  id: string;
  /** The hospital's calendar date, YYYY-MM-DD. */
  date: string;
  isUnavailable: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

/** `GET /doctors/:id/schedule` (the doctor themselves). */
export interface DoctorScheduleView {
  timezone: string;
  weekly: AvailabilitySlotView[];
  exceptions: AvailabilityExceptionView[];
}

/** `PUT /doctors/:id/availability`: replaces the whole weekly schedule. */
export interface SetAvailabilityRequest {
  slots: { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number; isActive?: boolean }[];
}

/** `POST /doctors/:id/availability-exceptions` (one per date; re-posting replaces it). */
export interface AvailabilityExceptionRequest {
  date: string;
  isUnavailable: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

/** `POST /medical-records/:id/attachments` and `POST /doctors/:id/signature`:
 * declare the file, then PUT its bytes to `uploadUrl` (pre-signed, 5 min). */
export interface UploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentUploadView {
  attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string };
  uploadUrl: string;
}

export interface VaccinationRequest {
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  batchNumber?: string;
  nextDueDate?: string;
}

/** `GET /hospitals` row (Super Admin). */
export interface HospitalView {
  id: string;
  name: string;
  slug: string;
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
  contactEmail: string | null;
  contactPhone: string | null;
  timezone: string;
  createdAt: string;
}

/** `POST /hospitals`: created PENDING_VERIFICATION. */
export interface CreateHospitalRequest {
  name: string;
  slug: string;
  contactEmail: string;
  contactPhone?: string;
  timezone?: string;
  address?: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string };
}

/** `POST /hospitals/:id/admins` (Super Admin). */
export interface CreateHospitalAdminRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  employeeCode: string;
}
