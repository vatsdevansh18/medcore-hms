"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { usePrescriptions } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { doctorName, formatDate } from "@/lib/format";
import { ROUTES } from "@/constants";

export default function PrescriptionsPage() {
  const [page, setPage] = useState(1);
  const { timezone } = useHospital();
  const prescriptions = usePrescriptions(page);

  return (
    <>
      <PageHeader title="Prescriptions" description="Medicines your doctors have prescribed. Collect them at the hospital pharmacy." />
      {prescriptions.isPending ? (
        <ListSkeleton />
      ) : prescriptions.isError ? (
        <ErrorState error={prescriptions.error} onRetry={() => void prescriptions.refetch()} />
      ) : prescriptions.data.data.length === 0 ? (
        <EmptyState title="No prescriptions yet" description="Prescriptions from your visits will be listed here." />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {prescriptions.data.data.map((p) => (
              <li key={p.id}>
                <Link
                  href={ROUTES.prescription(p.id)}
                  className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{formatDate(p.createdAt, timezone)}</p>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {p.items.map((i) => i.medicine.name).join(", ")}
                    </p>
                    {p.doctor && <p className="mt-0.5 text-sm text-subtle">{doctorName(p.doctor.user)}</p>}
                  </div>
                  <StatusBadge status={p.status} />
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination meta={prescriptions.data.meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
