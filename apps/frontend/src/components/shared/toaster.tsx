"use client";

import { create } from "zustand";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
  /** Set while the exit fade plays, before the toast is removed. */
  leaving?: boolean;
}

const EXIT_MS = 150;

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Transient confirmation for an action the user just took (§2.9); never
 * for background events. */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, tone = "success") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }].slice(-3) }));
    setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), EXIT_MS);
  },
}));

export const toast = {
  success: (message: string) => useToastStore.getState().show(message, "success"),
  error: (message: string) => useToastStore.getState().show(message, "error"),
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
    >
      {/* Enter and exit are CSS keyframes (toast-in/toast-out, globals.css);
          reduced motion turns both off with every other animation. */}
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md",
            t.leaving ? "[animation:toast-out_150ms_ease-in_forwards]" : "[animation:toast-in_180ms_ease-out]",
            t.tone === "success" ? "border-success/30 bg-surface" : "border-danger/30 bg-surface",
          )}
        >
          {t.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 text-success" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 text-danger" aria-hidden="true" />
          )}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-subtle hover:text-foreground">
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Dismiss</span>
          </button>
        </div>
      ))}
    </div>
  );
}
