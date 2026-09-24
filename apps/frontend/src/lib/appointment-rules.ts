import { AppointmentStatus, AppointmentType, type AppointmentView, type HospitalSummary } from "@medcore/types";

export type RescheduleCheck = { allowed: true } | { allowed: false; reason: string | null };

/**
 * Whether the portal offers "Reschedule", mirroring the server's rules
 * (docs/11-DECISIONS.md D-035) so the button isn't shown when it would only
 * fail. The server still decides. `reason` is null where nothing needs
 * explaining (a finished or cancelled appointment).
 */
export function canReschedule(a: AppointmentView, hospital: HospitalSummary, now = Date.now()): RescheduleCheck {
  if (a.status !== AppointmentStatus.PENDING && a.status !== AppointmentStatus.CONFIRMED) {
    return { allowed: false, reason: null };
  }
  if (a.type === AppointmentType.EMERGENCY) {
    return { allowed: false, reason: "Emergency appointments can't be rescheduled." };
  }
  if (!hospital.patientRescheduleAllowed) {
    return {
      allowed: false,
      reason: "This hospital doesn't allow online rescheduling. Please contact the front desk.",
    };
  }
  if (new Date(a.scheduledStart).getTime() - now < hospital.patientRescheduleCutoffHours * 3_600_000) {
    return {
      allowed: false,
      reason: `Online rescheduling closes ${hospital.patientRescheduleCutoffHours} hours before the appointment. Please contact the front desk.`,
    };
  }
  return { allowed: true };
}

/** A patient may cancel only a request that's still PENDING (RBAC §3.3). */
export function canCancel(a: AppointmentView): boolean {
  return a.status === AppointmentStatus.PENDING;
}
