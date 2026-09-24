"use client";

import { useState } from "react";
import type { ExpiringBatchView, LowStockView } from "@medcore/types";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { RoleGate } from "@/components/modules/role-gate";
import { useExpiring, useLowStock } from "@/services/staff";
import { formatCalendarDate } from "@/lib/format";
import { ROUTES } from "@/constants";

const lowColumns: Column<LowStockView>[] = [
  { key: "name", header: "Medicine", cell: (m) => (m.genericName ? `${m.name} (${m.genericName})` : m.name) },
  { key: "form", header: "Form", cell: (m) => m.form.toLowerCase(), hideOnMobile: true },
  { key: "available", header: "Available", align: "right", cell: (m) => `${m.availableQuantity} ${m.unit}` },
  { key: "reorder", header: "Reorder level", align: "right", cell: (m) => m.reorderLevel },
];

const expiringColumns: Column<ExpiringBatchView>[] = [
  { key: "medicine", header: "Medicine", cell: (b) => b.medicine.name },
  { key: "batch", header: "Batch", cell: (b) => b.batchNumber },
  { key: "quantity", header: "Quantity", align: "right", cell: (b) => `${b.quantityOnHand} ${b.medicine.unit}` },
  { key: "expiry", header: "Expires", cell: (b) => formatCalendarDate(b.expiryDate) },
];

function Inventory() {
  const [lowPage, setLowPage] = useState(1);
  const [expPage, setExpPage] = useState(1);
  const [days, setDays] = useState("30");
  const low = useLowStock(lowPage);
  const expiring = useExpiring(Number(days), expPage);
  return (
    <>
      <PageHeader title="Inventory" description="Stock below reorder level and batches nearing expiry. Expired batches are quarantined automatically every night." />
      <section aria-labelledby="low-heading" className="mb-8">
        <h2 id="low-heading" className="mb-3 text-lg font-semibold">
          Low stock
        </h2>
        <DataTable
          caption="Medicines below their reorder level"
          columns={lowColumns}
          rows={low.data?.data}
          rowKey={(m) => m.id}
          meta={low.data?.meta}
          onPage={setLowPage}
          loading={low.isPending}
          error={low.error}
          onRetry={() => void low.refetch()}
          empty={{ title: "Every medicine is above its reorder level" }}
          density="compact"
        />
      </section>
      <section aria-labelledby="expiring-heading" id="expiring">
        <h2 id="expiring-heading" className="mb-3 text-lg font-semibold">
          Expiring soon
        </h2>
        <FilterBar>
          <FilterSelect
            id="days"
            label="Within"
            value={days}
            onChange={(v) => {
              setDays(v);
              setExpPage(1);
            }}
            options={[
              { value: "30", label: "30 days" },
              { value: "60", label: "60 days" },
              { value: "90", label: "90 days" },
            ]}
          />
        </FilterBar>
        <DataTable
          caption="Dispensable batches expiring soon"
          columns={expiringColumns}
          rows={expiring.data?.data}
          rowKey={(b) => b.id}
          meta={expiring.data?.meta}
          onPage={setExpPage}
          loading={expiring.isPending}
          error={expiring.error}
          onRetry={() => void expiring.refetch()}
          empty={{ title: "No batches expire in this window" }}
          density="compact"
        />
      </section>
    </>
  );
}

export default function InventoryPage() {
  return (
    <RoleGate route={ROUTES.inventory}>
      <Inventory />
    </RoleGate>
  );
}
