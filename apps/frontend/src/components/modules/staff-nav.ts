import {
  Activity,
  BedDouble,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Package,
  Pill,
  Receipt,
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
const labOrders = (label: string): StaffNavItem => ({ href: ROUTES.labQueue, label, icon: FlaskConical });
const prescriptions = (label: string): StaffNavItem => ({ href: ROUTES.rxQueue, label, icon: Pill });
const invoices: StaffNavItem = { href: ROUTES.invoiceQueue, label: "Bills", icon: Receipt };
const payments: StaffNavItem = { href: ROUTES.paymentList, label: "Payments", icon: Wallet };
const inventory: StaffNavItem = { href: ROUTES.inventory, label: "Inventory", icon: Package };
const beds: StaffNavItem = { href: ROUTES.beds, label: "Beds", icon: BedDouble };
const audit: StaffNavItem = { href: ROUTES.auditLog, label: "Audit log", icon: ClipboardList };

/**
 * Role-scoped navigation (docs/04-UI-UX.md §2.4, §6): a role sees only what
 * it can open; unreachable destinations are left out, not greyed out. This
 * mirrors the API's RBAC for convenience only; the API enforces it.
 */
export const STAFF_NAV: Partial<Record<UserRole, StaffNavItem[]>> = {
  [UserRole.SUPER_ADMIN]: [overview, audit],
  [UserRole.HOSPITAL_ADMIN]: [overview, appointments(), invoices, payments, inventory, beds, audit],
  [UserRole.DOCTOR]: [overview, appointments("My schedule"), labOrders("My lab orders"), prescriptions("My prescriptions")],
  [UserRole.NURSE]: [overview, appointments(), beds],
  [UserRole.RECEPTIONIST]: [overview, appointments("Schedule"), invoices],
  [UserRole.LAB_TECHNICIAN]: [overview, labOrders("Lab queue")],
  [UserRole.PHARMACIST]: [overview, prescriptions("Dispensing queue"), inventory],
  [UserRole.ACCOUNTANT]: [overview, invoices, payments],
};

export function navFor(role: UserRole): StaffNavItem[] {
  return STAFF_NAV[role] ?? [overview];
}

/** Whether a role's navigation includes `href` (pages use it to refuse a
 * hand-typed URL with a clear message instead of a failed request). */
export function canOpen(role: UserRole, href: string): boolean {
  return navFor(role).some((item) => item.href === href);
}

export const BRAND_ICON = Activity;
