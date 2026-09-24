"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { HospitalSettingsView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DetailList } from "@/components/shared/detail-list";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { useHospitalSettings, useUpdateHospital } from "@/services/workflows";
import { useAuthStore } from "@/store/auth-store";
import { settingsSchema, type SettingsValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

/** The patient reschedule policy (D-035): whether patients may move their
 * own appointments, and how close to the start time they still can. */
function ReschedulePolicy({ hospital }: { hospital: HospitalSettingsView }) {
  const update = useUpdateHospital(hospital.id);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
    reset,
  } = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      patientRescheduleAllowed: hospital.patientRescheduleAllowed,
      patientRescheduleCutoffHours: String(hospital.patientRescheduleCutoffHours),
    },
  });
  const allowed = watch("patientRescheduleAllowed");
  const onSubmit = handleSubmit(async (v) => {
    try {
      const saved = await update.mutateAsync({
        patientRescheduleAllowed: v.patientRescheduleAllowed,
        patientRescheduleCutoffHours: Number(v.patientRescheduleCutoffHours),
      });
      reset({
        patientRescheduleAllowed: saved.patientRescheduleAllowed,
        patientRescheduleCutoffHours: String(saved.patientRescheduleCutoffHours),
      });
      toast.success("Reschedule policy saved. Patients see it the next time they sign in.");
    } catch {
      // Shown below.
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-lg flex-col gap-3">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" {...register("patientRescheduleAllowed")} />
        <span>
          <span className="font-medium">Patients can reschedule their own appointments</span>
          <span className="block text-muted">From the portal, to another open slot with the same doctor.</span>
        </span>
      </label>
      <FormField
        label="Cutoff (hours before the appointment)"
        error={errors.patientRescheduleCutoffHours?.message}
        hint="0 to 720. Closer to the start than this, patients must call the hospital."
      >
        <Input inputMode="numeric" disabled={!allowed} {...register("patientRescheduleCutoffHours")} className="max-w-32" />
      </FormField>
      <FormError error={update.error} />
      <div>
        <Button type="submit" loading={update.isPending} disabled={!isDirty}>
          Save policy
        </Button>
      </div>
    </form>
  );
}

function Settings() {
  const hospitalId = useAuthStore((s) => s.user?.hospitalId);
  const hospital = useHospitalSettings(hospitalId);
  if (hospital.isPending) return <Skeleton className="h-64" />;
  if (hospital.isError) return <ErrorState error={hospital.error} onRetry={() => void hospital.refetch()} />;
  const h = hospital.data;
  return (
    <>
      <PageHeader title="Settings" description="Hospital details and patient-facing policies." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Hospital">
          <DetailList
            items={[
              ["Name", h.name],
              ["Contact email", h.contactEmail],
              ["Contact phone", h.contactPhone],
              ["Time zone", h.timezone],
            ]}
          />
          <p className="mt-3 text-xs text-muted">Every schedule and report uses this time zone. Contact the platform team to change these details.</p>
        </Panel>
        <Panel title="Patient rescheduling">
          <ReschedulePolicy hospital={h} />
        </Panel>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <RoleGate route={ROUTES.settings}>
      <Settings />
    </RoleGate>
  );
}
