"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { VitalsView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/shared/panel";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { useRecordVitals } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatDateTime } from "@/lib/format";
import { vitalsBody, vitalsSchema, type VitalsValues } from "@/lib/staff-validation";

const EMPTY: VitalsValues = { bpSystolic: "", bpDiastolic: "", pulse: "", temperatureC: "", spo2: "", heightCm: "", weightKg: "" };

function reading(v: VitalsView): [string, string][] {
  const rows: [string, string | null][] = [
    ["Blood pressure", v.bpSystolic !== null && v.bpDiastolic !== null ? `${v.bpSystolic}/${v.bpDiastolic} mmHg` : null],
    ["Pulse", v.pulse !== null ? `${v.pulse} bpm` : null],
    ["Temperature", v.temperatureC !== null ? `${Number(v.temperatureC)} °C` : null],
    ["SpO₂", v.spo2 !== null ? `${v.spo2}%` : null],
    ["Height", v.heightCm !== null ? `${Number(v.heightCm)} cm` : null],
    ["Weight", v.weightKg !== null ? `${Number(v.weightKg)} kg` : null],
    ["BMI", v.bmi !== null ? Number(v.bmi).toFixed(1) : null],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

/** Vitals (FR-EMR-003): the latest reading and a form for a new one. BMI is
 * computed by the server from height and weight. */
export function VitalsPanel({ recordId, vitals }: { recordId: string; vitals: VitalsView[] }) {
  const timeZone = useWorkspaceTimeZone();
  const [adding, setAdding] = useState(vitals.length === 0);
  const record = useRecordVitals(recordId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VitalsValues>({ resolver: zodResolver(vitalsSchema), mode: "onBlur", reValidateMode: "onChange", defaultValues: EMPTY });
  const latest = vitals[0];

  const onSubmit = handleSubmit(async (values) => {
    try {
      await record.mutateAsync(vitalsBody(values));
      reset(EMPTY);
      setAdding(false);
      toast.success("Vitals recorded.");
    } catch {
      // Shown below.
    }
  });

  return (
    <Panel
      title="Vitals"
      actions={
        !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Record vitals
          </Button>
        )
      }
    >
      {latest ? (
        <>
          <p className="mb-2 text-xs text-muted">Latest, {formatDateTime(latest.recordedAt, timeZone)}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {reading(latest).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {vitals.length > 1 && <p className="mt-2 text-xs text-subtle">{vitals.length - 1} earlier reading(s) on this encounter.</p>}
        </>
      ) : (
        !adding && <p className="text-sm text-muted">No vitals yet.</p>
      )}
      {adding && (
        <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-x-3">
            <FormField label="Systolic" error={errors.bpSystolic?.message}>
              <Input inputMode="numeric" {...register("bpSystolic")} />
            </FormField>
            <FormField label="Diastolic" error={errors.bpDiastolic?.message}>
              <Input inputMode="numeric" {...register("bpDiastolic")} />
            </FormField>
            <FormField label="Pulse (bpm)" error={errors.pulse?.message}>
              <Input inputMode="numeric" {...register("pulse")} />
            </FormField>
            <FormField label="Temp (°C)" error={errors.temperatureC?.message}>
              <Input inputMode="decimal" {...register("temperatureC")} />
            </FormField>
            <FormField label="SpO₂ (%)" error={errors.spo2?.message}>
              <Input inputMode="numeric" {...register("spo2")} />
            </FormField>
            <FormField label="Height (cm)" error={errors.heightCm?.message}>
              <Input inputMode="decimal" {...register("heightCm")} />
            </FormField>
            <FormField label="Weight (kg)" error={errors.weightKg?.message}>
              <Input inputMode="decimal" {...register("weightKg")} />
            </FormField>
          </div>
          <FormError error={record.error} />
          <div className="flex justify-end gap-2">
            {latest && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" size="sm" loading={record.isPending}>
              Save vitals
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
