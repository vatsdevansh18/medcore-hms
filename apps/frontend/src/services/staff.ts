"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  AppointmentTrend,
  AppointmentView,
  AuditLogView,
  DashboardKpis,
  ExpiringBatchView,
  GlobalSearchView,
  InvoiceQueueRow,
  LabQueueRow,
  LowStockView,
  OccupancyView,
  PaymentListView,
  PrescriptionQueueRow,
  RevenueTrend,
  SearchDoctorHit,
  SearchMedicineHit,
  SearchPatientHit,
  SearchScope,
} from "@medcore/types";
import { apiPaginated, apiRequest, type QueryValue } from "@/lib/api-client";

/**
 * Staff dashboards and work queues (Phase 13). Read-only: the screens that
 * act on these rows are Phase 13B (docs/11-DECISIONS.md D-039).
 */

export const LIST_PAGE_SIZE = 20;

/** Filters to a query string: arrays become comma-separated (the API's
 * multi-status format), empty values are dropped. */
export function toQuery(filters: Record<string, QueryValue | string[]>): Record<string, QueryValue> {
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? (value.length ? value.join(",") : undefined) : value]),
  );
}

export interface DateRange {
  from?: string;
  to?: string;
}

export function useOverview(enabled = true) {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => apiRequest<DashboardKpis>("/analytics/overview"),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useAppointmentTrend(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: ["analytics", "appointments", range.from, range.to],
    queryFn: () => apiRequest<AppointmentTrend>("/analytics/appointments", { query: { ...range } }),
    enabled,
  });
}

export function useRevenueTrend(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: ["analytics", "revenue", range.from, range.to],
    queryFn: () => apiRequest<RevenueTrend>("/analytics/revenue", { query: { ...range } }),
    enabled,
  });
}

export function useOccupancy(enabled = true) {
  return useQuery({
    queryKey: ["analytics", "occupancy"],
    queryFn: () => apiRequest<OccupancyView>("/analytics/occupancy"),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useGlobalSearch(q: string) {
  return useQuery({
    queryKey: ["search", "grouped", q],
    queryFn: () => apiRequest<GlobalSearchView>("/search", { query: { q } }),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export type SearchHit = SearchPatientHit | SearchDoctorHit | SearchMedicineHit;

export function useScopedSearch(q: string, scope: SearchScope, page: number) {
  return useQuery({
    queryKey: ["search", scope, q, page],
    queryFn: () => apiPaginated<SearchHit>("/search", { query: { q, scope, page, limit: LIST_PAGE_SIZE } }),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

function usePagedList<T>(key: string, path: string, filters: Record<string, QueryValue | string[]>, page: number, enabled = true) {
  return useQuery({
    queryKey: [key, filters, page],
    queryFn: () => apiPaginated<T>(path, { query: { ...toQuery(filters), page, limit: LIST_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export interface AppointmentFilters {
  status?: string[];
  doctorId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortOrder?: "asc" | "desc";
}

export const useStaffAppointments = (filters: AppointmentFilters, page: number, enabled = true) =>
  usePagedList<AppointmentView>("staff-appointments", "/appointments", { ...filters }, page, enabled);

export const useLabQueue = (filters: { status?: string[]; priority?: string }, page: number, enabled = true) =>
  usePagedList<LabQueueRow>("lab-queue", "/lab-orders", { ...filters }, page, enabled);

export const usePrescriptionQueue = (filters: { status?: string[] }, page: number, enabled = true) =>
  usePagedList<PrescriptionQueueRow>("rx-queue", "/prescriptions", { ...filters }, page, enabled);

export const useInvoiceQueue = (filters: { status?: string[] }, page: number, enabled = true) =>
  usePagedList<InvoiceQueueRow>("invoice-queue", "/invoices", { ...filters }, page, enabled);

export const usePaymentList = (filters: { status?: string[]; method?: string[] }, page: number, enabled = true) =>
  usePagedList<PaymentListView>("payments", "/payments", { ...filters }, page, enabled);

export const useAuditLogs = (filters: { entityType?: string }, page: number, enabled = true) =>
  usePagedList<AuditLogView>("audit-logs", "/audit-logs", { ...filters }, page, enabled);

export const useLowStock = (page: number, enabled = true) =>
  usePagedList<LowStockView>("low-stock", "/medicines/low-stock", {}, page, enabled);

export const useExpiring = (days: number, page: number, enabled = true) =>
  usePagedList<ExpiringBatchView>("expiring", "/medicines/expiring", { days }, page, enabled);

export function useDoctorOptions(enabled = true) {
  return useQuery({
    queryKey: ["doctor-options"],
    queryFn: () =>
      apiPaginated<{ id: string; specialization: string; user: { firstName: string; lastName: string } }>("/doctors", {
        query: { limit: 100 },
      }),
    enabled,
    staleTime: 5 * 60_000,
  });
}
