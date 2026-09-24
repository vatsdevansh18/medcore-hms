import {
  Activity,
  BedDouble,
  Building2,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Package,
  Pill,
  Receipt,
  Settings,
  Stethoscope,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { UserRole } from "@medcore/types";
import { ROUTES } from "@/constants";

export interface StaffNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const overview: StaffNavItem = { href: ROUTES.dashboard, label: "Overview", icon: LayoutDashboard };
const appointments = (label = "Appointments"): StaffNavItem => ({ href: ROUTES.staffAppointments, label, icon: CalendarDays });
const patients: StaffNavItem = { href: ROUTES.patients, label: "Patients", icon: UsersRound };
const labOrders = (label: string): StaffNavItem => ({ href: ROUTES.labQueue, label, icon: FlaskConical });
const prescriptions = (label: string): StaffNavItem => ({ href: ROUTES.rxQueue, label, icon: Pill });
const invoices: StaffNavItem = { href: ROUTES.invoiceQueue, label: "Bills", icon: Receipt };
const payments: StaffNavItem = { href: ROUTES.paymentList, label: "Payments", icon: Wallet };
const medicines: StaffNavItem = { href: ROUTES.medicines, label: "Medicines", icon: Stethoscope };
const inventory: StaffNavItem = { href: ROUTES.inventory, label: "Stock alerts", icon: Package };
const beds: StaffNavItem = { href: ROUTES.beds, label: "Beds", icon: BedDouble };
const staff: StaffNavItem = { href: ROUTES.staffDirectory, label: "Staff", icon: Users };
const departments: StaffNavItem = { href: ROUTES.departments, label: "Departments", icon: Building2 };
const settings: StaffNavItem = { href: ROUTES.settings, label: "Settings", icon: Settings };
const audit: StaffNavItem = { href: ROUTES.auditLog, label: "Audit log", icon: ClipboardList };

/**
 * Role-scoped navigation (docs/04-UI-UX.md §2.4, §6): a role sees only what
 * it can open; unreachable destinations are left out, not greyed out. This
 * mirrors the API's RBAC for convenience only; the API enforces it.
 */
export const STAFF_NAV: Partial<Record<UserRole, StaffNavItem[]>> = {
  [UserRole.SUPER_ADMIN]: [overview, audit],
  [UserRole.HOSPITAL_ADMIN]: [
    overview,
    appointments(),
    patients,
    invoices,
    payments,
    medicines,
    inventory,
    beds,
    staff,
    departments,
    settings,
    audit,
  ],
  [UserRole.DOCTOR]: [overview, appointments("My schedule"), patients, labOrders("My lab orders"), prescriptions("My prescriptions")],
  [UserRole.NURSE]: [overview, appointments(), patients, beds],
  [UserRole.RECEPTIONIST]: [overview, appointments("Schedule"), patients, invoices],
  [UserRole.LAB_TECHNICIAN]: [overview, labOrders("Lab queue")],
  [UserRole.PHARMACIST]: [overview, prescriptions("Dispensing queue"), medicines, inventory],
  [UserRole.ACCOUNTANT]: [overview, invoices, payments],
};

const { HOSPITAL_ADMIN: HA, DOCTOR: DOC, NURSE: NUR, RECEPTIONIST: REC, LAB_TECHNICIAN: LAB, PHARMACIST: PHM, ACCOUNTANT: ACC } =
  UserRole;

/**
 * Screens reached from a list rather than the sidebar (Phase 13B), keyed by
 * a route pattern. Each follows the API's roles for the action the screen
 * performs (docs/07-RBAC-MATRIX.md).
 */
export const WORKFLOW_ACCESS: Record<string, UserRole[]> = {
  "/dashboard/patients/new": [HA, REC],
  "/dashboard/patients/:id": [HA, DOC, NUR, REC],
  "/dashboard/appointments/new": [REC, DOC],
  "/dashboard/appointments/:id": [HA, DOC, NUR, REC],
  "/dashboard/encounters/:id": [DOC, NUR],
  "/dashboard/lab-orders/:id": [LAB, DOC, NUR],
  "/dashboard/prescriptions/:id": [PHM, DOC, NUR],
  "/dashboard/medicines/:id": [PHM, HA],
  "/dashboard/invoices/:id": [REC, ACC, HA],
};

export function navFor(role: UserRole): StaffNavItem[] {
  return STAFF_NAV[role] ?? [overview];
}

/** Whether a role can open `route`: a sidebar destination, or a workflow
 * screen pattern from `WORKFLOW_ACCESS` (pages use it to refuse a
 * hand-typed URL with a clear message instead of a failed request). */
export function canOpen(role: UserRole, route: string): boolean {
  if (route in WORKFLOW_ACCESS) return WORKFLOW_ACCESS[route].includes(role);
  return navFor(role).some((item) => item.href === route);
}

export const BRAND_ICON = Activity;
