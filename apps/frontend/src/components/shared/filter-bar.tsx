import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/input";

/** The filter row above a table (§2.6). */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div role="group" aria-label="Filters" className="mb-3 flex flex-wrap items-end gap-3">
      {children}
    </div>
  );
}

export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted">
        {label}
      </Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-40 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
