"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { PrescriptionFrequency, type MedicineView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/shared/panel";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { RowLink } from "@/components/shared/detail-list";
import { toast } from "@/components/shared/toaster";
import { useCreatePrescription, useEncounterPrescriptions, useMedicineSearch } from "@/services/workflows";
import { useDebounce } from "@/hooks/use-debounce";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatDateTime } from "@/lib/format";
import { prescriptionSchema, type PrescriptionValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

export const FREQUENCY_LABEL: Record<PrescriptionFrequency, string> = {
  OD: "Once a day",
  BD: "Twice a day",
  TDS: "Three times a day",
  QID: "Four times a day",
  SOS: "When needed",
  OTHER: "Other (see instructions)",
};

function MedicinePicker({ onPick }: { onPick: (m: MedicineView) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search.trim(), 250);
  const results = useMedicineSearch(debounced, debounced.length >= 2);
  return (
    <div className="flex flex-col gap-2">
      <FormField label="Add a medicine" hint="Type at least 2 letters of the name.">
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Amoxicillin" />
      </FormField>
      {debounced.length >= 2 &&
        (results.isPending ? (
          <Skeleton className="h-16" />
        ) : results.isError ? (
          <ErrorState error={results.error} />
        ) : results.data.data.length === 0 ? (
          <p className="text-sm text-muted">No medicine matches “{debounced}”.</p>
        ) : (
          <ul className="flex max-h-48 flex-col overflow-auto rounded-md border border-border" aria-label="Matching medicines">
            {results.data.data.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(m);
                    setSearch("");
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                >
                  <span>
                    <span className="font-medium">{m.name}</span>
                    {m.genericName && <span className="text-muted"> ({m.genericName})</span>}
                    <span className="text-muted"> · {m.form.toLowerCase()}</span>
                  </span>
                  <span className={m.availableQuantity > 0 ? "text-xs text-muted" : "text-xs text-warning"}>
                    {m.availableQuantity > 0 ? `${m.availableQuantity} ${m.unit} in stock` : "Out of stock"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

function NewPrescription({ recordId, onDone }: { recordId: string; onDone: () => void }) {
  const create = useCreatePrescription();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PrescriptionValues>({ resolver: zodResolver(prescriptionSchema), mode: "onSubmit", reValidateMode: "onChange", defaultValues: { items: [] } });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const onSubmit = handleSubmit(async ({ items }) => {
    try {
      await create.mutateAsync({
        medicalRecordId: recordId,
        items: items.map((i) => ({
          medicineId: i.medicineId,
          dosage: i.dosage,
          frequency: i.frequency,
          durationDays: Number(i.durationDays),
          quantityPrescribed: Number(i.quantityPrescribed),
          ...(i.specialInstructions ? { specialInstructions: i.specialInstructions } : {}),
        })),
      });
      toast.success("Prescription issued. The PDF is being prepared.");
      onDone();
    } catch {
      // Shown below.
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <MedicinePicker
        onPick={(m) =>
          append({
            medicineId: m.id,
            medicineName: `${m.name} (${m.form.toLowerCase()})`,
            dosage: "",
            frequency: "BD",
            durationDays: "5",
            quantityPrescribed: "",
            specialInstructions: "",
          })
        }
      />
      {fields.map((field, index) => {
        const e = errors.items?.[index];
        return (
          <fieldset key={field.id} className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{field.medicineName}</legend>
            <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Dose" error={e?.dosage?.message}>
                <Input placeholder="e.g. 500 mg" {...register(`items.${index}.dosage`)} />
              </FormField>
              <FormField label="Frequency" error={e?.frequency?.message}>
                <Select {...register(`items.${index}.frequency`)}>
                  {Object.values(PrescriptionFrequency).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABEL[f]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Days" error={e?.durationDays?.message}>
                <Input inputMode="numeric" {...register(`items.${index}.durationDays`)} />
              </FormField>
              <FormField label="Quantity" error={e?.quantityPrescribed?.message}>
                <Input inputMode="numeric" {...register(`items.${index}.quantityPrescribed`)} />
              </FormField>
            </div>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <FormField label="Instructions (optional)" error={e?.specialInstructions?.message}>
                  <Input placeholder="e.g. after food" {...register(`items.${index}.specialInstructions`)} />
                </FormField>
              </div>
              <Button type="button" variant="ghost" size="icon" className="mt-6" onClick={() => remove(index)} aria-label={`Remove ${field.medicineName}`}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </fieldset>
        );
      })}
      {errors.items?.message && <p className="text-sm text-danger">{errors.items.message}</p>}
      {errors.items?.root?.message && <p className="text-sm text-danger">{errors.items.root.message}</p>}
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={create.isPending} disabled={fields.length === 0}>
          Issue prescription
        </Button>
      </div>
    </form>
  );
}

/** Prescriptions on this encounter (FR-RX-001/002). Issued prescriptions
 * are immutable; the encounter's own doctor writes them. */
export function PrescriptionPanel({ recordId, canWrite }: { recordId: string; canWrite: boolean }) {
  const timeZone = useWorkspaceTimeZone();
  const list = useEncounterPrescriptions(recordId);
  const [writing, setWriting] = useState(false);
  return (
    <Panel
      title="Prescriptions"
      actions={
        canWrite &&
        !writing && (
          <Button size="sm" variant="secondary" onClick={() => setWriting(true)}>
            <Plus aria-hidden="true" /> New prescription
          </Button>
        )
      }
    >
      {list.isPending ? (
        <Skeleton className="h-12" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        !writing && <p className="text-sm text-muted">Nothing prescribed on this visit.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.data.map((rx) => (
            <li key={rx.id} className="rounded-md border border-border p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <RowLink href={ROUTES.staffPrescription(rx.id)}>{formatDateTime(rx.createdAt, timeZone)}</RowLink>
                <StatusBadge status={rx.status} kind="staff-rx" />
              </div>
              <ul className="text-sm text-muted">
                {rx.items.map((item) => (
                  <li key={item.id}>
                    <span className="text-foreground">{item.medicine.name}</span> {item.dosage}, {FREQUENCY_LABEL[item.frequency].toLowerCase()},{" "}
                    {item.durationDays} days · {item.quantityPrescribed} {item.medicine.unit}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {writing && <NewPrescription recordId={recordId} onDone={() => setWriting(false)} />}
    </Panel>
  );
}
