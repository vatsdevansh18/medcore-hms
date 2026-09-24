"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Gender } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { toast } from "@/components/shared/toaster";
import { RoleGate } from "@/components/modules/role-gate";
import { useRegisterPatient } from "@/services/workflows";
import { compact, patientSchema, type PatientValues } from "@/lib/staff-validation";
import { ROUTES } from "@/constants";

const GENDER_LABEL: Record<Gender, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

/**
 * Front-desk registration (FR-HOSP-004). The account is created verified,
 * and the patient gets an email link to set their own password; staff never
 * see or choose it.
 */
function RegisterPatient() {
  const router = useRouter();
  const registerPatient = useRegisterPatient();
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PatientValues>({
    resolver: zodResolver(patientSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      dob: "",
      gender: "",
      bloodGroup: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { gender, ...rest } = compact(values);
      const patient = await registerPatient.mutateAsync({
        ...(rest as Omit<PatientValues, "gender">),
        ...(gender ? { gender: gender as Gender } : {}),
      });
      toast.success(`${patient.user.firstName} ${patient.user.lastName} is registered. A password link was emailed to them.`);
      router.push(ROUTES.patient(patient.id));
    } catch (err) {
      setError(err);
    }
  });

  return (
    <>
      <PageHeader
        title="Register a patient"
        description="The patient receives an email to set their own password for the portal."
        back={{ href: ROUTES.patients, label: "Patients" }}
      />
      <Card className="max-w-3xl">
        <CardBody>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
            <fieldset className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Identity and contact</legend>
              <FormField label="First name" error={errors.firstName?.message}>
                <Input autoComplete="off" {...register("firstName")} />
              </FormField>
              <FormField label="Last name" error={errors.lastName?.message}>
                <Input autoComplete="off" {...register("lastName")} />
              </FormField>
              <FormField label="Email" error={errors.email?.message} hint="Must not already have an account.">
                <Input type="email" autoComplete="off" {...register("email")} />
              </FormField>
              <FormField label="Mobile (optional)" error={errors.phone?.message} hint="International format, e.g. +919812345678.">
                <Input type="tel" autoComplete="off" {...register("phone")} />
              </FormField>
              <FormField label="Date of birth (optional)" error={errors.dob?.message}>
                <Input type="date" {...register("dob")} />
              </FormField>
              <FormField label="Gender (optional)" error={errors.gender?.message}>
                <Select {...register("gender")}>
                  <option value="">Not given</option>
                  {Object.values(Gender).map((g) => (
                    <option key={g} value={g}>
                      {GENDER_LABEL[g]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Blood group (optional)" error={errors.bloodGroup?.message}>
                <Input placeholder="e.g. O+" {...register("bloodGroup")} />
              </FormField>
            </fieldset>
            <fieldset className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              <legend className="mb-2 mt-2 text-sm font-semibold">Emergency contact (optional)</legend>
              <FormField label="Name" error={errors.emergencyContactName?.message}>
                <Input autoComplete="off" {...register("emergencyContactName")} />
              </FormField>
              <FormField label="Phone" error={errors.emergencyContactPhone?.message}>
                <Input type="tel" autoComplete="off" {...register("emergencyContactPhone")} />
              </FormField>
            </fieldset>
            <FormError error={error} />
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => router.push(ROUTES.patients)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Register patient
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

export default function NewPatientPage() {
  return (
    <RoleGate route="/dashboard/patients/new">
      <RegisterPatient />
    </RoleGate>
  );
}
