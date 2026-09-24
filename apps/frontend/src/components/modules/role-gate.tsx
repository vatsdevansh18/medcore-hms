"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/auth-store";
import { EmptyState } from "@/components/shared/states";
import { ROUTES } from "@/constants";
import { canOpen } from "./staff-nav";

/**
 * Pages outside a role's navigation say so plainly instead of firing
 * requests the API would refuse with 403. UX only: the API enforces
 * every permission itself (FR-RBAC-002).
 */
export function RoleGate({ route, children }: { route: string; children: ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);
  if (!role) return null;
  if (!canOpen(role, route)) {
    return (
      <EmptyState
        title="This page isn't part of your workspace"
        description="Your role doesn't have access to it."
        action={
          <Link href={ROUTES.dashboard} className="text-primary hover:underline">
            Back to your dashboard
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}
