"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useInvoices } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { formatDate, formatMoney } from "@/lib/format";
import { ROUTES } from "@/constants";

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const { timezone } = useHospital();
  const invoices = useInvoices(page);

  return (
    <>
      <PageHeader title="Bills & payments" description="Bills appear here once the hospital has finalised them." />
      {invoices.isPending ? (
        <ListSkeleton />
      ) : invoices.isError ? (
        <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoices.data.data.length === 0 ? (
        <EmptyState title="No bills yet" description="After a visit, your bill is shared here for you to view and pay." />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {invoices.data.data.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={ROUTES.invoice(inv.id)}
                  className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{formatMoney(inv.total, inv.currency)}</p>
                    <p className="mt-0.5 text-sm text-muted">Issued {formatDate(inv.finalizedAt ?? inv.createdAt, timezone)}</p>
                  </div>
                  <StatusBadge status={inv.status} />
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination meta={invoices.data.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
