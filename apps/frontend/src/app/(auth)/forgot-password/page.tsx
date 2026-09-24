"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/validation";
import { authApi } from "@/services/auth";
import { ROUTES } from "@/constants";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onBlur",
    // After a submit attempt, errors clear as the field is fixed. Re-validating
    // on blur shifted the layout under the pointer and swallowed the click.
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err);
    }
  });

  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {sent ? (
        <p role="status" className="mt-4 rounded-md bg-success-surface px-3 py-3 text-sm text-success">
          If an account exists for that email, we&apos;ve sent a link to reset the password. It expires in 60 minutes.
        </p>
      ) : (
        <>
          <p className="mb-6 mt-1 text-sm text-muted">We&apos;ll email you a link to choose a new password.</p>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <FormField label="Email" error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register("email")} />
            </FormField>
            <FormError error={error} />
            <Button type="submit" loading={isSubmitting} className="w-full">
              Send reset link
            </Button>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href={ROUTES.login} className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
