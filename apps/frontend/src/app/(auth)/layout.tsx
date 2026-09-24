import type { ReactNode } from "react";
import { Activity } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-primary">
        <Activity className="size-6" aria-hidden="true" />
        <span className="text-xl font-semibold">MedCore HMS</span>
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8">{children}</div>
    </main>
  );
}
