"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/states";
import { todayKey } from "@/lib/format";
import { dayBounds } from "@/lib/zoned-time";

/** Today in the workspace's timezone, and its bounds as UTC instants. */
export function todayIn(timeZone: string): { key: string; from: string; to: string } {
  const key = todayKey(timeZone);
  return { key, ...dayBounds(key, timeZone) };
}

/** Loading / error / empty / content for one dashboard panel (§2.10). */
export function PanelBody<T>({
  query,
  isEmpty,
  empty,
  rows = 3,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data?: T; refetch: () => unknown };
  isEmpty?: (data: T) => boolean;
  empty: string;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(query.data)) return <p className="py-2 text-sm text-muted">{empty}</p>;
  return <>{children(query.data)}</>;
}

export function DashboardHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export const RANGE_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

/** A small segmented control for a trailing date range. */
export function RangePicker({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.days}
          type="button"
          role="radio"
          aria-checked={value === option.days}
          onClick={() => onChange(option.days)}
          className={
            value === option.days
              ? "rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
              : "rounded px-3 py-1 text-sm text-muted hover:text-foreground"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
