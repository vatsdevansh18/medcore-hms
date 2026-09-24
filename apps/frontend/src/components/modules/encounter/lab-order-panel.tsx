"use client";

import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { LabOrderPriority } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/shared/panel";
import { FormField } from "@/components/shared/form-field";
import { ErrorState, FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { RowLink } from "@/components/shared/detail-list";
import { toast } from "@/components/shared/toaster";
import { useCreateLabOrder, useEncounterLabOrders, useLabTests } from "@/services/workflows";
import { useDebounce } from "@/hooks/use-debounce";
import { useWorkspaceTimeZone } from "@/hooks/use-hospital";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ROUTES } from "@/constants";

function NewLabOrder({ recordId, onDone }: { recordId: string; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search.trim(), 250);
  const tests = useLabTests(debounced);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [urgent, setUrgent] = useState(false);
  const create = useCreateLabOrder();

  function toggle(id: string, name: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  }

  async function submit() {
    try {
      await create.mutateAsync({
        medicalRecordId: recordId,
        priority: urgent ? LabOrderPriority.URGENT : LabOrderPriority.ROUTINE,
        items: [...selected.keys()].map((labTestId) => ({ labTestId })),
      });
      toast.success("Lab order sent to the laboratory.");
      onDone();
    } catch {
      // Shown below.
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <FormField label="Find a test" hint="By name or code.">
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. CBC" />
      </FormField>
      {tests.isPending ? (
        <Skeleton className="h-24" />
      ) : tests.isError ? (
        <ErrorState error={tests.error} onRetry={() => void tests.refetch()} />
      ) : tests.data.data.length === 0 ? (
        <p className="text-sm text-muted">No test matches “{debounced}”.</p>
      ) : (
        <fieldset className="max-h-56 overflow-auto rounded-md border border-border">
          <legend className="sr-only">Tests</legend>
          {tests.data.data.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-surface-muted">
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id, t.name)} className="size-4" />
              <span className="flex-1">
                <span className="font-medium">{t.name}</span> <span className="text-muted">({t.code})</span>
                {t.sampleType && <span className="text-muted"> · {t.sampleType}</span>}
              </span>
              <span className="tabular-nums text-muted">{formatMoney(t.price)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {selected.size > 0 && (
        <p className="text-sm">
          Ordering: <span className="font-medium">{[...selected.values()].join(", ")}</span>
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-4" />
        Urgent (the lab works these first)
      </label>
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} loading={create.isPending} disabled={selected.size === 0}>
          Order {selected.size || ""} test{selected.size === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

/** Lab orders on this encounter (FR-LAB-001). Each test is billed when
 * ordered; results appear here once the lab has approved them. */
export function LabOrderPanel({ recordId, canWrite }: { recordId: string; canWrite: boolean }) {
  const timeZone = useWorkspaceTimeZone();
  const list = useEncounterLabOrders(recordId);
  const [ordering, setOrdering] = useState(false);
  return (
    <Panel
      title="Lab orders"
      actions={
        canWrite &&
        !ordering && (
          <Button size="sm" variant="secondary" onClick={() => setOrdering(true)}>
            <Plus aria-hidden="true" /> Order tests
          </Button>
        )
      }
    >
      {list.isPending ? (
        <Skeleton className="h-12" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        !ordering && <p className="text-sm text-muted">No tests ordered on this visit.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.data.map((order) => (
            <li key={order.id} className="rounded-md border border-border p-3">
              <div className="mb-1 flex items-center gap-2">
                <RowLink href={ROUTES.labOrder(order.id)}>{formatDateTime(order.createdAt, timeZone)}</RowLink>
                {order.priority === "URGENT" && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
                    <AlertTriangle className="size-3.5" aria-hidden="true" /> Urgent
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span>{item.labTest.name}</span>
                    <StatusBadge status={item.status} kind="lab" />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {ordering && <NewLabOrder recordId={recordId} onDone={() => setOrdering(false)} />}
    </Panel>
  );
}
