import type { ReactNode } from "react";

/**
 * The route transition (docs/04-UI-UX.md §7 "Transitions"): a 150 ms fade
 * that marks a navigation without moving anything. Used by the route
 * groups' `template.tsx`, which remounts on every navigation. Plain CSS
 * (`page-in` in globals.css), so it adds no JavaScript, and the global
 * reduced-motion rule turns it off.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="[animation:page-in_150ms_ease-out]">{children}</div>;
}
