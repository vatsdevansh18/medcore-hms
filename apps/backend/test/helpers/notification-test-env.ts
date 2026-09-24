/**
 * Env for the notifications e2e spec. Imported before `AppModule`, for the
 * same reason as `payment-test-env.ts` (ConfigModule snapshots the
 * environment at first import). A short retry base delay lets the spec
 * watch a channel job exhaust all 3 attempts (NFR-AVAIL-002) in well under
 * a second instead of 5s + 10s.
 */
export const TEST_RETRY_BASE_DELAY_MS = 50;

process.env.NOTIFICATION_RETRY_BASE_DELAY_MS = String(TEST_RETRY_BASE_DELAY_MS);
