"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Search } from "lucide-react";
import type { AppointmentView, DoctorView, SlotView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StepIndicator } from "@/components/shared/step-indicator";
import { FormField } from "@/components/shared/form-field";
import { EmptyState, ErrorState, FormError, ListSkeleton } from "@/components/shared/states";
import { SlotPicker } from "@/components/modules/slot-picker";
import { useBookAppointment, useDoctors } from "@/services/portal";
import { useDebounce } from "@/hooks/use-debounce";
import { useHospital } from "@/hooks/use-hospital";
import { doctorName, formatDateTime, formatMoney } from "@/lib/format";
import { errorCode } from "@/lib/errors";
import { visitReasonSchema, type VisitReasonValues } from "@/lib/validation";
import { ROUTES } from "@/constants";

const STEPS = ["Doctor", "Time", "Confirm"];

function DoctorStep({ onPick }: { onPick: (doctor: DoctorView) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search.trim());
  const doctors = useDoctors(debounced);
  return (
    <>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by specialization, e.g. Cardiology"
          aria-label="Search doctors by specialization"
          className="pl-9"
        />
      </div>
      {doctors.isPending ? (
        <ListSkeleton />
      ) : doctors.isError ? (
        <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />
      ) : doctors.data.data.length === 0 ? (
        <EmptyState title="No doctors match" description="Try a different specialization, or clear the search." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {doctors.data.data.map((doctor) => (
            <li key={doctor.id}>
              <button
                type="button"
                onClick={() => onPick(doctor)}
                className="h-full w-full rounded-lg border border-border bg-surface p-4 text-left hover:border-primary"
              >
                <p className="font-medium">{doctorName(doctor.user)}</p>
                <p className="text-sm text-muted">
                  {doctor.specialization} · {doctor.department.name}
                </p>
                <p className="mt-2 text-sm text-subtle">
                  Consultation {formatMoney(doctor.consultationFee)}
                  {doctor.yearsOfExperience ? ` · ${doctor.yearsOfExperience} yrs experience` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** FR-APPT-002 / FR-PORTAL-002: book a visit in three steps. The server
 * re-checks the slot, and the database decides a race (409 SLOT_UNAVAILABLE). */
export default function BookAppointmentPage() {
  const { timezone } = useHospital();
  const [step, setStep] = useState(0);
  const [doctor, setDoctor] = useState<DoctorView | null>(null);
  const [slot, setSlot] = useState<SlotView | null>(null);
  const [booked, setBooked] = useState<AppointmentView | null>(null);
  const book = useBookAppointment();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VisitReasonValues>({
    resolver: zodResolver(visitReasonSchema),
    mode: "onBlur",
    defaultValues: { reasonForVisit: "" },
  });

  const confirm = handleSubmit(async ({ reasonForVisit }) => {
    if (!doctor || !slot) return;
    try {
      const appointment = await book.mutateAsync({
        doctorId: doctor.id,
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
        reasonForVisit: reasonForVisit || undefined,
      });
      setBooked(appointment);
    } catch (error) {
      if (errorCode(error) === "SLOT_UNAVAILABLE") {
        // Someone else took it: go back and pick again from fresh slots.
        setSlot(null);
        setStep(1);
      }
    }
  });

  if (booked) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Appointment requested</h1>
          <p className="text-muted">
            {doctorName(booked.doctor.user)} · {formatDateTime(booked.scheduledStart, timezone)}
          </p>
          <p className="text-sm text-muted">
            The hospital will confirm it shortly. You&apos;ll get a notification when it&apos;s confirmed.
          </p>
          <div className="mt-2 flex gap-2">
            <Button asChild variant="secondary">
              <Link href={ROUTES.appointment(booked.id)}>View appointment</Link>
            </Button>
            <Button asChild>
              <Link href={ROUTES.appointments}>All appointments</Link>
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Book an appointment" back={{ href: ROUTES.appointments, label: "Appointments" }} />
      <StepIndicator steps={STEPS} current={step} />

      {step === 0 && (
        <DoctorStep
          onPick={(d) => {
            setDoctor(d);
            setSlot(null);
            setStep(1);
          }}
        />
      )}

      {step === 1 && doctor && (
        <Card>
          <CardBody>
            <p className="mb-4 text-sm text-muted">
              Choose a time with <span className="font-medium text-foreground">{doctorName(doctor.user)}</span>.
            </p>
            {book.isError && errorCode(book.error) === "SLOT_UNAVAILABLE" && (
              <div className="mb-4">
                <FormError error={book.error} />
              </div>
            )}
            <SlotPicker doctorId={doctor.id} selected={slot} onSelect={setSlot} />
            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(0)}>
                Change doctor
              </Button>
              <Button disabled={!slot} onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 2 && doctor && slot && (
        <Card>
          <CardBody>
            <form onSubmit={confirm} noValidate className="flex flex-col gap-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-muted">Doctor</dt>
                <dd>
                  {doctorName(doctor.user)} · {doctor.specialization}
                </dd>
                <dt className="text-muted">When</dt>
                <dd>{formatDateTime(slot.start, timezone)}</dd>
                <dt className="text-muted">Consultation fee</dt>
                <dd>{formatMoney(doctor.consultationFee)}, billed after the visit</dd>
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
                  Request appointment
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </>
  );
}
