import { Loader2 } from "lucide-react";

export function FullPageLoader({ label = "Loading MedCore" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-16" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
