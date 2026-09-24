"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddendumRequest,
  AddInvoiceItemRequest,
  AllergyRequest,
  AllergyView,
  ApproveLabResultRequest,
  AppointmentView,
  AttachmentUploadView,
  AvailabilityExceptionRequest,
  BookAppointmentRequest,
  CreateHospitalAdminRequest,
  CreateHospitalRequest,
  DoctorScheduleView,
  DoctorView,
  FamilyHistoryRequest,
  FamilyHistoryView,
  HospitalView,
  SetAvailabilityRequest,
  UploadRequest,
  VaccinationRequest,
  VaccinationView,
  CashPaymentView,
  CreateDoctorRequest,
  CreateLabOrderRequest,
  CreateMedicalRecordRequest,
  CreatePrescriptionRequest,
  CreateStaffRequest,
  DepartmentRequest,
  DepartmentView,
  DispenseRequest,
  DownloadUrlView,
  EmergencyAppointmentRequest,
  EnterLabResultRequest,
  HospitalSettingsView,
  LabOrderView,
  LabQueueRow,
  LabTestView,
  MedicalRecordView,
  MedicineBatchView,
  MedicineRequest,
  MedicineView,
  PatientProfileView,
  PrescriptionView,
  ReceiveBatchRequest,
  RecordVitalsRequest,
  RegisterPatientRequest,
  StaffInvoiceView,
  StaffLabOrderView,
  StaffMemberView,
  StaffPrescriptionView,
  UpdateAppointmentStatusRequest,
  UpdateHospitalRequest,
} from "@medcore/types";
import { ApiRequestError, apiPaginated, apiRequest } from "@/lib/api-client";
import { uploadToSignedUrl } from "@/lib/upload";
import { LIST_PAGE_SIZE } from "./staff";

/**
 * Reads and writes for the staff workflow screens (Phase 13B, D-041). Every
 * mutation invalidates the query families its result can change; the API
 * enforces every permission and state rule itself.
 */

/** Query-key roots. The Phase 13 queue hooks use the same roots, so a write
 * here refreshes the dashboards and lists too. */
const ROOT = {
  appointments: "staff-appointments",
  appointment: "staff-appointment",
  patients: "staff-patients",
  patient: "staff-patient",
  record: "staff-record",
  clinical: "staff-clinical",
  rxQueue: "rx-queue",
  prescription: "staff-prescription",
  labQueue: "lab-queue",
  labOrder: "staff-lab-order",
  labTests: "lab-tests",
  invoices: "invoice-queue",
  invoice: "staff-invoice",
  payments: "payments",
  medicines: "medicines",
  medicine: "medicine",
  batches: "batches",
  lowStock: "low-stock",
  expiring: "expiring",
  staff: "staff-directory",
  departments: "departments",
  hospital: "hospital-settings",
  availability: "availability",
  analytics: "analytics",
  schedule: "doctor-schedule",
  doctor: "doctor-profile",
  hospitals: "hospitals",
} as const;

function useInvalidate() {
  const client = useQueryClient();
  return (...roots: string[]) => Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: [root] })));
}

/** A 404 that means "nothing yet" (e.g. an encounter not started) rather
 * than an error to show. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

// ── Patients and appointments ───────────────────────────────────────────

export function usePatientDirectory(search: string, page: number, enabled = true) {
  return useQuery({
    queryKey: [ROOT.patients, search, page],
    queryFn: () =>
      apiPaginated<PatientProfileView>("/patients", { query: { search: search || undefined, page, limit: LIST_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePatient(id: string | null) {
  return useQuery({
    queryKey: [ROOT.patient, id],
    queryFn: () => apiRequest<PatientProfileView>(`/patients/${id}`),
    enabled: Boolean(id),
  });
}

export function useRegisterPatient() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: RegisterPatientRequest) => apiRequest<PatientProfileView>("/patients", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.patients),
  });
}

export function usePatientAppointments(patientId: string, page: number) {
  return useQuery({
    queryKey: [ROOT.appointments, "patient", patientId, page],
    queryFn: () =>
      apiPaginated<AppointmentView>("/appointments", {
        query: { patientId, page, limit: LIST_PAGE_SIZE, sortOrder: "desc" },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useStaffAppointment(id: string) {
  return useQuery({
    queryKey: [ROOT.appointment, id],
    queryFn: () => apiRequest<AppointmentView>(`/appointments/${id}`),
  });
}

const APPOINTMENT_ROOTS = [ROOT.appointments, ROOT.appointment, ROOT.availability, ROOT.analytics];

export function useBookForPatient() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: BookAppointmentRequest) => apiRequest<AppointmentView>("/appointments", { method: "POST", body }),
    onSettled: () => invalidate(...APPOINTMENT_ROOTS),
  });
}

export function useEmergencyAppointment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: EmergencyAppointmentRequest) =>
      apiRequest<AppointmentView>("/appointments/emergency", { method: "POST", body }),
    onSettled: () => invalidate(...APPOINTMENT_ROOTS),
  });
}

export function useUpdateAppointmentStatus(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateAppointmentStatusRequest) =>
      apiRequest<AppointmentView>(`/appointments/${id}/status`, { method: "PATCH", body }),
    onSettled: () => invalidate(...APPOINTMENT_ROOTS),
  });
}

// ── Encounter (EMR) ─────────────────────────────────────────────────────

/** The encounter record of an appointment, or null before it's started. */
export function useEncounterRecord(appointmentId: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT.record, "appointment", appointmentId],
    queryFn: () => orNull(apiRequest<MedicalRecordView>(`/medical-records/by-appointment/${appointmentId}`)),
    enabled,
  });
}

export function usePatientRecords(patientId: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT.record, "patient", patientId],
    queryFn: () => apiPaginated<MedicalRecordView>(`/medical-records/${patientId}`, { query: { limit: 10 } }),
    enabled,
  });
}

export function useStartEncounter() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateMedicalRecordRequest) =>
      apiRequest<MedicalRecordView>("/medical-records", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.record, ROOT.invoices, ROOT.invoice),
  });
}

export function useRecordVitals(recordId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: RecordVitalsRequest) => apiRequest(`/medical-records/${recordId}/vitals`, { method: "POST", body }),
    onSettled: () => invalidate(ROOT.record),
  });
}

export function useAddAddendum(recordId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: AddendumRequest) => apiRequest(`/medical-records/${recordId}/addenda`, { method: "POST", body }),
    onSettled: () => invalidate(ROOT.record),
  });
}

export function useStaffAllergies(patientId: string) {
  return useQuery({
    queryKey: [ROOT.clinical, "allergies", patientId],
    queryFn: () => apiRequest<AllergyView[]>(`/patients/${patientId}/allergies`),
  });
}

export function useAddAllergy(patientId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: AllergyRequest) => apiRequest(`/patients/${patientId}/allergies`, { method: "POST", body }),
    onSettled: () => invalidate(ROOT.clinical),
  });
}

export function useEncounterPrescriptions(medicalRecordId: string | null) {
  return useQuery({
    queryKey: [ROOT.rxQueue, "record", medicalRecordId],
    queryFn: () => apiPaginated<PrescriptionView>("/prescriptions", { query: { medicalRecordId, limit: 50 } }),
    enabled: Boolean(medicalRecordId),
  });
}

export function useCreatePrescription() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreatePrescriptionRequest) => apiRequest<PrescriptionView>("/prescriptions", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.rxQueue, ROOT.prescription),
  });
}

export function useEncounterLabOrders(medicalRecordId: string | null) {
  return useQuery({
    queryKey: [ROOT.labQueue, "record", medicalRecordId],
    queryFn: () => apiPaginated<LabQueueRow>("/lab-orders", { query: { medicalRecordId, limit: 50 } }),
    enabled: Boolean(medicalRecordId),
  });
}

export function useCreateLabOrder() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateLabOrderRequest) => apiRequest<LabOrderView>("/lab-orders", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.labQueue, ROOT.invoices, ROOT.invoice),
  });
}

export function useLabTests(search: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT.labTests, search],
    queryFn: () => apiPaginated<LabTestView>("/lab-tests", { query: { search: search || undefined, limit: 100 } }),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMedicineSearch(search: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT.medicines, "search", search],
    queryFn: () => apiPaginated<MedicineView>("/medicines", { query: { search: search || undefined, limit: 20 } }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// ── Laboratory ──────────────────────────────────────────────────────────

export function useStaffLabOrder(id: string) {
  return useQuery({ queryKey: [ROOT.labOrder, id], queryFn: () => apiRequest<StaffLabOrderView>(`/lab-orders/${id}`) });
}

const LAB_ROOTS = [ROOT.labOrder, ROOT.labQueue];

export function useLabItemStatus(orderId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: "SAMPLE_COLLECTED" | "IN_PROGRESS" }) =>
      apiRequest(`/lab-orders/${orderId}/items/${itemId}/status`, { method: "PATCH", body: { status } }),
    onSettled: () => invalidate(...LAB_ROOTS),
  });
}

export function useEnterLabResult(orderId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: EnterLabResultRequest }) =>
      apiRequest(`/lab-orders/${orderId}/items/${itemId}/result`, { method: "PATCH", body }),
    onSettled: () => invalidate(...LAB_ROOTS),
  });
}

export function useApproveLabResult(orderId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: ApproveLabResultRequest }) =>
      apiRequest(`/lab-orders/${orderId}/items/${itemId}/approve`, { method: "PATCH", body }),
    onSettled: () => invalidate(...LAB_ROOTS),
  });
}

// ── Pharmacy ────────────────────────────────────────────────────────────

export function useStaffPrescription(id: string) {
  return useQuery({
    queryKey: [ROOT.prescription, id],
    queryFn: () => apiRequest<StaffPrescriptionView>(`/prescriptions/${id}`),
  });
}

export function useDispense(prescriptionId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: DispenseRequest) => apiRequest(`/prescriptions/${prescriptionId}/dispense`, { method: "POST", body }),
    onSettled: () =>
      invalidate(ROOT.prescription, ROOT.rxQueue, ROOT.medicines, ROOT.medicine, ROOT.batches, ROOT.lowStock, ROOT.expiring, ROOT.invoices),
  });
}

export function useMedicines(search: string, page: number) {
  return useQuery({
    queryKey: [ROOT.medicines, "list", search, page],
    queryFn: () => apiPaginated<MedicineView>("/medicines", { query: { search: search || undefined, page, limit: LIST_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

export function useMedicine(id: string) {
  return useQuery({ queryKey: [ROOT.medicine, id], queryFn: () => apiRequest<MedicineView>(`/medicines/${id}`) });
}

export function useMedicineBatches(id: string, page: number) {
  return useQuery({
    queryKey: [ROOT.batches, id, page],
    queryFn: () => apiPaginated<MedicineBatchView>(`/medicines/${id}/batches`, { query: { page, limit: LIST_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

const STOCK_ROOTS = [ROOT.medicines, ROOT.medicine, ROOT.batches, ROOT.lowStock, ROOT.expiring];

export function useCreateMedicine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: MedicineRequest) => apiRequest<MedicineView>("/medicines", { method: "POST", body }),
    onSettled: () => invalidate(...STOCK_ROOTS),
  });
}

export function useUpdateMedicine(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Partial<MedicineRequest>) => apiRequest<MedicineView>(`/medicines/${id}`, { method: "PATCH", body }),
    onSettled: () => invalidate(...STOCK_ROOTS),
  });
}

export function useReceiveBatch(medicineId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: ReceiveBatchRequest) =>
      apiRequest<MedicineBatchView>(`/medicines/${medicineId}/batches`, { method: "POST", body }),
    onSettled: () => invalidate(...STOCK_ROOTS),
  });
}

// ── Billing desk ────────────────────────────────────────────────────────

export function useStaffInvoice(id: string) {
  return useQuery({ queryKey: [ROOT.invoice, id], queryFn: () => apiRequest<StaffInvoiceView>(`/invoices/${id}`) });
}

export function useAppointmentInvoices(appointmentId: string, enabled = true) {
  return useQuery({
    queryKey: [ROOT.invoices, "appointment", appointmentId],
    queryFn: () => apiPaginated<StaffInvoiceView>("/invoices", { query: { appointmentId, limit: 20 } }),
    enabled,
  });
}

const BILLING_ROOTS = [ROOT.invoice, ROOT.invoices, ROOT.payments, ROOT.analytics];

/** Opens (or returns) the visit's DRAFT invoice. Idempotent server-side. */
export function useOpenInvoice() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (appointmentId: string) => apiRequest<StaffInvoiceView>("/invoices", { method: "POST", body: { appointmentId } }),
    onSettled: () => invalidate(...BILLING_ROOTS),
  });
}

export function useAddInvoiceItem(invoiceId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: AddInvoiceItemRequest) => apiRequest(`/invoices/${invoiceId}/items`, { method: "POST", body }),
    onSettled: () => invalidate(...BILLING_ROOTS),
  });
}

export function useFinalizeInvoice(invoiceId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => apiRequest(`/invoices/${invoiceId}/finalize`, { method: "PATCH" }),
    onSettled: () => invalidate(...BILLING_ROOTS),
  });
}

export function useCashPayment(invoiceId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (amount: number) =>
      apiRequest<CashPaymentView>(`/invoices/${invoiceId}/cash-payment`, { method: "POST", body: { amount } }),
    onSettled: () => invalidate(...BILLING_ROOTS),
  });
}

export const fetchReceiptUrl = (paymentId: string) => apiRequest<DownloadUrlView>(`/payments/${paymentId}/receipt`);

// ── Hospital administration ─────────────────────────────────────────────

export function useStaffDirectory(filters: { role?: string; search?: string }, page: number) {
  return useQuery({
    queryKey: [ROOT.staff, filters, page],
    queryFn: () =>
      apiPaginated<StaffMemberView>("/users", {
        query: { role: filters.role || undefined, search: filters.search || undefined, page, limit: LIST_PAGE_SIZE },
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateStaff() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateStaffRequest) => apiRequest("/users", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.staff),
  });
}

export function useCreateDoctor() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateDoctorRequest) => apiRequest("/doctors", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.staff, "doctor-options"),
  });
}

export function useDepartments(hospitalId: string | null | undefined) {
  return useQuery({
    queryKey: [ROOT.departments, hospitalId],
    queryFn: () => apiPaginated<DepartmentView>(`/hospitals/${hospitalId}/departments`, { query: { limit: 100 } }),
    enabled: Boolean(hospitalId),
    staleTime: 60_000,
  });
}

export function useSaveDepartment(hospitalId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: DepartmentRequest }) =>
      id
        ? apiRequest<DepartmentView>(`/hospitals/${hospitalId}/departments/${id}`, { method: "PATCH", body })
        : apiRequest<DepartmentView>(`/hospitals/${hospitalId}/departments`, { method: "POST", body }),
    onSettled: () => invalidate(ROOT.departments),
  });
}

export function useDeleteDepartment(hospitalId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiRequest(`/hospitals/${hospitalId}/departments/${id}`, { method: "DELETE" }),
    onSettled: () => invalidate(ROOT.departments),
  });
}

export function useHospitalSettings(hospitalId: string | null | undefined) {
  return useQuery({
    queryKey: [ROOT.hospital, hospitalId],
    queryFn: () => apiRequest<HospitalSettingsView>(`/hospitals/${hospitalId}`),
    enabled: Boolean(hospitalId),
  });
}

export function useUpdateHospital(hospitalId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateHospitalRequest) =>
      apiRequest<HospitalSettingsView>(`/hospitals/${hospitalId}`, { method: "PATCH", body }),
    onSettled: () => invalidate(ROOT.hospital),
  });
}

// ── Phase 13B follow-up (D-042) ─────────────────────────────────────────


export function useVaccinations(patientId: string) {
  return useQuery({
    queryKey: [ROOT.clinical, "vaccinations", patientId],
    queryFn: () => apiRequest<VaccinationView[]>(`/patients/${patientId}/vaccinations`),
  });
}

export function useAddVaccination(patientId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: VaccinationRequest) => apiRequest(`/patients/${patientId}/vaccinations`, { method: "POST", body }),
    onSettled: () => invalidate(ROOT.clinical),
  });
}

export function useFamilyHistory(patientId: string) {
  return useQuery({
    queryKey: [ROOT.clinical, "family-history", patientId],
    queryFn: () => apiRequest<FamilyHistoryView[]>(`/patients/${patientId}/family-history`),
  });
}

export function useAddFamilyHistory(patientId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: FamilyHistoryRequest) => apiRequest(`/patients/${patientId}/family-history`, { method: "POST", body }),
    onSettled: () => invalidate(ROOT.clinical),
  });
}

/** Declares the attachment (the API validates type and size and returns a
 * pre-signed URL), then uploads the bytes straight to storage. */
export function useUploadAttachment(recordId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (file: File) => {
      const declared: UploadRequest = { fileName: file.name, mimeType: file.type, sizeBytes: file.size };
      const { attachment, uploadUrl } = await apiRequest<AttachmentUploadView>(`/medical-records/${recordId}/attachments`, {
        method: "POST",
        body: declared,
      });
      await uploadToSignedUrl(uploadUrl, file);
      return attachment;
    },
    onSettled: () => invalidate(ROOT.record),
  });
}

export const fetchAttachmentUrl = (recordId: string, attachmentId: string) =>
  apiRequest<DownloadUrlView>(`/medical-records/${recordId}/attachments/${attachmentId}/download-url`);

export function useDoctorSchedule(doctorId: string | null | undefined) {
  return useQuery({
    queryKey: [ROOT.schedule, doctorId],
    queryFn: () => apiRequest<DoctorScheduleView>(`/doctors/${doctorId}/schedule`),
    enabled: Boolean(doctorId),
  });
}

const SCHEDULE_ROOTS = [ROOT.schedule, ROOT.availability];

export function useSaveWeeklyHours(doctorId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: SetAvailabilityRequest) => apiRequest(`/doctors/${doctorId}/availability`, { method: "PUT", body }),
    onSettled: () => invalidate(...SCHEDULE_ROOTS),
  });
}

export function useAddException(doctorId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: AvailabilityExceptionRequest) =>
      apiRequest(`/doctors/${doctorId}/availability-exceptions`, { method: "POST", body }),
    onSettled: () => invalidate(...SCHEDULE_ROOTS),
  });
}

export function useRemoveException(doctorId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (date: string) => apiRequest(`/doctors/${doctorId}/availability-exceptions/${date}`, { method: "DELETE" }),
    onSettled: () => invalidate(...SCHEDULE_ROOTS),
  });
}

export function useDoctorProfile(doctorId: string | null | undefined) {
  return useQuery({
    queryKey: [ROOT.doctor, doctorId],
    queryFn: () => apiRequest<DoctorView>(`/doctors/${doctorId}`),
    enabled: Boolean(doctorId),
  });
}

/** The prescription signature: declare it, then upload the image. New
 * prescriptions carry it; issued PDFs never change. */
export function useUploadSignature(doctorId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (file: File) => {
      const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(`/doctors/${doctorId}/signature`, {
        method: "POST",
        body: { fileName: file.name, mimeType: file.type, sizeBytes: file.size } satisfies UploadRequest,
      });
      await uploadToSignedUrl(uploadUrl, file);
    },
    onSettled: () => invalidate(ROOT.doctor),
  });
}

export function useHospitals(page: number) {
  return useQuery({
    queryKey: [ROOT.hospitals, page],
    queryFn: () => apiPaginated<HospitalView>("/hospitals", { query: { page, limit: LIST_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateHospital() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateHospitalRequest) => apiRequest<HospitalView>("/hospitals", { method: "POST", body }),
    onSettled: () => invalidate(ROOT.hospitals, ROOT.analytics),
  });
}

export function useVerifyHospital() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiRequest<HospitalView>(`/hospitals/${id}/verify`, { method: "PATCH" }),
    onSettled: () => invalidate(ROOT.hospitals, ROOT.analytics),
  });
}

export function useCreateHospitalAdmin(hospitalId: string) {
  return useMutation({
    mutationFn: (body: CreateHospitalAdminRequest) => apiRequest(`/hospitals/${hospitalId}/admins`, { method: "POST", body }),
  });
}
