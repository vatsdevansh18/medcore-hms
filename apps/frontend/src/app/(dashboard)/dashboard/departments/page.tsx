"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { DepartmentView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { useDeleteDepartment, useDepartments, useSaveDepartment } from "@/services/workflows";
import { useAuthStore } from "@/store/auth-store";
import { departmentSchema, type DepartmentValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

function DepartmentForm({ hospitalId, initial, onDone }: { hospitalId: string; initial?: DepartmentView; onDone: () => void }) {
  const save = useSaveDepartment(hospitalId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DepartmentValues>({
    resolver: zodResolver(departmentSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { name: initial?.name ?? "", description: initial?.description ?? "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ id: initial?.id, body: { name: v.name, ...(v.description ? { description: v.description } : {}) } });
      toast.success(initial ? "Department updated." : `${v.name} created.`);
      onDone();
    } catch {
      // Shown below.
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
      <div className="grid gap-x-4 sm:grid-cols-[16rem_1fr]">
        <FormField label="Name" error={errors.name?.message}>
          <Input {...register("name")} />
        </FormField>
        <FormField label="Description (optional)" error={errors.description?.message}>
          <Input {...register("description")} />
        </FormField>
      </div>
      <FormError error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {initial ? "Save" : "Create department"}
        </Button>
      </div>
    </form>
  );
}

/** Departments (FR-HOSP-002), Hospital Admin only. A department still in
 * use by doctors, staff, or rooms can't be deleted; the API explains why. */
function Departments() {
  const hospitalId = useAuthStore((s) => s.user?.hospitalId) ?? "";
  const list = useDepartments(hospitalId);
  const remove = useDeleteDepartment(hospitalId);
  const [editing, setEditing] = useState<DepartmentView | "new" | null>(null);
  const [deleting, setDeleting] = useState<DepartmentView | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
    } catch {
      // Shown in the dialog.
    }
  }

  const columns: Column<DepartmentView>[] = [
    { key: "name", header: "Name", cell: (d) => <span className="font-medium">{d.name}</span> },
    { key: "desc", header: "Description", cell: (d) => d.description ?? "—", hideOnMobile: true },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}>
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              remove.reset();
              setDeleting(d);
            }}
            aria-label={`Delete ${d.name}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Departments"
        description="Every doctor belongs to a department; staff can too."
        actions={
          editing === null && (
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" /> New department
            </Button>
          )
        }
      />
      {editing !== null && (
        <Panel title={editing === "new" ? "New department" : `Edit ${editing.name}`} className="mb-4">
          <DepartmentForm
            key={editing === "new" ? "new" : editing.id}
            hospitalId={hospitalId}
            initial={editing === "new" ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        </Panel>
      )}
      <DataTable
        caption="Departments"
        columns={columns}
        rows={list.data?.data}
        rowKey={(d) => d.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No departments yet", description: "Create one before adding doctors." }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "department"}?`}
        consequence="The department is removed. This is refused while any doctor, staff member, or room still belongs to it."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

export default function DepartmentsPage() {
  return (
    <RoleGate route={ROUTES.departments}>
      <Departments />
    </RoleGate>
  );
}
