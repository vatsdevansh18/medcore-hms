"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserRole } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { ROUTES } from "@/constants";

/**
 * Staff roles sign in fine, but their dashboards are Phase 13
 * (docs/05-DEVELOPMENT-PLAN.md). This page says so plainly instead of
 * showing a mock dashboard. Staff use the API (Swagger) until then.
 */
export default function StaffHomePage() {
  const { status, user, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace(ROUTES.login);
    if (status === "authenticated" && user?.role === UserRole.PATIENT) router.replace(ROUTES.portal);
  }, [status, user, router]);

  if (status !== "authenticated" || !user || user.role === UserRole.PATIENT) return <FullPageLoader />;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Signed in as {user.firstName}</h1>
      <p className="text-muted">
        The {user.role.replace(/_/g, " ").toLowerCase()} workspace isn&apos;t available in the web app yet. Role
        dashboards are being built in the next phase. The patient portal is the only web workspace today.
      </p>
      <div>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
