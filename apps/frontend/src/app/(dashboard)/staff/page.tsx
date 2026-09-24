"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/constants";
import { FullPageLoader } from "@/components/modules/full-page-loader";

/** Phase 12's staff landing page, kept so old links still work. */
export default function StaffRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(ROUTES.dashboard);
  }, [router]);
  return <FullPageLoader />;
}
