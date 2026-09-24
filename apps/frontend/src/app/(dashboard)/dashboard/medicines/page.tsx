"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { UserRole, type MedicineView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowLink } from "@/components/shared/detail-list";
import { toast } from "@/components/shared/toaster";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { MedicineForm } from "@/components/modules/pharmacy/medicine-form";
import { useCreateMedicine, useMedicines } from "@/services/workflows";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuthStore } from "@/store/auth-store";
import { ROUTES } from "@/constants";

const columns: Column<MedicineView>[] = [
  { key: "name", header: "Medicine", cell: (m) => <RowLink href={ROUTES.medicine(m.id)}>{m.name}</RowLink> },
  { key: "generic", header: "Generic name", cell: (m) => m.genericName ?? "—", hideOnMobile: true },
  { key: "form", header: "Form", cell: (m) => m.form.toLowerCase(), hideOnMobile: true },
  {
    key: "stock",
    header: "In stock",
    align: "right",
    cell: (m) => (
      <span className={m.availableQuantity < m.reorderLevel ? "font-medium text-warning" : undefined}>
        {m.availableQuantity} {m.unit}
        {m.availableQuantity < m.reorderLevel && <span className="sr-only"> (below reorder level)</span>}
      </span>
    ),
  },
  { key: "reorder", header: "Reorder at", align: "right", cell: (m) => m.reorderLevel, hideOnMobile: true },
];

function Medicines() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const canWrite = role === UserRole.PHARMACIST;
  const { values, page, set, setPage } = useUrlFilters(["search"] as const);
  const [search, setSearch] = useState(values.search);
  const debounced = useDebounce(search.trim(), 300);
  useEffect(() => {
    if (debounced !== values.search) set({ search: debounced });
  }, [debounced, values.search, set]);
  const list = useMedicines(values.search, page);
  const create = useCreateMedicine();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Medicines"
        description="The hospital's catalog. Stock counts only unexpired, dispensable batches."
        actions={
          canWrite &&
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" /> New medicine
            </Button>
          )
        }
      />
      {adding && (
        <Panel title="New medicine" className="mb-4">
          <MedicineForm
            submitLabel="Add to catalog"
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              const medicine = await create.mutateAsync(body);
              toast.success(`${medicine.name} added. Receive a batch to put it in stock.`);
              router.push(ROUTES.medicine(medicine.id));
            }}
          />
        </Panel>
      )}
      <FilterBar>
        <div className="flex w-full max-w-sm flex-col gap-1">
          <Label htmlFor="medicine-search" className="text-xs text-muted">
            Name
          </Label>
          <Input id="medicine-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-sm" />
        </div>
      </FilterBar>
      <DataTable
        caption="Medicines"
        columns={columns}
        rows={list.data?.data}
        rowKey={(m) => m.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={values.search ? { title: "No medicines match" } : { title: "The catalog is empty", description: canWrite ? "Add the first medicine." : undefined }}
        density="compact"
      />
    </>
  );
}

export default function MedicinesPage() {
  return (
    <RoleGate route={ROUTES.medicines}>
      <Suspense fallback={<FullPageLoader />}>
        <Medicines />
      </Suspense>
    </RoleGate>
  );
}
