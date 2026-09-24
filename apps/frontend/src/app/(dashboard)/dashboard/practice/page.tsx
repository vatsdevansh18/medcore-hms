"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Plus, Trash2, Upload } from "lucide-react";
import type { AvailabilityExceptionView, DoctorScheduleView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import {
  useAddException,
  useDoctorProfile,
  useDoctorSchedule,
  useRemoveException,
  useSaveWeeklyHours,
  useUploadSignature,
} from "@/services/workflows";
import { useHospital } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { formatDateKey, todayKey } from "@/lib/format";
import { hoursProblems, toSlots, WEEKDAYS, type HoursRow } from "@/lib/schedule";
import { MAX_SIGNATURE_BYTES, SIGNATURE_TYPES, fileProblem } from "@/lib/upload";
import { ROUTES } from "@/constants";

let nextKey = 0;
const newKey = () => `row-${nextKey++}`;

/** Weekly hours (FR-APPT-001). Saving replaces the whole week; booked
 * appointments are never moved, only future open slots change. */
function WeeklyHours({ doctorId, schedule }: { doctorId: string; schedule: DoctorScheduleView }) {
  const save = useSaveWeeklyHours(doctorId);
  const [rows, setRows] = useState<HoursRow[]>(() =>
    schedule.weekly.map((w) => ({
      key: newKey(),
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      slotDurationMinutes: String(w.slotDurationMinutes),
    })),
  );
  const [touched, setTouched] = useState(false);
  const problems = hoursProblems(rows);
  const update = (key: string, patch: Partial<HoursRow>) => {
    setTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  async function onSave() {
    try {
      await save.mutateAsync({ slots: toSlots(rows) });
      setTouched(false);
      toast.success("Weekly hours saved. Patients see the new times right away.");
    } catch {
      // Shown below.
    }
  }

  return (
    <Panel title="Weekly hours">
      <p className="mb-3 text-sm text-muted">
        Times are in the hospital&apos;s time zone ({schedule.timezone}). Existing bookings aren&apos;t changed.
      </p>
      {rows.length === 0 && <p className="mb-3 text-sm text-muted">No hours set: patients can&apos;t book you yet.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const id = r.key;
          return (
            <li key={id} className="rounded-md border border-border p-3">
              <div className="grid items-end gap-2 sm:grid-cols-[10rem_7rem_7rem_8rem_auto]">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-day`} className="text-xs text-muted">
                    Day
                  </label>
                  <Select id={`${id}-day`} value={r.dayOfWeek} onChange={(e) => update(id, { dayOfWeek: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-start`} className="text-xs text-muted">
                    From
                  </label>
                  <Input id={`${id}-start`} type="time" value={r.startTime} onChange={(e) => update(id, { startTime: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-end`} className="text-xs text-muted">
                    To
                  </label>
                  <Input id={`${id}-end`} type="time" value={r.endTime} onChange={(e) => update(id, { endTime: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-len`} className="text-xs text-muted">
                    Minutes each
                  </label>
                  <Input
                    id={`${id}-len`}
                    inputMode="numeric"
                    value={r.slotDurationMinutes}
                    onChange={(e) => update(id, { slotDurationMinutes: e.target.value })}
                    aria-invalid={problems[id] ? true : undefined}
                    aria-describedby={problems[id] ? `${id}-problem` : undefined}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${WEEKDAYS[r.dayOfWeek]} ${r.startTime}–${r.endTime}`}
                  onClick={() => {
                    setTouched(true);
                    setRows((rs) => rs.filter((x) => x.key !== id));
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              {problems[id] && touched && (
                <p id={`${id}-problem`} className="mt-1 text-xs text-danger">
                  {problems[id]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <FormError error={save.error} />
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setTouched(true);
            setRows((rs) => [...rs, { key: newKey(), dayOfWeek: 1, startTime: "09:00", endTime: "13:00", slotDurationMinutes: "30" }]);
          }}
        >
          <Plus aria-hidden="true" /> Add hours
        </Button>
        <Button onClick={() => void onSave()} loading={save.isPending} disabled={!touched || Object.keys(problems).length > 0}>
          Save weekly hours
        </Button>
      </div>
    </Panel>
  );
}

interface ExceptionValues {
  date: string;
  kind: "OFF" | "HOURS";
  startTime: string;
  endTime: string;
  reason: string;
}

/** Days off and one-day changes of hours; one entry per date. */
function Exceptions({ doctorId, exceptions }: { doctorId: string; exceptions: AvailabilityExceptionView[] }) {
  const { timezone } = useHospital();
  const today = todayKey(timezone);
  const add = useAddException(doctorId);
  const remove = useRemoveException(doctorId);
  const [removing, setRemoving] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<ExceptionValues>({ defaultValues: { date: "", kind: "OFF", startTime: "", endTime: "", reason: "" }, mode: "onSubmit" });
  const kind = watch("kind");

  const onSubmit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync({
        date: v.date,
        isUnavailable: v.kind === "OFF",
        ...(v.kind === "HOURS" ? { startTime: v.startTime, endTime: v.endTime } : {}),
        ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
      });
      reset();
      toast.success(`Saved for ${formatDateKey(v.date)}.`);
    } catch {
      // Shown below.
    }
  });

  return (
    <Panel title="Days off and changes">
      {exceptions.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No upcoming changes: your weekly hours apply every week.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2 text-sm">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-b-0">
              <span>
                <span className="font-medium">{formatDateKey(e.date, { year: "numeric" })}</span>{" "}
                <span className="text-muted">
                  · {e.isUnavailable ? "Not available" : `${e.startTime}–${e.endTime} only`}
                  {e.reason ? ` · ${e.reason}` : ""}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  remove.reset();
                  setRemoving(e.date);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1 border-t border-border pt-3">
        <div className="grid gap-x-3 sm:grid-cols-2">
          <FormField label="Date" error={errors.date?.message}>
            <Input type="date" min={today} {...register("date", { validate: (v) => (v && v >= today) || "Choose today or a later date." })} />
          </FormField>
          <FormField label="What changes">
            <Select {...register("kind")}>
              <option value="OFF">Not available all day</option>
              <option value="HOURS">Different hours that day</option>
            </Select>
          </FormField>
          {kind === "HOURS" && (
            <>
              <FormField label="From" error={errors.startTime?.message}>
                <Input type="time" {...register("startTime", { validate: (v) => kind !== "HOURS" || Boolean(v) || "Enter the start." })} />
              </FormField>
              <FormField label="To" error={errors.endTime?.message}>
                <Input
                  type="time"
                  {...register("endTime", {
                    validate: (v, all) => kind !== "HOURS" || (Boolean(v) && v > all.startTime) || "The end must be after the start.",
                  })}
                />
              </FormField>
            </>
          )}
        </div>
        <FormField label="Reason (optional)" error={errors.reason?.message}>
          <Input maxLength={300} {...register("reason")} />
        </FormField>
        <FormError error={add.error} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={add.isPending}>
            Save change
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this change?"
        consequence={`Your usual weekly hours apply on ${removing ? formatDateKey(removing) : "that day"} again, and those times open for booking.`}
        confirmLabel="Remove"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          removing &&
          void remove
            .mutateAsync(removing)
            .then(() => {
              setRemoving(null);
              toast.success("Removed.");
            })
            .catch(() => undefined)
        }
      />
    </Panel>
  );
}

/** The signature printed on new prescription PDFs (FR-RX-003). */
function Signature({ doctorId }: { doctorId: string }) {
  const profile = useDoctorProfile(doctorId);
  const upload = useUploadSignature(doctorId);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    upload.reset();
    const issue = fileProblem(file, SIGNATURE_TYPES, MAX_SIGNATURE_BYTES);
    setProblem(issue);
    if (!issue) {
      try {
        await upload.mutateAsync(file);
        toast.success("Signature saved. It appears on prescriptions you issue from now on.");
      } catch {
        // Shown below.
      }
    }
    if (input.current) input.current.value = "";
  }

  return (
    <Panel title="Prescription signature">
      {profile.isPending ? (
        <Skeleton className="h-6" />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <p className="mb-3 text-sm">
          {profile.data.hasSignature ? "A signature is on file." : "No signature yet: prescriptions print without one."}{" "}
          <span className="text-muted">Prescriptions already issued keep the signature they were issued with.</span>
        </p>
      )}
      <input
        ref={input}
        id="signature-file"
        type="file"
        className="sr-only"
        accept={Object.values(SIGNATURE_TYPES).flat().join(",")}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()} loading={upload.isPending}>
        {!upload.isPending && <Upload aria-hidden="true" />} {profile.data?.hasSignature ? "Replace signature" : "Upload signature"}
      </Button>
      <p className="mt-1 text-xs text-muted">PNG or JPEG, up to 2 MB.</p>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
      <div className="mt-2">
        <FormError error={upload.error} />
      </div>
    </Panel>
  );
}

function Practice() {
  const doctorId = useAuthStore((s) => s.user?.doctorProfileId);
  const schedule = useDoctorSchedule(doctorId);
  if (!doctorId) return null;
  if (schedule.isPending) return <Skeleton className="h-64" />;
  if (schedule.isError) return <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />;
  return (
    <>
      <PageHeader title="My practice" description="When patients can book you, and the signature on your prescriptions." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WeeklyHours key={JSON.stringify(schedule.data.weekly)} doctorId={doctorId} schedule={schedule.data} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Exceptions doctorId={doctorId} exceptions={schedule.data.exceptions} />
          <Signature doctorId={doctorId} />
        </div>
      </div>
    </>
  );
}

export default function PracticePage() {
  return (
    <RoleGate route={ROUTES.practice}>
      <Practice />
    </RoleGate>
  );
}
