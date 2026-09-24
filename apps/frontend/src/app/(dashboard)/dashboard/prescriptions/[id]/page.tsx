"use client";

import { use, useState } from "react";
import { PackageCheck } from "lucide-react";
import { PrescriptionStatus, UserRole, type StaffPrescriptionView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { DownloadButton } from "@/components/shared/download-button";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { FREQUENCY_LABEL } from "@/components/modules/encounter/prescription-panel";
import { useDispense, useMedicine, useStaffPrescription } from "@/services/workflows";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { apiRequest } from "@/lib/api-client";
import { doctorName, formatDateTime, personName } from "@/lib/format";
import { dispensePlan, type DispenseLine } from "@/lib/dispense";
import { ROUTES } from "@/constants";

type Item = StaffPrescriptionView["items"][number];

function StockHint({ medicineId, unit }: { medicineId: string; unit: string }) {
  const medicine = useMedicine(medicineId);
  // Inline (a <span>): this sits inside a paragraph, where a block skeleton is invalid HTML.
  if (medicine.isPending) return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-20 rounded-md bg-[linear-gradient(90deg,var(--surface-muted)_0%,var(--border)_50%,var(--surface-muted)_100%)] bg-[length:800px_100%] align-middle [animation:shimmer_1.4s_linear_infinite]"
      />
    );
  if (medicine.isError) return null;
  const available = medicine.data.availableQuantity;
  return (
    <span className={available > 0 ? "text-xs text-muted" : "text-xs font-medium text-warning"}>
      {available > 0 ? `${available} ${unit} in stock` : "Out of stock"}
    </span>
  );
}

/**
 * Dispensing against a prescription (FR-PHARM-002/003). The pharmacist
 * enters how much of each remaining line to hand over now; batches are
 * chosen by the server, earliest expiry first, and the whole request is
 * atomic: if any line can't be filled nothing is dispensed.
 */
function Dispense({ rx }: { rx: StaffPrescriptionView }) {
  const dispense = useDispense(rx.id);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(rx.items.map((i) => [i.id, String(i.quantityPrescribed - i.dispensedQuantity)])),
  );
  const [confirming, setConfirming] = useState(false);
  const plan = dispensePlan(rx.items, quantities);

  async function submit() {
    try {
      await dispense.mutateAsync({ items: plan.lines.map(({ itemId, quantity }) => ({ prescriptionItemId: itemId, quantity })) });
      setConfirming(false);
      toast.success("Dispensed. The charge is on the patient's bill.");
    } catch {
      // Shown in the dialog.
    }
  }

  return (
    <Panel title="Dispense">
      <ul className="flex flex-col gap-3">
        {rx.items.map((item) => {
          const remaining = item.quantityPrescribed - item.dispensedQuantity;
          const error = plan.errors[item.id];
          return (
            <li key={item.id} className="grid items-start gap-2 border-b border-border pb-3 last:border-b-0 sm:grid-cols-[1fr_10rem]">
              <div>
                <p className="font-medium">{item.medicine.name}</p>
                <p className="text-sm text-muted">
                  {item.dosage}, {FREQUENCY_LABEL[item.frequency].toLowerCase()}, {item.durationDays} days
                </p>
                <p className="text-sm">
                  {item.dispensedQuantity} of {item.quantityPrescribed} {item.medicine.unit} dispensed ·{" "}
                  <StockHint medicineId={item.medicine.id} unit={item.medicine.unit} />
                </p>
              </div>
              {remaining > 0 ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor={`qty-${item.id}`} className="text-xs text-muted">
                    Hand over now ({item.medicine.unit})
                  </label>
                  <Input
                    id={`qty-${item.id}`}
                    inputMode="numeric"
                    value={quantities[item.id] ?? ""}
                    onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: e.target.value }))}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `qty-${item.id}-error` : undefined}
                  />
                  <p id={`qty-${item.id}-error`} className="min-h-4 text-xs text-danger">
                    {error}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-success">Fully dispensed</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button
          onClick={() => {
            dispense.reset();
            setConfirming(true);
          }}
          disabled={!plan.valid}
        >
          <PackageCheck aria-hidden="true" /> Dispense
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Dispense these medicines?"
        consequence="Stock is taken from the earliest-expiring batches and the patient is charged the MRP. Dispensing can't be undone here."
        confirmLabel="Dispense"
        pending={dispense.isPending}
        error={dispense.error}
        onConfirm={() => void submit()}
      >
        <ul className="text-sm">
          {plan.lines.map((line: DispenseLine) => (
            <li key={line.itemId}>
              {line.quantity} × {line.name}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </Panel>
  );
}

function PrescriptionDetail({ id }: { id: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const timeZone = useWorkspaceTimeZone();
  const rx = useStaffPrescription(id);
  if (rx.isPending) return <Skeleton className="h-64" />;
  if (rx.isError) return <ErrorState error={rx.error} onRetry={() => void rx.refetch()} />;
  const p = rx.data;
  const isPharmacist = role === UserRole.PHARMACIST;
  const open = p.status === PrescriptionStatus.ISSUED || p.status === PrescriptionStatus.PARTIALLY_DISPENSED;

  return (
    <>
      <PageHeader
        title={`Prescription · ${personName(p.patient)}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} kind="staff-rx" />
            <span>
              {doctorName(p.doctor?.user)} · {formatDateTime(p.createdAt, timeZone)}
            </span>
          </span>
        }
        back={{ href: ROUTES.rxQueue, label: isPharmacist ? "Dispensing queue" : "Prescriptions" }}
        actions={
          role === UserRole.DOCTOR && p.pdfReady ? (
            <DownloadButton label="PDF" fetchUrl={() => apiRequest(`/prescriptions/${p.id}/pdf`)} />
          ) : undefined
        }
      />
      {isPharmacist && open ? (
        <Dispense rx={p} />
      ) : (
        <Panel title="Medicines">
          <ul className="flex flex-col gap-2 text-sm">
            {p.items.map((item: Item) => (
              <li key={item.id}>
                <span className="font-medium">{item.medicine.name}</span> {item.dosage}, {FREQUENCY_LABEL[item.frequency].toLowerCase()},{" "}
                {item.durationDays} days · {item.dispensedQuantity} of {item.quantityPrescribed} {item.medicine.unit} dispensed
                {item.specialInstructions && <span className="text-muted"> · {item.specialInstructions}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

export default function StaffPrescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/prescriptions/:id">
      <PrescriptionDetail id={id} />
    </RoleGate>
  );
}
