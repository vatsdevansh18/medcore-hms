"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UserRole } from "@medcore/types";
import { homeFor, useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { ROUTES } from "@/constants";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { AppShell } from "@/components/modules/app-shell";
import { PORTAL_NAV } from "@/components/modules/portal-nav";

/**
 * The patient portal shell (docs/04-UI-UX.md §2.4, mobile-first per §4).
 * Signed-out visitors go to sign-in; staff go to their own workspace. This
 * is UX only: every API call is authorized server-side (FR-RBAC-002).
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useRealtime();

  useEffect(() => {
    if (status === "anonymous") router.replace(`${ROUTES.login}?next=${encodeURIComponent(pathname)}`);
    else if (status === "authenticated" && user && user.role !== UserRole.PATIENT) router.replace(homeFor(user.role));
  }, [status, user, router, pathname]);

  if (status !== "authenticated" || !user || user.role !== UserRole.PATIENT) return <FullPageLoader />;

  return (
    <AppShell
      items={PORTAL_NAV}
      home={ROUTES.portal}
      navLabel="Portal"
      context={user.hospital?.name}
      userName={`${user.firstName} ${user.lastName}`}
      onLogout={() => void logout()}
    >
      {children}
    </AppShell>
  );
}
