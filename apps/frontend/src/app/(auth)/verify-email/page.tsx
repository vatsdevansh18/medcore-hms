"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FormError } from "@/components/shared/states";
import { FullPageLoader } from "@/components/modules/full-page-loader";
import { verifyEmailSchema, type VerifyEmailValues } from "@/lib/validation";
import { authApi } from "@/services/auth";
import { ROUTES } from "@/constants";

function VerifyEmailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<VerifyEmailValues>({
    resolver: zodResolver(verifyEmailSchema),
    mode: "onBlur",
    // After a submit attempt, errors clear as the field is fixed. Re-validating
    // on blur shifted the layout under the pointer and swallowed the click.
    reValidateMode: "onChange",
    defaultValues: { email: params.get("email") ?? "", code: "" },
  });

  const onSubmit = handleSubmit(async ({ email, code }) => {
    setError(null);
    try {
      await authApi.verifyEmail(email, code);
      router.push(`${ROUTES.login}?verified=1`);
    } catch (err) {
      setError(err);
    }
  });

  async function resend() {
    const email = getValues("email");
    if (!email) return;
    setResending(true);
    try {
      // Always succeeds (no account enumeration), so there's nothing to report.
      await authApi.resendEmailOtp(email);
      setResent(true);
    } catch (err) {
      setError(err);
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Verify your email</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        {params.get("sent") === "1"
          ? "We've emailed you a 6-digit code. It expires in 10 minutes."
          : "Enter the 6-digit code we emailed you."}
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register("email")} />
        </FormField>
        <FormField label="Verification code" error={errors.code?.message}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...register("code")} />
        </FormField>
        <FormError error={error} />
        {resent && (
          <p role="status" className="text-sm text-success">
            If that account still needs verifying, a new code is on its way.
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="w-full">
          Verify email
        </Button>
        <Button type="button" variant="ghost" onClick={resend} loading={resending}>
          Send a new code
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href={ROUTES.login} className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
