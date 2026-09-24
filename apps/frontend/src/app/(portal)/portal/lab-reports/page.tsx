"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LabOrderItemStatus } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useLabOrders } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { doctorName, formatDate } from "@/lib/format";
import { ROUTES } from "@/constants";

export default function LabReportsPage() {
  const [page, setPage] = useState(1);
  const { timezone } = useHospital();
  const orders = useLabOrders(page);

  return (
    <>
      <PageHeader title="Lab reports" description="Results appear once the lab has reviewed and approved them." />
      {orders.isPending ? (
        <ListSkeleton />
      ) : orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : orders.data.data.length === 0 ? (
        <EmptyState title="No lab tests yet" description="Tests your doctor orders will be tracked here." />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {orders.data.data.map((o) => {
              const ready = o.items.filter((i) => i.status === LabOrderItemStatus.APPROVED).length;
              return (
                <li key={o.id}>
                  <Link
                    href={ROUTES.labReport(o.id)}
                    className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {formatDate(o.createdAt, timezone)}
                        {o.priority === "URGENT" && <span className="ml-2 text-xs font-medium text-danger">Urgent</span>}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-muted">{o.items.map((i) => i.labTest.name).join(", ")}</p>
                      <p className="mt-0.5 text-sm text-subtle">
                        {doctorName(o.doctor.user)} · {ready} of {o.items.length} results ready
                      </p>
                    </div>
                    <StatusBadge
                      status={ready === o.items.length ? LabOrderItemStatus.APPROVED : LabOrderItemStatus.IN_PROGRESS}
                      kind="lab"
                    />
                    <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination meta={orders.data.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
