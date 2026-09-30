import * as Sentry from "@sentry/nextjs";

/**
 * docs/03-ARCHITECTURE.md §14: Sentry error reporting, browser runtime.
 * `NEXT_PUBLIC_*` because this file ships in the client bundle — the DSN
 * itself isn't a secret (Sentry DSNs are meant to be public), but an unset
 * value disables capture entirely rather than initialising against an
 * empty string.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_FRONTEND;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
}
