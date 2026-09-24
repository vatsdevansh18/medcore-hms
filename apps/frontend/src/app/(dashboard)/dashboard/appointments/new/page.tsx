"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { UserRole, type AppointmentView, type SlotView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { StepIndicator } from "@/components/shared/step-indicator";
import { FormField } from "@/components/shared/form-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, ErrorState, FormError } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { SlotPicker } from "@/components/modules/slot-picker";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { useDoctorOptions } from "@/services/staff";
import { useBookForPatient, useEmergencyAppointment, usePatient } from "@/services/workflows";
import { useHospital } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { doctorName, formatDateTime, personName } from "@/lib/format";
import { errorCode } from "@/lib/errors";
import { reasonSchema, type ReasonValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

const STEPS = ["Doctor", "Time", "Confirm"];

function Booked({ appointment, patientId }: { appointment: AppointmentView; patientId: string }) {
  const { timezone } = useHospital();
  return (
    <Card className="mx-auto max-w-lg">
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{appointment.type === "EMERGENCY" ? "Emergency visit started" : "Appointment booked"}</h1>
        <p className="text-muted">
          {personName(appointment.patient.user)} with {doctorName(appointment.doctor.user)}
          <br />
          {formatDateTime(appointment.scheduledStart, timezone)}
        </p>
        <StatusBadge status={appointment.status} />
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild variant="secondary">
            <Link href={ROUTES.patient(patientId)}>Back to patient</Link>
          </Button>
          <Button asChild>
            <Link href={ROUTES.staffAppointment(appointment.id)}>Open appointment</Link>
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function DoctorSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const doctors = useDoctorOptions();
  if (doctors.isPending) return <Skeleton className="h-10" />;
  if (doctors.isError) return <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />;
  if (doctors.data.data.length === 0) return <EmptyState title="No doctors yet" description="A hospital admin adds doctors under Staff." />;
  return (
    <FormField label="Doctor">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a doctor…</option>
        {doctors.data.data.map((d) => (
          <option key={d.id} value={d.id}>
            {doctorName(d.user)} · {d.specialization}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/** Regular booking on the patient's behalf (FR-APPT-003): doctor, then an
 * open slot, then confirm. The server re-checks the slot and the database
 * settles a race (409 SLOT_UNAVAILABLE). */
function BookRegular({ patientId, onBooked }: { patientId: string; onBooked: (a: AppointmentView) => void }) {
  const [step, setStep] = useState(0);
  const [doctorId, setDoctorId] = useState("");
  const [slot, setSlot] = useState<SlotView | null>(null);
  const { timezone } = useHospital();
  const book = useBookForPatient();
  const doctors = useDoctorOptions();
  const doctor = doctors.data?.data.find((d) => d.id === doctorId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), mode: "onBlur", defaultValues: { reasonForVisit: "" } });

  const confirm = handleSubmit(async ({ reasonForVisit }) => {
    if (!slot) return;
    try {
      onBooked(
        await book.mutateAsync({
          patientId,
          doctorId,
          scheduledStart: slot.start,
          scheduledEnd: slot.end,
          reasonForVisit: reasonForVisit || undefined,
        }),
      );
    } catch (error) {
      if (errorCode(error) === "SLOT_UNAVAILABLE") {
        setSlot(null);
        setStep(1);
      }
    }
  });

  return (
    <>
      <StepIndicator steps={STEPS} current={step} />
      <Card>
        <CardBody>
          {step === 0 && (
            <div className="flex max-w-md flex-col gap-2">
              <DoctorSelect value={doctorId} onChange={setDoctorId} />
              <div>
                <Button
                  disabled={!doctorId}
                  onClick={() => {
                    setSlot(null);
                    setStep(1);
                  }}
                >
                  Continue
                </Button>
              </div>
            </div>
          )}
          {step === 1 && (
            <>
              <p className="mb-4 text-sm text-muted">
                Open times with <span className="font-medium text-foreground">{doctorName(doctor?.user)}</span>, in the hospital&apos;s time zone.
              </p>
              {book.isError && errorCode(book.error) === "SLOT_UNAVAILABLE" && (
                <div className="mb-4">
                  <FormError error={book.error} />
                </div>
              )}
              <SlotPicker doctorId={doctorId} selected={slot} onSelect={setSlot} />
              <div className="mt-6 flex justify-between">
                <Button variant="secondary" onClick={() => setStep(0)}>
                  Change doctor
                </Button>
                <Button disabled={!slot} onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </>
          )}
          {step === 2 && slot && (
            <form onSubmit={confirm} noValidate className="flex flex-col gap-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-muted">Doctor</dt>
                <dd>
                  {doctorName(doctor?.user)} · {doctor?.specialization}
                </dd>
                <dt className="text-muted">When</dt>
                <dd>{formatDateTime(slot.start, timezone)}</dd>
              </dl>
              <FormField label="Reason for visit (optional)" error={errors.reasonForVisit?.message}>
                <Textarea rows={3} maxLength={500} {...register("reasonForVisit")} />
              </FormField>
              {book.isError && errorCode(book.error) !== "SLOT_UNAVAILABLE" && <FormError error={book.error} />}
              <div className="flex justify-between">
                <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                  Change time
                </Button>
                <Button type="submit" loading={book.isPending}>
                  Book appointment
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/** Emergency visit (FR-APPT-006): starts now, outside the slot grid. */
function BookEmergency({ patientId, onBooked }: { patientId: string; onBooked: (a: AppointmentView) => void }) {
  const role = useAuthStore((s) => s.user?.role);
  const ownDoctorId = useAuthStore((s) => s.user?.doctorProfileId ?? "");
  const isDoctor = role === UserRole.DOCTOR;
  const [doctorId, setDoctorId] = useState(isDoctor ? ownDoctorId : "");
  const emergency = useEmergencyAppointment();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReasonValues>({ resolver: zodResolver(reasonSchema), mode: "onBlur", defaultValues: { reasonForVisit: "" } });

  const submit = handleSubmit(async ({ reasonForVisit }) => {
    try {
      onBooked(await emergency.mutateAsync({ patientId, doctorId, reasonForVisit: reasonForVisit || undefined }));
    } catch {
      // Shown below from emergency.error.
    }
  });

  return (
    <Card className="max-w-2xl">
      <CardBody>
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          {isDoctor ? (
            <p className="mb-2 text-sm text-muted">The visit is booked with you, starting now.</p>
          ) : (
            <DoctorSelect value={doctorId} onChange={setDoctorId} />
          )}
          <FormField label="What happened (optional)" error={errors.reasonForVisit?.message}>
            <Textarea rows={3} maxLength={500} {...register("reasonForVisit")} />
          </FormField>
          <FormError error={emergency.error} />
          <div className="flex justify-end">
            <Button type="submit" variant="danger" disabled={!doctorId} loading={emergency.isPending}>
              Start emergency visit
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function NewAppointment() {
  const params = useSearchParams();
  const patientId = params.get("patientId") ?? "";
  const role = useAuthStore((s) => s.user?.role);
  // A doctor only starts emergency visits; booking is the front desk's job.
  const emergency = params.get("type") === "emergency" || role === UserRole.DOCTOR;
  const patient = usePatient(patientId || null);
  const [booked, setBooked] = useState<AppointmentView | null>(null);

  if (!patientId) {
    return (
      <EmptyState
        title="Choose the patient first"
        description="Open the patient's page, then book from there."
        action={
          <Link href={ROUTES.patients} className="text-primary hover:underline">
            Find a patient
          </Link>
        }
      />
    );
  }
  if (booked) return <Booked appointment={booked} patientId={patientId} />;

  return (
    <>
      <PageHeader
        title={emergency ? "Emergency visit" : "Book an appointment"}
        description={
          patient.data ? `For ${personName(patient.data.user)}` : patient.isError ? undefined : "Loading patient…"
        }
        back={{ href: ROUTES.patient(patientId), label: "Patient" }}
      />
      {patient.isError ? (
        <ErrorState error={patient.error} onRetry={() => void patient.refetch()} />
      ) : emergency ? (
        <BookEmergency patientId={patientId} onBooked={setBooked} />
      ) : (
        <BookRegular patientId={patientId} onBooked={setBooked} />
      )}
    </>
  );
}

export default function NewAppointmentPage() {
  return (
    <RoleGate route="/dashboard/appointments/new">
      <Suspense fallback={<FullPageLoader />}>
        <NewAppointment />
      </Suspense>
    </RoleGate>
  );
}
