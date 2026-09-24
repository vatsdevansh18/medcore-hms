"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { DepartmentView } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { useCreateDoctor, useCreateStaff } from "@/services/workflows";
import { doctorSchema, staffSchema, type DoctorValues, type StaffValues } from "@/lib/staff-validation";

export const ROLE_LABEL: Record<string, string> = {
  HOSPITAL_ADMIN: "Hospital admin",
  DOCTOR: "Doctor",
  NURSE: "Nurse",
  RECEPTIONIST: "Receptionist",
  LAB_TECHNICIAN: "Lab technician",
  PHARMACIST: "Pharmacist",
  ACCOUNTANT: "Accountant",
};

const INVITE_NOTE = "They get an email link to set their own password.";

function DepartmentOptions({ departments, optional }: { departments: DepartmentView[]; optional?: boolean }) {
  return (
    <>
      <option value="">{optional ? "None" : "Choose a department…"}</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </>
  );
}

/** Non-doctor staff (FR-HOSP-002). */
export function StaffForm({ departments, onDone }: { departments: DepartmentView[]; onDone: () => void }) {
  const create = useCreateStaff();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StaffValues>({
    resolver: zodResolver(staffSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", role: "NURSE", employeeCode: "", departmentId: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        role: v.role,
        employeeCode: v.employeeCode,
        ...(v.phone ? { phone: v.phone } : {}),
        ...(v.departmentId ? { departmentId: v.departmentId } : {}),
      });
      toast.success(`${v.firstName} ${v.lastName} added. ${INVITE_NOTE}`);
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
        <FormField label="Role" error={errors.role?.message}>
          <Select {...register("role")}>
            {(["NURSE", "RECEPTIONIST", "LAB_TECHNICIAN", "PHARMACIST", "ACCOUNTANT", "HOSPITAL_ADMIN"] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Employee code" error={errors.employeeCode?.message} hint="Unique within this hospital.">
          <Input autoComplete="off" {...register("employeeCode")} />
        </FormField>
        <FormField label="Department (optional)" error={errors.departmentId?.message}>
          <Select {...register("departmentId")}>
            <DepartmentOptions departments={departments} optional />
          </Select>
        </FormField>
        <FormField label="Mobile (optional)" error={errors.phone?.message} hint="International format.">
          <Input type="tel" autoComplete="off" {...register("phone")} />
        </FormField>
      </div>
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Add staff member
        </Button>
      </div>
    </form>
  );
}

/** A doctor account with its clinical profile (FR-HOSP-003). */
export function DoctorForm({ departments, onDone }: { departments: DepartmentView[]; onDone: () => void }) {
  const create = useCreateDoctor();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DoctorValues>({
    resolver: zodResolver(doctorSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      departmentId: "",
      specialization: "",
      licenseNumber: "",
      qualification: "",
      yearsOfExperience: "",
      consultationFee: "",
    },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        departmentId: v.departmentId,
        specialization: v.specialization,
        licenseNumber: v.licenseNumber,
        consultationFee: Number(v.consultationFee),
        ...(v.phone ? { phone: v.phone } : {}),
        ...(v.qualification ? { qualification: v.qualification } : {}),
        ...(v.yearsOfExperience !== "" ? { yearsOfExperience: Number(v.yearsOfExperience) } : {}),
      });
      toast.success(`Dr. ${v.firstName} ${v.lastName} added. ${INVITE_NOTE} They set their own clinic hours.`);
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
        <FormField label="Department" error={errors.departmentId?.message}>
          <Select {...register("departmentId")}>
            <DepartmentOptions departments={departments} />
          </Select>
        </FormField>
        <FormField label="Specialization" error={errors.specialization?.message}>
          <Input placeholder="e.g. Cardiology" {...register("specialization")} />
        </FormField>
        <FormField label="Licence number" error={errors.licenseNumber?.message}>
          <Input autoComplete="off" {...register("licenseNumber")} />
        </FormField>
        <FormField label="Consultation fee" error={errors.consultationFee?.message}>
          <Input inputMode="decimal" {...register("consultationFee")} />
        </FormField>
        <FormField label="Qualification (optional)" error={errors.qualification?.message}>
          <Input placeholder="e.g. MBBS, MD" {...register("qualification")} />
        </FormField>
        <FormField label="Years of experience (optional)" error={errors.yearsOfExperience?.message}>
          <Input inputMode="numeric" {...register("yearsOfExperience")} />
        </FormField>
        <FormField label="Mobile (optional)" error={errors.phone?.message} hint="International format.">
          <Input type="tel" autoComplete="off" {...register("phone")} />
        </FormField>
      </div>
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Add doctor
        </Button>
      </div>
    </form>
  );
}
