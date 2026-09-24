"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Building2, UserPlus } from "lucide-react";
import type { HospitalView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { useCreateHospital, useCreateHospitalAdmin, useHospitals, useVerifyHospital } from "@/services/workflows";
import { formatDate } from "@/lib/format";
import { hospitalAdminSchema, hospitalSchema, type HospitalAdminValues, type HospitalValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

function NewHospital({ onDone }: { onDone: () => void }) {
  const create = useCreateHospital();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<HospitalValues>({
    resolver: zodResolver(hospitalSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { name: "", slug: "", contactEmail: "", contactPhone: "", timezone: "Asia/Kolkata", line1: "", city: "", state: "", postalCode: "", country: "India" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      const hospital = await create.mutateAsync({
        name: v.name,
        slug: v.slug,
        contactEmail: v.contactEmail,
        timezone: v.timezone,
        ...(v.contactPhone ? { contactPhone: v.contactPhone } : {}),
        ...(v.line1 ? { address: { line1: v.line1, city: v.city, state: v.state, postalCode: v.postalCode, country: v.country } } : {}),
      });
      toast.success(`${hospital.name} created. Verify it to open registrations, and add its first admin.`);
      onDone();
    } catch {
      // Shown below.
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Name" error={errors.name?.message}>
          <Input {...register("name")} />
        </FormField>
        <FormField label="Short name (slug)" error={errors.slug?.message} hint="Lowercase, e.g. city-hospital. Can't change later.">
          <Input {...register("slug")} />
        </FormField>
        <FormField label="Contact email" error={errors.contactEmail?.message}>
          <Input type="email" {...register("contactEmail")} />
        </FormField>
        <FormField label="Contact phone (optional)" error={errors.contactPhone?.message}>
          <Input type="tel" {...register("contactPhone")} />
        </FormField>
        <FormField label="Time zone" error={errors.timezone?.message} hint="IANA name, e.g. Asia/Kolkata. Every schedule uses it.">
          <Input {...register("timezone")} />
        </FormField>
      </div>
      <fieldset className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">Address (optional; the city shows on the patient sign-up list)</legend>
        <FormField label="Street" error={errors.line1?.message}>
          <Input {...register("line1")} />
        </FormField>
        <FormField label="City" error={errors.city?.message}>
          <Input {...register("city")} />
        </FormField>
        <FormField label="State" error={errors.state?.message}>
          <Input {...register("state")} />
        </FormField>
        <FormField label="Postal code" error={errors.postalCode?.message}>
          <Input {...register("postalCode")} />
        </FormField>
        <FormField label="Country" error={errors.country?.message}>
          <Input {...register("country")} />
        </FormField>
      </fieldset>
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create hospital
        </Button>
      </div>
    </form>
  );
}

function NewAdmin({ hospital, onDone }: { hospital: HospitalView; onDone: () => void }) {
  const create = useCreateHospitalAdmin(hospital.id);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<HospitalAdminValues>({
    resolver: zodResolver(hospitalAdminSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", employeeCode: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        employeeCode: v.employeeCode,
        ...(v.phone ? { phone: v.phone } : {}),
      });
      toast.success(`${v.firstName} ${v.lastName} is an admin of ${hospital.name}. They get an email to set their password.`);
      onDone();
    } catch {
      // Shown below.
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="First name" error={errors.firstName?.message}>
          <Input autoComplete="off" {...register("firstName")} />
        </FormField>
        <FormField label="Last name" error={errors.lastName?.message}>
          <Input autoComplete="off" {...register("lastName")} />
        </FormField>
        <FormField label="Work email" error={errors.email?.message}>
          <Input type="email" autoComplete="off" {...register("email")} />
        </FormField>
        <FormField label="Employee code" error={errors.employeeCode?.message}>
          <Input autoComplete="off" {...register("employeeCode")} />
        </FormField>
        <FormField label="Mobile (optional)" error={errors.phone?.message}>
          <Input type="tel" autoComplete="off" {...register("phone")} />
        </FormField>
      </div>
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Add admin
        </Button>
      </div>
    </form>
  );
}

/** Hospital onboarding (FR-HOSP-001), Super Admin only: create a tenant,
 * give it a Hospital Admin, verify it. A hospital stays
 * PENDING_VERIFICATION, and off the patient sign-up list, until verified. */
function Hospitals() {
  const [page, setPage] = useState(1);
  const list = useHospitals(page);
  const verify = useVerifyHospital();
  const [creating, setCreating] = useState(false);
  const [adminFor, setAdminFor] = useState<HospitalView | null>(null);
  const [verifying, setVerifying] = useState<HospitalView | null>(null);

  const columns: Column<HospitalView>[] = [
    {
      key: "name",
      header: "Hospital",
      cell: (h) => (
        <span>
          <span className="font-medium">{h.name}</span> <span className="text-xs text-muted">({h.slug})</span>
        </span>
      ),
    },
    { key: "contact", header: "Contact", cell: (h) => h.contactEmail ?? "—", hideOnMobile: true },
    { key: "tz", header: "Time zone", cell: (h) => h.timezone, hideOnMobile: true },
    { key: "created", header: "Created", cell: (h) => formatDate(h.createdAt, "UTC"), hideOnMobile: true },
    { key: "status", header: "Status", cell: (h) => <StatusBadge status={h.status} /> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (h) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAdminFor(h)}>
            <UserPlus aria-hidden="true" /> Add admin
          </Button>
          {h.status === "PENDING_VERIFICATION" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                verify.reset();
                setVerifying(h);
              }}
            >
              <BadgeCheck aria-hidden="true" /> Verify
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Hospitals"
        description="Every tenant on the platform."
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Building2 aria-hidden="true" /> New hospital
            </Button>
          )
        }
      />
      {creating && (
        <Panel title="New hospital" className="mb-4">
          <NewHospital onDone={() => setCreating(false)} />
        </Panel>
      )}
      {adminFor && (
        <Panel title={`New admin for ${adminFor.name}`} className="mb-4">
          <NewAdmin key={adminFor.id} hospital={adminFor} onDone={() => setAdminFor(null)} />
        </Panel>
      )}
      <DataTable
        caption="Hospitals"
        columns={columns}
        rows={list.data?.data}
        rowKey={(h) => h.id}
        meta={list.data?.meta}
        onPage={setPage}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No hospitals yet", description: "Create the first one." }}
      />
      <ConfirmDialog
        open={verifying !== null}
        onOpenChange={(open) => !open && setVerifying(null)}
        title={`Verify ${verifying?.name ?? "this hospital"}?`}
        consequence="The hospital becomes active: its staff can work in it and patients can register with it."
        confirmLabel="Verify hospital"
        pending={verify.isPending}
        error={verify.error}
        onConfirm={() =>
          verifying &&
          void verify
            .mutateAsync(verifying.id)
            .then(() => {
              toast.success(`${verifying.name} is active.`);
              setVerifying(null);
            })
            .catch(() => undefined)
        }
      />
    </>
  );
}

export default function HospitalsPage() {
  return (
    <RoleGate route={ROUTES.hospitals}>
      <Hospitals />
    </RoleGate>
  );
}
