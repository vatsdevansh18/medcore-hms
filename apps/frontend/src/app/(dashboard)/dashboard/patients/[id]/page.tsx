"use client";

import { use, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Siren } from "lucide-react";
import { UserRole, type AppointmentView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DetailList, RowLink } from "@/components/shared/detail-list";
import { ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { RoleGate } from "@/components/modules/role-gate";
import { usePatient, usePatientAppointments, useStaffAllergies } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatCalendarDate, formatDateTime, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

function Allergies({ patientId }: { patientId: string }) {
  const allergies = useStaffAllergies(patientId);
  if (allergies.isPending) return <Skeleton className="h-10" />;
  if (allergies.isError) return <ErrorState error={allergies.error} onRetry={() => void allergies.refetch()} />;
  if (allergies.data.length === 0) return <p className="text-sm text-muted">No known allergies recorded.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {allergies.data.map((a) => (
        <li key={a.id}>
          <span className="font-medium">{a.allergen}</span>
          {a.severity && <span className="text-muted"> · {a.severity.toLowerCase()}</span>}
          {a.reaction && <span className="text-muted"> · {a.reaction}</span>}
        </li>
      ))}
    </ul>
  );
}

function PatientDetail({ id }: { id: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const [page, setPage] = useState(1);
  const patient = usePatient(id);
  const visits = usePatientAppointments(id, page);
  const clinical = role === UserRole.DOCTOR || role === UserRole.NURSE;
  const canBook = role === UserRole.RECEPTIONIST;
  const canEmergency = role === UserRole.RECEPTIONIST || role === UserRole.DOCTOR;

  if (patient.isPending) return <Skeleton className="h-64" />;
  if (patient.isError) return <ErrorState error={patient.error} onRetry={() => void patient.refetch()} />;
  const p = patient.data;

  const columns: Column<AppointmentView>[] = [
    { key: "when", header: "When", cell: (a) => <RowLink href={ROUTES.staffAppointment(a.id)}>{formatDateTime(a.scheduledStart, timeZone)}</RowLink> },
    { key: "doctor", header: "Doctor", cell: (a) => `${doctorName(a.doctor.user)} · ${a.doctor.specialization}`, hideOnMobile: true },
    { key: "reason", header: "Reason", cell: (a) => a.reasonForVisit ?? "—", hideOnMobile: true },
    { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={personName(p.user)}
        description="Patient profile and visits at this hospital."
        back={{ href: ROUTES.patients, label: "Patients" }}
        actions={
          <>
            {canEmergency && (
              <Button asChild variant="secondary">
                <Link href={`${ROUTES.newAppointment}?patientId=${p.id}&type=emergency`}>
                  <Siren aria-hidden="true" /> Emergency visit
                </Link>
              </Button>
            )}
            {canBook && (
              <Button asChild>
                <Link href={`${ROUTES.newAppointment}?patientId=${p.id}`}>
                  <CalendarPlus aria-hidden="true" /> Book appointment
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Details" className="lg:col-span-2">
          <DetailList
            items={[
              ["Email", p.user.email],
              ["Mobile", p.user.phone],
              ["Date of birth", p.dob ? formatCalendarDate(p.dob) : null],
              ["Gender", p.gender ? p.gender.charAt(0) + p.gender.slice(1).toLowerCase() : null],
              ["Blood group", p.bloodGroup],
              ["Emergency contact", p.emergencyContactName ? `${p.emergencyContactName} ${p.emergencyContactPhone ?? ""}`.trim() : null],
            ]}
          />
        </Panel>
        {clinical && (
          <Panel title="Allergies">
            <Allergies patientId={p.id} />
          </Panel>
        )}
      </div>
      <h2 className="mb-3 mt-6 text-lg font-semibold">Visits</h2>
      <DataTable
        caption="Visits"
        columns={columns}
        rows={visits.data?.data}
        rowKey={(a) => a.id}
        meta={visits.data?.meta}
        onPage={setPage}
        loading={visits.isPending}
        error={visits.error}
        onRetry={() => void visits.refetch()}
        empty={{
          title: role === UserRole.DOCTOR ? "No visits with you" : "No visits yet",
          description: canBook ? "Book this patient's first appointment." : undefined,
        }}
      />
    </>
  );
}

export default function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/patients/:id">
      <PatientDetail id={id} />
    </RoleGate>
  );
}
