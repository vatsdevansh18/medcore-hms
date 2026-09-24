"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { useStartEncounter } from "@/services/workflows";
import { compact, encounterSchema, icd10List, type EncounterValues } from "@/lib/staff-validation";

/**
 * Opens the encounter's medical record (FR-EMR-001). The consultation fee is
 * charged in the same transaction, so starting twice is refused by the API
 * (one record per appointment).
 */
export function StartEncounterForm({ appointmentId, reason }: { appointmentId: string; reason: string | null }) {
  const start = useStartEncounter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EncounterValues>({
    resolver: zodResolver(encounterSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      chiefComplaint: reason ?? "",
      presentingSymptoms: "",
      diagnosisNotes: "",
      icd10: "",
      treatmentPlan: "",
      notes: "",
    },
  });

  const onSubmit = handleSubmit(async ({ icd10, ...values }) => {
    try {
      await start.mutateAsync({
        appointmentId,
        ...compact(values),
        ...(icd10 ? { confirmedDiagnosisIcd10: icd10List(icd10) } : {}),
      });
      toast.success("Encounter started. The consultation fee is on the visit's bill.");
    } catch {
      // Shown below.
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
      <FormField label="Chief complaint" error={errors.chiefComplaint?.message}>
        <Input {...register("chiefComplaint")} />
      </FormField>
      <FormField label="Presenting symptoms (optional)" error={errors.presentingSymptoms?.message}>
        <Textarea rows={3} {...register("presentingSymptoms")} />
      </FormField>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="Diagnosis notes (optional)" error={errors.diagnosisNotes?.message}>
          <Textarea rows={3} {...register("diagnosisNotes")} />
        </FormField>
        <FormField label="Treatment plan (optional)" error={errors.treatmentPlan?.message}>
          <Textarea rows={3} {...register("treatmentPlan")} />
        </FormField>
      </div>
      <FormField label="ICD-10 codes (optional)" error={errors.icd10?.message} hint="Comma-separated, e.g. J06.9, R50.9">
        <Input {...register("icd10")} />
      </FormField>
      <FormField label="Clinical notes (optional)" error={errors.notes?.message} hint="Stored encrypted. Visible to clinicians and the patient.">
        <Textarea rows={4} {...register("notes")} />
      </FormField>
      <FormError error={start.error} />
      <div className="flex justify-end">
        <Button type="submit" loading={start.isPending}>
          Start encounter
        </Button>
      </div>
    </form>
  );
}
