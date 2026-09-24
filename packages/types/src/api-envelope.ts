/**
 * Standard response envelopes — see docs/08-API-CONTRACT.md §2.
 * Every NestJS controller response is wrapped in one of these shapes by
 * the global response interceptor; every frontend API client function
 * is typed against them.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error: ApiErrorBody;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiPaginated<T> {
  success: true;
  data: T[];
  meta: PaginationMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Standard error codes catalogued in docs/08-API-CONTRACT.md §3. */
export enum ApiErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHENTICATED = "UNAUTHENTICATED",
  INVALID_REFRESH_TOKEN = "INVALID_REFRESH_TOKEN",
  FORBIDDEN_ROLE = "FORBIDDEN_ROLE",
  TENANT_MISMATCH = "TENANT_MISMATCH",
  NOT_FOUND = "NOT_FOUND",
  SLOT_UNAVAILABLE = "SLOT_UNAVAILABLE",
  MEDICINE_EXPIRED = "MEDICINE_EXPIRED",
  INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK",
  INVOICE_LOCKED = "INVOICE_LOCKED",
  WEBHOOK_SIGNATURE_INVALID = "WEBHOOK_SIGNATURE_INVALID",
  PAYMENT_PROVIDER_UNAVAILABLE = "PAYMENT_PROVIDER_UNAVAILABLE",
  RATE_LIMITED = "RATE_LIMITED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}
