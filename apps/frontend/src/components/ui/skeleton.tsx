import { cn } from "@/lib/utils";

/** A shimmer block matching the shape of content still loading (§2.10). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-md bg-[linear-gradient(90deg,var(--surface-muted)_0%,var(--border)_50%,var(--surface-muted)_100%)] bg-[length:800px_100%] [animation:shimmer_1.4s_linear_infinite]",
        className,
      )}
    />
  );
}
