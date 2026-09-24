"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PackagePlus, Pencil } from "lucide-react";
import { UserRole, type MedicineBatchView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DetailList } from "@/components/shared/detail-list";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { MedicineForm } from "@/components/modules/pharmacy/medicine-form";
import { useMedicine, useMedicineBatches, useReceiveBatch, useUpdateMedicine } from "@/services/workflows";
import { useHospital } from "@/hooks/use-hospital";
import { useAuthStore } from "@/store/auth-store";
import { formatCalendarDate, formatMoney, todayKey } from "@/lib/format";
import { batchSchema, type BatchValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

const EMPTY_BATCH: BatchValues = { batchNumber: "", manufacturingDate: "", expiryDate: "", quantity: "", unitCost: "", mrp: "" };

/** Receiving stock (FR-PHARM-001): a batch with its dates and prices. The
 * server refuses a duplicate batch number, an already-expired batch, and a
 * future manufacturing date. */
function ReceiveBatch({ medicineId, unit, onDone }: { medicineId: string; unit: string; onDone: () => void }) {
  const { timezone } = useHospital();
  const today = todayKey(timezone);
  const receive = useReceiveBatch(medicineId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BatchValues>({ resolver: zodResolver(batchSchema), mode: "onBlur", reValidateMode: "onChange", defaultValues: EMPTY_BATCH });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await receive.mutateAsync({
        batchNumber: v.batchNumber,
        manufacturingDate: v.manufacturingDate,
        expiryDate: v.expiryDate,
        quantity: Number(v.quantity),
        unitCost: Number(v.unitCost),
        mrp: Number(v.mrp),
      });
      toast.success(`Batch ${v.batchNumber} received: ${v.quantity} ${unit}.`);
      onDone();
    } catch {
      // Shown below.
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
      <div className="grid gap-x-4 sm:grid-cols-3">
        <FormField label="Batch number" error={errors.batchNumber?.message}>
          <Input {...register("batchNumber")} />
        </FormField>
        <FormField label="Manufactured" error={errors.manufacturingDate?.message}>
          <Input type="date" max={today} {...register("manufacturingDate")} />
        </FormField>
        <FormField label="Expires" error={errors.expiryDate?.message}>
          <Input type="date" min={today} {...register("expiryDate")} />
        </FormField>
        <FormField label={`Quantity (${unit})`} error={errors.quantity?.message}>
          <Input inputMode="numeric" {...register("quantity")} />
        </FormField>
        <FormField label="Unit cost" error={errors.unitCost?.message}>
          <Input inputMode="decimal" {...register("unitCost")} />
        </FormField>
        <FormField label="MRP (charged per unit)" error={errors.mrp?.message}>
          <Input inputMode="decimal" {...register("mrp")} />
        </FormField>
      </div>
      <FormError error={receive.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={receive.isPending}>
          Receive batch
        </Button>
      </div>
    </form>
  );
}

function MedicineDetail({ id }: { id: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const canWrite = role === UserRole.PHARMACIST;
  const medicine = useMedicine(id);
  const [page, setPage] = useState(1);
  const batches = useMedicineBatches(id, page);
  const update = useUpdateMedicine(id);
  const [editing, setEditing] = useState(false);
  const [receiving, setReceiving] = useState(false);

  if (medicine.isPending) return <Skeleton className="h-64" />;
  if (medicine.isError) return <ErrorState error={medicine.error} onRetry={() => void medicine.refetch()} />;
  const m = medicine.data;
  const low = m.availableQuantity < m.reorderLevel;

  const columns: Column<MedicineBatchView>[] = [
    { key: "batch", header: "Batch", cell: (b) => b.batchNumber },
    { key: "expiry", header: "Expires", cell: (b) => formatCalendarDate(b.expiryDate) },
    { key: "qty", header: "On hand", align: "right", cell: (b) => `${b.quantityOnHand} ${m.unit}` },
    { key: "mrp", header: "MRP", align: "right", cell: (b) => formatMoney(b.mrp), hideOnMobile: true },
    { key: "cost", header: "Unit cost", align: "right", cell: (b) => formatMoney(b.unitCost), hideOnMobile: true },
    { key: "made", header: "Manufactured", cell: (b) => formatCalendarDate(b.manufacturingDate), hideOnMobile: true },
    { key: "status", header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={m.name}
        description={m.genericName ?? undefined}
        back={{ href: ROUTES.medicines, label: "Medicines" }}
        actions={
          canWrite && (
            <>
              {!editing && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" /> Edit
                </Button>
              )}
              {!receiving && (
                <Button onClick={() => setReceiving(true)}>
                  <PackagePlus aria-hidden="true" /> Receive batch
                </Button>
              )}
            </>
          )
        }
      />
      {receiving && (
        <Panel title="Receive a batch" className="mb-4">
          <ReceiveBatch medicineId={m.id} unit={m.unit} onDone={() => setReceiving(false)} />
        </Panel>
      )}
      {editing ? (
        <Panel title="Edit medicine" className="mb-4">
          <MedicineForm
            initial={m}
            submitLabel="Save changes"
            error={update.error}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await update.mutateAsync(body);
              toast.success("Saved.");
              setEditing(false);
            }}
          />
        </Panel>
      ) : (
        <Panel title="Details" className="mb-4">
          <DetailList
            items={[
              ["Form", m.form.charAt(0) + m.form.slice(1).toLowerCase()],
              ["Unit", m.unit],
              ["Manufacturer", m.manufacturer],
              [
                "In stock",
                <span key="s" className={low ? "font-medium text-warning" : undefined}>
                  {m.availableQuantity} {m.unit}
                  {low ? " · below reorder level" : ""}
                </span>,
              ],
              ["Reorder level", m.reorderLevel],
            ]}
          />
        </Panel>
      )}
      <h2 className="mb-3 text-lg font-semibold">Batches</h2>
      <p className="mb-3 text-sm text-muted">Earliest expiry first: the order dispensing uses them in.</p>
      <DataTable
        caption="Batches"
        columns={columns}
        rows={batches.data?.data}
        rowKey={(b) => b.id}
        meta={batches.data?.meta}
        onPage={setPage}
        loading={batches.isPending}
        error={batches.error}
        onRetry={() => void batches.refetch()}
        empty={{ title: "No batches yet", description: canWrite ? "Receive a batch to put this medicine in stock." : undefined }}
        density="compact"
      />
    </>
  );
}

export default function MedicinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RoleGate route="/dashboard/medicines/:id">
      <MedicineDetail id={id} />
    </RoleGate>
  );
}
