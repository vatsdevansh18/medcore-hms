"use client";

import { use, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { AppointmentStatus, UserRole, type AppointmentView, type MedicalRecordView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DetailList } from "@/components/shared/detail-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { StartEncounterForm } from "@/components/modules/encounter/start-encounter-form";
import { VitalsPanel } from "@/components/modules/encounter/vitals-panel";
import { AddendaPanel, AllergiesPanel } from "@/components/modules/encounter/notes-panels";
import { AttachmentsPanel, FamilyHistoryPanel, VaccinationsPanel } from "@/components/modules/encounter/history-panels";
import { PrescriptionPanel } from "@/components/modules/encounter/prescription-panel";
import { LabOrderPanel } from "@/components/modules/encounter/lab-order-panel";
import { useEncounterRecord, useStaffAppointment, useUpdateAppointmentStatus } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatDateTime, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

function CompleteVisit({ appointment }: { appointment: AppointmentView }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateAppointmentStatus(appointment.id);
  async function complete() {
    try {
      await update.mutateAsync({ status: AppointmentStatus.COMPLETED });
      setOpen(false);
      toast.success("Visit completed.");
    } catch {
      // Shown in the dialog.
    }
  }
  return (
    <>
      <Button
        onClick={() => {
          update.reset();
          setOpen(true);
        }}
      >
        <CheckCircle2 aria-hidden="true" /> Complete visit
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Complete this visit?"
        consequence="This ends the visit. You can still add addenda, and the front desk can finalise the bill."
        confirmLabel="Complete visit"
        pending={update.isPending}
        error={update.error}
        onConfirm={() => void complete()}
      />
    </>
  );
}

function RecordSummary({ record }: { record: MedicalRecordView }) {
  return (
    <Panel title="Encounter">
      <DetailList
        items={[
          ["Chief complaint", record.chiefComplaint],
          ["Presenting symptoms", record.presentingSymptoms],
          ["Diagnosis", record.diagnosisNotes],
          ["ICD-10", record.confirmedDiagnosisIcd10.length ? record.confirmedDiagnosisIcd10.join(", ") : null],
          ["Treatment plan", record.treatmentPlan],
          ["Clinical notes", record.notes ? <span className="whitespace-pre-wrap">{record.notes}</span> : null],
        ]}
      />
    </Panel>
  );
}

/**
 * The encounter workspace (FR-EMR-*, FR-RX-*, FR-LAB-001): one screen per
 * visit, opened from the appointment. The visit's doctor starts the record,
 * prescribes, and orders tests; nurses record vitals, allergies, and
 * addenda. Every action is checked again by the API.
 */
function Encounter({ appointmentId }: { appointmentId: string }) {
  const user = useAuthStore((s) => s.user);
  const timeZone = useWorkspaceTimeZone();
  const appointment = useStaffAppointment(appointmentId);
  const record = useEncounterRecord(appointmentId);

  if (appointment.isPending || record.isPending) return <Skeleton className="h-96" />;
  if (appointment.isError) return <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />;
  if (record.isError) return <ErrorState error={record.error} onRetry={() => void record.refetch()} />;
  if (!user) return null;

  const a = appointment.data;
  const r = record.data;
  const isDoctor = user.role === UserRole.DOCTOR;
  const ownVisit = isDoctor && user.doctorProfileId === a.doctorId;
  const inProgress = a.status === AppointmentStatus.IN_PROGRESS;

  const header = (
    <PageHeader
      title={personName(a.patient.user)}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusBadge status={a.status} />
          <span>
            {formatDateTime(a.scheduledStart, timeZone)} · {doctorName(a.doctor.user)}
          </span>
        </span>
      }
      back={{ href: ROUTES.staffAppointment(a.id), label: "Appointment" }}
      actions={ownVisit && inProgress && r ? <CompleteVisit appointment={a} /> : undefined}
    />
  );

  if (!r) {
    return (
      <>
        {header}
        {ownVisit && inProgress ? (
          <Panel title="Start the encounter" className="max-w-3xl">
            <StartEncounterForm appointmentId={a.id} reason={a.reasonForVisit} />
          </Panel>
        ) : (
          <EmptyState
            title="The encounter hasn't been started"
            description={
              ownVisit
                ? "Start the visit from the appointment first."
                : "The visit's doctor opens the record when the consultation begins. Vitals can be recorded after that."
            }
            action={
              <Link href={ROUTES.staffAppointment(a.id)} className="text-primary hover:underline">
                Back to the appointment
              </Link>
            }
          />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <RecordSummary record={r} />
          {isDoctor && <PrescriptionPanel recordId={r.id} canWrite={ownVisit} />}
          {isDoctor && <LabOrderPanel recordId={r.id} canWrite={ownVisit} />}
          <AttachmentsPanel recordId={r.id} attachments={r.attachments} />
          <AddendaPanel recordId={r.id} addenda={r.addenda} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <VitalsPanel recordId={r.id} vitals={r.vitals} />
          <AllergiesPanel patientId={a.patientId} />
          <VaccinationsPanel patientId={a.patientId} />
          <FamilyHistoryPanel patientId={a.patientId} />
        </div>
      </div>
    </>
  );
}

export default function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/encounters/:id">
      <Encounter appointmentId={id} />
    </RoleGate>
  );
}
