import { ApiRequestError } from "./api-client";

/** Human-readable text for an API error code (docs/04-UI-UX.md §2.10:
 * "derived from the API error envelope's code"). The server's own message
 * is used where it's already written for the user. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Your session has ended. Please sign in again.",
  INVALID_REFRESH_TOKEN: "Your session has ended. Please sign in again.",
  FORBIDDEN_ROLE: "Your account doesn't have access to this.",
  NOT_FOUND: "We couldn't find that. It may have been removed, or it isn't yours.",
  RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
  INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
  NETWORK_ERROR: "We couldn't reach MedCore. Check your connection and try again.",
};

/** Codes whose server message is already user-facing. */
const USE_SERVER_MESSAGE = new Set([
  "VALIDATION_ERROR",
  "SLOT_UNAVAILABLE",
  "RESCHEDULE_NOT_ALLOWED",
  "INVOICE_LOCKED",
  "PAYMENT_PROVIDER_UNAVAILABLE",
]);

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (USE_SERVER_MESSAGE.has(error.code)) return error.message;
    return MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof TypeError) return MESSAGES.NETWORK_ERROR;
  return MESSAGES.INTERNAL_ERROR;
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiRequestError ? error.code : null;
}

/** Retrying makes sense for server and network faults, not for a 4xx. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiRequestError) return error.status >= 500 || error.status === 429;
  return true;
}
