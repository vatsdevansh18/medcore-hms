"use client";

import { Suspense, useEffect, useState } from "react";
import type { SearchDoctorHit, SearchMedicineHit, SearchPatientHit, SearchScope } from "@medcore/types";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { useGlobalSearch, useScopedSearch, type SearchHit } from "@/services/staff";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useDebounce } from "@/hooks/use-debounce";
import { formatCalendarDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABEL: Record<SearchScope, string> = { patients: "Patients", doctors: "Doctors", medicines: "Medicines" };

const COLUMNS: Record<SearchScope, Column<SearchHit>[]> = {
  patients: [
    { key: "name", header: "Name", cell: (h) => (h as SearchPatientHit).name },
    { key: "phone", header: "Phone", cell: (h) => (h as SearchPatientHit).phone ?? "—" },
    { key: "email", header: "Email", cell: (h) => (h as SearchPatientHit).email ?? "—", hideOnMobile: true },
    { key: "dob", header: "Date of birth", cell: (h) => formatCalendarDate((h as SearchPatientHit).dob), hideOnMobile: true },
  ],
  doctors: [
    { key: "name", header: "Name", cell: (h) => (h as SearchDoctorHit).name },
    { key: "specialization", header: "Specialization", cell: (h) => (h as SearchDoctorHit).specialization },
    { key: "department", header: "Department", cell: (h) => (h as SearchDoctorHit).department, hideOnMobile: true },
  ],
  medicines: [
    { key: "name", header: "Name", cell: (h) => (h as SearchMedicineHit).name },
    { key: "generic", header: "Generic name", cell: (h) => (h as SearchMedicineHit).genericName ?? "—" },
    { key: "form", header: "Form", cell: (h) => `${(h as SearchMedicineHit).form.toLowerCase()} · ${(h as SearchMedicineHit).unit}`, hideOnMobile: true },
  ],
};

/** FR-SEARCH-001's full results: one tab per scope the role can search,
 * each paginated server-side. */
function SearchResults() {
  const { values, page, set, setPage } = useUrlFilters(["q", "scope"] as const);
  const [text, setText] = useState(values.q);
  const debounced = useDebounce(text.trim(), 300);
  useEffect(() => {
    if (debounced !== values.q && (debounced.length >= 2 || debounced.length === 0)) set({ q: debounced || null });
  }, [debounced, values.q, set]);

  const q = values.q;
  const grouped = useGlobalSearch(q);
  const scopes = grouped.data?.scopes ?? [];
  const scope = (scopes.includes(values.scope as SearchScope) ? values.scope : scopes[0]) as SearchScope | undefined;
  const results = useScopedSearch(q, scope ?? "doctors", page);
  const counts: Partial<Record<SearchScope, number>> = {
    patients: grouped.data?.patients?.total,
    doctors: grouped.data?.doctors?.total,
    medicines: grouped.data?.medicines?.total,
  };

  return (
    <>
      <PageHeader title="Search" description="Across your hospital. Results depend on what your role can see." />
      <div className="mb-4 max-w-xl">
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name, phone, email, specialization, medicine…"
          aria-label="Search"
          autoFocus
        />
      </div>
      {q.length < 2 ? (
        <EmptyState title="Type at least two characters" description="Patients by name, email or phone; doctors by name, specialization or department; medicines by brand or generic name." />
      ) : (
        <>
          <div role="tablist" aria-label="Result type" className="mb-3 flex gap-1 border-b border-border">
            {scopes.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={s === scope}
                onClick={() => set({ scope: s })}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm",
                  s === scope ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {LABEL[s]} {counts[s] !== undefined && <span className="text-subtle">({counts[s]})</span>}
              </button>
            ))}
          </div>
          {scope && (
            <div role="tabpanel">
              <DataTable
                caption={`${LABEL[scope]} matching ${q}`}
                columns={COLUMNS[scope]}
                rows={results.data?.data}
                rowKey={(h) => h.id}
                meta={results.data?.meta}
                onPage={setPage}
                loading={results.isPending}
                error={results.error ?? grouped.error}
                onRetry={() => void results.refetch()}
                empty={{ title: `No ${LABEL[scope].toLowerCase()} match “${q}”` }}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <SearchResults />
    </Suspense>
  );
}
