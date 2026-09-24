"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useAllergies, useFamilyHistory, useMedicalRecords, useVaccinations } from "@/services/portal";
import { useHospital } from "@/hooks/use-hospital";
import { formatCalendarDate, formatDate } from "@/lib/format";
import { ROUTES } from "@/constants";

function SmallList<T>({
  title,
  query,
  empty,
  render,
}: {
  title: string;
  query: { isPending: boolean; isError: boolean; error: unknown; data?: T[]; refetch: () => unknown };
  empty: string;
  render: (item: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {query.isPending ? (
          <ListSkeleton rows={1} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : !query.data || query.data.length === 0 ? (
          <p className="text-sm text-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">{query.data.map(render)}</ul>
        )}
      </CardBody>
    </Card>
  );
}

const FAMILY_LABELS: Record<string, string> = {
  DIABETES: "Diabetes",
  HYPERTENSION: "Hypertension",
  CANCER: "Cancer",
  CARDIAC: "Heart disease",
  OTHER: "Other",
};

/** FR-PORTAL-001 / FR-EMR-007: the patient's own encounters and
 * patient-level history (allergies, vaccinations, family history). */
export default function RecordsPage() {
  const [page, setPage] = useState(1);
  const { timezone } = useHospital();
  const records = useMedicalRecords(page);
  const allergies = useAllergies();
  const vaccinations = useVaccinations();
  const family = useFamilyHistory();

  return (
    <>
      <PageHeader title="Medical records" description="Notes from your visits, written by your doctors." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="visits-heading">
          <h2 id="visits-heading" className="mb-3 text-lg font-semibold">
            Visits
          </h2>
          {records.isPending ? (
            <ListSkeleton />
          ) : records.isError ? (
            <ErrorState error={records.error} onRetry={() => void records.refetch()} />
          ) : records.data.data.length === 0 ? (
            <EmptyState title="No visit records yet" description="Your doctor's notes appear here after a consultation." />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {records.data.data.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={ROUTES.record(r.id)}
                      className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{formatDate(r.createdAt, timezone)}</p>
                        <p className="mt-0.5 truncate text-sm text-muted">{r.chiefComplaint || "Consultation"}</p>
                        {r.diagnosisNotes && <p className="mt-0.5 truncate text-sm text-subtle">{r.diagnosisNotes}</p>}
                      </div>
                      <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination meta={records.data.meta} onPage={setPage} />
            </>
          )}
        </section>
        <aside className="flex flex-col gap-4" aria-label="Health history">
          <SmallList
            title="Allergies"
            query={allergies}
            empty="No allergies recorded."
            render={(a) => (
              <li key={a.id}>
                <span className="font-medium">{a.allergen}</span>
                {a.severity && <span className="text-muted"> · {a.severity}</span>}
                {a.reaction && <p className="text-muted">{a.reaction}</p>}
              </li>
            )}
          />
          <SmallList
            title="Vaccinations"
            query={vaccinations}
            empty="No vaccinations recorded."
            render={(v) => (
              <li key={v.id}>
                <span className="font-medium">{v.vaccineName}</span>
                <span className="text-muted"> · dose {v.doseNumber}</span>
                <p className="text-muted">
                  Given {formatCalendarDate(v.dateAdministered)}
                  {v.nextDueDate ? ` · next due ${formatCalendarDate(v.nextDueDate)}` : ""}
                </p>
              </li>
            )}
          />
          <SmallList
            title="Family history"
            query={family}
            empty="No family history recorded."
            render={(f) => (
              <li key={f.id}>
                <span className="font-medium">{FAMILY_LABELS[f.condition] ?? f.condition}</span>
                {f.notes && <p className="text-muted">{f.notes}</p>}
              </li>
            )}
          />
        </aside>
      </div>
    </>
  );
}
