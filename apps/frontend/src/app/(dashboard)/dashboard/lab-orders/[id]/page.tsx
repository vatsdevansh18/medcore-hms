"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { LabOrderItemStatus, LabResultDecision, UserRole, type StaffLabOrderItemView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DetailList } from "@/components/shared/detail-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { DownloadButton } from "@/components/shared/download-button";
import { Flag } from "@/components/shared/lab-flag";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { useApproveLabResult, useEnterLabResult, useLabItemStatus, useStaffLabOrder } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatCalendarDate, formatDateTime, personName } from "@/lib/format";
import { labResultSchema, type LabResultValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

function ResultValues({ item }: { item: StaffLabOrderItemView }) {
  const values = item.result?.structuredValues ?? [];
  if (!item.result) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 text-sm">
      {values.map((v) => (
        <p key={v.parameter}>
          <span className="font-medium tabular-nums">
            {v.value} {v.unit}
          </span>{" "}
          · <Flag flag={v.flag} />
        </p>
      ))}
      {item.result.downloadUrl && (
        <div>
          <DownloadButton label="Report file" fetchUrl={async () => ({ downloadUrl: item.result!.downloadUrl! })} />
        </div>
      )}
    </div>
  );
}

function EnterResult({ orderId, item }: { orderId: string; item: StaffLabOrderItemView }) {
  const enter = useEnterLabResult(orderId);
  const range = item.labTest.referenceRanges[0];
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LabResultValues>({
    resolver: zodResolver(labResultSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { value: "", unit: range?.unit ?? "" },
  });
  const onSubmit = handleSubmit(async ({ value, unit }) => {
    try {
      await enter.mutateAsync({ itemId: item.id, body: { values: [{ parameter: item.labTest.name, value: Number(value), unit }] } });
      toast.success(`${item.labTest.name}: result saved. A second technician must review it.`);
    } catch {
      // Shown below.
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-1">
      <div className="grid gap-x-3 sm:grid-cols-[1fr_8rem]">
        <FormField
          label={`${item.labTest.name} result`}
          error={errors.value?.message}
          hint={range ? `Reference ${Number(range.lowValue)}–${Number(range.highValue)} ${range.unit}` : "No reference range on file."}
        >
          <Input inputMode="decimal" {...register("value")} />
        </FormField>
        <FormField label="Unit" error={errors.unit?.message}>
          <Input {...register("unit")} />
        </FormField>
      </div>
      <FormError error={enter.error} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={enter.isPending}>
          Save result
        </Button>
      </div>
    </form>
  );
}

/** Four-eyes review (FR-LAB-004): a different technician from the one who
 * entered the result approves or rejects it. Both are confirmed (§8):
 * approval releases the result to the doctor and the patient. */
function Review({ orderId, item }: { orderId: string; item: StaffLabOrderItemView }) {
  const approve = useApproveLabResult(orderId);
  const [decision, setDecision] = useState<LabResultDecision | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ notes: string }>({ defaultValues: { notes: "" } });

  async function decide(chosen: LabResultDecision, notes?: string) {
    try {
      await approve.mutateAsync({ itemId: item.id, body: { decision: chosen, ...(notes ? { notes } : {}) } });
      setDecision(null);
      toast.success(chosen === LabResultDecision.APPROVED ? "Result approved and released." : "Result rejected.");
    } catch {
      // Shown in the dialog.
    }
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() => {
          approve.reset();
          setDecision(LabResultDecision.APPROVED);
        }}
      >
        <ShieldCheck aria-hidden="true" /> Approve
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          approve.reset();
          setDecision(LabResultDecision.REJECTED);
        }}
      >
        Reject
      </Button>
      <ConfirmDialog
        open={decision === LabResultDecision.APPROVED}
        onOpenChange={(open) => !open && setDecision(null)}
        title={`Approve ${item.labTest.name}?`}
        consequence="The result is released to the ordering doctor and the patient, who is notified. It can't be changed afterwards."
        confirmLabel="Approve result"
        pending={approve.isPending}
        error={approve.error}
        onConfirm={() => void decide(LabResultDecision.APPROVED)}
      />
      <ConfirmDialog
        open={decision === LabResultDecision.REJECTED}
        onOpenChange={(open) => !open && setDecision(null)}
        title={`Reject ${item.labTest.name}?`}
        consequence="The result is not released. The doctor sees it was rejected and orders the test again."
        confirmLabel="Reject result"
        destructive
        pending={approve.isPending}
        error={approve.error}
        onConfirm={handleSubmit(({ notes }) => {
          if (!notes.trim()) return;
          void decide(LabResultDecision.REJECTED, notes.trim());
        })}
      >
        <FormField label="Why" error={errors.notes?.message}>
          <Textarea rows={2} maxLength={500} {...register("notes", { validate: (v) => v.trim().length > 0 || "Say why the result is rejected." })} />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

function ItemCard({ orderId, item, isLab, userId }: { orderId: string; item: StaffLabOrderItemView; isLab: boolean; userId: string }) {
  const status = useLabItemStatus(orderId);
  async function move(target: "SAMPLE_COLLECTED" | "IN_PROGRESS") {
    try {
      await status.mutateAsync({ itemId: item.id, status: target });
    } catch {
      // Shown below.
    }
  }
  const enteredByMe = item.result?.enteredBy === userId;
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {item.labTest.name} <span className="text-sm font-normal text-muted">({item.labTest.code})</span>
        </p>
        <StatusBadge status={item.status} kind="lab" />
      </div>
      <ResultValues item={item} />
      {isLab && item.status === LabOrderItemStatus.ORDERED && (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => void move("SAMPLE_COLLECTED")} loading={status.isPending}>
          Mark sample collected
        </Button>
      )}
      {isLab && item.status === LabOrderItemStatus.SAMPLE_COLLECTED && (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => void move("IN_PROGRESS")} loading={status.isPending}>
          Start testing
        </Button>
      )}
      {isLab && item.status === LabOrderItemStatus.IN_PROGRESS && <EnterResult orderId={orderId} item={item} />}
      {isLab && item.status === LabOrderItemStatus.RESULT_UPLOADED &&
        (enteredByMe ? (
          <p className="mt-3 text-sm text-muted">You entered this result. Another technician must review it (four-eyes check).</p>
        ) : (
          <Review orderId={orderId} item={item} />
        ))}
      {!isLab && !item.result && item.status !== LabOrderItemStatus.APPROVED && (
        <p className="mt-2 text-sm text-muted">The result appears here once the lab has reviewed it.</p>
      )}
      <div className="mt-2">
        <FormError error={status.error} />
      </div>
    </li>
  );
}

function LabOrderDetail({ id }: { id: string }) {
  const user = useAuthStore((s) => s.user);
  const timeZone = useWorkspaceTimeZone();
  const order = useStaffLabOrder(id);
  if (order.isPending) return <Skeleton className="h-64" />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  if (!user) return null;
  const o = order.data;
  const isLab = user.role === UserRole.LAB_TECHNICIAN;

  return (
    <>
      <PageHeader
        title={`Lab order · ${personName(o.patient.user)}`}
        description={
          o.priority === "URGENT" ? (
            <span className="inline-flex items-center gap-1 font-semibold text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" /> Urgent
            </span>
          ) : (
            "Routine"
          )
        }
        back={{ href: ROUTES.labQueue, label: isLab ? "Lab queue" : "Lab orders" }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Tests" className="lg:col-span-2">
          <ul className="flex flex-col gap-3">
            {o.items.map((item) => (
              <ItemCard key={item.id} orderId={o.id} item={item} isLab={isLab} userId={user.id} />
            ))}
          </ul>
        </Panel>
        <Panel title="Order">
          <DetailList
            className="sm:grid-cols-1"
            items={[
              ["Patient", personName(o.patient.user)],
              ["Date of birth", o.patient.dob ? formatCalendarDate(o.patient.dob) : null],
              ["Gender", o.patient.gender ? o.patient.gender.charAt(0) + o.patient.gender.slice(1).toLowerCase() : null],
              ["Ordered by", o.doctor ? doctorName(o.doctor.user) : null],
              ["Ordered", formatDateTime(o.createdAt, timeZone)],
            ]}
          />
        </Panel>
      </div>
    </>
  );
}

export default function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/lab-orders/:id">
      <LabOrderDetail id={id} />
    </RoleGate>
  );
}
