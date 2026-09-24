"use client";

import { use } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { DownloadButton } from "@/components/shared/download-button";
import { prescriptionPdf, usePrescription } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { doctorName, formatDate } from "@/lib/format";
import { ROUTES } from "@/constants";
import { PrescriptionStatus } from "@medcore/types";

const FREQUENCY: Record<string, string> = {
  OD: "Once a day",
  BD: "Twice a day",
  TDS: "Three times a day",
  QID: "Four times a day",
  SOS: "When needed",
  OTHER: "As directed",
};

export default function PrescriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { timezone } = useHospital();
  const prescription = usePrescription(id);
  const back = { href: ROUTES.prescriptions, label: "Prescriptions" };

  if (prescription.isPending) {
    return (
      <>
        <PageHeader title="Prescription" back={back} />
        <ListSkeleton rows={2} />
      </>
    );
  }
  if (prescription.isError) {
    return (
      <>
        <PageHeader title="Prescription" back={back} />
        <ErrorState error={prescription.error} onRetry={() => void prescription.refetch()} />
      </>
    );
  }

  const p = prescription.data;
  return (
    <>
      <PageHeader
        title={`Prescription · ${formatDate(p.createdAt, timezone)}`}
        description={p.doctor ? `${doctorName(p.doctor.user)} · ${p.doctor.specialization}` : undefined}
        back={back}
        actions={
          p.pdfReady ? (
            <DownloadButton label="Download PDF" fetchUrl={() => prescriptionPdf(p.id)} />
          ) : (
            <span className="text-sm text-muted">The PDF is being prepared. Check back in a minute.</span>
          )
        }
      />
      {p.status === PrescriptionStatus.CANCELLED && (
        <p className="mb-4 rounded-md bg-warning-surface px-3 py-2 text-sm text-warning">
          This prescription was replaced by a corrected one. Please use the newer prescription.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Medicines</CardTitle>
          <StatusBadge status={p.status} />
        </CardHeader>
        <CardBody className="p-0">
          {/* Phones get a stacked list; the table needs width (§4 mobile-first). */}
          <ul className="divide-y divide-border sm:hidden">
            {p.items.map((item) => (
              <li key={item.id} className="px-4 py-3 text-sm">
                <p className="font-medium">{item.medicine.name}</p>
                {item.medicine.genericName && <p className="text-subtle">{item.medicine.genericName}</p>}
                <p className="mt-1">
                  {item.dosage} · {FREQUENCY[item.frequency] ?? item.frequency} · {item.durationDays} days
                </p>
                <p className="text-muted">
                  Quantity: {item.quantityPrescribed} {item.medicine.unit}
                </p>
                {item.specialInstructions && <p className="mt-1 text-muted">{item.specialInstructions}</p>}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Medicine</th>
                  <th scope="col" className="px-4 py-2 font-medium">Dose</th>
                  <th scope="col" className="px-4 py-2 font-medium">How often</th>
                  <th scope="col" className="px-4 py-2 font-medium">For</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((item) => (
                  <tr key={item.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.medicine.name}</p>
                      {item.medicine.genericName && <p className="text-subtle">{item.medicine.genericName}</p>}
                      {item.specialInstructions && <p className="mt-1 text-muted">{item.specialInstructions}</p>}
                    </td>
                    <td className="px-4 py-3">{item.dosage}</td>
                    <td className="px-4 py-3">{FREQUENCY[item.frequency] ?? item.frequency}</td>
                    <td className="px-4 py-3">{item.durationDays} days</td>
                    <td className="px-4 py-3 text-right">
                      {item.quantityPrescribed} {item.medicine.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
