"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AddendumView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/shared/panel";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { useAddAddendum, useAddAllergy, useStaffAllergies } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatDateTime } from "@/lib/format";
import { addendumSchema, allergySchema, compact, type AddendumValues, type AllergyValues } from "@/lib/staff-validation";

/** Addenda (FR-EMR-002): the record itself is never edited; corrections and
 * later notes are appended, newest first. */
export function AddendaPanel({ recordId, addenda }: { recordId: string; addenda: AddendumView[] }) {
  const timeZone = useWorkspaceTimeZone();
  const add = useAddAddendum(recordId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddendumValues>({ resolver: zodResolver(addendumSchema), mode: "onSubmit", reValidateMode: "onChange", defaultValues: { note: "" } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await add.mutateAsync(values);
      reset({ note: "" });
      toast.success("Addendum added.");
    } catch {
      // Shown below.
    }
  });

  return (
    <Panel title="Addenda">
      {addenda.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No addenda. The record is append-only: add a note here to correct or extend it.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-3">
          {addenda.map((a) => (
            <li key={a.id} className="border-l-2 border-border pl-3">
              <p className="whitespace-pre-wrap text-sm">{a.note}</p>
              <p className="mt-0.5 text-xs text-subtle">{formatDateTime(a.createdAt, timeZone)}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
        <FormField label="New addendum" error={errors.note?.message}>
          <Textarea rows={2} maxLength={5000} {...register("note")} />
        </FormField>
        <FormError error={add.error} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="secondary" loading={add.isPending}>
            Add addendum
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Allergies (FR-EMR-005): patient-level, so they carry across visits. */
export function AllergiesPanel({ patientId }: { patientId: string }) {
  const allergies = useStaffAllergies(patientId);
  const add = useAddAllergy(patientId);
  const [adding, setAdding] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AllergyValues>({
    resolver: zodResolver(allergySchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { allergen: "", reaction: "", severity: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await add.mutateAsync(compact(values) as { allergen: string });
      reset();
      setAdding(false);
      toast.success("Allergy recorded.");
    } catch {
      // Shown below.
    }
  });

  return (
    <Panel
      title="Allergies"
      actions={
        !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add
          </Button>
        )
      }
    >
      {allergies.isPending ? (
        <Skeleton className="h-10" />
      ) : allergies.isError ? (
        <ErrorState error={allergies.error} onRetry={() => void allergies.refetch()} />
      ) : allergies.data.length === 0 ? (
        <p className="text-sm text-muted">No known allergies recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {allergies.data.map((a) => (
            <li key={a.id}>
              <span className="font-medium">{a.allergen}</span>
              {a.severity && <span className="text-muted"> · {a.severity.toLowerCase()}</span>}
              {a.reaction && <span className="text-muted"> · {a.reaction}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <FormField label="Allergen" error={errors.allergen?.message}>
            <Input {...register("allergen")} />
          </FormField>
          <FormField label="Reaction (optional)" error={errors.reaction?.message}>
            <Input {...register("reaction")} />
          </FormField>
          <FormField label="Severity (optional)" error={errors.severity?.message}>
            <Select {...register("severity")}>
              <option value="">Not given</option>
              <option value="MILD">Mild</option>
              <option value="MODERATE">Moderate</option>
              <option value="SEVERE">Severe</option>
            </Select>
          </FormField>
          <FormError error={add.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={add.isPending}>
              Save allergy
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
