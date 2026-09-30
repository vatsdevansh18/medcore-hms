import * as Sentry from "@sentry/nextjs";

/**
 * docs/03-ARCHITECTURE.md §14: Sentry error reporting, server + edge
 * runtimes. Optional like every other external provider in this project —
 * an unset DSN disables capture entirely rather than crashing the build or
 * a request. `NEXT_PUBLIC_*` here too (not just in `instrumentation-client.ts`)
 * so one env var covers server, edge, and client — a Sentry DSN isn't a
 * secret, so there's no reason to keep a separate server-only name.
 */
export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_FRONTEND;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
