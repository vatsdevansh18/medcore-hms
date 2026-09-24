/** Formats an instant for a notification body in the hospital's own
 * timezone (e.g. "24 Sept 2026, 10:30 am"), since that's the clock a
 * patient or doctor reads the appointment time against. */
export function formatHospitalTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

export function doctorName(user: { firstName: string; lastName: string } | null | undefined): string {
  return user ? `Dr. ${user.firstName} ${user.lastName}` : "your doctor";
}
