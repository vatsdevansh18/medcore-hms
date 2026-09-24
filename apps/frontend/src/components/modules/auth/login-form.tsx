"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CurrentUser } from "@medcore/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { ApiRequestError } from "@/lib/api-client";
import { errorMessage } from "@/lib/errors";
import { loginSchema, type LoginValues } from "@/lib/validation";
import { ROUTES } from "@/constants";

/** Login failures come back as UNAUTHENTICATED with a message written for
 * the user ("Invalid email or password.", "Please verify your email..."). */
function loginErrorText(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "UNAUTHENTICATED") return error.message;
  return errorMessage(error);
}

export function LoginForm({ onLogin }: { onLogin: (email: string, password: string) => Promise<CurrentUser> }) {
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    // After a submit attempt, errors clear as the field is fixed. Re-validating
    // on blur shifted the layout under the pointer and swallowed the click.
    reValidateMode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await onLogin(values.email, values.password);
    } catch (err) {
      setError(err);
    }
  });

  const text = error ? loginErrorText(error) : null;
  const needsVerification = Boolean(text && /verify your email/i.test(text));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormField label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>
      <FormField label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register("password")} />
      </FormField>
      {text && (
        <div role="alert" className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">
          {text}
          {needsVerification && (
            <>
              {" "}
              <Link
                className="font-medium underline"
                href={`${ROUTES.verifyEmail}?email=${encodeURIComponent(getValues("email"))}`}
              >
                Verify now
              </Link>
            </>
          )}
        </div>
      )}
      <Button type="submit" loading={isSubmitting} className="w-full">
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <Link href={ROUTES.forgotPassword} className="text-primary hover:underline">
          Forgot password?
        </Link>
        <Link href={ROUTES.register} className="text-primary hover:underline">
          Create a patient account
        </Link>
      </div>
    </form>
  );
}
