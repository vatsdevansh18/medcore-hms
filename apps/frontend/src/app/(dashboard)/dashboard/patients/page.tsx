"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { UserRole, type PatientProfileView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowLink } from "@/components/shared/detail-list";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { usePatientDirectory } from "@/services/workflows";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuthStore } from "@/store/auth-store";
import { formatCalendarDate, personName } from "@/lib/format";
import { ROUTES } from "@/constants";

function PatientList() {
  const role = useAuthStore((s) => s.user?.role);
  const canRegister = role === UserRole.RECEPTIONIST || role === UserRole.HOSPITAL_ADMIN;
  const { values, page, set, setPage } = useUrlFilters(["search"] as const);
  const [search, setSearch] = useState(values.search);
  const debounced = useDebounce(search.trim(), 300);
  useEffect(() => {
    if (debounced !== values.search) set({ search: debounced });
  }, [debounced, values.search, set]);
  const list = usePatientDirectory(values.search, page);

  const columns: Column<PatientProfileView>[] = [
    { key: "name", header: "Name", cell: (p) => <RowLink href={ROUTES.patient(p.id)}>{personName(p.user)}</RowLink> },
    { key: "email", header: "Email", cell: (p) => p.user.email, hideOnMobile: true },
    { key: "phone", header: "Phone", cell: (p) => p.user.phone ?? "—", hideOnMobile: true },
    { key: "dob", header: "Date of birth", cell: (p) => formatCalendarDate(p.dob) },
  ];

  return (
    <>
      <PageHeader
        title="Patients"
        description="Registered patients at this hospital, newest first."
        actions={
          canRegister && (
            <Button asChild>
              <Link href={ROUTES.newPatient}>
                <UserPlus aria-hidden="true" /> Register patient
              </Link>
            </Button>
          )
        }
      />
      <FilterBar>
        <div className="flex w-full max-w-sm flex-col gap-1">
          <Label htmlFor="patient-search" className="text-xs text-muted">
            Name or email
          </Label>
          <Input
            id="patient-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients"
            className="h-9 text-sm"
          />
        </div>
      </FilterBar>
      <DataTable
        caption="Patients"
        columns={columns}
        rows={list.data?.data}
        rowKey={(p) => p.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={
          values.search
            ? { title: "No patients match", description: "Check the spelling, or search by email." }
            : { title: "No patients yet", description: canRegister ? "Register the first patient to get started." : undefined }
        }
      />
    </>
  );
}

export default function PatientsPage() {
  return (
    <RoleGate route={ROUTES.patients}>
      <Suspense fallback={<FullPageLoader />}>
        <PatientList />
      </Suspense>
    </RoleGate>
  );
}
