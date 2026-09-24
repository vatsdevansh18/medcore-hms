import type {
  AppointmentStatus,
  BedStatus,
  InvoiceStatus,
  LabOrderItemStatus,
  LabOrderPriority,
  PaymentMethod,
  PaymentStatus,
  PrescriptionStatus,
  RoomType,
} from "./enums";
import type { PersonName } from "./portal";

/**
 * Dashboards, analytics, and search (Phase 13, FR-ANALYTICS-001,
 * FR-SEARCH-001, docs/11-DECISIONS.md D-040). Dates named `date`, `from`,
 * `to` are calendar dates (YYYY-MM-DD) in the hospital's timezone, or UTC for
 * the platform-wide (Super Admin) view. Money is a 2-decimal string.
 */

export type AnalyticsScope = "HOSPITAL" | "PLATFORM";

/** `GET /analytics/overview`: the KPI row. */
export interface DashboardKpis {
  scope: AnalyticsScope;
  /** "Today" as a calendar date in `timezone`. */
  date: string;
  timezone: string;
  /** Non-cancelled appointments scheduled today. */
  appointmentsToday: number;
  /** Distinct patients with a non-cancelled appointment today. */
  patientsToday: number;
  /** SUCCEEDED payments received today. */
  revenueToday: string;
  currency: string;
  occupiedBeds: number;
  totalBeds: number;
  /** Doctors whose account is active. */
  activeDoctors: number;
  /** Platform view only. */
  activeHospitals?: number;
}

export interface DailyAppointments {
  date: string;
  total: number;
  byStatus: Partial<Record<AppointmentStatus, number>>;
}

/** `GET /analytics/appointments?from&to`: one entry per calendar day. */
export interface AppointmentTrend {
  scope: AnalyticsScope;
  from: string;
  to: string;
  timezone: string;
  days: DailyAppointments[];
}

export interface DailyRevenue {
  date: string;
  /** SUCCEEDED payments received that day. */
  collected: string;
  /** Totals of invoices finalized that day. */
  invoiced: string;
  byMethod: Partial<Record<PaymentMethod, string>>;
}

/** `GET /analytics/revenue?from&to`. */
export interface RevenueTrend {
  scope: AnalyticsScope;
  from: string;
  to: string;
  timezone: string;
  currency: string;
  days: DailyRevenue[];
  totals: { collected: string; invoiced: string };
  /** Balance due now across FINALIZED and PARTIALLY_PAID invoices. */
  outstanding: string;
  outstandingInvoices: number;
}

export interface BedView {
  id: string;
  bedNumber: string;
  status: BedStatus;
}

export interface RoomOccupancy {
  id: string;
  roomNumber: string;
  type: RoomType;
  beds: BedView[];
}

export interface BedCounts {
  VACANT: number;
  OCCUPIED: number;
  MAINTENANCE: number;
}

/** `GET /analytics/occupancy`: the bed board / department heat map. */
export interface OccupancyView {
  departments: { id: string; name: string; rooms: RoomOccupancy[]; counts: BedCounts }[];
  counts: BedCounts;
}

export const SearchScope = { PATIENTS: "patients", DOCTORS: "doctors", MEDICINES: "medicines" } as const;
export type SearchScope = (typeof SearchScope)[keyof typeof SearchScope];

export interface SearchPatientHit {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
}

export interface SearchDoctorHit {
  id: string;
  name: string;
  specialization: string;
  department: string;
}

export interface SearchMedicineHit {
  id: string;
  name: string;
  genericName: string | null;
  form: string;
  unit: string;
}

/** `GET /search?q=` without `scope`: up to 5 hits per scope the caller may
 * search. With `scope`, the endpoint returns a paginated list instead. */
export interface GlobalSearchView {
  query: string;
  scopes: SearchScope[];
  patients?: { hits: SearchPatientHit[]; total: number };
  doctors?: { hits: SearchDoctorHit[]; total: number };
  medicines?: { hits: SearchMedicineHit[]; total: number };
}

/** `GET /audit-logs` row. Before/after data is never included. */
export interface AuditLogView {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: (PersonName & { role: string }) | null;
  hospitalId: string | null;
  createdAt: string;
}

/** `GET /payments` row (reconciliation). */
export interface PaymentListView {
  id: string;
  invoiceId: string;
  method: PaymentMethod;
  amount: string;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  patient: PersonName | null;
}

/** Staff work-queue row for `GET /lab-orders`. */
export interface LabQueueRow {
  id: string;
  priority: LabOrderPriority;
  createdAt: string;
  patient: PersonName | null;
  doctor: { id: string; specialization: string; user: PersonName };
  items: { id: string; status: LabOrderItemStatus; labTest: { id: string; name: string } }[];
}

/** Staff work-queue row for `GET /prescriptions`. */
export interface PrescriptionQueueRow {
  id: string;
  status: PrescriptionStatus;
  createdAt: string;
  patient: PersonName | null;
  doctor: { id: string; specialization: string; user: PersonName };
  items: { id: string; quantityPrescribed: number; quantityDispensed: number; medicine: { id: string; name: string } }[];
}

/** Staff row for `GET /invoices`. */
export interface InvoiceQueueRow {
  id: string;
  appointmentId: string;
  patientId: string;
  patient: PersonName | null;
  status: InvoiceStatus;
  total: string;
  currency: string;
  finalizedAt: string | null;
  createdAt: string;
}

/** `GET /medicines/low-stock` row (Phase 9 endpoint, typed in Phase 13). */
export interface LowStockView {
  id: string;
  name: string;
  genericName: string | null;
  form: string;
  unit: string;
  reorderLevel: number;
  availableQuantity: number;
}

/** `GET /medicines/expiring?days=` row: a dispensable batch expiring soon. */
export interface ExpiringBatchView {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantityOnHand: number;
  medicine: { id: string; name: string; unit: string };
}
