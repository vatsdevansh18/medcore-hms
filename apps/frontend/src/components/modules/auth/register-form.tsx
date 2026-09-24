"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { HospitalDirectoryEntry } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { registerSchema, type RegisterValues } from "@/lib/validation";
import type { RegisterInput } from "@/services/auth";

export function RegisterForm({
  hospitals,
  onRegister,
}: {
  hospitals: HospitalDirectoryEntry[];
  onRegister: (input: RegisterInput) => Promise<void>;
}) {
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
    // After a submit attempt, errors clear as the field is fixed. Re-validating
    // on blur shifted the layout under the pointer and swallowed the click.
    reValidateMode: "onChange",
    defaultValues: {
      hospitalId: hospitals.length === 1 ? hospitals[0].id : "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await onRegister({
        hospitalId: values.hospitalId,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        phone: values.phone ? values.phone : undefined,
      });
    } catch (err) {
      setError(err);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormField label="Hospital" error={errors.hospitalId?.message} hint="Your records stay with this hospital.">
        <Select {...register("hospitalId")}>
          <option value="">Choose a hospital…</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.city ? `${h.name} — ${h.city}` : h.name}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="First name" error={errors.firstName?.message}>
          <Input autoComplete="given-name" {...register("firstName")} />
        </FormField>
        <FormField label="Last name" error={errors.lastName?.message}>
          <Input autoComplete="family-name" {...register("lastName")} />
        </FormField>
      </div>
      <FormField label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>
      <FormField
        label="Mobile number (optional)"
        error={errors.phone?.message}
        hint="International format, e.g. +919812345678. Used for SMS reminders once verified."
      >
        <Input type="tel" autoComplete="tel" {...register("phone")} />
      </FormField>
      <FormField label="Password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number.">
        <Input type="password" autoComplete="new-password" {...register("password")} />
      </FormField>
      <FormField label="Confirm password" error={errors.confirmPassword?.message}>
        <Input type="password" autoComplete="new-password" {...register("confirmPassword")} />
      </FormField>
      <FormError error={error} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Create account
      </Button>
    </form>
  );
}
