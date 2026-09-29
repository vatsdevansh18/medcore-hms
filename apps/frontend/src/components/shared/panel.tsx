"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A dashboard card with a title, an optional "view all" link, and a body
 * (docs/04-UI-UX.md §2.5 ListPanel/ChartCard). */
export function Panel({
  title,
  href,
  linkLabel = "View all",
  actions,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  // A named region, so assistive tech can jump between panels (and tests
  // can scope to one) by its title.
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId} className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader>
        <CardTitle id={titleId} className="text-base">
          {title}
        </CardTitle>
        <div className="flex items-center gap-3">
          {actions}
          {href && (
            <Link href={href} className="text-sm text-primary hover:underline">
              {linkLabel}
            </Link>
          )}
        </div>
      </CardHeader>
      <CardBody className={cn("flex-1", bodyClassName)}>{children}</CardBody>
    </Card>
  );
}

/** Staggered fade-in for dashboard cards on first render only
 * (docs/04-UI-UX.md §7 "Hierarchy"): the wrapper mounts once, so refetches
 * don't replay it. A CSS keyframe (reveal-in, globals.css) with a per-card
 * delay; reduced-motion users get no animation at all. */
export function Reveal({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn("[animation:reveal-in_200ms_ease-out_both]", className)}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      {children}
    </div>
  );
}

/** A compact list row: primary text, secondary line, trailing slot. With
 * `href`, the primary text opens the row's workflow screen (Phase 13B). */
export function PanelRow({
  primary,
  secondary,
  trailing,
  href,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {href ? (
            <Link href={href} className="text-primary hover:underline">
              {primary}
            </Link>
          ) : (
            primary
          )}
        </div>
        {secondary && <p className="truncate text-xs text-muted">{secondary}</p>}
      </div>
      {trailing}
    </li>
  );
}
