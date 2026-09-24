# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions. Read it first, then verify it against the actual repository state: the repo is the source of truth for what's implemented; this file is the source of truth for session context only.

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable. Work follows a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules. Read before touching anything:**
1. **`CLAUDE.md`** (project root), every session. It points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in" and to the `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done. Its "Monorepo conventions" list encodes hard-won, real-bug lessons (**23 entries** as of this handoff; 4 added in Phase 10). Read all of them.
2. **`docs/12-QUALITY-PROTOCOL.md`**: the implement → verify → root-cause-fix → re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase can't be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user explicitly typing "START PHASE N."** Phase 10 was completed in this session and gated **PASS WITH DOCUMENTED MINOR ISSUES**. Don't start Phase 11 until the user says so.

Current objective as of this handoff: **wait for "START PHASE 11."** Per `docs/05-DEVELOPMENT-PLAN.md`, Phase 11 is Notifications & Background Jobs: event bus, per-channel queues/workers, Socket.IO gateway with Redis adapter, delivery logging, Bull Board dev-only (`FR-NOTIF-001..003`, `NFR-AVAIL-002/003`). Re-read the actual doc section in full when authorized.

## Current State

**Eleven phases complete** (Phase 0 through Phase 10), each with a review at `docs/phase-reviews/PHASE-{0..10}-REVIEW.md`. Phases 0–9 are PASS; Phase 10 is PASS WITH DOCUMENTED MINOR ISSUES (one UNVERIFIED item, below). This session's plan is to commit Phase 10 immediately after writing this handoff, so `git log` should show `feat: Phase 10 — billing & payments` at HEAD. If it doesn't, check `git status` first.

Verified this session, all re-run after the last code change:
- Backend typecheck: **PASS**. Backend lint (`--max-warnings=0`): **PASS**. Frontend typecheck: **PASS**.
- Full e2e: **PASS**, 198/198 tests across 12/12 suites (175 pre-existing, 23 new `billing.e2e-spec.ts`). A direct DB count afterwards showed 0 leftover invoice, item, or payment rows.
- `docker compose build api` + `up -d api`: **PASS**. The 9 billing routes are mapped. Stripe and Razorpay SDK signature verification were run inside the Alpine container. Webhooks fail closed live (400) with no secrets configured. `Stripe-Signature` was confirmed redacted in container logs.
- Migrations: **PASS**. `20260924120000_billing_integrity` is applied (the dev DB was reset and reseeded this session after adding columns to the not-yet-committed migration). The shadow-DB `migrate diff` shows no drift.

Docker stack is **currently running**: `postgres`, `redis`, `localstack`, and `api` (Phase 10 image). `frontend`/`nginx` aren't started (the same host port-3000 conflict as before, not a project defect). Docker Desktop was already running this session; if the machine rebooted it may need `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` again.

Seeded accounts are unchanged (password `Demo123!`): `superadmin@medcore.test`, `hospitaladmin@medcore-city.medcore.test` / `hospitaladmin@medcore-metro.medcore.test`, `dr.jeremy.keebler@medcore-city.medcore.test`, and 30 `*.patient.medcore.test`. There's still no seeded Pharmacist, Receptionist, or Accountant: create them via `POST /users` as the Hospital Admin. The seed has no invoices, since it creates no encounters.

### What Phase 10 actually delivered

`FR-BILL-001..006` + `SEC-PAY-001..004` in `apps/backend/src/billing/`:
- **Automatic charges.** Encounter → consultation fee; lab order → test price; dispense → quantity × batch MRP. Each is written in the same transaction as the clinical write via `ChargesService`, onto the visit's DRAFT invoice, or a new supplementary DRAFT if the visit's invoice is already finalized (D-027, which dropped `Invoice.appointmentId @unique`).
- **Invoice lifecycle.** Manual ROOM/OTHER lines and credit lines; finalize (lines immutable afterwards, corrections only by credit).
- **Database-enforced total integrity** (CHECKs, a deferred subtotal trigger, an immutability trigger; D-028).
- **Payments.** Cash payments (partial/full, never over the balance); patient online checkout (a PENDING Payment is created first, then the provider call); Stripe and Razorpay webhooks verified with the real SDKs over the raw body, settled idempotently via a conditional `PENDING→SUCCEEDED/FAILED` update under the invoice lock (D-029). Invoice status is always derived from payments. A `PAYMENT_RECEIVED` notification row goes to the patient.
- **Both extra gates pass:** invoice-total integrity (API and DB level) and webhook-signature rejection (5 attack variants plus replay).
- **Six mutation checks** (skipping signature verification, removing the idempotency guard, a wrong app-computed total, removing each of the three locks/ownership checks) were each caught.

### The one UNVERIFIED item (why the gate is "with documented minor issues")

**The live outbound calls that create a checkout at the providers** (`CheckoutClient`: `stripe.checkout.sessions.create`, `razorpay.orders.create`) **were never executed.** `.env` has no Stripe/Razorpay test keys, and the e2e suite replaces only this network hop. Everything downstream (PENDING payment, amount, signed-webhook settlement, idempotency) is verified. To verify: put test-mode keys in `.env` (`STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`). Env validation refuses live keys. Then run a checkout end to end, e.g. with `stripe listen --forward-to localhost:3001/api/payments/webhook/stripe` and test card 4242 4242 4242 4242.

### Other known limitations (all in `PHASE-10-REVIEW.md`)

- An abandoned Razorpay checkout stays PENDING (Razorpay has no expiry webhook).
- An overpayment (online payment after cash already settled the invoice) is recorded and needs a manual refund; refunds are out of scope.
- There's no receipt PDF (Phase 12) and no `GET /notifications/me` (Phase 11).
- `tax`/`discount` are always 0.
- There's no invoice cancel endpoint.
- The pre-existing audit-log-outside-transaction debt (Phase 2) now covers more transactions; it's scheduled for Phase 15.

## Active Files

Relevant to Phase 11, or to touching Phase 10's surface:
- `docs/05-DEVELOPMENT-PLAN.md` Phase 11, `docs/12-QUALITY-PROTOCOL.md`, `docs/03-ARCHITECTURE.md` §7 (notifications) and §12 (queues), `docs/02-SRS.md` FR-NOTIF, `docs/08-API-CONTRACT.md` §4.10.
- **The four `Notification`-row producers Phase 11 must migrate onto the real event bus/dispatcher:** `src/lab/lab.service.ts` (`notifyResultApproved`), `src/medicines/stock.service.ts` (`notifyLowStock`), `src/medicines/expiry-scan.service.ts` (digest plus `ExpiryDigestDeliveryStub`), and `src/billing/invoice-ledger.service.ts` (`notifyPaymentReceived`). Also the older stubs `src/queue/reminder-delivery.stub.ts` and the auth OTP stub. See D-020/D-025/D-030.
- `src/billing/charges.service.ts`: the only allowed path for invoice lines (CLAUDE.md), and the lock order.
- `src/billing/payments/*`: webhook verification (`payment-webhook-verifier.ts`), checkout (`checkout-client.ts`), settlement (`payments.service.ts`).
- `test/helpers/billing-cleanup.ts` (`purgeBilling`) and `test/helpers/payment-test-env.ts`: needed by any new spec that creates encounters, lab orders, or dispenses, or that needs env set before `AppModule` loads.

## Changes Made (this session)

1. **Schema/migration** `20260924120000_billing_integrity`:
   - dropped `Invoice_appointmentId_key` and added an index;
   - added `Invoice.finalizedAt`, `InvoiceItem.createdAt`, `Payment.recordedBy`;
   - raw-SQL CHECK constraints, the deferred `medcore_verify_invoice_subtotal` constraint triggers, and the `medcore_guard_invoice_item` immutability trigger.
2. **`BillingModule`** (new): `ChargesService`, `InvoiceLedgerService`, `InvoicesService`/`InvoicesController`, `PaymentsService`, `PaymentWebhookVerifier`, `CheckoutClient`, `PaymentWebhooksController`, 5 DTOs.
3. **Charge hooks** in `MedicalRecordsService.create`, `LabService.create`, `DispensingService.dispense` (each now an interactive `$transaction` taking the Appointment lock), plus `BillingModule` imported into the EMR, Lab, and Medicines modules.
4. **`configureApp`**: raw-body capture for `/api/payments/webhook/*` via `useBodyParser("json", { verify })`.
5. **`env.validation.ts`**: optional payment keys, with live-mode keys rejected at boot.
6. **`logger.config.ts`**: webhook signature headers redacted.
7. **Dependencies**: `stripe@^22.6.2`, `razorpay@^2.9.8`.
8. **`packages/types`**: `PaymentProvider`, `NotificationType.PAYMENT_RECEIVED`, `ApiErrorCode.PAYMENT_PROVIDER_UNAVAILABLE`.
9. **Tests**: `test/billing.e2e-spec.ts` (23), `test/helpers/billing-cleanup.ts`, `test/helpers/payment-test-env.ts`; `purgeBilling` added to the lab, medical-records, pharmacy, and prescriptions spec teardowns.
10. **Docs**: D-027 to D-031; API contract §3/§4.9; DB design §3.5; architecture §9; CLAUDE.md (+4 conventions); `PHASE-10-REVIEW.md`.
11. Removed the stray empty file `apps/backend/a.id` (the same recurring artifact pattern). `.claude-flow/` dirs were left untracked.

## Failed Attempts

- **Decimal `isPositive()` bug** (my own first cut): decimal.js treats 0 as positive, so every unpaid finalized invoice became `PARTIALLY_PAID`. Caught by the e2e tests and fixed with `.gt(0)`/`.lt(0)`. Now a CLAUDE.md convention. **Don't use `isPositive`/`isNegative` on money.**
- **Running Prettier on whole existing files** (`lab.service.ts`, `medical-records.service.ts`) reformatted unrelated code (those files aren't Prettier-clean). Reverted with `git checkout --` and the edits re-applied by script. **Run Prettier only on new files.**
- **Test-helper mistakes:** `async` wrappers around supertest requests lose `.expect()` (return the request itself, not a Promise). Building several supertest requests up front before awaiting them causes `ECONNREFUSED`, because each binds its own ephemeral server; build them lazily (thunks).
- Bash-tool heredocs with apostrophes still intermittently fail to parse (seen in Phase 9). Used the Write tool plus Python edit scripts instead.

## Next Steps

1. **Wait for "START PHASE 11."**
2. Optionally, whenever the user can provide Stripe/Razorpay **test** keys: run one real checkout per provider end to end and update `PHASE-10-REVIEW.md` (UNVERIFIED → verified, and the gate status to PASS if nothing else remains).
3. When Phase 11 is authorized:
   - Read its scope.
   - Design the event bus and `NotificationDispatcher` so the four existing `Notification`-row producers (Active Files) emit events instead of writing rows directly, replace the email/SMS stubs with real (test-mode) providers, and add `GET /notifications/me` + `PATCH /notifications/:id/read` + the Socket.IO gateway.
   - Keep each producer's current idempotency guarantees (the low-stock latch, per-day digest, one receipt per settled payment) intact through the migration. Regression-test them.
4. Same phase discipline: implement → checks → adversarial/RBAC/tenancy tests → mutation-check the key tests → Docker in-container verification of any new dependency (Socket.IO Redis adapter, email/SMS SDKs) → review → docs → commit → stop.
5. Carried debt: the audit-log extension writing outside interactive transactions (Phase 15); the missing decision entry for the appointment module's UTC simplification (see D-023).

## Important Commands, Paths, and Gotchas

### Commands (all run from `apps/backend` unless noted)

```bash
# Typecheck / lint
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0
# Frontend typecheck (from apps/frontend) — run whenever packages/types changes
pnpm exec tsc --noEmit

# Full e2e suite (needs Postgres + Redis + LocalStack reachable)
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json
# ...or one file:
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json billing.e2e-spec.ts
# The output is very long (request logs). Redirect to a file and grep for "✕|●|Tests:".

# Clear the auth rate limiter between repeated runs (spurious 429s otherwise):
docker exec medcore-hms-redis-1 redis-cli --scan --pattern "throttle:*" | xargs -r docker exec -i medcore-hms-redis-1 redis-cli DEL

# Docker (from repo root)
docker compose up -d postgres redis localstack
docker compose up -d api
docker compose build api frontend    # after editing packages/types or apps/backend src
docker compose logs api --tail 60
docker exec medcore-hms-api-1 sh -c "cd /workspace/apps/backend && node -e \"...\""   # in-container checks

# API base URL: http://localhost:3001/api  (API_PORT=3001)

# Prisma (from apps/backend)
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
pnpm exec dotenv -e ../../.env -- prisma migrate reset --force --skip-seed && pnpm exec dotenv -e ../../.env -- pnpm run db:seed
# Drift check for a hand-written migration (temp shadow DB):
#   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE medcore_shadow;"'
#   pnpm exec dotenv -e ../../.env -- prisma migrate diff --from-migrations prisma/migrations \
#     --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with /medcore_shadow>
#   ...then DROP DATABASE medcore_shadow

# Quick billing residue check after tests:
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d medcore_hms -tAc "SELECT count(*) FROM \"Invoice\";"'
```

### Gotchas (cumulative; `CLAUDE.md` "Monorepo conventions" is the canonical list)

- `dotenv` isn't on PATH; always use `pnpm exec dotenv ...`. The backend dev script is `pnpm run dev`.
- Windows file locks: a running node process can lock the Prisma engine (`EPERM` on generate/migrate). Find it via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- After editing `packages/types/src/*`, run `pnpm --filter=@medcore/types run build`.
- Pure-ESM npm packages need a `transformIgnorePatterns` carve-out in `test/jest-e2e.json`. (`stripe`/`razorpay` load as CommonJS; no carve-out was needed.)
- Verify new native or binary dependencies inside the Alpine container, not just via a successful build.
- `prisma migrate dev` can't prompt in this shell. Hand-write the migration, apply it with `migrate deploy`, and verify it with `migrate diff`.
- S3 pre-signed uploads need `requestChecksumCalculation: "WHEN_REQUIRED"`; EMR/lab-report specs need LocalStack running.
- `$queryRaw` bypasses tenant scoping; bind `hospitalId` explicitly.
- Pharmacy stock writes use `lockMedicines` + `evaluateLowStock`.
- **New in Phase 10:**
  - Invoice lines only via `ChargesService`.
  - Money sign checks use `.gt(0)`/`.lt(0)`, never `isPositive`.
  - Specs that create clinical charges call `purgeBilling` before deleting appointments.
  - Env needed by a spec goes in a helper imported before `AppModule`.
  - The e2e suite replaces only `CheckoutClient` via `overrideProvider`; never replace `PaymentWebhookVerifier`.

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md` (D-001 to D-031)
- RBAC: `docs/07-RBAC-MATRIX.md`. API index: `docs/08-API-CONTRACT.md`
- Backend: `apps/backend/src/` (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `medicines/` (pharmacy), `prescriptions/`, `lab/`, `billing/`, `queue/`, `common/`)
- Prisma: `apps/backend/prisma/`. e2e tests: `apps/backend/test/` (+ `test/helpers/`). Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | PASS | Phase 10 changes ready to commit; stray empty file removed; `.claude-flow/` untracked and never staged |
| Lint | PASS | Backend, zero warnings |
| Typecheck | PASS | Backend and frontend |
| Unit tests | NOT APPLICABLE | No dedicated unit suite project-wide yet |
| Integration/e2e tests | PASS | 198/198, 12/12 suites, re-run after the last change; 0 residue rows |
| Component tests | NOT APPLICABLE | No frontend work |
| Build | PASS | `docker compose build api`; routes mapped; container healthy |
| DB migrations | PASS | Applied (after reset + reseed); shadow-DB diff shows no drift; the raw-SQL triggers and CHECKs proven to fire by e2e tests |
| Docker | PASS | In-container SDK signature verification; live fail-closed webhooks; live RBAC; log redaction confirmed |
| Security review | PASS | RBAC for every §3.8 cell; tenancy in both directions; webhook trust boundary (5 signature attacks plus replay); idempotency including concurrent duplicates; data minimisation; test-mode key enforcement |
| Live provider checkout | UNVERIFIED | No Stripe/Razorpay test keys available; see "The one UNVERIFIED item" |

## Current Phase Gate

**Phase 10 — Billing & Payments: PASS WITH DOCUMENTED MINOR ISSUES.** Full detail in `docs/phase-reviews/PHASE-10-REVIEW.md`. All of `FR-BILL-001..006` and `SEC-PAY-001..004` are verified, including both extra gates. The live checkout-creation call to the provider test APIs is explicitly UNVERIFIED (no keys). No critical or high-severity defect is open.

## Important Decisions / Context

- **D-027**: supplementary invoices. `Invoice.appointmentId` isn't unique any more; "one DRAFT per visit" is enforced under an Appointment row lock.
- **D-028**: the DB enforces line arithmetic, total = subtotal + tax − discount, subtotal = sum of lines (deferred trigger), and immutability of finalized lines except appended credits.
- **D-029**:
  - A PENDING payment is created before the provider call, with our paymentId in the provider metadata.
  - `providerEventId` holds the checkout reference (session/order id).
  - Settlement is a conditional PENDING transition under the invoice lock; duplicates and unmatched events get 200 no-op.
  - Invoice status is derived.
  - Client-supplied totals are rejected (400).
  - Only ids and amounts are kept from payloads.
- **D-030**: test-mode keys are enforced by env validation. An unconfigured provider → checkout 503 and webhook fail-closed 400. Only `CheckoutClient` is replaced in tests. Receipt = payment record plus a notification row.
- **D-031**: billing RBAC interpretation (Hospital Admin read-only; manual lines ROOM/OTHER only), plus the added `GET /invoices` list.
- Earlier decisions still load-bearing: D-020/D-025 (notification rows now, dispatch in Phase 11), D-022 (low-stock latch), D-023 (hospital-local dates), D-024 (pharmacy RBAC).
- **Known architectural debt (Phase 2):** the audit-log extension writes through the root client outside interactive transactions. Phase 10 increased how many flows use interactive transactions (EMR create, lab order, dispense, all billing writes). Fix in Phase 15.
