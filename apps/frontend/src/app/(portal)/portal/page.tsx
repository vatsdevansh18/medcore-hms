"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarPlus } from "lucide-react";
import { InvoiceStatus, LabOrderItemStatus } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/states";
import { useAppointments, useInvoices, useLabOrders, usePrescriptions } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ROUTES } from "@/constants";

function Panel({
  title,
  href,
  linkLabel,
  query,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <Link href={href} className="text-sm text-primary hover:underline">
          {linkLabel}
        </Link>
      </CardHeader>
      <CardBody className="flex-1">
        {query.isPending ? (
          <div aria-busy="true" aria-label="Loading">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          children
        )}
      </CardBody>
    </Card>
  );
}

/** docs/04-UI-UX.md §5 Patient: upcoming appointment, latest
 * prescription/report, outstanding bill: a calm summary, not a console. */
export default function PortalOverviewPage() {
  const user = useAuthStore((s) => s.user);
  const { timezone, name } = useHospital();
  const upcoming = useAppointments(1, "upcoming");
  const prescriptions = usePrescriptions(1);
  const labs = useLabOrders(1);
  const invoices = useInvoices(1);

  const next = upcoming.data?.data.find((a) => a.status === "PENDING" || a.status === "CONFIRMED");
  const latestRx = prescriptions.data?.data[0];
  const latestLab = labs.data?.data[0];
  const due = invoices.data?.data.filter(
    (i) => i.status === InvoiceStatus.FINALIZED || i.status === InvoiceStatus.PARTIALLY_PAID,
  );

  return (
    <>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Hello, {user?.firstName}</h1>
          <p className="mt-1 text-sm text-muted">{name}</p>
        </div>
        <Button asChild>
          <Link href={ROUTES.bookAppointment}>
            <CalendarPlus aria-hidden="true" />
            Book appointment
          </Link>
        </Button>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Next appointment" href={ROUTES.appointments} linkLabel="All appointments" query={upcoming}>
          {next ? (
            <Link href={ROUTES.appointment(next.id)} className="block hover:underline">
              <p className="font-medium">{formatDateTime(next.scheduledStart, timezone)}</p>
              <p className="mt-1 text-sm text-muted">{doctorName(next.doctor.user)}</p>
              <StatusBadge status={next.status} className="mt-2" />
            </Link>
          ) : (
            <p className="text-sm text-muted">Nothing booked.</p>
          )}
        </Panel>
        <Panel title="Bills due" href={ROUTES.invoices} linkLabel="All bills" query={invoices}>
          {due && due.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {due.slice(0, 3).map((inv) => (
                <li key={inv.id}>
                  <Link href={ROUTES.invoice(inv.id)} className="flex items-center justify-between gap-2 hover:underline">
                    <span>
                      {formatMoney(inv.total, inv.currency)}{" "}
                      <span className="text-sm text-muted">· {formatDate(inv.finalizedAt ?? inv.createdAt, timezone)}</span>
                    </span>
                    <StatusBadge status={inv.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">You&apos;re all paid up.</p>
          )}
        </Panel>
        <Panel title="Latest prescription" href={ROUTES.prescriptions} linkLabel="All prescriptions" query={prescriptions}>
          {latestRx ? (
            <Link href={ROUTES.prescription(latestRx.id)} className="block hover:underline">
              <p className="font-medium">{formatDate(latestRx.createdAt, timezone)}</p>
              <p className="mt-1 truncate text-sm text-muted">{latestRx.items.map((i) => i.medicine.name).join(", ")}</p>
              <StatusBadge status={latestRx.status} className="mt-2" />
            </Link>
          ) : (
            <p className="text-sm text-muted">No prescriptions yet.</p>
          )}
        </Panel>
        <Panel title="Latest lab tests" href={ROUTES.labReports} linkLabel="All lab reports" query={labs}>
          {latestLab ? (
            <Link href={ROUTES.labReport(latestLab.id)} className="block hover:underline">
              <p className="font-medium">{formatDate(latestLab.createdAt, timezone)}</p>
              <p className="mt-1 truncate text-sm text-muted">{latestLab.items.map((i) => i.labTest.name).join(", ")}</p>
              <p className="mt-1 text-sm text-subtle">
                {latestLab.items.filter((i) => i.status === LabOrderItemStatus.APPROVED).length} of {latestLab.items.length} results ready
              </p>
            </Link>
          ) : (
            <p className="text-sm text-muted">No lab tests yet.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
