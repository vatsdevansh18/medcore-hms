"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * List filters kept in the URL (`?status=PENDING&page=2`), so a dashboard's
 * "View all" link can open a pre-filtered list and a filtered view can be
 * shared or reloaded. Changing any filter resets to page 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ""])) as Record<K, string>;
  const page = Math.max(1, Number(params.get("page")) || 1);

  const update = useCallback(
    (changes: Partial<Record<K | "page", string | number | null>>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes) as [string, string | number | null][]) {
        if (value === null || value === "" || value === undefined) next.delete(key);
        else next.set(key, String(value));
      }
      if (!("page" in changes)) next.delete("page");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  const setPage = useCallback((p: number) => update({ page: p } as Partial<Record<K | "page", number>>), [update]);
  return { values, page, set: update, setPage };
}

/** A comma-separated URL value as a list (the API's multi-status format). */
export function listParam(value: string): string[] | undefined {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}
