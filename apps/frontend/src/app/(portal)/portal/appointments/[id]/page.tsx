"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AppointmentView, SlotView } from "@medcore/types";
import { AppointmentStatus, AppointmentType } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError, ListSkeleton } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { SlotPicker } from "@/components/modules/slot-picker";
import { useAppointment, useCancelAppointment, useRescheduleAppointment } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { doctorName, formatDateTime } from "@/lib/format";
import { cancelAppointmentSchema, type CancelAppointmentValues } from "@/lib/validation";
import { ROUTES } from "@/constants";
import { canCancel as patientCanCancel, canReschedule } from "@/lib/appointment-rules";

function CancelDialog({ appointment, open, onOpenChange }: { appointment: AppointmentView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const cancel = useCancelAppointment(appointment.id);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CancelAppointmentValues>({ resolver: zodResolver(cancelAppointmentSchema), defaultValues: { reason: "" } });
  const submit = handleSubmit(async ({ reason }) => {
    try {
      await cancel.mutateAsync(reason);
      onOpenChange(false);
      toast.success("Appointment cancelled.");
    } catch {
      // Shown in the dialog.
    }
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel this appointment?"
      consequence="The hospital will free this time for other patients. You can book a new appointment afterwards."
      confirmLabel="Cancel appointment"
      destructive
      pending={cancel.isPending}
      error={cancel.error}
      onConfirm={() => void submit()}
    >
      <FormField label="Reason" error={errors.reason?.message}>
        <Textarea rows={2} maxLength={500} {...register("reason")} />
      </FormField>
    </ConfirmDialog>
  );
}

function RescheduleDialog({ appointment, open, onOpenChange }: { appointment: AppointmentView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { timezone } = useHospital();
  const [slot, setSlot] = useState<SlotView | null>(null);
  const reschedule = useRescheduleAppointment(appointment.id);
  async function submit() {
    if (!slot) return;
    try {
      await reschedule.mutateAsync({ scheduledStart: slot.start, scheduledEnd: slot.end });
      onOpenChange(false);
      setSlot(null);
      toast.success("Appointment moved. The hospital will confirm the new time.");
    } catch {
      setSlot(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Choose a new time</DialogTitle>
        <DialogDescription>
          Same doctor. {appointment.status === AppointmentStatus.CONFIRMED
            ? "Your appointment will need to be confirmed again for the new time."
            : "The hospital will confirm the new time."}
        </DialogDescription>
        <div className="mt-4">
          <SlotPicker doctorId={appointment.doctorId} selected={slot} onSelect={setSlot} excludeStart={appointment.scheduledStart} />
        </div>
        {reschedule.isError && (
          <div className="mt-4">
            <FormError error={reschedule.error} />
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Keep current time
          </Button>
          <Button disabled={!slot} loading={reschedule.isPending} onClick={() => void submit()}>
            {slot ? `Move to ${formatDateTime(slot.start, timezone)}` : "Move appointment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const hospital = useHospital();
  const appointment = useAppointment(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const back = { href: ROUTES.appointments, label: "Appointments" };
  if (appointment.isPending) {
    return (
      <>
        <PageHeader title="Appointment" back={back} />
        <ListSkeleton rows={1} />
      </>
    );
  }
  if (appointment.isError) {
    return (
      <>
        <PageHeader title="Appointment" back={back} />
        <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />
      </>
    );
  }

  const a = appointment.data;
  const reschedule = canReschedule(a, hospital);
  const blocker = reschedule.allowed ? null : reschedule.reason;
  const canCancel = patientCanCancel(a);

  return (
    <>
      <PageHeader
        title={formatDateTime(a.scheduledStart, hospital.timezone)}
        description={`${doctorName(a.doctor.user)} · ${a.doctor.specialization}`}
        back={back}
        actions={
          <>
            {reschedule.allowed && <Button onClick={() => setRescheduleOpen(true)}>Reschedule</Button>}
            {canCancel && (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <StatusBadge status={a.status} />
        </CardHeader>
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-muted">Type</dt>
            <dd>{a.type === AppointmentType.EMERGENCY ? "Emergency" : a.type === AppointmentType.FOLLOW_UP ? "Follow-up" : "Regular visit"}</dd>
            <dt className="text-muted">Ends</dt>
            <dd>{formatDateTime(a.scheduledEnd, hospital.timezone)}</dd>
            <dt className="text-muted">Reason for visit</dt>
            <dd>{a.reasonForVisit || "—"}</dd>
            {a.cancelledReason && (
              <>
                <dt className="text-muted">Cancellation reason</dt>
                <dd>{a.cancelledReason}</dd>
              </>
            )}
          </dl>
          {blocker && (
            <p className="mt-4 rounded-md bg-surface-muted px-3 py-2 text-sm text-muted">{blocker}</p>
          )}
          {a.status === AppointmentStatus.CONFIRMED && (
            <p className="mt-4 text-sm text-muted">
              To cancel a confirmed appointment, please contact the hospital&apos;s front desk.
            </p>
          )}
        </CardBody>
      </Card>
      <CancelDialog appointment={a} open={cancelOpen} onOpenChange={setCancelOpen} />
      <RescheduleDialog appointment={a} open={rescheduleOpen} onOpenChange={setRescheduleOpen} />
    </>
  );
}
