"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AllergyView,
  AppointmentStatus,
  AppointmentView,
  BookAppointmentRequest,
  CheckoutSessionView,
  DaySlotsView,
  DoctorView,
  DownloadUrlView,
  FamilyHistoryView,
  InvoiceSummaryView,
  InvoiceView,
  LabOrderSummaryView,
  LabOrderView,
  MedicalRecordView,
  NotificationView,
  PaymentProvider,
  PrescriptionView,
  RescheduleAppointmentRequest,
  VaccinationView,
} from "@medcore/types";
import { apiPaginated, apiRequest } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";

/** Query keys, grouped so a mutation can invalidate a whole family. */
export const qk = {
  appointments: (page: number, filter: string) => ["appointments", page, filter] as const,
  appointment: (id: string) => ["appointments", "detail", id] as const,
  doctors: (search: string) => ["doctors", search] as const,
  availability: (doctorId: string, from: string, to: string) => ["availability", doctorId, from, to] as const,
  records: (patientId: string, page: number) => ["records", patientId, page] as const,
  record: (id: string) => ["records", "detail", id] as const,
  allergies: (patientId: string) => ["clinical", "allergies", patientId] as const,
  vaccinations: (patientId: string) => ["clinical", "vaccinations", patientId] as const,
  familyHistory: (patientId: string) => ["clinical", "family-history", patientId] as const,
  prescriptions: (page: number) => ["prescriptions", page] as const,
  prescription: (id: string) => ["prescriptions", "detail", id] as const,
  labOrders: (page: number) => ["lab-orders", page] as const,
  labOrder: (id: string) => ["lab-orders", "detail", id] as const,
  invoices: (page: number) => ["invoices", page] as const,
  invoice: (id: string) => ["invoices", "detail", id] as const,
  notifications: () => ["notifications"] as const,
};

export const PAGE_SIZE = 10;

/** Upcoming = not yet finished; the list endpoint filters by status only. */
export type AppointmentFilter = "upcoming" | "past" | "all";

export function useAppointments(page: number, filter: AppointmentFilter = "all") {
  return useQuery({
    queryKey: qk.appointments(page, filter),
    queryFn: () =>
      apiPaginated<AppointmentView>("/appointments", {
        query: {
          page,
          limit: PAGE_SIZE,
          dateFrom: filter === "upcoming" ? new Date().toISOString() : undefined,
          dateTo: filter === "past" ? new Date().toISOString() : undefined,
          sortOrder: filter === "upcoming" ? "asc" : "desc",
        },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useAppointment(id: string) {
  return useQuery({ queryKey: qk.appointment(id), queryFn: () => apiRequest<AppointmentView>(`/appointments/${id}`) });
}

export function useDoctors(search: string) {
  return useQuery({
    queryKey: qk.doctors(search),
    queryFn: () => apiPaginated<DoctorView>("/doctors", { query: { limit: 50, specialization: search || undefined } }),
    placeholderData: keepPreviousData,
  });
}

export function useAvailability(doctorId: string | null, dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: qk.availability(doctorId ?? "", dateFrom, dateTo),
    queryFn: () =>
      apiRequest<DaySlotsView[]>(`/doctors/${doctorId}/availability`, { query: { dateFrom, dateTo } }),
    enabled: Boolean(doctorId),
    // Slots go stale quickly while other patients book.
    staleTime: 15_000,
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return (...roots: string[]) => Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: [root] })));
}

export function useBookAppointment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: BookAppointmentRequest) =>
      apiRequest<AppointmentView>("/appointments", { method: "POST", body }),
    onSettled: () => invalidate("appointments", "availability"),
  });
}

export function useRescheduleAppointment(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: RescheduleAppointmentRequest) =>
      apiRequest<AppointmentView>(`/appointments/${id}/reschedule`, { method: "PATCH", body }),
    onSettled: () => invalidate("appointments", "availability"),
  });
}

export function useCancelAppointment(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (cancelledReason: string) =>
      apiRequest<AppointmentView>(`/appointments/${id}/status`, {
        method: "PATCH",
        body: { status: "CANCELLED" satisfies AppointmentStatus, cancelledReason },
      }),
    onSettled: () => invalidate("appointments", "availability"),
  });
}

function usePatientProfileId(): string | null {
  return useAuthStore((s) => s.user?.patientProfileId ?? null);
}

export function useMedicalRecords(page: number) {
  const patientId = usePatientProfileId();
  return useQuery({
    queryKey: qk.records(patientId ?? "", page),
    queryFn: () =>
      apiPaginated<MedicalRecordView>(`/medical-records/${patientId}`, { query: { page, limit: PAGE_SIZE } }),
    enabled: Boolean(patientId),
    placeholderData: keepPreviousData,
  });
}

export function useMedicalRecord(id: string) {
  return useQuery({
    queryKey: qk.record(id),
    queryFn: () => apiRequest<MedicalRecordView>(`/medical-records/by-id/${id}`),
  });
}

export function useAllergies() {
  const patientId = usePatientProfileId();
  return useQuery({
    queryKey: qk.allergies(patientId ?? ""),
    queryFn: () => apiRequest<AllergyView[]>(`/patients/${patientId}/allergies`),
    enabled: Boolean(patientId),
  });
}

export function useVaccinations() {
  const patientId = usePatientProfileId();
  return useQuery({
    queryKey: qk.vaccinations(patientId ?? ""),
    queryFn: () => apiRequest<VaccinationView[]>(`/patients/${patientId}/vaccinations`),
    enabled: Boolean(patientId),
  });
}

export function useFamilyHistory() {
  const patientId = usePatientProfileId();
  return useQuery({
    queryKey: qk.familyHistory(patientId ?? ""),
    queryFn: () => apiRequest<FamilyHistoryView[]>(`/patients/${patientId}/family-history`),
    enabled: Boolean(patientId),
  });
}

export const downloadAttachment = (recordId: string, attachmentId: string) =>
  apiRequest<DownloadUrlView>(`/medical-records/${recordId}/attachments/${attachmentId}/download-url`);

export function usePrescriptions(page: number) {
  return useQuery({
    queryKey: qk.prescriptions(page),
    queryFn: () => apiPaginated<PrescriptionView>("/prescriptions", { query: { page, limit: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

export function usePrescription(id: string) {
  return useQuery({
    queryKey: qk.prescription(id),
    queryFn: () => apiRequest<PrescriptionView>(`/prescriptions/${id}`),
    // The PDF is rendered by a background job (FR-RX-003); check again
    // until it's ready.
    refetchInterval: (query) => (query.state.data && !query.state.data.pdfReady ? 5_000 : false),
  });
}

export const prescriptionPdf = (id: string) => apiRequest<DownloadUrlView>(`/prescriptions/${id}/pdf`);

export function useLabOrders(page: number) {
  return useQuery({
    queryKey: qk.labOrders(page),
    queryFn: () => apiPaginated<LabOrderSummaryView>("/lab-orders", { query: { page, limit: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

export function useLabOrder(id: string) {
  return useQuery({ queryKey: qk.labOrder(id), queryFn: () => apiRequest<LabOrderView>(`/lab-orders/${id}`) });
}

export function useInvoices(page: number) {
  return useQuery({
    queryKey: qk.invoices(page),
    queryFn: () => apiPaginated<InvoiceSummaryView>("/invoices", { query: { page, limit: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

/** `pollMs` is set while a checkout is processing: the webhook, not the
 * browser, decides whether the payment succeeded (docs/03-ARCHITECTURE.md §9). */
export function useInvoice(id: string, pollMs: number | false = false) {
  return useQuery({
    queryKey: qk.invoice(id),
    queryFn: () => apiRequest<InvoiceView>(`/invoices/${id}`),
    refetchInterval: pollMs,
  });
}

export function useStartCheckout(invoiceId: string) {
  return useMutation({
    mutationFn: (provider: PaymentProvider) =>
      apiRequest<CheckoutSessionView>(`/invoices/${invoiceId}/checkout-session`, {
        method: "POST",
        body: { provider },
      }),
  });
}

export const paymentReceipt = (paymentId: string) => apiRequest<DownloadUrlView>(`/payments/${paymentId}/receipt`);

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications(),
    queryFn: () => apiPaginated<NotificationView>("/notifications/me", { query: { limit: 20 } }),
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<NotificationView>(`/notifications/${id}/read`, { method: "PATCH" }),
    onSettled: () => client.invalidateQueries({ queryKey: qk.notifications() }),
  });
}
