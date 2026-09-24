"use client";

import type { HospitalSummary } from "@medcore/types";
import { useAuthStore } from "@/store/auth-store";

const FALLBACK: HospitalSummary = {
  id: "",
  name: "",
  timezone: "Asia/Kolkata",
  patientRescheduleAllowed: false,
  patientRescheduleCutoffHours: 24,
};

/** The signed-in user's hospital: its timezone drives every time shown. */
export function useHospital(): HospitalSummary {
  return useAuthStore((s) => s.user?.hospital) ?? FALLBACK;
}
