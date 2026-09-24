import { CalendarDays, FileText, FlaskConical, Home, Pill, Receipt, type LucideIcon } from "lucide-react";
import { ROUTES } from "@/constants";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** docs/04-UI-UX.md §6: Patient → Appointments, Records, Reports,
 * Prescriptions, Invoices, Payments (payments live on each invoice). */
export const PORTAL_NAV: NavItem[] = [
  { href: ROUTES.portal, label: "Overview", icon: Home },
  { href: ROUTES.appointments, label: "Appointments", icon: CalendarDays },
  { href: ROUTES.records, label: "Records", icon: FileText },
  { href: ROUTES.labReports, label: "Lab reports", icon: FlaskConical },
  { href: ROUTES.prescriptions, label: "Prescriptions", icon: Pill },
  { href: ROUTES.invoices, label: "Bills & payments", icon: Receipt },
];
