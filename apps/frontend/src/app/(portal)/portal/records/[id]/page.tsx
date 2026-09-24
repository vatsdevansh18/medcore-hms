"use client";

import { use } from "react";
import { Paperclip } from "lucide-react";
import type { VitalsView } from "@medcore/types";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { DownloadButton } from "@/components/shared/download-button";
import { downloadAttachment, useMedicalRecord } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { ROUTES } from "@/constants";

function vitalsRows(v: VitalsView): [string, string][] {
  const rows: [string, string | null][] = [
    ["Blood pressure", v.bpSystolic && v.bpDiastolic ? `${v.bpSystolic}/${v.bpDiastolic} mmHg` : null],
    ["Pulse", v.pulse ? `${v.pulse} bpm` : null],
    ["Temperature", v.temperatureC ? `${v.temperatureC} °C` : null],
    ["SpO₂", v.spo2 ? `${v.spo2}%` : null],
    ["Height", v.heightCm ? `${v.heightCm} cm` : null],
    ["Weight", v.weightKg ? `${v.weightKg} kg` : null],
    ["BMI", v.bmi],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export default function RecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { timezone } = useHospital();
  const record = useMedicalRecord(id);
  const back = { href: ROUTES.records, label: "Medical records" };

  if (record.isPending) {
    return (
      <>
        <PageHeader title="Visit record" back={back} />
        <ListSkeleton rows={2} />
      </>
    );
  }
  if (record.isError) {
    return (
      <>
        <PageHeader title="Visit record" back={back} />
        <ErrorState error={record.error} onRetry={() => void record.refetch()} />
      </>
    );
  }

  const r = record.data;
  return (
    <>
      <PageHeader title={`Visit on ${formatDate(r.createdAt, timezone)}`} description={r.chiefComplaint ?? undefined} back={back} />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Consultation</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Section title="Symptoms" text={r.presentingSymptoms} />
            <Section title="Diagnosis" text={r.diagnosisNotes} />
            {r.confirmedDiagnosisIcd10.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted">Diagnosis codes (ICD-10)</h3>
                <p className="mt-1">{r.confirmedDiagnosisIcd10.join(", ")}</p>
              </div>
            )}
            <Section title="Treatment plan" text={r.treatmentPlan} />
            <Section title="Doctor's notes" text={r.notes} />
            {!r.presentingSymptoms && !r.diagnosisNotes && !r.treatmentPlan && !r.notes && (
              <p className="text-sm text-muted">Your doctor hasn&apos;t added notes to this visit yet.</p>
            )}
          </CardBody>
        </Card>

        {r.vitals.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Vitals</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              {r.vitals.map((v) => (
                <div key={v.id}>
                  <p className="mb-2 text-sm text-muted">{formatDateTime(v.recordedAt, timezone)}</p>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    {vitalsRows(v).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted">{label}</dt>
                        <dd className="font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {r.addenda.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Later notes</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {r.addenda.map((a) => (
                <div key={a.id}>
                  <p className="text-sm text-muted">{formatDateTime(a.createdAt, timezone)}</p>
                  <p className="mt-1 whitespace-pre-wrap">{a.note}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        {r.attachments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-col gap-2">
                {r.attachments.map((att) => (
                  <li key={att.id} className="flex items-center gap-3">
                    <Paperclip className="size-4 text-subtle" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {att.fileName} <span className="text-sm text-subtle">· {formatBytes(att.sizeBytes)}</span>
                    </span>
                    <DownloadButton label="Open" fetchUrl={() => downloadAttachment(r.id, att.id)} aria-label={`Open ${att.fileName}`} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
