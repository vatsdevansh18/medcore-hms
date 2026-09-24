"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import type { GlobalSearchView, SearchScope } from "@medcore/types";
import { useDebounce } from "@/hooks/use-debounce";
import { useGlobalSearch } from "@/services/staff";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants";

const SCOPE_LABEL: Record<SearchScope, string> = { patients: "Patients", doctors: "Doctors", medicines: "Medicines" };

export interface SearchOption {
  id: string;
  scope: SearchScope;
  primary: string;
  secondary: string;
}

/** Flattens the grouped response into one keyboard-navigable list. */
export function toOptions(view: GlobalSearchView | undefined): SearchOption[] {
  if (!view) return [];
  return [
    ...(view.patients?.hits ?? []).map((h) => ({
      id: h.id,
      scope: "patients" as const,
      primary: h.name,
      secondary: [h.phone, h.email].filter(Boolean).join(" · "),
    })),
    ...(view.doctors?.hits ?? []).map((h) => ({
      id: h.id,
      scope: "doctors" as const,
      primary: h.name,
      secondary: `${h.specialization} · ${h.department}`,
    })),
    ...(view.medicines?.hits ?? []).map((h) => ({
      id: h.id,
      scope: "medicines" as const,
      primary: h.name,
      secondary: [h.genericName, h.form.toLowerCase()].filter(Boolean).join(" · "),
    })),
  ];
}

export function searchHref(q: string, scope?: SearchScope): string {
  const params = new URLSearchParams({ q });
  if (scope) params.set("scope", scope);
  return `${ROUTES.staffSearch}?${params.toString()}`;
}

/**
 * FR-SEARCH-001's search box: debounced (one request per pause, not per
 * keystroke), scoped server-side to the caller's hospital and role, and
 * operable by keyboard (an ARIA combobox: arrows move, Enter opens, Escape
 * closes). A hit opens the full results page for its scope.
 */
export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounce(text.trim(), 300);
  const search = useGlobalSearch(q);
  const options = useMemo(() => toOptions(search.data), [search.data]);
  const showPanel = open && q.length >= 2;

  function go(href: string) {
    setOpen(false);
    setActive(-1);
    router.push(href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      const trimmed = text.trim();
      if (trimmed.length < 2) return;
      e.preventDefault();
      const option = options[active];
      go(option ? searchHref(trimmed, option.scope) : searchHref(trimmed));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  let lastScope: SearchScope | null = null;
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search patients, doctors, and medicines"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && options[active] ? `${listId}-${active}` : undefined}
        placeholder="Search patients, doctors, medicines…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-md border border-border-strong bg-surface pl-9 pr-8 text-sm placeholder:text-subtle"
      />
      {search.isFetching && q.length >= 2 && (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" aria-hidden="true" />
      )}
      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          <ul id={listId} role="listbox" aria-label="Search results">
            {options.map((option, i) => {
              const header = option.scope !== lastScope ? SCOPE_LABEL[option.scope] : null;
              lastScope = option.scope;
              return (
                <li
                  key={`${option.scope}-${option.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(searchHref(text.trim(), option.scope));
                  }}
                  className="cursor-pointer"
                >
                  {header && (
                    <span className="block px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-subtle">{header}</span>
                  )}
                  <span className={cn("block px-3 py-1.5", i === active ? "bg-primary-surface" : "hover:bg-surface-muted")}>
                    <span className="block text-sm font-medium">{option.primary}</span>
                    {option.secondary && <span className="block text-xs text-muted">{option.secondary}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border px-3 py-2 text-xs text-muted" aria-live="polite">
            {search.isError
              ? errorMessage(search.error)
              : search.isPending
                ? "Searching…"
                : options.length === 0
                  ? `No matches for “${q}”.`
                  : "Press Enter to see all results."}
          </div>
        </div>
      )}
    </div>
  );
}
