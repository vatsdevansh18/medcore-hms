"use client";

import { Suspense } from "react";
import { UserRole, type PrescriptionQueueRow } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { RowLink } from "@/components/shared/detail-list";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { usePrescriptionQueue } from "@/services/staff";
import { listParam, useUrlFilters } from "@/hooks/use-url-filters";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatDateTime, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

const TO_DISPENSE = "ISSUED,PARTIALLY_DISPENSED";

function PrescriptionList() {
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const isPharmacist = role === UserRole.PHARMACIST;
  const { values, page, set, setPage } = useUrlFilters(["status"] as const);
  const status = values.status || (isPharmacist ? TO_DISPENSE : "");
  const list = usePrescriptionQueue({ status: listParam(status) }, page);

  const columns: Column<PrescriptionQueueRow>[] = [
    { key: "written", header: "Written", cell: (p) => <RowLink href={ROUTES.staffPrescription(p.id)}>{formatDateTime(p.createdAt, timeZone)}</RowLink> },
    { key: "patient", header: "Patient", cell: (p) => personName(p.patient) },
    {
      key: "medicines",
      header: "Medicines",
      cell: (p) => (
        <ul>
          {p.items.map((i) => (
            <li key={i.id}>
              {i.medicine.name} <span className="text-subtle">× {i.quantityPrescribed}</span>
            </li>
          ))}
        </ul>
      ),
    },
    ...(isPharmacist ? [{ key: "doctor", header: "Doctor", cell: (p: PrescriptionQueueRow) => doctorName(p.doctor.user), hideOnMobile: true }] : []),
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} kind="staff-rx" /> },
  ];

  return (
    <>
      <PageHeader
        title={isPharmacist ? "Dispensing queue" : "My prescriptions"}
        description={isPharmacist ? "Oldest first." : "Newest first."}
      />
      <FilterBar>
        <FilterSelect
          id="status"
          label="Status"
          value={status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: TO_DISPENSE, label: "To dispense" },
            { value: "DISPENSED", label: "Dispensed" },
            { value: "CANCELLED", label: "Replaced by a correction" },
            ...(isPharmacist ? [] : [{ value: "", label: "Any status" }]),
          ]}
        />
      </FilterBar>
      <DataTable
        caption="Prescriptions"
        columns={columns}
        rows={list.data?.data}
        rowKey={(p) => p.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No prescriptions match" }}
      />
    </>
  );
}

export default function PrescriptionsQueuePage() {
  return (
    <RoleGate route={ROUTES.rxQueue}>
      <Suspense fallback={<FullPageLoader />}>
        <PrescriptionList />
      </Suspense>
    </RoleGate>
  );
}
