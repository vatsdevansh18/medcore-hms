"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Receipt, Stethoscope } from "lucide-react";
import { UserRole, type AppointmentView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DetailList, RowLink } from "@/components/shared/detail-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { useAppointmentInvoices, useOpenInvoice, useStaffAppointment, useUpdateAppointmentStatus } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { actionTarget, appointmentActions, canBill, canOpenEncounter, type AppointmentAction } from "@/lib/appointment-actions";
import { cancelReasonSchema, type CancelReasonValues } from "@/lib/staff-validation";
import { doctorName, formatDateTime, formatMoney, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

const LABEL: Record<AppointmentAction, string> = {
  CONFIRM: "Confirm",
  CHECK_IN: "Check in",
  COMPLETE: "Complete visit",
  NO_SHOW: "Mark as no-show",
  CANCEL: "Cancel appointment",
};

/** Plain-language consequences for the actions that need a confirmation
 * step (docs/04-UI-UX.md §8). Confirm and check-in are routine and reversible
 * in practice, so they go straight through. */
const CONSEQUENCE: Partial<Record<AppointmentAction, string>> = {
  COMPLETE: "This ends the visit. The record stays open for addenda, and the bill can be finalised.",
  NO_SHOW: "This closes the appointment as missed. It can't be reopened; book a new one if the patient arrives later.",
  CANCEL: "This cancels the appointment, frees the slot, and notifies the patient.",
};

/** Cancelling needs a reason (shared with the patient), so it's a small
 * form in the dialog rather than a bare confirm button. */
function CancelDialog({
  onClose,
  onSubmit,
  pending,
  error,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
  error: unknown;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CancelReasonValues>({ resolver: zodResolver(cancelReasonSchema), mode: "onBlur", reValidateMode: "onChange", defaultValues: { reason: "" } });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Cancel this appointment?</DialogTitle>
        <DialogDescription>{CONSEQUENCE.CANCEL}</DialogDescription>
        <form onSubmit={handleSubmit(({ reason }) => onSubmit(reason))} noValidate className="mt-4 flex flex-col gap-2">
          <FormField label="Reason" error={errors.reason?.message} hint="Shared with the patient.">
            <Textarea rows={3} maxLength={500} {...register("reason")} />
          </FormField>
          <FormError error={error} />
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Cancel appointment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Billing({ appointment }: { appointment: AppointmentView }) {
  const router = useRouter();
  const invoices = useAppointmentInvoices(appointment.id);
  const open = useOpenInvoice();
  const start = async () => {
    try {
      const invoice = await open.mutateAsync(appointment.id);
      router.push(ROUTES.staffInvoice(invoice.id));
    } catch {
      // Shown below.
    }
  };
  return (
    <Panel title="Billing">
      {invoices.isPending ? (
        <Skeleton className="h-10" />
      ) : invoices.isError ? (
        <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {invoices.data.data.length === 0 ? (
            <p className="text-sm text-muted">No bill yet. Charges are added automatically as the visit goes on.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {invoices.data.data.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2">
                  <RowLink href={ROUTES.staffInvoice(inv.id)}>{formatMoney(inv.total, inv.currency)}</RowLink>
                  <StatusBadge status={inv.status} />
                </li>
              ))}
            </ul>
          )}
          {!invoices.data.data.some((inv) => inv.status === "DRAFT") &&
            (invoices.data.data.length === 0 ? (
              <div>
                <Button variant="secondary" size="sm" onClick={start} loading={open.isPending}>
                  <Receipt aria-hidden="true" /> Open a bill
                </Button>
              </div>
            ) : (
              <div>
                <Button variant="ghost" size="sm" onClick={start} loading={open.isPending}>
                  <Receipt aria-hidden="true" /> Start a supplementary bill
                </Button>
                <p className="mt-1 text-xs text-muted">Only for charges added after the bill above was finalised.</p>
              </div>
            ))}
          <FormError error={open.error} />
        </div>
      )}
    </Panel>
  );
}

function AppointmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const appointment = useStaffAppointment(id);
  const update = useUpdateAppointmentStatus(id);
  const [pending, setPending] = useState<AppointmentAction | null>(null);

  if (appointment.isPending) return <Skeleton className="h-64" />;
  if (appointment.isError) return <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />;
  const a = appointment.data;
  if (!role) return null;
  const actions = appointmentActions(role, a.status);

  async function run(action: AppointmentAction, cancelledReason?: string) {
    try {
      await update.mutateAsync({ status: actionTarget(action), cancelledReason });
      setPending(null);
      toast.success(`${LABEL[action]}: done.`);
      if (action === "CHECK_IN" && role === UserRole.DOCTOR) router.push(ROUTES.encounter(id));
    } catch {
      // The dialog (or the inline error below) shows update.error.
    }
  }

  function trigger(action: AppointmentAction) {
    update.reset();
    if (CONSEQUENCE[action]) setPending(action);
    else void run(action);
  }

  return (
    <>
      <PageHeader
        title={`${personName(a.patient.user)} · ${formatDateTime(a.scheduledStart, timeZone)}`}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={a.status} />
            {a.type === "EMERGENCY" && <span className="text-xs font-semibold text-danger">Emergency</span>}
          </span>
        }
        back={{ href: ROUTES.staffAppointments, label: "Appointments" }}
        actions={
          <>
            {canOpenEncounter(role, a.status) && (
              <Button asChild>
                <Link href={ROUTES.encounter(a.id)}>
                  <Stethoscope aria-hidden="true" /> {role === UserRole.DOCTOR ? "Encounter" : "Vitals & notes"}
                </Link>
              </Button>
            )}
            {actions.map((action) => (
              <Button
                key={action}
                variant={action === "CANCEL" || action === "NO_SHOW" ? "secondary" : "primary"}
                onClick={() => trigger(action)}
                loading={update.isPending && pending === null}
              >
                {action === "CHECK_IN" && role === UserRole.DOCTOR ? "Start visit" : LABEL[action]}
              </Button>
            ))}
          </>
        }
      />
      {!pending && update.error ? (
        <div className="mb-4">
          <FormError error={update.error} />
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Visit" className="lg:col-span-2">
          <DetailList
            items={[
              ["Patient", <RowLink key="p" href={ROUTES.patient(a.patientId)}>{personName(a.patient.user)}</RowLink>],
              ["Doctor", `${doctorName(a.doctor.user)} · ${a.doctor.specialization}`],
              ["Starts", formatDateTime(a.scheduledStart, timeZone)],
              ["Ends", formatDateTime(a.scheduledEnd, timeZone)],
              ["Reason", a.reasonForVisit],
              ["Booked", formatDateTime(a.createdAt, timeZone)],
              ...(a.cancelledReason ? ([["Cancellation reason", a.cancelledReason]] as [string, string][]) : []),
            ]}
          />
        </Panel>
        {canBill(role, a.status) && <Billing appointment={a} />}
      </div>

      {pending && pending !== "CANCEL" && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={LABEL[pending]}
          consequence={CONSEQUENCE[pending] ?? ""}
          confirmLabel={LABEL[pending]}
          destructive={pending === "NO_SHOW"}
          pending={update.isPending}
          error={update.error}
          onConfirm={() => void run(pending)}
        />
      )}
      {pending === "CANCEL" && (
        <CancelDialog
          onClose={() => setPending(null)}
          onSubmit={(reason) => void run("CANCEL", reason)}
          pending={update.isPending}
          error={update.error}
        />
      )}
    </>
  );
}

export default function StaffAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/appointments/:id">
      <AppointmentDetail id={id} />
    </RoleGate>
  );
}
