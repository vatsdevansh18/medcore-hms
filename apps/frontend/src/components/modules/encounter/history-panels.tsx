"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Paperclip } from "lucide-react";
import { FamilyHistoryCondition, type AttachmentView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/shared/panel";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { DownloadButton } from "@/components/shared/download-button";
import { toast } from "@/components/shared/toaster";
import {
  fetchAttachmentUrl,
  useAddFamilyHistory,
  useAddVaccination,
  useFamilyHistory,
  useUploadAttachment,
  useVaccinations,
} from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatBytes, formatCalendarDate, formatDateTime } from "@/lib/format";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, fileProblem } from "@/lib/upload";
import {
  familyHistorySchema,
  vaccinationSchema,
  type FamilyHistoryValues,
  type VaccinationValues,
} from "@/lib/staff-validation";

const CONDITION_LABEL: Record<FamilyHistoryCondition, string> = {
  DIABETES: "Diabetes",
  HYPERTENSION: "Hypertension",
  CANCER: "Cancer",
  CARDIAC: "Heart disease",
  OTHER: "Other",
};

/** Vaccinations (FR-EMR-005): patient-level, kept across visits. */
export function VaccinationsPanel({ patientId }: { patientId: string }) {
  const list = useVaccinations(patientId);
  const add = useAddVaccination(patientId);
  const [adding, setAdding] = useState(false);
  const EMPTY: VaccinationValues = { vaccineName: "", doseNumber: "1", dateAdministered: "", batchNumber: "", nextDueDate: "" };
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VaccinationValues>({ resolver: zodResolver(vaccinationSchema), mode: "onBlur", reValidateMode: "onChange", defaultValues: EMPTY });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync({
        vaccineName: v.vaccineName,
        doseNumber: Number(v.doseNumber),
        dateAdministered: v.dateAdministered,
        ...(v.batchNumber ? { batchNumber: v.batchNumber } : {}),
        ...(v.nextDueDate ? { nextDueDate: v.nextDueDate } : {}),
      });
      reset(EMPTY);
      setAdding(false);
      toast.success("Vaccination recorded.");
    } catch {
      // Shown below.
    }
  });

  return (
    <Panel
      title="Vaccinations"
      actions={
        !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add
          </Button>
        )
      }
    >
      {list.isPending ? (
        <Skeleton className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        !adding && <p className="text-sm text-muted">No vaccinations recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.data.map((v) => (
            <li key={v.id}>
              <span className="font-medium">{v.vaccineName}</span> <span className="text-muted">dose {v.doseNumber} · {formatCalendarDate(v.dateAdministered)}</span>
              {v.nextDueDate && <span className="text-muted"> · next {formatCalendarDate(v.nextDueDate)}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <FormField label="Vaccine" error={errors.vaccineName?.message}>
            <Input {...register("vaccineName")} />
          </FormField>
          <div className="grid grid-cols-2 gap-x-3">
            <FormField label="Dose" error={errors.doseNumber?.message}>
              <Input inputMode="numeric" {...register("doseNumber")} />
            </FormField>
            <FormField label="Given on" error={errors.dateAdministered?.message}>
              <Input type="date" {...register("dateAdministered")} />
            </FormField>
            <FormField label="Batch (optional)" error={errors.batchNumber?.message}>
              <Input {...register("batchNumber")} />
            </FormField>
            <FormField label="Next dose (optional)" error={errors.nextDueDate?.message}>
              <Input type="date" {...register("nextDueDate")} />
            </FormField>
          </div>
          <FormError error={add.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={add.isPending}>
              Save vaccination
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/** Family history (FR-EMR-005). */
export function FamilyHistoryPanel({ patientId }: { patientId: string }) {
  const list = useFamilyHistory(patientId);
  const add = useAddFamilyHistory(patientId);
  const [adding, setAdding] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FamilyHistoryValues>({
    resolver: zodResolver(familyHistorySchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { condition: "DIABETES", notes: "" },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync({ condition: v.condition, ...(v.notes ? { notes: v.notes } : {}) });
      reset();
      setAdding(false);
      toast.success("Family history recorded.");
    } catch {
      // Shown below.
    }
  });

  return (
    <Panel
      title="Family history"
      actions={
        !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add
          </Button>
        )
      }
    >
      {list.isPending ? (
        <Skeleton className="h-10" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        !adding && <p className="text-sm text-muted">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.data.map((f) => (
            <li key={f.id}>
              <span className="font-medium">{CONDITION_LABEL[f.condition]}</span>
              {f.notes && <span className="text-muted"> · {f.notes}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <FormField label="Condition" error={errors.condition?.message}>
            <Select {...register("condition")}>
              {Object.values(FamilyHistoryCondition).map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Notes (optional)" error={errors.notes?.message} hint="e.g. which relative">
            <Input {...register("notes")} />
          </FormField>
          <FormError error={add.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={add.isPending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/** Attachments on this encounter (FR-EMR-006): scans and reports, up to
 * 20 MB, uploaded straight to storage through a pre-signed URL and
 * downloaded the same way. The file type is checked here and again by the API. */
export function AttachmentsPanel({ recordId, attachments }: { recordId: string; attachments: AttachmentView[] }) {
  const timeZone = useWorkspaceTimeZone();
  const upload = useUploadAttachment(recordId);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    upload.reset();
    const issue = fileProblem(file, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES);
    setProblem(issue);
    if (issue) return;
    try {
      await upload.mutateAsync(file);
      toast.success(`${file.name} attached.`);
    } catch {
      // Shown below.
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Panel
      title="Attachments"
      actions={
        <>
          <input
            ref={input}
            id={`attach-${recordId}`}
            type="file"
            className="sr-only"
            accept={Object.values(ATTACHMENT_TYPES).flat().join(",")}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={upload.isPending}>
            {!upload.isPending && <Paperclip aria-hidden="true" />} Attach file
          </Button>
        </>
      }
    >
      {attachments.length === 0 ? (
        <p className="text-sm text-muted">No files. Attach a scan, image, or report (PDF, JPEG, PNG, Word; up to 20 MB).</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.fileName}</span>
                <span className="text-xs text-muted">
                  {formatBytes(a.sizeBytes)} · {formatDateTime(a.createdAt, timeZone)}
                </span>
              </span>
              <DownloadButton label="Open" fetchUrl={() => fetchAttachmentUrl(recordId, a.id)} />
            </li>
          ))}
        </ul>
      )}
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
