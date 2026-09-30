import * as Sentry from "@sentry/node";
import { Logger } from "@nestjs/common";

const logger = new Logger("Sentry");

/**
 * docs/03-ARCHITECTURE.md §14: Sentry captures unhandled exceptions and
 * unhandled promise rejections in both the Nest process and BullMQ workers.
 * Optional by design, like every other external provider in this project
 * (Stripe/Razorpay/Resend/Twilio) — an unset `SENTRY_DSN_BACKEND` disables
 * capture entirely rather than crashing the app or silently no-op-ing
 * mid-request; `Sentry.captureException` is always safe to call regardless
 * of whether `init` ran (the SDK is a no-op client until initialised).
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN_BACKEND;
  if (!dsn) {
    logger.log("SENTRY_DSN_BACKEND not set — error reporting disabled.");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Traces/profiling are a cost/latency trade-off this project doesn't
    // need for a hardening pass; capture errors only.
    tracesSampleRate: 0,
  });
  logger.log("Sentry error reporting initialised.");
}

/** Attaches process-level nets for anything that escapes both the HTTP
 * exception filter (`HttpExceptionFilter`) and a BullMQ processor's own
 * `@OnWorkerEvent("failed")` handler — e.g. an error thrown during startup,
 * outside any request or job context. */
export function installProcessErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "uncaughtException");
    Sentry.captureException(error);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection");
    Sentry.captureException(reason);
  });
}

export { Sentry };
