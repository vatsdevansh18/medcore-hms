import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AppointmentView } from "@medcore/types";
import { StatusBadge } from "@/components/shared/status-badge";
import { doctorName, formatDateTime } from "@/lib/format";
import { ROUTES } from "@/constants";

export function AppointmentCard({ appointment, timeZone }: { appointment: AppointmentView; timeZone: string }) {
  return (
    <Link
      href={ROUTES.appointment(appointment.id)}
      className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 hover:border-border-strong"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{formatDateTime(appointment.scheduledStart, timeZone)}</p>
        <p className="mt-0.5 truncate text-sm text-muted">
          {doctorName(appointment.doctor.user)} · {appointment.doctor.specialization}
        </p>
        {appointment.reasonForVisit && (
          <p className="mt-0.5 truncate text-sm text-subtle">{appointment.reasonForVisit}</p>
        )}
      </div>
      <StatusBadge status={appointment.status} />
      <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
    </Link>
  );
}
