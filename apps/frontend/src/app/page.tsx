"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeFor, useAuth } from "@/hooks/use-auth";
import { ROUTES } from "@/constants";
import { FullPageLoader } from "@/components/modules/full-page-loader";

/** Sends a visitor to their home screen, or to sign-in. */
export default function Home() {
  const { status, user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "authenticated" && user) router.replace(homeFor(user.role));
    else if (status === "anonymous") router.replace(ROUTES.login);
  }, [status, user, router]);
  return <FullPageLoader />;
}
