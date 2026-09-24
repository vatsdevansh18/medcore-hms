# Phase 10 Review — Billing & Payments

## Phase

Phase 10 of 17 (`docs/05-DEVELOPMENT-PLAN.md`). Depends on Phases 5, 7, 8, 9, all gated PASS.

## Objective

Deliver `FR-BILL-001..006`:
- invoices that accumulate consultation, lab, and pharmacy charges automatically;
- finalization with immutable line items and credit-only corrections;
- an invoice total that is always the server-computed sum of its lines, re-verified by the database;
- Stripe and Razorpay test-mode checkout, with payment state changed only by signature-verified webhooks or staff cash actions;
- idempotent webhook processing;
- full/partial payment status with a receipt notification.

Extra gates: the invoice-total-integrity test (mandatory scenario #6) and the webhook-signature-rejection test (mandatory scenario #8).

## Implemented

- **Schema** (migration `20260924120000_billing_integrity`):
  - `Invoice.appointmentId` is no longer unique (supplementary invoices, D-027);
  - new `Invoice.finalizedAt`, `InvoiceItem.createdAt`, `Payment.recordedBy`;
  - database enforcement of FR-BILL-002/003 (D-028): CHECK `lineTotal = quantity × unitPrice`, `quantity > 0`, `total = subtotal + tax − discount ≥ 0`, `Payment.amount > 0`; a deferred constraint trigger verifying `subtotal = SUM(lineTotal)` at commit; a BEFORE trigger making non-DRAFT line items immutable except for appended credits.
- **`BillingModule`** (`src/billing/`):
  - `ChargesService`: get-or-create the visit's DRAFT invoice under an Appointment row lock; server-computed line totals; recomputed invoice totals.
  - `InvoiceLedgerService`: payment status always derived from the sum of SUCCEEDED payments; `PAYMENT_RECEIVED` receipt notification.
  - `InvoicesService`/`InvoicesController`: `POST /invoices`, `GET /invoices` (work-queue list), `GET /invoices/:id`, `POST /invoices/:id/items` (manual ROOM/OTHER lines and credits), `PATCH /invoices/:id/finalize`.
  - `PaymentsService`: `POST /invoices/:id/cash-payment`, `POST /invoices/:id/checkout-session`, and webhook settlement.
  - `PaymentWebhookVerifier`: real SDK verification, `stripe.webhooks.constructEvent` / `Razorpay.validateWebhookSignature`.
  - `CheckoutClient`: Stripe Checkout Session / Razorpay order creation.
  - `PaymentWebhooksController`: `POST /payments/webhook/stripe|razorpay`, public but signature-authenticated.
- **Automatic charges (FR-BILL-001), each in the same transaction as the clinical write:**
  - encounter creation (`MedicalRecordsService.create`) → CONSULTATION at the doctor's fee;
  - lab order (`LabService.create`) → one LAB line per test at catalog price;
  - dispense (`DispensingService.dispense`) → one PHARMACY line per dispense record at the batch MRP.
- **Raw-body capture** for `/api/payments/webhook/*` in `configureApp` (`useBodyParser("json", { verify })`), so `main.ts` and every e2e spec get it (CLAUDE.md single-bootstrap rule).
- **Test-mode enforcement**: env validation refuses `STRIPE_SECRET_KEY`/`RAZORPAY_KEY_ID` values that aren't test-mode keys (SEC-PAY-004).
- **Log hygiene**: `Stripe-Signature`/`X-Razorpay-Signature` headers are redacted in request logs.
- **Dependencies**: `stripe@^22.6.2`, `razorpay@^2.9.8`, the official SDKs, needed because SEC-PAY-002 mandates "the provider's SDK-provided verification function." Both are CommonJS-loadable, so no Jest `transformIgnorePatterns` change was needed, and both were verified inside the Alpine container.
- **`packages/types`**: `PaymentProvider`, `NotificationType.PAYMENT_RECEIVED`, `ApiErrorCode.PAYMENT_PROVIDER_UNAVAILABLE`.

## Requirements Verified

| ID | Status | Notes |
| --- | --- | --- |
| `FR-BILL-001` | PASS | One visit produced CONSULTATION (500) + LAB (200) + PHARMACY (6 × 4.75) on one DRAFT invoice, each line's `sourceId` pointing at the appointment, lab order item, or dispense record. A charge after finalization opens a supplementary DRAFT and leaves the finalized invoice untouched. Three concurrent `POST /invoices` calls yield one draft |
| `FR-BILL-002` | PASS | Finalize is DRAFT-only (409 `INVOICE_LOCKED` again). A positive line on a finalized invoice → 409. A credit line → 201 with the total reduced. Over-credit below the amount paid → 422. Database-level update/delete of a finalized line → rejected ("immutable"). A fully credited invoice finalizes straight to PAID |
| `FR-BILL-003` | PASS | **Extra gate passed (scenario #6):** after each of 4 mixed-quantity/price/credit mutations, stored `lineTotal`s and `subtotal`/`total` equal the recomputed sum. Client-supplied `total`/`lineTotal`/`subtotal` → 400 with the total unchanged. **Database layer:** a wrong `total`, a consistent-but-wrong `subtotal`/`total`, a wrong `lineTotal`, and an item inserted without recompute are all rejected by Postgres |
| `FR-BILL-004` | PASS (live checkout call UNVERIFIED) | Payment state changes only via a signed webhook or staff cash. Checkout amount = server balance (asserted in the provider call: `amountMinor` = 37950 after a 120.50 cash part-payment). Checkout alone changes no invoice state. The real `stripe.checkout.sessions.create`/`razorpay.orders.create` calls weren't executed: no test keys exist here (D-030) |
| `FR-BILL-005` | PASS | Stripe: 3 sequential redeliveries, a different event type for the same session, and 4 truly concurrent deliveries → exactly one SUCCEEDED payment and one receipt. Razorpay `order.paid` after `payment.captured` → no-op. An expired-then-completed session can't be resurrected. A signed event for payment A under session B → not applied |
| `FR-BILL-006` | PASS | Partial cash → PARTIALLY_PAID, remainder → PAID, overpay → 422, pay-after-PAID → 409. One `PAYMENT_RECEIVED` notification per payment to the patient's portal user. Receipt returned (`paymentId` is the reference) |
| `SEC-PAY-001..004` | PASS | Scenario #8 **(extra gate):** a tampered signature, missing header, wrong secret, body altered after signing, and a replay older than the 300s tolerance → all `400 WEBHOOK_SIGNATURE_INVALID`, with the payment still PENDING and the invoice unchanged. Only ids/amounts persisted from payloads (card/customer email and phone asserted absent). Live-mode keys refuse to boot |

## Files/Modules Changed

- New: `apps/backend/src/billing/**` (module, services, controllers, 5 DTOs).
- Changed:
  - `prisma/schema.prisma`, plus new migration `20260924120000_billing_integrity`;
  - `src/app.module.ts`, `src/config/env.validation.ts`, `src/common/bootstrap/configure-app.ts`, `src/common/logging/logger.config.ts`;
  - `src/emr/emr.module.ts` + `medical-records.service.ts`, `src/lab/lab.module.ts` + `lab.service.ts`, `src/medicines/medicines.module.ts` + `dispensing.service.ts` (charge hooks);
  - `apps/backend/package.json` (stripe, razorpay), `pnpm-lock.yaml`;
  - `packages/types/src/enums.ts`, `api-envelope.ts`.
- Tests:
  - new `test/billing.e2e-spec.ts` (23 tests), `test/helpers/billing-cleanup.ts`, `test/helpers/payment-test-env.ts`;
  - teardown updated in `lab`, `medical-records`, `pharmacy`, `prescriptions` specs.

## Tests Executed

- Backend `tsc --noEmit` and ESLint (`--max-warnings=0`); frontend `tsc --noEmit` (shared types changed).
- Full e2e suite (all 12 specs).
- Shadow-DB `prisma migrate diff --from-migrations --to-schema-datamodel` → "No difference detected". The raw-SQL constraints and triggers don't cause drift.
- **Mutation checks** (billing spec re-run against each; `src/billing` restored byte-for-byte afterwards, verified with `diff -r`):

  | Deliberate bug | Tests failed |
  | --- | --- |
  | Stripe signature not verified | 1 |
  | `PENDING` guard removed from settlement | 4 |
  | App computes a wrong total, so the DB must catch it | 21 (every charge commit rejected by the trigger) |
  | Invoice lock removed from cash payments | 2 |
  | Appointment lock removed when opening a draft | 2 |
  | Patient ownership check removed from checkout | 1 |

- Docker: `docker compose build api` + `up -d api`.
  - All 9 billing routes are mapped.
  - **Inside the Alpine container**, `stripe` constructs and verifies a real signed event and rejects a wrong secret, and `Razorpay.validateWebhookSignature` accepts a valid HMAC and rejects a tampered body.
  - Live HTTP: webhooks with no secret configured → `400 WEBHOOK_SIGNATURE_INVALID` (fail closed, error logged); Hospital Admin `GET /invoices` 200 and `POST /invoices` 403.
  - After the redaction change: `Stripe-Signature` confirmed `[REDACTED]` in container logs.

## Test Results

- Typecheck (backend and frontend): **PASS**. Lint: **PASS**.
- Full e2e: **PASS**, 198/198 tests across 12/12 suites (175 pre-existing, 23 new). Re-run after the final code change (log redaction).
- Docker: **PASS**, as above.

## Security Review

- **RBAC (§3.8):**
  - Invoice create, item, finalize, and cash endpoints tested against Hospital Admin, Doctor, Nurse, Lab Technician, Pharmacist, and Patient → 403. Receptionist and Accountant are allowed.
  - Checkout: Patient only (Receptionist → 403).
  - View: Receptionist, Accountant, and Hospital Admin → 200; Doctor, Nurse, Lab Technician, and Pharmacist → 403; the patient's own → 200; another patient's → 404. The list endpoint is denied to Patient.
- **Tenancy:** another hospital's Receptionist gets 404 on view, item, finalize, cash, and `POST /invoices` (by appointment), and an empty list filtered by our appointment. Another hospital's Patient gets 404 on checkout. Every case asserts nothing was written. Webhook handling finds the payment as the system, then runs every write under that payment's own hospital context. All raw SQL (row locks) binds `hospitalId` explicitly.
- **Payment trust boundary:** no client-reachable path mutates payment or invoice status (there's no status field in any DTO; `status`/`amount`/`total` in bodies → 400). The webhook is `@Public()`, but the signature over raw bytes is checked first and fails closed when unconfigured. The replay window is bounded by Stripe's 300s tolerance; beyond it, replays are idempotent no-ops.
- **Data minimisation:** only identifiers and amounts are stored from provider payloads. Signature headers are redacted from logs. Payment responses never include `rawPayloadSanitized` or `providerSignatureVerified`.
- **Integrity under concurrency:** proven for cash double-collection, draft creation, and webhook double-apply, each backed by a lock-removal mutation.

## UI/UX Review

Not applicable: Phase 10 is backend-only, like every phase so far. `GET /invoices` filters and the `amountPaid`/`balanceDue` fields were added for the `04-UI-UX.md` §4 Receptionist/Accountant/Patient dashboard panels.

## Bugs Found

1. **`Prisma.Decimal.isPositive()` treats zero as positive** (decimal.js semantics). This was in this phase's own first cut: `InvoiceLedgerService.applyPaymentStatus` marked every freshly finalized invoice with no payments `PARTIALLY_PAID`, and the same helper misuse in `createCheckoutSession` would have allowed a zero-amount checkout. It was caught by the new e2e status assertions (4 failures) before anything was committed. Root cause: a library semantic, not a logic slip. Fixed everywhere (`.gt(0)`/`.lt(0)`) and recorded as a CLAUDE.md convention so it doesn't recur.
2. **Design gap in the Phase 2 schema, not a code defect:** `Invoice.appointmentId @unique` made FR-BILL-001's "accumulates as incurred" impossible once a visit's invoice had been finalized (e.g. pharmacy after paying for the consultation). Resolved via D-027 (supplementary invoices), with a schema change and migration.
3. **Spec gap:** FR-BILL-003 requires a database check/trigger, but none existed in any migration since Phase 2, despite `06-DATABASE-DESIGN.md` describing one. Implemented in this phase (D-028).

Two failures during development were test-authoring errors and are noted for honesty: `async` wrappers around supertest dropped `.expect()` chaining, and eagerly built supertest requests hit closed ephemeral ports. Both were fixed in the spec.

## Fixes Applied

- Bug 1: replaced all Decimal `isPositive`/`isNegative` uses in `src/billing` with explicit comparisons. The regression is covered by the finalize and cash status assertions.
- Bugs 2–3: migration `20260924120000_billing_integrity` plus `ChargesService` (D-027/D-028).

## Regression Checks

- The full suite ran green after the charge hooks were added to EMR, Lab, and Pharmacy (175/175, before the billing spec existed), confirming the hooks don't break existing clinical flows. Each of those specs' teardown now purges billing first. A direct DB count after the run confirmed zero leftover invoice, item, or payment rows.
- Re-run at the end: 198/198.
- The Prettier reformatting of unrelated code in `lab.service.ts`/`medical-records.service.ts` was reverted, and only the hook edits were re-applied, to keep the diff scoped.

## Known Minor Issues

- **UNVERIFIED:** the live calls to the Stripe/Razorpay test APIs that create a checkout (`CheckoutClient`) weren't executed, because no test keys are available. Needs `STRIPE_SECRET_KEY` (`sk_test_...`) / `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (+ webhook secrets) in `.env`, then a manual checkout with a documented test card.
- An abandoned Razorpay checkout stays `PENDING` (Razorpay has no expiry webhook); Stripe's are marked FAILED on `checkout.session.expired`.
- An online payment completed after the balance was already settled another way is recorded, and the invoice stays PAID. The overpayment needs a manual refund, and refunds are out of scope for v1 (D-029).
- A receipt is the payment record plus a `PAYMENT_RECEIVED` notification row. There's no downloadable receipt PDF yet (Phase 12 portal), and no `GET /notifications/me` yet (Phase 11).
- A patient without a portal account gets no receipt notification (the same Phase 4 limitation as lab results).

## Technical Debt

- `tax`/`discount` columns exist but no API sets them (always 0). Discounts are credit lines.
- The pre-existing audit-log-outside-transaction debt (PHASE-9-REVIEW) now applies to more interactive transactions: billing, EMR creation, lab order creation. It's still scheduled for Phase 15.
- `InsuranceClaim` remains data-model-only (D-011).
- There's no invoice cancellation endpoint (the `CANCELLED`/`REFUNDED` statuses are unused).

## Documentation Updated

- `docs/11-DECISIONS.md`: D-027 to D-031.
- `docs/08-API-CONTRACT.md`: §3 (`PAYMENT_PROVIDER_UNAVAILABLE`), §4.9 (full implemented table).
- `docs/06-DATABASE-DESIGN.md` §3.5 (relationship change, constraints, triggers, columns).
- `docs/03-ARCHITECTURE.md` §9 (payment flow as implemented).
- `CLAUDE.md`: 4 new conventions.
- `handoff.md`.

## Final Gate

**Phase 10 — Billing & Payments: PASS WITH DOCUMENTED MINOR ISSUES.**
- All of `FR-BILL-001..006` and `SEC-PAY-001..004` are implemented and verified, including both extra gates:
  - invoice-total integrity, verified at both the API and the database level;
  - webhook-signature rejection, verified across five attack variants plus replay.
- Idempotency and concurrency safety are proven by tests and by mutation.
- The one non-verified item is the live outbound checkout-creation call to the providers' test APIs, which can't run without test keys. It's explicitly marked UNVERIFIED rather than claimed, and everything downstream of it is verified.
- No known critical or high-severity defect remains open.
