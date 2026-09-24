# Phase 11 Review — Notifications & Background Jobs

## Phase

Phase 11 of 17 (`docs/05-DEVELOPMENT-PLAN.md`). Depends on Phases 3, 5, 8, and 10, all gated PASS (Phase 10 with one documented UNVERIFIED item; see Known Minor Issues).

## Objective

Deliver `FR-NOTIF-001..003` and `NFR-AVAIL-002/003`:
- an event bus;
- per-channel queues and workers (email, SMS, in-app);
- a Socket.IO gateway with the Redis adapter;
- delivery logging;
- Bull Board (dev only).

This covers every trigger in the brief's §7.8 table, the §7.2 appointment reminders, and the §7.6 expiry report. It also replaces all four earlier "real row now, dispatch in Phase 11" producers and the three delivery stubs (OTP, reminder, and expiry digest).

## Implemented

**Transactional outbox and event bus** (`src/notifications/`, D-032):
- `NotificationsService.record(tx, event)` writes one `Notification` row per recipient inside the triggering transaction, taking channels from the trigger table, with a unique `dedupeKey` for idempotency.
- `publish()` emits `notifications.committed` on `@nestjs/event-emitter`.
- `NotificationDispatcher` drains undispatched rows into the `email`/`sms`/`in-app` BullMQ queues with deterministic job ids, then marks `dispatchedAt`.
- The `notification-outbox` sweep (every 30s) recovers rows whose signal was lost.

**Trigger table** (brief §7.8), all eight events plus the expiry digest:

| Event | Where it fires | Recipient | Channels |
| --- | --- | --- | --- |
| Appointment confirmed | `PENDING → CONFIRMED` | Patient | Email, SMS, In-app |
| Appointment reminder | 24h and 1h BullMQ jobs, replacing `ReminderDeliveryStub` | Patient | Email, SMS |
| Emergency appointment | Created | Doctor | In-app, SMS |
| Prescription ready | Issue | Patient | SMS, In-app |
| Lab result approved | Approval, now inside the approval transaction | Doctor, Patient | Email, In-app |
| Invoice generated | Finalize | Patient | Email, In-app |
| Payment received | Cash or verified webhook | Patient | Email, SMS |
| Low-stock alert | Latch (D-022) | Pharmacists, Hospital Admin | Email, In-app |
| Medicine expiry digest | Nightly scan, replacing `ExpiryDigestDeliveryStub` | Pharmacists, Hospital Admin | Email, In-app |

**Channel workers:**
- `EmailProcessor`/`SmsProcessor`/`InAppProcessor` run on `ChannelDeliveryService`, with one `NotificationDeliveryLog` row per attempt.
- Outcomes: SENT; SKIPPED (`PROVIDER_NOT_CONFIGURED`, `NO_PHONE`, `PHONE_NOT_VERIFIED`, `RECIPIENT_INACTIVE`); FAILED, retried 3 times with exponential backoff and then dead-lettered in the failed set.
- Permanent provider errors fail fast.
- Workers close in `beforeApplicationShutdown`, so in-flight jobs finish before the socket layer is torn down.

**Providers** (`src/common/messaging/`, D-033):
- Resend and Twilio adapters behind `EMAIL_SENDER`/`SMS_SENDER`.
- Resend calls carry an idempotency key.
- Non-production email always goes to a sandbox recipient; SMS does too when `SMS_SANDBOX_RECIPIENT` is set.
- SMS goes only to verified phones.
- Lab and prescription messages carry minimal content by email/SMS.

**Auth secrets:** `MessagingOtpDelivery` replaces the Phase 3 `OtpDeliveryStub`. It sends email OTP, SMS OTP, and password-reset links directly and synchronously, never persisting or queueing them.

**Real time:**
- `NotificationsGateway` on namespace `/notifications`.
- JWT handshake middleware (signature, expiry, active account) with a generic `UNAUTHENTICATED` error.
- The socket joins its own `user:{id}` room only, and is disconnected when its token expires.
- `ConfiguredIoAdapter`, applied in `configureApp()`, sets the CORS allow-list and the `@socket.io/redis-adapter`.

**API:**
- `GET /notifications/me` (own in-app history, paginated, `unreadOnly`, `meta.unreadCount`).
- `PATCH /notifications/:id/read` (owner only, idempotent).
- Shared `NotificationView`/`NOTIFICATIONS_NAMESPACE`/`NotificationSocketEvent` in `packages/types`.

**Bull Board** at `/api/admin/queues` over all 7 queues: off by default, refused in production by env validation, and HTTP Basic with a constant-time comparison when enabled.

**Schema** (migration `20260925090000_notification_dispatch`):
- `Notification.dispatchedAt`/`dedupeKey`, plus indexes.
- `NotificationStatus.SKIPPED`.
- `NotificationDeliveryLog.attempt`/`providerMessageId`, and its FK changed to `ON DELETE CASCADE`.
- Existing rows backfilled as dispatched.

**Hardening outside the module:**
- The appointment status update is now conditional on the validated status (concurrent duplicate → 409).
- Lab approval is conditional on `RESULT_UPLOADED` (concurrent duplicate → 409).
- The tenant-scoping extension now also covers `createManyAndReturn`.

## Requirements Verified

| Requirement | How |
| --- | --- |
| FR-NOTIF-001 (event-originated, decoupled via queue, never inline) | Every trigger goes through `record` + `publish`; delivery happens in workers after commit. A failing event bus still returns 200 (test). |
| FR-NOTIF-002 (fan-out per trigger table; independently retryable channels) | Trigger-table test; per-trigger tests assert channels and recipients; SMS failing 3× while Email and In-app are SENT. |
| FR-NOTIF-003 (Socket.IO delivery, persisted history via `/notifications/me`) | Live socket tests (own room only, token expiry, handshake rejection); history/read tests; live check against the Docker container. |
| NFR-AVAIL-002 (3 attempts, exponential backoff, dead-letter) | Attempt log `[1 FAILED, 2 FAILED, 3 FAILED]` and job state `failed, attemptsMade 3`; recovery on attempt 2; a permanent error makes 1 attempt only. |
| NFR-AVAIL-003 (a channel failure never blocks or rolls back the domain transaction) | The appointment stays CONFIRMED with SMS failing; the request succeeds with the event bus failing; the sweep recovers the row. |
| SEC-NOTIF-001..005 (new, `docs/09-SECURITY.md` §11a) | Handshake rejection (no/garbage/forged/expired token, disabled user); room isolation across users and tenants; payload shape; ownership 404s; minimal content; verified-phone gate; Bull Board gating and env refusal. |
| Brief §7.2 reminders (24h + 1h, email + SMS) | Reminder processor test: channels, recipient, idempotent across retries, separate windows, cancelled appointment skipped. |

## Files/Modules Changed

- **New:**
  - `src/notifications/`: service, dispatcher, delivery service, processors, outbox sweep, trigger table, format helpers, gateway, IO adapter, controller, DTO, module, constants.
  - `src/common/messaging/`: ports, Resend and Twilio senders, module.
  - `src/common/bootstrap/bull-board.ts`.
  - `src/auth/services/otp-delivery.ts`.
  - `packages/types/src/notifications.ts`.
  - The migration.
  - `test/notifications.e2e-spec.ts`, `test/helpers/notification-test-env.ts`.
- **Modified:** appointments, prescriptions, lab, medicines (stock, expiry scan, medicines, dispensing), billing (ledger, invoices, payments), and their modules; queue module and reminder processor; auth module and OTP/password-reset services; `app.module.ts`, `configure-app.ts`, `env.validation.ts`, `tenant-scoping.extension.ts`, `schema.prisma`, `packages/types/src/enums.ts`.
- **Deleted:** `otp-delivery.stub.ts`, `reminder-delivery.stub.ts`, `expiry-digest-delivery.stub.ts`.
- **Tests adjusted:** notification teardown in the appointments, appointment-concurrency, medical-records, and prescriptions specs; the pharmacy low-stock channel assertion (now Email + In-app, per the brief); the `auth.e2e-spec.ts` import path; `jest-e2e.json` `maxWorkers: 1`.
- **Dependencies:** `@nestjs/event-emitter`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@socket.io/redis-adapter`, `resend`, `twilio`, `@bull-board/api`, `@bull-board/express`; dev: `socket.io-client`.

## Tests Executed

- `tsc --noEmit` (backend incl. tests; frontend), ESLint `--max-warnings=0`.
- Full e2e suite: twice after the final change, serially.
- `notifications.e2e-spec.ts` alone: 17 times across development and the flakiness investigation (see Bugs Found #1).
- **13 mutation checks**, each re-running the notifications spec with one protection removed. Every one was caught:

| Protection removed | Tests failed |
| --- | --- |
| Owner filter in `findMine` | 11 |
| Owner filter in `markRead` | 1 |
| Field-by-field `toView` (spread instead) | 5 |
| Dedupe key | 2 |
| Socket auth middleware | 3 |
| Deterministic job ids | 11 |
| Verified-phone gate | 1 |
| Minimal external content | 1 |
| Outbox sweep | 1 |
| Conditional appointment update | 5 |
| Disabled-recipient skip | 1 |
| Permanent-error fail-fast | 1 |
| Clock-skew fix | 1 (exactly the regression test) |

- **Migration drift check:** fresh shadow DB, `prisma migrate diff` → "No difference detected".
- **Docker:**
  - `docker compose build api` + `up -d api`: routes mapped, sweep scheduled.
  - In-container: the Resend/Twilio/socket adapter/Bull Board packages load and construct under Node 20 on Alpine.
  - Live checks against the container on port 3001: tokenless socket rejected; authenticated socket connected; a message emitted by a **separate process** through its own Redis adapter reached the API-attached socket (cross-instance fan-out); a row inserted by SQL with no signal was swept within 30s, pushed in-app, and logged (EMAIL `SKIPPED: PROVIDER_NOT_CONFIGURED`, IN_APP SENT); `GET /notifications/me` and `PATCH …/read` worked; Bull Board 404 when disabled; no JWT appears in the container logs.

## Test Results

- Typecheck: **PASS** (backend, frontend). Lint: **PASS**.
- e2e: **PASS**, 231/231 across 13/13 suites, twice (198 pre-existing + 33 new), about 39s serially.
- 0 leftover notification, delivery-log, or invoice rows after the suite.
- Docker live checks: **PASS**. Migration: **PASS**.

## Security Review

**Tenancy and ownership:**
- History and read are scoped by recipient on top of tenant scoping.
- Cross-tenant and same-tenant foreign ids return 404, and the row is verified unchanged.
- A Super Admin (no hospital) is served through `runForCaller`'s bypass, still filtered to their own recipient id.

**Real time:**
- Handshake authentication: five rejection variants tested.
- There are no client-to-server handlers; `join`/`subscribe` attempts were tested and had no effect.
- The socket is disconnected at token expiry.
- CORS uses the HTTP allow-list.

**Data minimisation:**
- `NotificationView` is an explicit field list; the payload-shape test caught a spread leaking recipient contact details (Bugs Found #2).
- Clinical content is withheld from email/SMS.
- Delivery-log error messages are truncated to 500 characters and stored server-side only.

**Messaging:**
- SMS only to verified phones.
- Sandbox redirect outside production.
- OTP and reset secrets are never persisted or queued, and are logged only outside production.
- `forgot-password` stays uniform, since send failures are swallowed.

**Operations:** Bull Board is off by default, refused in production, and needs a 12+ character Basic password (constant-time compare). The system processes (dispatcher, sweep, workers) read across tenants via the documented `TenantContext.bypass()` and only by notification id. No `$queryRaw` was added.

**Tenancy hardening:** `createManyAndReturn` had been falling through the tenant extension unscoped since Phase 2. It's now injected, with a test.

**Residual:** the Socket.IO handshake isn't rate-limited. The HTTP throttler doesn't apply to WS upgrades, though each handshake costs one JWT verify and one indexed lookup. See Known Minor Issues.

## UI/UX Review

No screens in this phase; the frontend is still the Phase 1 skeleton. The client contract (namespace, event name, payload type, reconnect-on-expiry behaviour) is published in `packages/types` and `docs/08-API-CONTRACT.md` §4.10 for the portal and dashboard work in Phases 12 to 14.

## Bugs Found

1. **The outbox drain intermittently skipped just-committed rows.** It filtered `createdAt <= Date.now()`, comparing the DB clock with the Node clock, and the Postgres container ran a few ms ahead. Symptom: about 1 in 5 spec runs had several 5s timeouts, with `dispatchedAt` null and no jobs for the row (captured with temporary instrumentation). Root cause fixed: no age filter on the event-driven drain. A regression test stamps a row 5s in the future, and its mutation check fails exactly that test. Then 6/6 clean instrumented runs, plus both full-suite runs.
2. **Socket payload leak.** `toView` spread the row it was given, and the in-app worker's row included the recipient's email/phone, `dedupeKey`, and `hospitalId`. Caught by the payload-shape assertion while the tests were being written, before any commit. Fixed with an explicit field list.
3. **`BULL_BOARD_ENABLED=false` parsed as `true`.** With implicit conversion, `@Transform` receives the converted value. Caught by the env-validation e2e test; fixed by reading `obj[key]`.
4. **Shutdown ordering:** in-flight in-app jobs pushed to an already-closed Redis connection, an unhandled rejection that failed a suite. Nest's `dispose()` precedes `onApplicationShutdown`. Fixed by closing channel workers in `beforeApplicationShutdown`; the gateway also refuses pushes once shutdown starts, so a late job retries rather than being lost.
5. **Pre-existing (Phase 2):** the tenant extension didn't handle `createManyAndReturn`. Hardened, with a test.
6. **Pre-existing (Phases 5 and 8):** concurrent identical appointment transitions, or concurrent lab approvals, both "succeeded". Now conditional updates with a 409; the duplicate-confirmation test asserts exactly one 200.

## Fixes Applied

All six above were fixed at the root cause, each with a test that fails without the fix (mutation-checked for #1, #2, and #6). The pharmacy spec's low-stock channel assertion was updated deliberately to the brief's Email + In-app (D-032), not to make a failure pass.

## Regression Checks

The full pre-existing suite (198 tests) passed after every producer migration. The two changed behaviours are intentional and documented:
- low-stock and payment-received channels now match the brief;
- a concurrent duplicate appointment transition or lab approval now gets 409 instead of a silent double-apply.

Also re-checked:
- the auth OTP flows (via the capturing port);
- the low-stock latch once-per-crossing test;
- the expiry digest per-day idempotency;
- the billing receipt tests;
- the lab approval fan-out and reject-no-notify tests.

## Known Minor Issues

- **UNVERIFIED: live Resend and Twilio API calls.** `.env` has no Resend or Twilio credentials. Everything up to the provider network hop is verified, and the SDK clients load and construct in the Alpine image. To verify, set `RESEND_API_KEY` (plus `EMAIL_FROM` for a verified domain, or keep `onboarding@resend.dev`) and Twilio *test* credentials with `TWILIO_FROM_NUMBER=+15005550006`. Then confirm an appointment for a user with a verified phone and check `NotificationDeliveryLog` for SENT with a `providerMessageId`.
- **Phase 10's UNVERIFIED item is unchanged:** there are still no Stripe/Razorpay test keys (re-checked this session).
- The Socket.IO handshake isn't rate-limited (see Security Review).
- An SMS-only-channel failure during a Twilio outage longer than about 15s of retries (3 attempts at 5s/10s) is dead-lettered. There's no automatic re-drive; it can be retried manually from Bull Board.
- In-app pushes reach only currently connected sockets; offline clients rely on `/notifications/me` (by design, FR-NOTIF-003).

## Technical Debt

- The audit-log-outside-transaction debt from Phase 2 now covers the lab-approval and appointment-status transactions too (Phase 15).
- There's no dedicated unit test of the Resend/Twilio adapters' error classification (`isPermanentStatus`); it's exercised through fakes only. Add one in Phase 15.
- `ChannelDeliveryService` loads the notification with `TenantContext.bypass()` by id. That's correct for a system worker, but a future multi-region split would need the hospital id in the job data.

## Documentation Updated

- `docs/11-DECISIONS.md` D-032 (outbox and trigger interpretations), D-033 (providers, sandboxing, auth secrets), D-034 (serial e2e), plus forward pointers on D-020 and D-025.
- `docs/09-SECURITY.md` §11a: SEC-NOTIF-001..005 (new IDs).
- `docs/08-API-CONTRACT.md` §4.10.
- `docs/03-ARCHITECTURE.md` §7 (as-built) and §12 (queues).
- `docs/06-DATABASE-DESIGN.md` §3.5.
- `.env.example`.
- `CLAUDE.md`: 6 new conventions.
- This review.

## Final Gate

**PASS WITH DOCUMENTED MINOR ISSUES.**
- All of `FR-NOTIF-001..003` and `NFR-AVAIL-002/003` are implemented and verified end to end (e2e suite, mutation checks, live Docker checks including cross-instance Socket.IO fan-out).
- No critical or high-severity defect is open.
- The one UNVERIFIED item is the live Resend/Twilio network call (no credentials available), recorded above with exact verification steps.
