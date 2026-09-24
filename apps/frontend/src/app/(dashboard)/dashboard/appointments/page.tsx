"use client";

import { Suspense } from "react";
import type { AppointmentView } from "@medcore/types";
import { UserRole } from "@medcore/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { RowLink } from "@/components/shared/detail-list";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { useDoctorOptions, useStaffAppointments } from "@/services/staff";
import { listParam, useUrlFilters } from "@/hooks/use-url-filters";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatDateTime, personName } from "@/lib/format";
import { dayBounds } from "@/lib/zoned-time";
import { ROUTES } from "@/constants";

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "PENDING", label: "Awaiting confirmation" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED,NO_SHOW", label: "Cancelled or missed" },
];

function AppointmentsList() {
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const { values, page, set, setPage } = useUrlFilters(["status", "doctorId", "date"] as const);
  const isDoctor = role === UserRole.DOCTOR;
  const doctors = useDoctorOptions(!isDoctor);
  const bounds = values.date ? dayBounds(values.date, timeZone) : null;
  const list = useStaffAppointments(
    {
      status: listParam(values.status),
      doctorId: values.doctorId || undefined,
      dateFrom: bounds?.from,
      dateTo: bounds?.to,
      sortOrder: bounds ? "asc" : "desc",
    },
    page,
  );

  const columns: Column<AppointmentView>[] = [
    { key: "when", header: "When", cell: (a) => <RowLink href={ROUTES.staffAppointment(a.id)}>{formatDateTime(a.scheduledStart, timeZone)}</RowLink> },
    { key: "patient", header: "Patient", cell: (a) => personName(a.patient.user) },
    ...(isDoctor ? [] : [{ key: "doctor", header: "Doctor", cell: (a: AppointmentView) => `${doctorName(a.doctor.user)} · ${a.doctor.specialization}`, hideOnMobile: true }]),
    { key: "reason", header: "Reason", cell: (a) => a.reasonForVisit ?? "—", hideOnMobile: true },
    { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <>
      <PageHeader title={isDoctor ? "My schedule" : "Appointments"} description="Newest first; pick a day to see it in time order." />
      <FilterBar>
        <FilterSelect id="status" label="Status" value={values.status} onChange={(v) => set({ status: v })} options={STATUS_OPTIONS} />
        {!isDoctor && (
          <FilterSelect
            id="doctor"
            label="Doctor"
            value={values.doctorId}
            onChange={(v) => set({ doctorId: v })}
            options={[
              { value: "", label: "All doctors" },
              ...(doctors.data?.data ?? []).map((d) => ({ value: d.id, label: `${doctorName(d.user)} · ${d.specialization}` })),
            ]}
          />
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="date" className="text-xs text-muted">
            Day
          </Label>
          <Input id="date" type="date" value={values.date} onChange={(e) => set({ date: e.target.value })} className="h-9 text-sm" />
        </div>
      </FilterBar>
      <DataTable
        caption="Appointments"
        columns={columns}
        rows={list.data?.data}
        rowKey={(a) => a.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No appointments match", description: "Try a different day or status." }}
      />
    </>
  );
}

export default function AppointmentsPage() {
  return (
    <RoleGate route={ROUTES.staffAppointments}>
      <Suspense fallback={<FullPageLoader />}>
        <AppointmentsList />
      </Suspense>
    </RoleGate>
  );
}
