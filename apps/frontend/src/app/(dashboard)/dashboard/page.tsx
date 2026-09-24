"use client";

import dynamic from "next/dynamic";
import { UserRole } from "@medcore/types";
import { useAuthStore } from "@/store/auth-store";
import { ListSkeleton } from "@/components/shared/states";

/**
 * FR-ANALYTICS-001: each role gets its own dashboard, laid out around its
 * own first-hour-of-shift questions (docs/04-UI-UX.md §5), not one
 * dashboard with swapped labels. Each is a separate chunk loaded only for
 * its role, so only the roles with charts download the charting library
 * (NFR-PERF-003; the combined bundle was 304 kB first load).
 */
const loading = () => <ListSkeleton rows={4} />;
const ops = () => import("@/components/modules/dashboards/operations-dashboards");

const AdminDashboard = dynamic(() => import("@/components/modules/dashboards/admin-dashboard").then((m) => m.AdminDashboard), { loading });
const DoctorDashboard = dynamic(() => import("@/components/modules/dashboards/doctor-dashboard").then((m) => m.DoctorDashboard), { loading });
const NurseDashboard = dynamic(() => ops().then((m) => m.NurseDashboard), { loading });
const ReceptionistDashboard = dynamic(() => ops().then((m) => m.ReceptionistDashboard), { loading });
const LabDashboard = dynamic(() => ops().then((m) => m.LabDashboard), { loading });
const PharmacistDashboard = dynamic(() => ops().then((m) => m.PharmacistDashboard), { loading });
const AccountantDashboard = dynamic(() => ops().then((m) => m.AccountantDashboard), { loading });

export default function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role);
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return <AdminDashboard platform />;
    case UserRole.HOSPITAL_ADMIN:
      return <AdminDashboard />;
    case UserRole.DOCTOR:
      return <DoctorDashboard />;
    case UserRole.NURSE:
      return <NurseDashboard />;
    case UserRole.RECEPTIONIST:
      return <ReceptionistDashboard />;
    case UserRole.LAB_TECHNICIAN:
      return <LabDashboard />;
    case UserRole.PHARMACIST:
      return <PharmacistDashboard />;
    case UserRole.ACCOUNTANT:
      return <AccountantDashboard />;
    default:
      return null;
  }
}
