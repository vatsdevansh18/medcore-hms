"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { homeFor, useAuth } from "@/hooks/use-auth";
import { LoginForm } from "@/components/modules/auth/login-form";
import { FullPageLoader } from "@/components/modules/full-page-loader";

/** Only same-app paths are honoured as a post-login destination. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

function LoginPageInner() {
  const { status, user, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (status === "authenticated" && user) router.replace(next ?? homeFor(user.role));
  }, [status, user, router, next]);

  if (status === "unknown") return <FullPageLoader />;

  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Use the email and password for your MedCore account.</p>
      {params.get("reset") === "1" && (
        <p role="status" className="mb-4 rounded-md bg-success-surface px-3 py-2 text-sm text-success">
          Your password was changed. Sign in with the new one.
        </p>
      )}
      {params.get("verified") === "1" && (
        <p role="status" className="mb-4 rounded-md bg-success-surface px-3 py-2 text-sm text-success">
          Your email is verified. You can sign in now.
        </p>
      )}
      <LoginForm onLogin={login} />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <LoginPageInner />
    </Suspense>
  );
}
