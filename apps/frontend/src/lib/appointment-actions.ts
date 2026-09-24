import { AppointmentStatus, UserRole, type UpdateAppointmentStatusRequest } from "@medcore/types";

export type AppointmentAction = "CONFIRM" | "CHECK_IN" | "COMPLETE" | "NO_SHOW" | "CANCEL";

const TARGET: Record<AppointmentAction, UpdateAppointmentStatusRequest["status"]> = {
  CONFIRM: AppointmentStatus.CONFIRMED,
  CHECK_IN: AppointmentStatus.IN_PROGRESS,
  COMPLETE: AppointmentStatus.COMPLETED,
  NO_SHOW: AppointmentStatus.NO_SHOW,
  CANCEL: AppointmentStatus.CANCELLED,
};

/**
 * The status moves each staff role may make, per current status. A copy of
 * the API's state machine (`ALLOWED_TRANSITIONS` in
 * appointments.service.ts, docs/07-RBAC-MATRIX.md §3.3), used only to decide
 * which buttons to show; the API refuses anything else regardless.
 */
const MOVES: Partial<Record<UserRole, Partial<Record<AppointmentStatus, AppointmentAction[]>>>> = {
  [UserRole.HOSPITAL_ADMIN]: {
    PENDING: ["CONFIRM", "CANCEL"],
    CONFIRMED: ["CHECK_IN", "NO_SHOW", "CANCEL"],
    IN_PROGRESS: ["COMPLETE"],
  },
  [UserRole.DOCTOR]: {
    PENDING: ["CONFIRM"],
    CONFIRMED: ["CHECK_IN", "NO_SHOW"],
    IN_PROGRESS: ["COMPLETE"],
  },
  [UserRole.NURSE]: { CONFIRMED: ["CHECK_IN"] },
  [UserRole.RECEPTIONIST]: {
    PENDING: ["CONFIRM", "CANCEL"],
    CONFIRMED: ["NO_SHOW", "CANCEL"],
  },
};

export function appointmentActions(role: UserRole, status: AppointmentStatus): AppointmentAction[] {
  return MOVES[role]?.[status] ?? [];
}

export function actionTarget(action: AppointmentAction): UpdateAppointmentStatusRequest["status"] {
  return TARGET[action];
}

/** Whether a role works in the encounter workspace for a visit in this
 * status: doctors and nurses, once the visit has started. */
export function canOpenEncounter(role: UserRole, status: AppointmentStatus): boolean {
  const clinical = role === UserRole.DOCTOR || role === UserRole.NURSE;
  return clinical && (status === AppointmentStatus.IN_PROGRESS || status === AppointmentStatus.COMPLETED);
}

/** Whether the billing desk can open a bill for a visit in this status. A
 * cancelled or missed visit has nothing to bill. */
export function canBill(role: UserRole, status: AppointmentStatus): boolean {
  const billing = role === UserRole.RECEPTIONIST || role === UserRole.ACCOUNTANT;
  return billing && status !== AppointmentStatus.CANCELLED && status !== AppointmentStatus.NO_SHOW;
}
