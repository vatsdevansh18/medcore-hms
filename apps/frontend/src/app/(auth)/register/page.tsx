"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/services/auth";
import { RegisterForm } from "@/components/modules/auth/register-form";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { ROUTES } from "@/constants";

export default function RegisterPage() {
  const router = useRouter();
  const hospitals = useQuery({ queryKey: ["hospital-directory"], queryFn: authApi.hospitalDirectory });

  return (
    <>
      <h1 className="text-xl font-semibold">Create a patient account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        See your appointments, records, prescriptions, lab reports and bills in one place.
      </p>
      {hospitals.isPending ? (
        <ListSkeleton rows={2} />
      ) : hospitals.isError ? (
        <ErrorState error={hospitals.error} onRetry={() => void hospitals.refetch()} />
      ) : hospitals.data.length === 0 ? (
        <EmptyState
          title="No hospitals are taking registrations"
          description="Please ask your hospital's front desk to register you."
        />
      ) : (
        <RegisterForm
          hospitals={hospitals.data}
          onRegister={async (input) => {
            await authApi.register(input);
            router.push(`${ROUTES.verifyEmail}?email=${encodeURIComponent(input.email)}&sent=1`);
          }}
        />
      )}
      <p className="mt-6 text-center text-sm text-muted">
        Already registered?{" "}
        <Link href={ROUTES.login} className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
