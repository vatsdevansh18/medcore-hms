"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MedicineForm as Form, type MedicineRequest, type MedicineView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { medicineSchema, type MedicineValues } from "@/lib/staff-validation";

const FORM_LABEL: Record<Form, string> = {
  TABLET: "Tablet",
  CAPSULE: "Capsule",
  SYRUP: "Syrup",
  INJECTION: "Injection",
  TOPICAL: "Topical",
  OTHER: "Other",
};

/** Catalog entry fields (FR-PHARM-001). Stock never comes from here: it
 * arrives only as received batches. */
export function MedicineForm({
  initial,
  submitLabel,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: MedicineView;
  submitLabel: string;
  error: unknown;
  onSubmit: (body: MedicineRequest) => Promise<void>;
  onCancel?: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MedicineValues>({
    resolver: zodResolver(medicineSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      name: initial?.name ?? "",
      genericName: initial?.genericName ?? "",
      form: initial?.form ?? "TABLET",
      manufacturer: initial?.manufacturer ?? "",
      unit: initial?.unit ?? "",
      reorderLevel: initial ? String(initial.reorderLevel) : "",
    },
  });

  const submit = handleSubmit(async (v) => {
    await onSubmit({
      name: v.name,
      form: v.form,
      unit: v.unit,
      ...(v.genericName ? { genericName: v.genericName } : {}),
      ...(v.manufacturer ? { manufacturer: v.manufacturer } : {}),
      ...(v.reorderLevel !== "" ? { reorderLevel: Number(v.reorderLevel) } : {}),
    }).catch(() => undefined);
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-1">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <FormField label="Name" error={errors.name?.message}>
          <Input {...register("name")} />
        </FormField>
        <FormField label="Generic name (optional)" error={errors.genericName?.message}>
          <Input {...register("genericName")} />
        </FormField>
        <FormField label="Form" error={errors.form?.message}>
          <Select {...register("form")}>
            {Object.values(Form).map((f) => (
              <option key={f} value={f}>
                {FORM_LABEL[f]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Unit" error={errors.unit?.message} hint="What one counted item is, e.g. tablet, ml, vial.">
          <Input {...register("unit")} />
        </FormField>
        <FormField label="Manufacturer (optional)" error={errors.manufacturer?.message}>
          <Input {...register("manufacturer")} />
        </FormField>
        <FormField label="Reorder level (optional)" error={errors.reorderLevel?.message} hint="A low-stock alert fires below this. Default 10.">
          <Input inputMode="numeric" {...register("reorderLevel")} />
        </FormField>
      </div>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
