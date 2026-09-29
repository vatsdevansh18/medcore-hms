import type { ReactNode } from "react";
import { PageTransition } from "@/components/shared/page-transition";

/** Remounts on each navigation, so every page gets the §7 transition. */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
