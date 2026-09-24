import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A KPI tile (docs/04-UI-UX.md §2.5 StatCard). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading = false,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {Icon && <Icon className="size-4 text-subtle" aria-hidden="true" />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </div>
  );
}
