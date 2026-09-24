# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions. Read it first, then verify it against the actual repository state: the repo is the source of truth for what's implemented; this file is the source of truth for session context only.

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable. Work follows a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules. Read before touching anything:**
1. **`CLAUDE.md`** (project root), every session. It points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in" and to the `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done. Its "Monorepo conventions" list encodes hard-won, real-bug lessons (**29 entries** as of this handoff; 6 added in Phase 11). Read all of them.
2. **`docs/12-QUALITY-PROTOCOL.md`**: the implement → verify → root-cause-fix → re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase can't be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user's explicit go-ahead ("START PHASE N").** This session the user said "Close Phase 10 open item then continue with Phase 11"; that was taken as the Phase 11 go-ahead. Phase 11 is complete and gated **PASS WITH DOCUMENTED MINOR ISSUES**. Don't start Phase 12 until the user says so.

Current objective as of this handoff: **wait for "START PHASE 12."** Per `docs/05-DEVELOPMENT-PLAN.md`, Phase 12 is the Patient Portal: patient-scoped views over appointments, records, prescriptions, lab reports, and invoices, plus self-service booking and payment (`FR-PORTAL-001..003`). Note: the frontend (`apps/frontend`) is still the Phase 1 skeleton; every phase so far has been backend-only. Re-read the actual doc section in full when authorized.

## Current State

**Twelve phases complete** (Phase 0 through Phase 11), each with a review at `docs/phase-reviews/PHASE-{0..11}-REVIEW.md`:
- Phases 0–9: PASS.
- Phase 10: PASS WITH DOCUMENTED MINOR ISSUES (live Stripe/Razorpay checkout creation UNVERIFIED; no test keys).
- Phase 11: PASS WITH DOCUMENTED MINOR ISSUES (live Resend/Twilio sends UNVERIFIED; no credentials).

**Phase 11 is NOT committed.** All Phase 11 work is in the working tree on `master`. HEAD is still `2a5d82f feat: Phase 10 — billing & payments`. The user hasn't asked for a commit; see Next Steps #1.

**Phase 10 open item: attempted, still blocked.** The user asked to close it first. `.env` still has empty `STRIPE_*`/`RAZORPAY_*` values (checked at the start and again near the end of the session). Provider accounts can't be created from here, so it stays UNVERIFIED. The user was asked to put test keys in `.env` themselves (not in chat).

Verified this session, all re-run after the last code change:
- Backend typecheck: **PASS**. Backend lint (`--max-warnings=0`): **PASS**. Frontend typecheck: **PASS**.
- Full e2e: **PASS**, 231/231 across 13/13 suites, **twice**, serially (about 39s): 198 pre-existing + 33 new in `notifications.e2e-spec.ts`. 0 leftover rows afterwards.
- 13 mutation checks on the notifications spec: all caught.
- Migration `20260925090000_notification_dispatch`: applied; shadow-DB `migrate diff` shows no difference.
- Docker: `docker compose build api` + `up -d api` **PASS**. Live checks against the container:
  - socket handshake rejected without a token; an authenticated socket connects;
  - **cross-instance** push via the Redis adapter (from a separate process in the container);
  - the outbox sweep delivered a SQL-inserted, unsignalled row within 30s;
  - `/notifications/me` and `PATCH …/read` work;
  - Bull Board returns 404 when disabled;
  - no JWT appears in the logs.

Docker stack is **currently running**: `postgres`, `redis`, `localstack`, `api` (Phase 11 image). `frontend`/`nginx` aren't started (the same host port-3000 conflict as before, not a project defect). Starting `api` hit a one-off "port 3001 not available" error that went away on retry (nothing was actually listening).

Seeded accounts are unchanged (password `Demo123!`): `superadmin@medcore.test`, `hospitaladmin@medcore-city.medcore.test` / `hospitaladmin@medcore-metro.medcore.test`, `dr.jeremy.keebler@medcore-city.medcore.test`, and 30 `*.patient.medcore.test` (e.g. `alda.smith-predovic.5@patient.medcore.test`). There's still no seeded Pharmacist, Receptionist, or Accountant; create them via `POST /users` as the Hospital Admin. No seeded user has a verified phone, so SMS deliveries are SKIPPED (`PHONE_NOT_VERIFIED`/`NO_PHONE`) for them.

### What Phase 11 delivered (details in `PHASE-11-REVIEW.md`, D-032/D-033/D-034)

- **Transactional outbox:**
  - `NotificationsService.record(tx, event)` writes `Notification` rows inside the triggering transaction, with channels from the trigger table (`src/notifications/notification-triggers.ts`, brief §7.8) and a unique `dedupeKey`.
  - `publish()` emits `notifications.committed` on `@nestjs/event-emitter`.
  - `NotificationDispatcher` drains undispatched rows into the `email`/`sms`/`in-app` BullMQ queues (job id `<notificationId>-<channel>`) and sets `dispatchedAt`.
  - The `notification-outbox` sweep every 30s recovers lost signals.
- **Triggers wired:**
  - appointment confirmed (patient; Email/SMS/In-app);
  - reminders 24h+1h (patient; Email/SMS);
  - emergency (doctor; In-app/SMS);
  - prescription issued = "ready at pharmacy" (patient; SMS/In-app);
  - lab result approved (doctor+patient; Email/In-app);
  - invoice finalized = "invoice generated" (patient; Email/In-app);
  - payment received (patient; Email/SMS);
  - low stock (Pharmacist+HA; Email/In-app);
  - expiry digest (Pharmacist+HA; Email/In-app).
- **Workers:**
  - one per channel, 3 attempts with exponential backoff;
  - the failed set is the dead-letter store;
  - `NotificationDeliveryLog` has one row per attempt: SENT, SKIPPED (new status: `PROVIDER_NOT_CONFIGURED`, `NO_PHONE`, `PHONE_NOT_VERIFIED`, `RECIPIENT_INACTIVE`), or FAILED;
  - permanent provider errors fail fast.
- **Providers:**
  - Resend and Twilio adapters (`src/common/messaging`), with a non-production sandbox redirect;
  - SMS only to verified phones;
  - minimal content for lab and prescription messages by email/SMS.
- **Auth secrets:** OTP and password-reset go via `MessagingOtpDelivery` (synchronous, never persisted or queued; the code is logged only outside production).
- **Socket.IO:** namespace `/notifications`, JWT handshake middleware, own room only, disconnected at token expiry, Redis adapter plus CORS via `ConfiguredIoAdapter` in `configureApp()`.
- **REST:** `GET /notifications/me` (in-app rows only, paginated, `unreadOnly`, `meta.unreadCount`) and `PATCH /notifications/:id/read` (owner only).
- **Bull Board:** `/api/admin/queues`. Off by default, refused in production, HTTP Basic when enabled.
- **Behaviour changes (intentional, documented):**
  - low-stock channels In-app → Email+In-app, and payment-received In-app+Email → Email+SMS (both now match the brief);
  - concurrent duplicate appointment transitions and lab approvals now get 409 (conditional updates);
  - the e2e suite now runs in one Jest worker.

### The UNVERIFIED items (why both gates are "with documented minor issues")

1. **Phase 11: live Resend/Twilio API calls.** Everything up to the network hop is verified (fakes replace only `EMAIL_SENDER`/`SMS_SENDER`), and the SDKs load in the Alpine image. To verify:
   - set `RESEND_API_KEY` (keep `EMAIL_FROM` as `onboarding@resend.dev` unless a domain is verified);
   - set Twilio **test** credentials with `TWILIO_FROM_NUMBER=+15005550006`;
   - give a test user a verified phone (`phoneVerifiedAt`);
   - confirm one of their appointments, and check `NotificationDeliveryLog` for SENT rows with a `providerMessageId`.
2. **Phase 10: live Stripe/Razorpay checkout creation.** Needs `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Then run a checkout end to end (e.g. `stripe listen --forward-to localhost:3001/api/payments/webhook/stripe`, card 4242 4242 4242 4242).

### Other known limitations

- **Phase 11:**
  - the Socket.IO handshake isn't rate-limited;
  - dead-lettered SMS/email jobs have no automatic re-drive (manual retry from Bull Board);
  - there's no unit test of the adapters' error classification.
- **Phase 10:**
  - an abandoned Razorpay checkout stays PENDING;
  - an overpayment needs a manual refund (refunds out of scope);
  - no receipt PDF (Phase 12);
  - `tax`/`discount` are always 0;
  - no invoice cancel endpoint.
- The audit-log-outside-transaction debt (Phase 2) now covers even more transactions; it's scheduled for Phase 15.

## Active Files

Relevant to Phase 12, or to touching Phase 11's surface:
- `docs/05-DEVELOPMENT-PLAN.md` (Phase 12), `docs/02-SRS.md` FR-PORTAL, `docs/07-RBAC-MATRIX.md` (Patient columns), `docs/08-API-CONTRACT.md`, `docs/04-UI-UX.md`: the portal is the first real frontend work.
- `src/notifications/notifications.service.ts`: `record`/`publish`/`findMine`/`markRead`/`toView`. Any new trigger goes through `record` + `publish` (CLAUDE.md).
- `src/notifications/notification-triggers.ts`: the only place channels are decided.
- `src/notifications/notification-dispatcher.service.ts`, `channel-delivery.service.ts`, `channel.processors.ts`, `notification-outbox.sweep.ts`, `realtime/notifications.gateway.ts`, `realtime/configured-io.adapter.ts`.
- `packages/types/src/notifications.ts`: the client contract (`NOTIFICATIONS_NAMESPACE`, `NotificationSocketEvent`, `NotificationView`) the portal will consume.
- `test/notifications.e2e-spec.ts` (fake senders, `eventually`/`settled` helpers) and `test/helpers/notification-test-env.ts`.

## Changes Made (this session)

1. **Phase 10 item:** checked `.env`; still no test keys, so it stays UNVERIFIED. A dated re-check note was added to `PHASE-10-REVIEW.md`.
2. **Schema/migration** `20260925090000_notification_dispatch`: `Notification.dispatchedAt`, `dedupeKey` (unique), two composite indexes; `NotificationStatus.SKIPPED`; `NotificationDeliveryLog.attempt`/`providerMessageId`; the log FK changed to `ON DELETE CASCADE`; existing rows backfilled as dispatched.
3. **New modules:** `NotificationsModule` (service, dispatcher, delivery, 3 processors, outbox scheduler and sweep, gateway, controller, DTO) and `MessagingModule` (global; Resend and Twilio senders). Plus `bull-board.ts` and `otp-delivery.ts` (`MessagingOtpDelivery`).
4. **Producers migrated / added:**
   - `appointments.service.ts`: confirm and emergency, both in transactions; the conditional status update.
   - `prescriptions.service.ts`: issue.
   - `lab.service.ts`: approval moved to an interactive transaction with a conditional update.
   - `stock.service.ts`: low stock.
   - `expiry-scan.service.ts`: digest.
   - `invoice-ledger.service.ts`: payment received and the new invoice-generated.
   - `invoices.service.ts`/`payments.service.ts`/`dispensing.service.ts`/`medicines.service.ts`: `publish()` after commit.
   - `appointment-reminder.processor.ts`: real reminder events.
5. **Deleted stubs:** `otp-delivery.stub.ts`, `reminder-delivery.stub.ts`, `expiry-digest-delivery.stub.ts`.
6. **Infrastructure:**
   - `configureApp()` sets the WebSocket adapter and mounts Bull Board;
   - `env.validation.ts` has the new optional vars, the Bull Board production refusal, and the correct boolean parse;
   - the tenant extension now covers `createManyAndReturn`;
   - `app.module.ts` registers `EventEmitterModule`, `MessagingModule`, and `NotificationsModule`.
7. **Dependencies:** `@nestjs/event-emitter@^2.1.1`, `@nestjs/websockets`/`@nestjs/platform-socket.io@^10.4.15`, `socket.io@^4.8.1`, `@socket.io/redis-adapter@^8.3.0`, `resend@^6.28.1`, `twilio@^6.1.1`, `@bull-board/api`/`express@^9.10.1`; dev `socket.io-client`.
8. **`packages/types`:** 5 new `NotificationType` values, `NotificationStatus.SKIPPED`, and `notifications.ts`.
9. **Tests:**
   - new `notifications.e2e-spec.ts` (33 tests) and `helpers/notification-test-env.ts`;
   - notification teardown added to 4 specs;
   - the pharmacy low-stock channel assertion updated to the brief;
   - the auth spec import path updated;
   - `jest-e2e.json` `maxWorkers: 1`.
10. **Docs:**
    - D-032/D-033/D-034, plus forward notes on D-020/D-025;
    - SEC-NOTIF-001..005 (`09-SECURITY.md` §11a);
    - API contract §4.10;
    - architecture §7/§12;
    - DB design §3.5;
    - `.env.example`;
    - CLAUDE.md (+6 conventions);
    - `PHASE-11-REVIEW.md`.
11. Removed 8 empty stray files created by shell parse failures (the recurring artifact pattern). `.claude-flow/` dirs (including a new `src/notifications/.claude-flow/`) are left untracked; **exclude them when staging**.

## Failed Attempts

- **Earlier sessions (still relevant):**
  - Decimal `isPositive()` treats 0 as positive; use `.gt(0)`.
  - Running Prettier on whole existing files reformats unrelated code; only format new files.
  - `async` wrappers around supertest lose `.expect()`.
  - Building supertest requests eagerly causes `ECONNREFUSED`.
- **Bash heredocs containing apostrophes** (e.g. "don't", "isn't") fail to parse ("unexpected EOF while looking for matching `''") and leave empty stray files named after code fragments. It happened again this session. **Use the Write tool for any file containing prose with apostrophes**, and check `git status` for stray empty files afterwards.
- **Python edit scripts:** `"\\n"` inside a heredoc'd Python string wrote a literal newline into a TS string (`.join("` + newline). Fixed with Edit. Prefer the Edit tool for escapes.
- **Running e2e specs in parallel** after Phase 11 made the notification assertions flaky (other specs' workers take the jobs). It was not a code bug; fixed by `maxWorkers: 1` (D-034). **Don't revert it.**
- **An intermittent drain miss** (about 1 in 5 runs, several 5s timeouts) was first suspected to be BullMQ worker latency. Instrumentation showed `dispatchedAt` null and no jobs, i.e. the drain skipped the row: the local-clock vs DB-clock `createdAt` filter. Fixed at the root, with a regression test. **Don't reintroduce a `createdAt <= now` filter on the event-driven drain.**
- **`docker compose exec … psql` via Node `execSync` on Windows** mangles `$POSTGRES_USER` quoting. Use `spawnSync` with an args array and the literal user (`medcore`).
- **Node scripts outside `apps/backend`** can't resolve its packages; set `NODE_PATH=apps/backend/node_modules`. Inside the container, copy a script file in (`docker cp`) rather than `node -e` with nested quotes.

## Next Steps

1. **Ask the user whether to commit Phase 11.** Suggested command, run from the repo root, excluding the untracked `.claude-flow/` dirs:
   `git add -A -- . ':!**/.claude-flow/**' && git commit -m "feat: Phase 11 — notifications & background jobs"`
   Check `git status` first for stray empty files.
2. **Wait for "START PHASE 12."**
3. Whenever the user provides credentials, close the UNVERIFIED items (Current State lists exact steps): Resend/Twilio (Phase 11) and Stripe/Razorpay (Phase 10). Update both reviews' gates to PASS if nothing else remains.
4. When Phase 12 starts:
   - it's the first real frontend phase (Next.js skeleton only so far);
   - consume `packages/types` notifications (the socket client with `auth: { token }` and reconnect-on-expiry, and `useRealtime`/`notificationStore` per the brief);
   - add the patient receipt PDF deferred from Phase 10;
   - re-read `docs/04-UI-UX.md` and the UI/UX checklist (§9).
5. Carried debt:
   - audit-log writes outside interactive transactions (Phase 15);
   - the missing decision entry for the appointment module's UTC simplification (see D-023);
   - rate-limiting the Socket.IO handshake;
   - unit tests for the provider error classification (Phase 15).

## Important Commands, Paths, and Gotchas

### Commands (all run from `apps/backend` unless noted)

```bash
# Typecheck / lint
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0
# Frontend typecheck (from apps/frontend) — run whenever packages/types changes
pnpm exec tsc --noEmit

# Full e2e suite (needs Postgres + Redis + LocalStack reachable). Runs serially (maxWorkers 1), ~40s.
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json
# ...or one file:
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json notifications.e2e-spec.ts
# The output is very long (request logs). Redirect to a file and grep for "✕|●|Tests:".
# Stop the api container first (`docker compose stop api`) so its workers don't take test jobs.

# Clear the auth rate limiter between repeated runs (spurious 429s otherwise):
docker exec medcore-hms-redis-1 redis-cli --scan --pattern "throttle:*" | xargs -r docker exec -i medcore-hms-redis-1 redis-cli DEL

# Queue inspection without Bull Board:
docker exec medcore-hms-redis-1 redis-cli ZCARD bull:sms:failed    # dead-lettered SMS jobs

# Docker (from repo root)
docker compose up -d postgres redis localstack
docker compose up -d api
docker compose build api frontend    # after editing packages/types or dependencies
docker compose logs api --tail 60

# API base URL: http://localhost:3001/api  ·  Socket.IO: http://localhost:3001/notifications (auth: { token })

# Prisma (from apps/backend)
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
pnpm exec dotenv -e ../../.env -- prisma migrate reset --force --skip-seed && pnpm exec dotenv -e ../../.env -- pnpm run db:seed
# Drift check for a hand-written migration (temp shadow DB):
#   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE medcore_shadow;"'
#   pnpm exec dotenv -e ../../.env -- prisma migrate diff --from-migrations prisma/migrations \
#     --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with /medcore_shadow>
#   ...then DROP DATABASE medcore_shadow
```

### Gotchas (cumulative; `CLAUDE.md` "Monorepo conventions" is the canonical list)

- `dotenv` isn't on PATH; always use `pnpm exec dotenv ...`. The backend dev script is `pnpm run dev`.
- Windows file locks: a running node process can lock the Prisma engine (`EPERM` on generate/migrate). Find it via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- After editing `packages/types/src/*`, run `pnpm --filter=@medcore/types run build`.
- Pure-ESM packages need a `transformIgnorePatterns` carve-out in `test/jest-e2e.json` (`@nestjs/bullmq` has one). The Phase 11 packages all load as CommonJS.
- `prisma migrate dev` can't prompt in this shell. Hand-write the migration, apply it with `migrate deploy`, and verify it with `migrate diff`.
- **Phase 10:**
  - invoice lines only via `ChargesService`;
  - `.gt(0)` for money;
  - `purgeBilling` in spec teardown;
  - env for a spec goes in a helper imported before `AppModule`.
- **Phase 11:**
  - notifications only via `record` (in the transaction) + `publish` (after commit);
  - never compare DB timestamps with the process clock for fresh rows;
  - `toView` field by field, never spread;
  - workers touching sockets close in `beforeApplicationShutdown`;
  - env booleans are parsed from `obj[key]`;
  - e2e runs serially;
  - specs override only `EMAIL_SENDER`/`SMS_SENDER`;
  - specs that trigger notifications delete them (`hospitalId in …`) before users/appointments in teardown (delivery logs cascade).

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md` (D-001 to D-034)
- Security IDs: `docs/09-SECURITY.md` (SEC-NOTIF-* added in §11a). RBAC: `docs/07-RBAC-MATRIX.md`. API index: `docs/08-API-CONTRACT.md`
- Backend: `apps/backend/src/` (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `medicines/`, `prescriptions/`, `lab/`, `billing/`, `notifications/`, `queue/`, `common/` incl. `common/messaging/`)
- Prisma: `apps/backend/prisma/`. e2e tests: `apps/backend/test/` (+ `test/helpers/`). Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | UNCOMMITTED | Phase 11 is in the working tree on `master`; HEAD is the Phase 10 commit. Stray files removed; `.claude-flow/` untracked and must be excluded when staging |
| Lint | PASS | Backend, zero warnings |
| Typecheck | PASS | Backend (incl. tests) and frontend |
| Unit tests | NOT APPLICABLE | No dedicated unit suite project-wide yet |
| Integration/e2e tests | PASS | 231/231, 13/13 suites, twice, serially; 0 leftover rows; 13/13 mutation checks caught |
| Component tests | NOT APPLICABLE | No frontend work |
| Build | PASS | `docker compose build api`; routes mapped; sweep scheduled |
| DB migrations | PASS | Applied; shadow-DB diff shows no drift |
| Docker | PASS | In-container SDK load; live socket auth; cross-instance Redis-adapter push; live sweep recovery; history API; Bull Board 404 when disabled; no JWTs in the logs |
| Security review | PASS | Socket handshake auth (5 rejection variants); room isolation across users and tenants; ownership 404s; payload minimisation; clinical-content minimisation; verified-phone SMS gate; Bull Board gating |
| Live Resend/Twilio sends | UNVERIFIED | No credentials (Phase 11) |
| Live Stripe/Razorpay checkout | UNVERIFIED | No test keys (Phase 10, re-checked this session) |

## Current Phase Gate

**Phase 11 — Notifications & Background Jobs: PASS WITH DOCUMENTED MINOR ISSUES.** Full detail in `docs/phase-reviews/PHASE-11-REVIEW.md`. `FR-NOTIF-001..003` and `NFR-AVAIL-002/003` are verified end to end. No critical or high-severity defect is open. The live Resend/Twilio network calls are UNVERIFIED (no credentials). Phase 10 remains PASS WITH DOCUMENTED MINOR ISSUES (live checkout UNVERIFIED).

## Important Decisions / Context

- **D-032:**
  - The notification outbox is the `Notification` table itself (`dispatchedAt`, `dedupeKey`), written in the triggering transaction.
  - The event bus only signals "drain now"; the 30s sweep is the crash backstop.
  - The trigger table mirrors brief §7.8. Interpretations: prescription ready = issue; invoice generated = finalize; reminders at 24h and 1h; expiry digest Email+In-app.
  - In-app history shows IN_APP rows only.
- **D-033:**
  - Resend/Twilio adapters, all optional; unconfigured → SKIPPED.
  - Non-production email is redirected to a sandbox.
  - SMS only to verified phones.
  - OTP and reset secrets are sent synchronously and never persisted or queued.
- **D-034:** the e2e suite runs in one Jest worker.
- **Earlier decisions still load-bearing:** D-022 (low-stock latch, now with a crossing-time dedupe key), D-027 to D-031 (billing), D-023 (hospital-local dates), D-024 (pharmacy RBAC).
- **Known architectural debt (Phase 2):** the audit-log extension writes through the root client outside interactive transactions. Fix in Phase 15.
