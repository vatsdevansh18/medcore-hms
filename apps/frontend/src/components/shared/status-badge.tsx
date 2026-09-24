import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  FlaskConical,
  Loader,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

interface StatusStyle {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

/**
 * Every workflow status the portal shows, named in words with an icon and
 * a colour (docs/04-UI-UX.md §1.3: "never colour alone"). Keys are unique
 * across the enums they come from, except where the meaning is the same.
 */
const STYLES: Record<string, StatusStyle> = {
  // Appointments
  PENDING: { label: "Awaiting confirmation", tone: "warning", icon: Clock },
  CONFIRMED: { label: "Confirmed", tone: "success", icon: CheckCircle2 },
  IN_PROGRESS: { label: "In progress", tone: "info", icon: Loader },
  COMPLETED: { label: "Completed", tone: "neutral", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", tone: "danger", icon: Ban },
  NO_SHOW: { label: "Missed", tone: "danger", icon: UserX },
  // Prescriptions
  ISSUED: { label: "Ready to collect", tone: "info", icon: FileText },
  PARTIALLY_DISPENSED: { label: "Partly dispensed", tone: "warning", icon: CircleDashed },
  DISPENSED: { label: "Dispensed", tone: "success", icon: CheckCircle2 },
  // Lab items
  ORDERED: { label: "Ordered", tone: "neutral", icon: FlaskConical },
  SAMPLE_COLLECTED: { label: "Sample collected", tone: "info", icon: FlaskConical },
  RESULT_UPLOADED: { label: "Under review", tone: "info", icon: Loader },
  APPROVED: { label: "Result ready", tone: "success", icon: CheckCircle2 },
  REJECTED: { label: "Being redone", tone: "warning", icon: AlertTriangle },
  // Invoices
  DRAFT: { label: "Draft", tone: "neutral", icon: FileText },
  FINALIZED: { label: "Due", tone: "warning", icon: Clock },
  PARTIALLY_PAID: { label: "Partly paid", tone: "warning", icon: CircleDashed },
  PAID: { label: "Paid", tone: "success", icon: CheckCircle2 },
  REFUNDED: { label: "Refunded", tone: "neutral", icon: CircleDashed },
  // Payments
  SUCCEEDED: { label: "Succeeded", tone: "success", icon: CheckCircle2 },
  FAILED: { label: "Failed", tone: "danger", icon: AlertTriangle },
};

/** Lab item IN_PROGRESS reads differently from an appointment's. */
const LAB_OVERRIDES: Record<string, StatusStyle> = {
  IN_PROGRESS: { label: "Testing", tone: "info", icon: Loader },
};

/** Payment PENDING is not the appointment "awaiting confirmation". */
const PAYMENT_OVERRIDES: Record<string, StatusStyle> = {
  PENDING: { label: "Processing", tone: "info", icon: Loader },
};

const TONES: Record<Tone, string> = {
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
  info: "bg-info-surface text-info",
  neutral: "bg-surface-muted text-muted",
};

export function statusStyle(status: string, kind?: "lab" | "payment"): StatusStyle {
  const override = kind === "lab" ? LAB_OVERRIDES[status] : kind === "payment" ? PAYMENT_OVERRIDES[status] : undefined;
  return override ?? STYLES[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "neutral", icon: CircleDashed };
}

export function StatusBadge({ status, kind, className }: { status: string; kind?: "lab" | "payment"; className?: string }) {
  const style = statusStyle(status, kind);
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        TONES[style.tone],
        className,
      )}
      data-status={status}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {style.label}
    </span>
  );
}
