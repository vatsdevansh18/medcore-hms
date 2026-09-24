"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
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
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
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
 * (docs/04-UI-UX.md §7 "Hierarchy"); refetches don't replay it, and
 * reduced-motion users get no animation at all. */
export function Reveal({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.04 }}
    >
      {children}
    </motion.div>
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
        <p className="truncate text-sm font-medium">
          {href ? (
            <Link href={href} className="text-primary hover:underline">
              {primary}
            </Link>
          ) : (
            primary
          )}
        </p>
        {secondary && <p className="truncate text-xs text-muted">{secondary}</p>}
      </div>
      {trailing}
    </li>
  );
}
