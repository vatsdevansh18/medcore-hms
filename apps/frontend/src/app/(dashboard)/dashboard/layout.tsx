"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserRole } from "@medcore/types";
import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { ROUTES } from "@/constants";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { AppShell } from "@/components/modules/app-shell";
import { GlobalSearch } from "@/components/modules/global-search";
import { navFor } from "@/components/modules/staff-nav";

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  HOSPITAL_ADMIN: "Hospital Admin",
  DOCTOR: "Doctor",
  NURSE: "Nurse",
  RECEPTIONIST: "Receptionist",
  LAB_TECHNICIAN: "Lab Technician",
  PHARMACIST: "Pharmacist",
  ACCOUNTANT: "Accountant",
  PATIENT: "Patient",
};

/**
 * The staff workspace shell (Phase 13): role-scoped navigation, global
 * search for roles that have it, live notifications. Desktop-first per
 * docs/04-UI-UX.md §4, but usable on a phone for quick lookups.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useRealtime();

  useEffect(() => {
    if (status === "anonymous") router.replace(`${ROUTES.login}?next=${encodeURIComponent(pathname)}`);
    else if (status === "authenticated" && user?.role === UserRole.PATIENT) router.replace(ROUTES.portal);
  }, [status, user, router, pathname]);

  if (status !== "authenticated" || !user || user.role === UserRole.PATIENT) return <FullPageLoader />;

  const platform = user.role === UserRole.SUPER_ADMIN;
  return (
    <AppShell
      items={navFor(user.role)}
      home={ROUTES.dashboard}
      navLabel="Workspace"
      context={`${platform ? "All hospitals" : (user.hospital?.name ?? "")} · ${ROLE_LABEL[user.role]}`}
      userName={`${user.firstName} ${user.lastName}`}
      onLogout={() => void logout()}
      search={platform ? undefined : <GlobalSearch />}
      maxWidth="max-w-7xl"
    >
      {children}
    </AppShell>
  );
}
