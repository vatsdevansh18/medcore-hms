"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { AppointmentCard } from "@/components/modules/appointment-card";
import { useAppointments, type AppointmentFilter } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants";

const TABS: { value: AppointmentFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
];

export default function AppointmentsPage() {
  const [filter, setFilter] = useState<AppointmentFilter>("upcoming");
  const [page, setPage] = useState(1);
  const { timezone } = useHospital();
  const appointments = useAppointments(page, filter);

  const bookButton = (
    <Button asChild>
      <Link href={ROUTES.bookAppointment}>
        <CalendarPlus aria-hidden="true" />
        Book appointment
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="Appointments" actions={bookButton} />
      <div role="tablist" aria-label="Appointment period" className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={filter === tab.value}
            onClick={() => {
              setFilter(tab.value);
              setPage(1);
            }}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              filter === tab.value ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {appointments.isPending ? (
          <ListSkeleton />
        ) : appointments.isError ? (
          <ErrorState error={appointments.error} onRetry={() => void appointments.refetch()} />
        ) : appointments.data.data.length === 0 ? (
          filter === "upcoming" ? (
            <EmptyState title="No upcoming appointments" description="Book a visit with one of the hospital's doctors." action={bookButton} />
          ) : (
            <EmptyState title="No past appointments" description="Visits you've had at this hospital will be listed here." />
          )
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {appointments.data.data.map((a) => (
                <li key={a.id}>
                  <AppointmentCard appointment={a} timeZone={timezone} />
                </li>
              ))}
            </ul>
            <Pagination meta={appointments.data.meta} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
