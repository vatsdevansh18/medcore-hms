"use client";

import { Suspense } from "react";
import { UserRole, type AuditLogView } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { useAuditLogs } from "@/services/staff";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { formatDateTime } from "@/lib/format";
import { ROUTES } from "@/constants";

const ENTITY_TYPES = [
  "Appointment",
  "MedicalRecord",
  "Prescription",
  "LabOrder",
  "LabResult",
  "Invoice",
  "Payment",
  "MedicineBatch",
  "DispenseRecord",
  "User",
  "Bed",
];

function AuditList() {
  const timeZone = useWorkspaceTimeZone();
  const platform = useAuthStore((s) => s.user?.role === UserRole.SUPER_ADMIN);
  const { values, page, set, setPage } = useUrlFilters(["entityType"] as const);
  const list = useAuditLogs({ entityType: values.entityType || undefined }, page);
  const columns: Column<AuditLogView>[] = [
    { key: "when", header: "When", cell: (r) => formatDateTime(r.createdAt, timeZone) },
    {
      key: "actor",
      header: "Who",
      cell: (r) =>
        r.actor ? (
          <>
            {r.actor.firstName} {r.actor.lastName}
            <span className="block text-xs text-subtle">{r.actor.role.replace(/_/g, " ").toLowerCase()}</span>
          </>
        ) : (
          <span className="text-muted">System</span>
        ),
    },
    { key: "action", header: "Action", cell: (r) => r.action.toLowerCase() },
    { key: "entity", header: "Record", cell: (r) => r.entityType },
    { key: "id", header: "Record id", cell: (r) => <code className="text-xs text-subtle">{r.entityId.slice(0, 8)}</code>, hideOnMobile: true },
  ];
  return (
    <>
      <PageHeader
        title="Audit log"
        description={`Who changed what, newest first${platform ? ", across every hospital" : ""}. Record contents aren't shown here.`}
      />
      <FilterBar>
        <FilterSelect
          id="entityType"
          label="Record type"
          value={values.entityType}
          onChange={(v) => set({ entityType: v })}
          options={[{ value: "", label: "Everything" }, ...ENTITY_TYPES.map((t) => ({ value: t, label: t }))]}
        />
      </FilterBar>
      <DataTable
        caption="Audit log"
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No recorded activity" }}
        density="compact"
      />
    </>
  );
}

export default function AuditPage() {
  return (
    <RoleGate route={ROUTES.auditLog}>
      <Suspense fallback={<FullPageLoader />}>
        <AuditList />
      </Suspense>
    </RoleGate>
  );
}
