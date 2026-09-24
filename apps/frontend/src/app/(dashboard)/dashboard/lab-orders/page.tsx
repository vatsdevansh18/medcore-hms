"use client";

import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { UserRole, type LabQueueRow } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { RowLink } from "@/components/shared/detail-list";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { useLabQueue } from "@/services/staff";
import { listParam, useUrlFilters } from "@/hooks/use-url-filters";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatDateTime, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

const OPEN = "ORDERED,SAMPLE_COLLECTED,IN_PROGRESS,RESULT_UPLOADED";

function LabList() {
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const isLab = role === UserRole.LAB_TECHNICIAN;
  const { values, page, set, setPage } = useUrlFilters(["status", "priority"] as const);
  const status = values.status || (isLab ? OPEN : "");
  const list = useLabQueue({ status: listParam(status), priority: values.priority || undefined }, page);

  const columns: Column<LabQueueRow>[] = [
    {
      key: "priority",
      header: "Priority",
      cell: (o) =>
        o.priority === "URGENT" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
            <AlertTriangle className="size-3.5" aria-hidden="true" /> Urgent
          </span>
        ) : (
          <span className="text-xs text-muted">Routine</span>
        ),
    },
    { key: "patient", header: "Patient", cell: (o) => personName(o.patient) },
    { key: "tests", header: "Tests", cell: (o) => <RowLink href={ROUTES.labOrder(o.id)}>{o.items.map((i) => i.labTest.name).join(", ")}</RowLink> },
    ...(isLab ? [{ key: "doctor", header: "Ordered by", cell: (o: LabQueueRow) => doctorName(o.doctor.user), hideOnMobile: true }] : []),
    { key: "ordered", header: "Ordered", cell: (o) => formatDateTime(o.createdAt, timeZone), hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      cell: (o) => (
        <div className="flex flex-col items-start gap-1">
          {o.items.map((i) => (
            <StatusBadge key={i.id} status={i.status} kind="lab" />
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={isLab ? "Lab queue" : "My lab orders"}
        description={isLab ? "Urgent orders first, then oldest first." : "Orders you placed, newest first."}
      />
      <FilterBar>
        <FilterSelect
          id="status"
          label="Stage"
          value={status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: OPEN, label: "Open (not yet approved)" },
            { value: "ORDERED", label: "To collect" },
            { value: "SAMPLE_COLLECTED", label: "Collected" },
            { value: "IN_PROGRESS", label: "Testing" },
            { value: "RESULT_UPLOADED", label: "Awaiting approval" },
            { value: "APPROVED", label: "Result ready" },
            { value: "REJECTED", label: "Rejected" },
            ...(isLab ? [] : [{ value: "", label: "Any stage" }]),
          ]}
        />
        <FilterSelect
          id="priority"
          label="Priority"
          value={values.priority}
          onChange={(v) => set({ priority: v })}
          options={[
            { value: "", label: "Any priority" },
            { value: "URGENT", label: "Urgent" },
            { value: "ROUTINE", label: "Routine" },
          ]}
        />
      </FilterBar>
      <DataTable
        caption="Lab orders"
        columns={columns}
        rows={list.data?.data}
        rowKey={(o) => o.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No lab orders match", description: "Try another stage or priority." }}
        density="compact"
      />
    </>
  );
}

export default function LabOrdersPage() {
  return (
    <RoleGate route={ROUTES.labQueue}>
      <Suspense fallback={<FullPageLoader />}>
        <LabList />
      </Suspense>
    </RoleGate>
  );
}
