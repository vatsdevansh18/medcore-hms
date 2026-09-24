"use client";

import { Suspense } from "react";
import type { InvoiceQueueRow } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { RowLink } from "@/components/shared/detail-list";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { useInvoiceQueue } from "@/services/staff";
import { listParam, useUrlFilters } from "@/hooks/use-url-filters";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatDate, formatMoney, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

function InvoiceList() {
  const timeZone = useWorkspaceTimeZone();
  const { values, page, set, setPage } = useUrlFilters(["status"] as const);
  const list = useInvoiceQueue({ status: listParam(values.status) }, page);
  const columns: Column<InvoiceQueueRow>[] = [
    { key: "created", header: "Opened", cell: (i) => <RowLink href={ROUTES.staffInvoice(i.id)}>{formatDate(i.createdAt, timeZone)}</RowLink> },
    { key: "patient", header: "Patient", cell: (i) => personName(i.patient) },
    { key: "finalized", header: "Finalized", cell: (i) => formatDate(i.finalizedAt, timeZone), hideOnMobile: true },
    { key: "total", header: "Total", align: "right", cell: (i) => formatMoney(i.total, i.currency) },
    { key: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
  ];
  return (
    <>
      <PageHeader title="Bills" description="Newest first." />
      <FilterBar>
        <FilterSelect
          id="status"
          label="Status"
          value={values.status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: "", label: "Any status" },
            { value: "DRAFT", label: "Draft" },
            { value: "FINALIZED,PARTIALLY_PAID", label: "Outstanding" },
            { value: "PAID", label: "Paid" },
          ]}
        />
      </FilterBar>
      <DataTable
        caption="Bills"
        columns={columns}
        rows={list.data?.data}
        rowKey={(i) => i.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No bills match" }}
        density="compact"
      />
    </>
  );
}

export default function InvoicesQueuePage() {
  return (
    <RoleGate route={ROUTES.invoiceQueue}>
      <Suspense fallback={<FullPageLoader />}>
        <InvoiceList />
      </Suspense>
    </RoleGate>
  );
}
