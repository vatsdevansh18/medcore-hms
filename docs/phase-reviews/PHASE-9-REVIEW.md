# Phase 9 Review — Pharmacy

## Phase

Phase 9 of 17 (`docs/05-DEVELOPMENT-PLAN.md`). Depends on Phase 7 (Prescriptions), which was gated PASS.

## Objective

Deliver `FR-PHARM-001..005`:
- batch-level medicine inventory (batch number, manufacturing date, expiry date, quantity on hand, unit cost, MRP);
- dispensing against a prescription that always consumes the earliest-expiring eligible batch first (FEFO, D-004);
- automatic quarantine of expired batches by a scheduled job, with any attempt to dispense expired, quarantined, or exhausted stock rejected with a validation error rather than silently falling back;
- a low-stock alert to Pharmacists and the Hospital Admin when available stock falls below the reorder level;
- a nightly digest of batches expiring within 30 days.

Extra gate: the expired-batch dispensing rejection test must pass (`docs/10-TESTING-STRATEGY.md` §3 mandatory scenario #5).

## Implemented

- **Catalog and batch management** on the existing `medicines/` module (D-017): `POST /medicines`, `PATCH /medicines/:id`, `GET /medicines/:id/batches` (FEFO order), `POST /medicines/:id/batches`. `GET /medicines` and `GET /medicines/:id` now include a live `availableQuantity`. Batch receipt rejects:
  - already-expired stock (`422 MEDICINE_EXPIRED`);
  - future manufacturing dates, and expiry on or before manufacturing (`400`);
  - impossible calendar dates (`strict` ISO validation) (`400`);
  - duplicate batch numbers (`409`).
- **Dispensing**, `POST /prescriptions/:id/dispense` (`DispensingController`/`DispensingService`, D-024):
  - Body is `{items:[{prescriptionItemId, quantity, batchId?}]}`; partial dispensing is supported.
  - FEFO allocation splits one line across batches when needed.
  - "Eligible" means `ACTIVE`, not past expiry in the hospital's local calendar (D-023), and with stock left. An expired batch the nightly scan hasn't quarantined yet is still never selected.
  - Validation and allocation run before any write, inside one transaction, so a failure writes nothing.
  - Concurrency: the prescription row and the medicine rows are locked (`SELECT ... FOR UPDATE`, in a fixed order) so concurrent requests can neither oversell a batch nor over-dispense a prescription.
  - Status moves to `PARTIALLY_DISPENSED` or `DISPENSED`. `CANCELLED` (including superseded) and `DISPENSED` prescriptions are refused with `409`.
  - Every `DispenseRecord` stores the acting pharmacist.
  - An optional `batchId` is a physical-pick check: it must be the FEFO batch, and is never an override.
- **Low-stock alerts** (`StockService`, D-022):
  - A new `Medicine.lowStockAlertedAt` latch (migration `20260924090000_add_medicine_low_stock_latch`) makes the alert fire exactly once per crossing of the reorder level.
  - It's evaluated on every write that changes stock or the threshold: receipt, dispense, reorder-level edit, and expiry quarantine.
  - It creates one `IN_APP` `Notification` row per active Pharmacist and Hospital Admin.
  - `GET /medicines/low-stock` is a pure live read and never touches the latch.
- **Nightly expiry scan** (`medicine-expiry-scan` BullMQ queue; `MedicineExpiryScanScheduler` registers `30 0 * * *` UTC idempotently at boot; `MedicineExpiryScanProcessor` → `ExpiryScanService`):
  - Runs each hospital under its own TenantContext with a system actor.
  - Quarantines expired `ACTIVE` batches under the medicine row lock, with one audit row per batch.
  - Re-evaluates low stock after quarantining.
  - Writes one expiry-digest `Notification` (`EMAIL` + `IN_APP`) per recipient per hospital-local day, with the date as the idempotency key.
  - Sends the email through `ExpiryDigestDeliveryStub` until Phase 11 (D-025).
  - A failure in one hospital doesn't stop the others, but the run still fails so BullMQ retries it.
- **`GET /medicines/expiring?days=`**: the on-demand view of the digest's window, for the Pharmacist dashboard.
- **`packages/types`**: `NotificationType` (as-const), and `ApiErrorCode.INSUFFICIENT_STOCK`. `LabService` now uses `NotificationType.LAB_RESULT_APPROVED` instead of a string literal.
- **Pre-existing gap fixed at the source**: `Hospital.timezone` is now validated as a real IANA zone (`IsIanaTimezone`). See Bugs Found.

## Requirements Verified

| ID | Status | Notes |
| --- | --- | --- |
| `FR-PHARM-001` | PASS | Every batch field is persisted and read back, including `Decimal` cost/MRP and `DATE` columns. Batch validation negative-tested (10 invalid payloads plus the expired-receipt 422). Catalog create/update and all RBAC/tenancy boundaries tested |
| `FR-PHARM-002` | PASS | FEFO verified with batches received in non-expiry order (late, early, middle): consumed early, then early+middle split, never late. Multi-medicine requests, per-line atomicity, and the explicit-`batchId` FEFO check all tested |
| `FR-PHARM-003` | PASS | **Extra gate passed:** only-expired stock → `422 MEDICINE_EXPIRED`, with no `DispenseRecord`, stock unchanged, and the prescription still `ISSUED`/0 dispensed. Explicitly chosen expired or quarantined batch → 422 even when valid stock exists (no fallback). Exhausted → `422 INSUFFICIENT_STOCK`. The scan quarantines only expired `ACTIVE` batches, leaves `DEPLETED` alone, is idempotent on re-run, and ran for real in the Docker container through the BullMQ worker |
| `FR-PHARM-004` | PASS | Fires once on crossing (12 → 8 with level 10), to exactly {Hospital Admin, both Pharmacists}; the Doctor gets nothing. No new alert on a further drop or three repeated reads. Re-arms after restock and fires again on the next crossing. A reorder-level raise counts as a crossing; an unrelated edit doesn't. Quarantine-induced crossings alert. Expired stock is excluded from the figure |
| `FR-PHARM-005` | PASS (scoped, D-025) | 30-day window, recipients, digest content, per-day idempotency, and `EMAIL`+`IN_APP` rows are all real and tested. The SMTP send is the disclosed dev stub until Phase 11, and was never claimed as built |

## Files/Modules Changed

- `apps/backend/prisma/schema.prisma` (`Medicine.lowStockAlertedAt`), new migration `20260924090000_add_medicine_low_stock_latch` (hand-written, then verified with `prisma migrate diff --from-migrations --to-schema-datamodel` against a shadow DB: "No difference detected").
- `apps/backend/src/medicines/`:
  - `medicines.controller.ts`, `medicines.service.ts`, `medicines.module.ts` (extended);
  - new `dispensing.controller.ts`, `dispensing.service.ts`, `stock.service.ts`, `expiry-scan.service.ts`, `expiry-digest-delivery.stub.ts`, `pharmacy-date.util.ts`;
  - new DTOs `create-medicine`, `update-medicine`, `receive-batch`, `dispense`, `find-expiring-query`.
- `apps/backend/src/queue/`: `queue.module.ts`, `queue.constants.ts`, new `medicine-expiry-scan.processor.ts` and `medicine-expiry-scan.scheduler.ts`.
- `apps/backend/src/common/validation/is-iana-timezone.decorator.ts` (new); `src/hospitals/dto/create-hospital.dto.ts` and `update-hospital.dto.ts`.
- `apps/backend/src/lab/lab.service.ts` (uses `NotificationType` only).
- `packages/types/src/enums.ts`, `api-envelope.ts`.
- Tests: new `apps/backend/test/pharmacy.e2e-spec.ts` (34 tests), plus a regression test in `test/directory.e2e-spec.ts`.

## Tests Executed

- `pnpm exec tsc --noEmit -p tsconfig.eslint.json` and `pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` (backend).
- The full e2e suite, `pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json`.
- **Mutation checks** to prove the new tests actually detect defects. Each mutation was applied temporarily and the pharmacy spec re-run; all were restored byte-for-byte afterwards:
  1. expiry date ignored in batch eligibility → 2 tests failed;
  2. prescription `FOR UPDATE` lock removed → the concurrent same-prescription test failed;
  3. medicine `FOR UPDATE` lock removed → the concurrent oversell test failed;
  4. latch condition removed (alert on every evaluation) → 2 tests failed.
- `docker compose build api`, then `up -d api`. In the container:
  - route mapping and scheduler registration confirmed in the logs;
  - live HTTP smoke tests as the seeded Hospital Admin: `GET /medicines/low-stock` 200, `GET /medicines/expiring` 200 with seeded near-expiry batches, `POST /medicines` 403, `GET /medicines` returns `availableQuantity`;
  - a one-off `medicine-expiry-scan` job enqueued and processed end to end by the container's own BullMQ worker (8 hospitals scanned; digests written for both seeded hospitals; stub log line emitted).

## Test Results

- Typecheck: **PASS**. Lint: **PASS** (zero warnings).
- Full e2e suite: **PASS**, 175/175 tests across 11/11 suites (140 pre-existing, 34 new pharmacy, 1 new timezone regression). The pharmacy spec also passed repeatedly during mutation checks.
- Docker: **PASS**, as described above.

## Security Review

- **RBAC (`07-RBAC-MATRIX.md` §3.7):** every write route was tested against every non-Pharmacist role (Hospital Admin, Doctor, Nurse, Receptionist, Lab Technician, Accountant, Patient → 403). Batch, low-stock, and expiring views allow only Pharmacist and Hospital Admin. Super Admin is denied every pharmacy endpoint. Hospital Admin's 🟡 is read-only (D-024).
- **Tenancy (both directions):**
  - Another hospital's Pharmacist or Admin gets 404 on medicine read/update, batch list/receipt, and dispense, and each case asserts that nothing was written. Hospital B's search, low-stock list, and alerts contain nothing from hospital A.
  - The expiry scan for hospital A leaves hospital B's expired batch untouched, and vice versa.
  - Raw SQL (row locks, the low-stock aggregate) bypasses the tenant-scoping extension. Every raw query binds `hospitalId` from the JWT via TenantContext, parameterised with tagged templates and no `$queryRawUnsafe`. This is recorded as a new CLAUDE.md convention.
- **Injection and input:** all DTOs are whitelisted (unknown fields such as `hospitalId`, `status`, and a nested `dispensedBy` are rejected with 400). Numbers are bounded; decimals are limited to 2 places; dates must be strict calendar dates; batch numbers are pattern-restricted.
- **Data integrity:** operations are atomic all-or-nothing; row locks stop concurrent requests overselling a batch or over-dispensing a prescription (both proven by e2e tests and by the lock-removal mutations); quantities can't go negative. `DispenseRecord.dispensedBy` and the audit trail attribute every stock movement to the pharmacist, and quarantines to the system (`actorUserId` null), both asserted in tests.
- **Sensitive data:** the recipient lookups use `select: { id }` / `select: { email }` only, so there are no `User` row leaks (the CLAUDE.md `SAFE_USER_SELECT` rule). Responses contain no user data.
- **Error leakage:** duplicate batches map from P2002 to a clean 409. No Prisma or SQL text reaches the client.

## UI/UX Review

Not applicable: Phase 9 is backend-only, like every phase so far (frontend work hasn't started). `GET /medicines/expiring` and `availableQuantity` were added with the `04-UI-UX.md` §4 Pharmacist dashboard panels ("low-stock and expiring-soon panels, batch lookup") in mind.

## Bugs Found

1. **`Hospital.timezone` was only `@IsString()`-validated since Phase 4** (pre-existing, found by break-it review). Nothing read the field until pharmacy, which is its first consumer. `Intl.DateTimeFormat` throws `RangeError: Invalid time zone specified` for an unknown zone (confirmed directly), so one bad value saved through `PATCH /hospitals/:id` would have made every pharmacy date computation for that hospital return 500, and would have failed that hospital's nightly scan every night. Severity: medium (an availability break for one tenant, triggerable by that tenant's own admin, with no cross-tenant or data impact).
2. **Documentation discrepancy (not fixed, recorded):** `src/doctors/availability.service.ts` says its "all times are UTC" simplification is recorded in `docs/11-DECISIONS.md`, but no such entry exists. D-023 notes the gap and the deliberate divergence (pharmacy uses the hospital's real timezone for calendar-date expiry). Adding the missing appointment entry belongs to that module's owner phase, and nothing is broken by its absence.

No defects were found in this phase's own new code beyond what the test-first negative cases caught during development: the first run of the new spec passed 33/33. That was treated as a reason for suspicion, not confidence, hence the mutation checks above.

## Fixes Applied

- Bug 1: added a reusable `IsIanaTimezone` class-validator decorator (`src/common/validation/`), applied to both `CreateHospitalDto` and `UpdateHospitalDto`. Regression test in `directory.e2e-spec.ts`: invalid zones on create or update → 400; a valid zone → 200.

## Regression Checks

- Full suite re-run after every change: 175/175. This includes the Phase 7 prescriptions spec (dispensing now changes `PrescriptionStatus`, and correction still requires `ISSUED`) and the Phase 8 lab spec (`NotificationType` refactor).
- Formatting-only changes that Prettier had applied to three unrelated queue files were reverted to keep the diff scoped.
- `docker compose build api` re-verified after all changes.

## Known Minor Issues

- The digest's SMTP send is a disclosed dev stub (D-025). Low-stock and digest `Notification` rows exist but can't yet be read through an API, because `GET /notifications/me` is Phase 11 scope (same as D-020).
- There's no manual quarantine or recall endpoint. Quarantine is automatic on expiry only, which is all FR-PHARM-003 asks for. A quarantined-before-expiry batch (for example a recall) is handled correctly by dispensing if it exists, but can currently only be set outside the API.
- There's no "prescriptions awaiting dispense" list endpoint. A pharmacist works from a prescription id (from the patient's prescription/PDF). A queue view belongs with the Phase 13 dashboards.
- Pharmacy uses the hospital's timezone while appointments still assume UTC (D-023). This is intentional and documented, but the two modules differ.

## Technical Debt

- **The audit-log extension (Phase 2) writes audit rows through the root Prisma client, not the interactive-transaction client.** Inside a `$transaction(async (tx) => ...)` (Phase 7's prescription correction, and now receipt, dispense, catalog edit, and quarantine), there are two consequences:
  - (a) Audit rows for writes that later roll back are not rolled back with them. Phase 9 validates everything before its first write, so this only arises on an unexpected database fault mid-transaction.
  - (b) Each transaction briefly needs a second pool connection for its audit writes, so concurrent transactions at or above the pool size could time out waiting for a connection.

  Not a Phase 9 regression, and not observed in testing (up to 3 concurrent dispenses). It should be fixed in the extension itself during Phase 15 hardening by threading the transaction client into the audit write.
- No seed data for dispense records or pharmacy notifications (the same pattern carried forward from Phases 5–8). The seed's existing near-expiry batches do exercise the digest and expiring view, as the Docker smoke run showed.
- The dev database has accumulated a few hospitals left over from earlier interrupted e2e runs (the scan saw 8, versus 2 seeded). This is harmless test residue; `prisma migrate reset` plus a reseed clears it.

## Documentation Updated

- `docs/11-DECISIONS.md`: D-022 (low-stock latch), D-023 (hospital-local dates, inclusive expiry, timezone validation, and the appointment-UTC doc gap), D-024 (RBAC interpretation, endpoint placement, `batchId` semantics, `INSUFFICIENT_STOCK`), D-025 (digest scope and email stub), D-026 (Redis inventory-count cache deferred).
- `docs/08-API-CONTRACT.md`: §3 `INSUFFICIENT_STOCK`; §4.6 medicines note; §4.8 full implemented Pharmacy table, including the new `GET /medicines/expiring` and the job.
- `docs/06-DATABASE-DESIGN.md` §3.4: `Medicine.lowStockAlertedAt` and the definition of "available stock".
- `docs/03-ARCHITECTURE.md` §12: `medicine-expiry-scan` schedule and retry policy as implemented.
- `CLAUDE.md`: two new conventions (raw SQL bypasses tenant scoping; stock-changing writes must take the medicine lock and evaluate the latch).

## Final Gate

**Phase 9 — Pharmacy: PASS.**
- All of `FR-PHARM-001..005` are implemented and verified, including the mandatory expired-batch dispensing rejection (the phase's extra gate), FEFO across multiple batches, once-per-crossing low-stock alerts, and a real run of the nightly quarantine and digest job inside the Docker container.
- RBAC and tenancy were verified for every §3.7 cell in both directions. Concurrency safety was proven by tests and by removing each lock.
- One pre-existing medium-severity validation gap (`Hospital.timezone`) was found and fixed at its source, with a regression test.
- FR-PHARM-005's email hop is deliberately stubbed (D-025) and disclosed as such.
- No known critical or high-severity defect remains open.
