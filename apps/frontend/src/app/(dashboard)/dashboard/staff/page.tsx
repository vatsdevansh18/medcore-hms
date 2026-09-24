"use client";

import { Suspense, useEffect, useState } from "react";
import { Stethoscope, UserPlus } from "lucide-react";
import type { StaffMemberView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { StatusBadge } from "@/components/shared/status-badge";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { RoleGate } from "@/components/modules/role-gate";
import { DoctorForm, ROLE_LABEL, StaffForm } from "@/components/modules/admin/staff-forms";
import { useDepartments, useStaffDirectory } from "@/services/workflows";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuthStore } from "@/store/auth-store";
import { personName } from "@/lib/format";
import { ROUTES } from "@/constants";

const columns: Column<StaffMemberView>[] = [
  { key: "name", header: "Name", cell: (u) => (u.doctorProfile ? `Dr. ${personName(u)}` : personName(u)) },
  { key: "role", header: "Role", cell: (u) => (u.doctorProfile ? `Doctor · ${u.doctorProfile.specialization}` : ROLE_LABEL[u.role] ?? u.role) },
  {
    key: "dept",
    header: "Department",
    cell: (u) => u.doctorProfile?.department.name ?? u.staffProfile?.department?.name ?? "—",
    hideOnMobile: true,
  },
  { key: "code", header: "Employee code", cell: (u) => u.staffProfile?.employeeCode ?? "—", hideOnMobile: true },
  { key: "email", header: "Email", cell: (u) => u.email, hideOnMobile: true },
  { key: "status", header: "Account", cell: (u) => <StatusBadge status={u.status} /> },
];

/** The staff directory and provisioning (FR-HOSP-002/003), Hospital Admin
 * only. New accounts are verified and set their own password by email. */
function StaffDirectory() {
  const hospitalId = useAuthStore((s) => s.user?.hospitalId);
  const departments = useDepartments(hospitalId);
  const { values, page, set, setPage } = useUrlFilters(["role", "search"] as const);
  const [search, setSearch] = useState(values.search);
  const debounced = useDebounce(search.trim(), 300);
  useEffect(() => {
    if (debounced !== values.search) set({ search: debounced });
  }, [debounced, values.search, set]);
  const list = useStaffDirectory({ role: values.role, search: values.search }, page);
  const [adding, setAdding] = useState<"staff" | "doctor" | null>(null);
  const deptList = departments.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone with an account at this hospital."
        actions={
          !adding && (
            <>
              <Button variant="secondary" onClick={() => setAdding("doctor")} disabled={!departments.data}>
                <Stethoscope aria-hidden="true" /> Add doctor
              </Button>
              <Button onClick={() => setAdding("staff")} disabled={!departments.data}>
                <UserPlus aria-hidden="true" /> Add staff
              </Button>
            </>
          )
        }
      />
      {adding === "staff" && (
        <Panel title="New staff member" className="mb-4">
          <StaffForm departments={deptList} onDone={() => setAdding(null)} />
        </Panel>
      )}
      {adding === "doctor" && (
        <Panel title="New doctor" className="mb-4">
          {deptList.length === 0 ? (
            <p className="text-sm text-muted">Create a department first: every doctor belongs to one.</p>
          ) : (
            <DoctorForm departments={deptList} onDone={() => setAdding(null)} />
          )}
        </Panel>
      )}
      <FilterBar>
        <FilterSelect
          id="role"
          label="Role"
          value={values.role}
          onChange={(v) => set({ role: v })}
          options={[{ value: "", label: "All roles" }, ...Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))]}
        />
        <div className="flex w-full max-w-xs flex-col gap-1">
          <Label htmlFor="staff-search" className="text-xs text-muted">
            Name or email
          </Label>
          <Input id="staff-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-sm" />
        </div>
      </FilterBar>
      <DataTable
        caption="Staff"
        columns={columns}
        rows={list.data?.data}
        rowKey={(u) => u.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No staff match", description: "Try another role or name." }}
        density="compact"
      />
    </>
  );
}

export default function StaffPage() {
  return (
    <RoleGate route={ROUTES.staffDirectory}>
      <Suspense fallback={<FullPageLoader />}>
        <StaffDirectory />
      </Suspense>
    </RoleGate>
  );
}
