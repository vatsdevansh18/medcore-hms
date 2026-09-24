"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { EmptyState, FormError } from "@/components/shared/states";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/validation";
import { authApi } from "@/services/auth";
import { ROUTES } from "@/constants";

function ResetPasswordInner() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onBlur",
    // After a submit attempt, errors clear as the field is fixed. Re-validating
    // on blur shifted the layout under the pointer and swallowed the click.
    reValidateMode: "onChange",
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  if (!token) {
    return (
      <EmptyState
        title="This reset link is incomplete"
        description="Open the link from the email again, or request a new one."
        action={
          <Link href={ROUTES.forgotPassword} className="text-primary hover:underline">
            Request a new link
          </Link>
        }
      />
    );
  }

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setError(null);
    try {
      await authApi.resetPassword(token, newPassword);
      router.push(`${ROUTES.login}?reset=1`);
    } catch (err) {
      setError(err);
    }
  });

  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">This signs you out of every other device.</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="New password" error={errors.newPassword?.message} hint="At least 8 characters, with a letter and a number.">
          <Input type="password" autoComplete="new-password" {...register("newPassword")} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirmPassword?.message}>
          <Input type="password" autoComplete="new-password" {...register("confirmPassword")} />
        </FormField>
        <FormError error={error} />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Save new password
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
