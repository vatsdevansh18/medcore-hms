import type { ReactNode } from "react";
import type { PaginationMeta } from "@medcore/types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "./states";
import { Pagination } from "./pagination";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Hidden below the sm breakpoint (phones get the essentials). */
  hideOnMobile?: boolean;
}

/**
 * The shared table (docs/04-UI-UX.md §2.6): sticky header, server-side
 * pagination, and explicit loading/empty/error states. Density is
 * "comfortable" by default and "compact" for high-volume queues.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  meta,
  onPage,
  loading,
  error,
  onRetry,
  empty,
  density = "comfortable",
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  meta?: PaginationMeta;
  onPage?: (page: number) => void;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: { title: string; description?: string };
  density?: "comfortable" | "compact";
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!loading && rows && rows.length === 0) return <EmptyState title={empty.title} description={empty.description} />;
  const pad = density === "compact" ? "px-3 py-1.5" : "px-4 py-2.5";
  const hide = (c: Column<T>) => (c.hideOnMobile ? "hidden sm:table-cell" : "");
  return (
    <div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn(pad, "font-medium", c.align === "right" && "text-right", hide(c))}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>
            {loading && !rows
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-t border-border">
                    {columns.map((c) => (
                      <td key={c.key} className={cn(pad, hide(c))}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows?.map((row) => (
                  <tr key={rowKey(row)} className="border-t border-border">
                    {columns.map((c) => (
                      <td key={c.key} className={cn(pad, "align-top", c.align === "right" && "text-right tabular-nums", hide(c))}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {meta && onPage && <Pagination meta={meta} onPage={onPage} />}
    </div>
  );
}
