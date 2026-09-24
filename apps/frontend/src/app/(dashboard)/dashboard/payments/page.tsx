"use client";

import { Suspense } from "react";
import type { PaymentListView } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { usePaymentList } from "@/services/staff";
import { listParam, useUrlFilters } from "@/hooks/use-url-filters";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatDateTime, formatMoney, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", STRIPE: "Card (Stripe)", RAZORPAY: "UPI / Netbanking" };

function PaymentList() {
  const timeZone = useWorkspaceTimeZone();
  const { values, page, set, setPage } = useUrlFilters(["status", "method"] as const);
  const list = usePaymentList({ status: listParam(values.status), method: listParam(values.method) }, page);
  const columns: Column<PaymentListView>[] = [
    { key: "when", header: "When", cell: (p) => formatDateTime(p.createdAt, timeZone) },
    { key: "patient", header: "Patient", cell: (p) => personName(p.patient) },
    { key: "method", header: "Method", cell: (p) => METHOD_LABEL[p.method] ?? p.method, hideOnMobile: true },
    { key: "amount", header: "Amount", align: "right", cell: (p) => formatMoney(p.amount, p.currency) },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} kind="payment" /> },
  ];
  return (
    <>
      <PageHeader title="Payments" description="For reconciliation: online payments are confirmed by the provider's signed webhook." />
      <FilterBar>
        <FilterSelect
          id="status"
          label="Status"
          value={values.status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: "", label: "Any status" },
            { value: "SUCCEEDED", label: "Succeeded" },
            { value: "PENDING,FAILED", label: "Needs attention (pending or failed)" },
            { value: "PENDING", label: "Pending" },
            { value: "FAILED", label: "Failed" },
          ]}
        />
        <FilterSelect
          id="method"
          label="Method"
          value={values.method}
          onChange={(v) => set({ method: v })}
          options={[{ value: "", label: "Any method" }, ...Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))]}
        />
      </FilterBar>
      <DataTable
        caption="Payments"
        columns={columns}
        rows={list.data?.data}
        rowKey={(p) => p.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No payments match" }}
        density="compact"
      />
    </>
  );
}

export default function PaymentsPage() {
  return (
    <RoleGate route={ROUTES.paymentList}>
      <Suspense fallback={<FullPageLoader />}>
        <PaymentList />
      </Suspense>
    </RoleGate>
  );
}
