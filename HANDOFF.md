# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions. Read it first, then verify it against the actual repository state: the repo is the source of truth for what's implemented; this file is the source of truth for session context only.

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable. Work follows a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules. Read before touching anything:**
1. **`CLAUDE.md`** (project root), every session. It points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in" and to the `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done. Its "Monorepo conventions" list encodes hard-won, real-bug lessons (**19 entries** as of this handoff; 2 added in Phase 9). Read all of them.
2. **`docs/12-QUALITY-PROTOCOL.md`**: the implement → verify → root-cause-fix → re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase can't be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user explicitly typing "START PHASE N."** Phase 9 was completed and gated PASS in this session. Don't start Phase 10 until the user says so.

Current objective as of this handoff: **wait for "START PHASE 10."** Per `docs/05-DEVELOPMENT-PLAN.md`, Phase 10 is Billing & Payments: invoice aggregation across modules, finalisation, Stripe and Razorpay test-mode checkout, signed webhook handling, cash payments, receipts (`FR-BILL-001..006`). Extra gate: invoice-total-integrity test and webhook-signature-rejection test. Re-read the actual doc section in full when authorized; don't assume this summary is complete.

## Current State

**Ten phases complete and gated PASS** (Phase 0 through Phase 9), each with a full review at `docs/phase-reviews/PHASE-{0..9}-REVIEW.md`. This session's plan is to commit Phase 9 immediately after writing this handoff, so `git log` should show `feat: Phase 9 — pharmacy` at HEAD. If it doesn't, check `git status` first: that means something went wrong between writing this file and committing.

Verified this session (all re-run after the last code change):
- Backend typecheck (`pnpm exec tsc --noEmit -p tsconfig.eslint.json` from `apps/backend`): **PASS**.
- Backend lint (`pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0`): **PASS**.
- Frontend typecheck (`pnpm exec tsc --noEmit` from `apps/frontend`, since `packages/types` changed): **PASS**.
- Full e2e suite: **PASS**, 175/175 tests across 11/11 suites (140 pre-existing, 34 new `pharmacy.e2e-spec.ts`, 1 new timezone regression test in `directory.e2e-spec.ts`).
- `docker compose build api` + `up -d api`: **PASS**. Pharmacy routes are mapped and the nightly scheduler is registered (seen in the logs). Live HTTP smoke tests passed against the container. A real `medicine-expiry-scan` job ran end to end through the container's own BullMQ worker.

Docker stack is **currently running**: `postgres`, `redis`, `localstack`, `api` are all up (the `api` container runs the freshly built Phase 9 image). `frontend`/`nginx` were **not** started: the same host port-3000 conflict noted in prior handoffs (an unrelated Next.js dev server on this machine), not a project defect. **Docker Desktop was not running at the start of this session.** It had to be launched manually (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`), then the stack brought up with `docker compose up -d postgres redis localstack`. Expect the same next time if the machine rebooted.

Seeded test accounts are unchanged (password `Demo123!`): `superadmin@medcore.test`, `hospitaladmin@medcore-city.medcore.test` / `hospitaladmin@medcore-metro.medcore.test`, `dr.jeremy.keebler@medcore-city.medcore.test`, plus 30 `*.patient.medcore.test` accounts. The seed has 5 medicines × 2 batches per hospital (one batch expiring within 20 days), so the expiring view and digest have real data. **There's no seeded Pharmacist account.** To exercise pharmacy writes by hand, create one via `POST /users` as the Hospital Admin, or use the e2e spec's pattern.

### What Phase 9 actually delivered

`FR-PHARM-001..005` on the existing `medicines/` module:
- catalog create/update and batch receipt, with strict date/decimal validation and 422 on already-expired stock;
- `POST /prescriptions/:id/dispense`, with FEFO allocation across batches, atomic, row-locked (no oversell or over-dispense under concurrency), and expired, quarantined, or exhausted stock rejected (`422 MEDICINE_EXPIRED` / new `422 INSUFFICIENT_STOCK`), never a fallback;
- low-stock alerts that fire exactly once per crossing via a new `Medicine.lowStockAlertedAt` latch (migration `20260924090000_add_medicine_low_stock_latch`);
- `GET /medicines/low-stock`, `GET /medicines/expiring`, `GET /medicines/:id/batches`;
- the nightly `medicine-expiry-scan` BullMQ job (quarantine, low-stock re-evaluation, and a per-day digest `Notification`, with the email send stubbed until Phase 11).

The mandatory **expired-batch dispensing rejection test (the Phase 9 extra gate) passes.** Four deliberate mutations (ignoring expiry, removing each row lock, removing the latch) were each caught by the tests, which proves the tests have teeth. One pre-existing defect was found and fixed at its source: `Hospital.timezone` had no real validation since Phase 4 (details below).

### Nothing is currently broken

There's no known open defect blocking the gate. The documented, accepted limitations are in `docs/phase-reviews/PHASE-9-REVIEW.md` "Known Minor Issues" and "Technical Debt":
- the digest email is a dev stub;
- there's no `GET /notifications/me` yet (Phase 11);
- there's no manual quarantine/recall endpoint;
- there's no "prescriptions awaiting dispense" list;
- pharmacy uses the hospital's timezone while appointments assume UTC (intentional, D-023);
- the audit-log extension writes through the root client, not the interactive-transaction client (pre-existing since Phase 2, recorded as Phase 15 hardening debt).

`apps/frontend` still can't `next build` natively on this Windows machine (carried forward, unchanged).

## Active Files

Only what's relevant to Phase 10, or to touching Phase 9's surface again:

- `docs/05-DEVELOPMENT-PLAN.md`: re-read Phase 10's scope before starting anything.
- `docs/12-QUALITY-PROTOCOL.md`: mandatory re-read every phase.
- `docs/07-RBAC-MATRIX.md` §3.8, `docs/08-API-CONTRACT.md` §4.9, `docs/02-SRS.md` FR-BILL: Phase 10's spec. Check `apps/backend/prisma/schema.prisma` for the already-modeled `Invoice`/`InvoiceItem`/`Payment`/`InsuranceClaim`. Every phase so far found real gaps in what looked complete at a glance, so verify rather than assume.
- `apps/backend/src/medicines/dispensing.service.ts`: FR-BILL-001 says invoices accumulate pharmacy charges "automatically as incurred." Dispensing is the natural trigger point (`DispenseRecord` quantity × the batch's `mrp`). Phase 10 needs to hook in there, inside the same transaction.
- `apps/backend/src/medicines/stock.service.ts`: the per-medicine lock and low-stock latch. Any new stock-changing path must use `lockMedicines` + `evaluateLowStock` (CLAUDE.md convention).
- `apps/backend/src/lab/lab.service.ts` and `src/medicines/stock.service.ts`/`expiry-scan.service.ts`: the three current `Notification`-row producers that Phase 11 must migrate onto the real event bus/dispatcher.
- `apps/backend/src/queue/`: the BullMQ queue/processor/scheduler pattern. `medicine-expiry-scan.scheduler.ts` is the first repeatable (cron) job.
- `docs/phase-reviews/PHASE-9-REVIEW.md`: what Phase 9 verified, and its technical debt.

## Changes Made (this session)

1. **Schema**: `Medicine.lowStockAlertedAt DateTime?`, via a hand-written migration `20260924090000_add_medicine_low_stock_latch` applied with `prisma migrate deploy`. Verified exact with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <temp medcore_shadow db>` → "No difference detected" (the temp shadow DB was created and dropped afterwards).
2. **`packages/types`**: `NotificationType` as-const (`LAB_RESULT_APPROVED`, `LOW_STOCK_ALERT`, `MEDICINE_EXPIRY_DIGEST`) and `ApiErrorCode.INSUFFICIENT_STOCK`, then rebuilt. `LabService` now uses the constant.
3. **`medicines/` module extended**:
   - `MedicinesService`: `create`, `update`, `listBatches`, `receiveBatch`, `findLowStock` (raw SQL, explicit `hospitalId`), `findExpiring`, and `availableQuantity` on reads;
   - new `DispensingController`/`DispensingService`, `StockService` (row locks and latch), `ExpiryScanService`, `ExpiryDigestDeliveryStub`, `pharmacy-date.util.ts` (hospital-local "today");
   - 5 new DTOs.
4. **Queue**: `medicine-expiry-scan` queue registered in `QueueModule` (which now imports `MedicinesModule`), plus `MedicineExpiryScanProcessor` and `MedicineExpiryScanScheduler` (`upsertJobScheduler`, `30 0 * * *` UTC).
5. **Pre-existing bug fix**: new `src/common/validation/is-iana-timezone.decorator.ts`, applied to `CreateHospitalDto`/`UpdateHospitalDto` (was `@IsString()` only). Regression test in `directory.e2e-spec.ts`.
6. **Tests**: `test/pharmacy.e2e-spec.ts` (34 tests: catalog, batches, FEFO, expiry/quarantine/exhaustion, validation and prescription state, RBAC for every role including Super Admin, cross-tenant in both directions, 2 concurrency races, low-stock latch, scan quarantine/digest/idempotency/tenant isolation, audit attribution).
7. **Docs**: `docs/11-DECISIONS.md` D-022 to D-026; `docs/08-API-CONTRACT.md` §3/§4.6/§4.8; `docs/06-DATABASE-DESIGN.md` §3.4; `docs/03-ARCHITECTURE.md` §12; `CLAUDE.md` (+2 conventions); `docs/phase-reviews/PHASE-9-REVIEW.md` (gate PASS).
8. Removed stray 0-byte artifact files again: files named after code fragments, like `b.id)`, `0`, `Number),+`, and `,-`. The same pattern was seen in Phases 6–8. They appear during the session, apparently from a hook, so check `git status` for them right before committing. The `.claude-flow/` telemetry directories (now also appearing under `apps/backend/src/`, `src/medicines/`, `src/medicines/dto/`, and `packages/types/`) were left alone and never staged.

## Failed Attempts

- **Bash-tool heredocs containing apostrophes or backticks intermittently failed** with `unexpected EOF while looking for matching '` (twice, when writing `expiry-scan.service.ts` and appending to `docs/11-DECISIONS.md`), even with a quoted `<<'EOF'` delimiter. The failures were parse-time, so nothing was partially written. Replaced by the Write tool (or Write to a temp file, then `cat >>`). **Don't use heredocs for prose or code containing apostrophes in this environment.**
- **`pnpm exec prettier --write src/queue` reformatted three unrelated, pre-existing queue files** (`appointment-reminder-queue.service.ts`, `appointment-reminder.processor.ts`, `prescription-pdf.processor.ts`). Reverted with `git checkout --` to keep the diff scoped. Run Prettier on specific changed files, not whole directories.
- **Docker wasn't running at session start** (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`), so the first `prisma migrate deploy` failed with `P1001`. Fixed by starting Docker Desktop. This was environmental, not a code issue.
- The auto-mode permission classifier returned "no verdict" for a few Bash calls (transient). Retrying once, or using the Edit tool, worked.

## Next Steps

1. **Wait for the user to say "START PHASE 10."** Don't start Phase 10 on your own initiative.
2. When authorized: read `docs/05-DEVELOPMENT-PLAN.md` Phase 10, `docs/12-QUALITY-PROTOCOL.md`, `docs/07-RBAC-MATRIX.md` §3.8, `docs/08-API-CONTRACT.md` §4.9, `docs/02-SRS.md` FR-BILL, and check `docs/11-DECISIONS.md` for anything billing-related before writing code.
3. Decide how pharmacy charges reach invoices (FR-BILL-001 "automatically as incurred"). The likely approach is an `InvoiceItem` written inside `DispensingService.dispense`'s transaction (quantity × batch `mrp`). Do the same for lab and consultation. Record the decision in `docs/11-DECISIONS.md`.
4. Same discipline as every phase: implement → typecheck → lint → e2e (native, then Docker) → mandatory negative/RBAC/cross-tenant adversarial testing → mutation-check the key tests → root-cause any failure → re-verify → write `docs/phase-reviews/PHASE-10-REVIEW.md` (§23) → update docs/`CLAUDE.md` → commit → **stop and wait for "START PHASE 11."**
5. Phase 10 extra gates: the invoice-total-integrity test and the webhook-signature-rejection test. Write both as negative tests before calling the feature done. Duplicate webhook events (idempotency on `providerEventId`) need a test too (`docs/12-QUALITY-PROTOCOL.md` §4 billing row).
6. Carried-forward debt worth scheduling: fix the audit-log extension so it writes through the transaction client (Phase 15; see the Phase 9 review), and add the missing `docs/11-DECISIONS.md` entry for the appointment module's UTC-wall-clock simplification (noted in D-023).

## Important Commands, Paths, and Gotchas

### Commands (all run from `apps/backend` unless noted)

```bash
# Typecheck / lint
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0
# Frontend typecheck (from apps/frontend) — run whenever packages/types changes
pnpm exec tsc --noEmit

# Full e2e suite (needs Postgres + Redis + LocalStack reachable — either native or via Docker)
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json
# ...or a single file:
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json <filename>.e2e-spec.ts

# If re-running e2e specs repeatedly in a short window, the auth rate limiter
# will start returning 429s and produce spurious total-suite failures that look
# like real bugs but aren't. Clear it between runs if needed:
docker exec medcore-hms-redis-1 redis-cli --scan --pattern "throttle:*" | xargs -r docker exec -i medcore-hms-redis-1 redis-cli DEL

# Docker (from repo root, not apps/backend)
docker compose up -d postgres redis localstack   # infra only
docker compose up -d api          # postgres + redis + localstack + api
docker compose ps
docker compose logs api --tail 60
docker compose build api frontend  # needed after editing packages/types OR apps/backend src

# Verify something actually works INSIDE the container (not just that the image builds):
docker exec medcore-hms-api-1 sh -c "cd /workspace/apps/backend && node -e \"...\""
# Phase 9 used this to enqueue a one-off medicine-expiry-scan job via bullmq's Queue +
# QueueEvents (connection parsed from process.env.REDIS_URL) and wait for its result.

# API base URL (native or Docker): http://localhost:3001/api  (API_PORT=3001 in .env)

# Prisma (from apps/backend, needs .env vars — use the dotenv wrapper)
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name X   # interactive — FAILS in this shell if
                                                                  # a confirmation prompt is needed
pnpm exec dotenv -e ../../.env -- prisma migrate deploy          # non-interactive apply
pnpm exec dotenv -e ../../.env -- prisma migrate reset --force --skip-seed && pnpm run db:seed
# Verify a hand-written migration matches the schema exactly (create/drop a temp shadow DB):
#   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE medcore_shadow;"'
#   pnpm exec dotenv -e ../../.env -- prisma migrate diff --from-migrations prisma/migrations \
#     --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with /medcore_shadow>
#   (then DROP DATABASE medcore_shadow)
```

### Gotchas (cumulative; `CLAUDE.md` "Monorepo conventions" is the canonical list)

- `dotenv` as a bare CLI command is not on PATH. Always use `pnpm exec dotenv ...`.
- Backend's dev script is `pnpm run dev`, not `start:dev`.
- Windows file-locking: a running backend process (native `nest start --watch`, or a leftover jest process) can hold the Prisma query engine `.dll.node` locked, causing `EPERM` on `prisma generate`/`migrate`. Find it via `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId,CommandLine` and kill it.
- `@medcore/types` is consumed as compiled JS: after editing `packages/types/src/*`, run `pnpm --filter=@medcore/types run build` before the change is visible anywhere.
- A pure-ESM npm package (bullmq, puppeteer, ...) needs a `transformIgnorePatterns` carve-out in `test/jest-e2e.json`, or e2e tests fail with `SyntaxError: Unexpected token 'export'`.
- A native/binary-dependent npm package can pass every native check and still fail only inside the Alpine container. Verify inside the container explicitly (not triggered in Phase 9: no new dependency).
- `prisma migrate dev` refuses to run in this non-interactive shell whenever it would show a confirmation prompt. Hand-write the migration, apply it with `prisma migrate deploy`, and verify it with `migrate diff` (done in Phase 9).
- `@aws-sdk/client-s3`'s default checksum behaviour breaks every pre-signed upload URL. Construct the client with `requestChecksumCalculation: "WHEN_REQUIRED"`.
- EMR/prescription/lab-report e2e tests need `docker compose up -d localstack` running first.
- Pass Prisma enum values into helpers as plain `string` parameters rather than `@medcore/types` union types (see `lab-reference-range.util.ts`). Comparing with `===` is fine.
- **New in Phase 9:**
  - `$queryRaw` bypasses tenant scoping, so always bind `hospitalId` explicitly.
  - Stock-changing writes must use `StockService.lockMedicines` + `evaluateLowStock` in the same transaction.
  - Pharmacy "today" is the hospital's local date (`hospitalToday`). An e2e test computing expected dates must use the same helper, as `pharmacy.e2e-spec.ts` does with `day(offset)`.
  - To test the nightly job, call `ExpiryScanService.runScan(now, [hospitalId])`. Always pass the hospital filter in tests so the dev DB's other hospitals aren't touched.

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/PHASE-X-REVIEW.md`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md`
- RBAC spec: `docs/07-RBAC-MATRIX.md`
- API index: `docs/08-API-CONTRACT.md`
- Backend source: `apps/backend/src/`, one module directory per domain (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `medicines/` (pharmacy), `prescriptions/`, `lab/`, `queue/`), plus `common/` for cross-cutting concerns (`crypto/`, `storage/`, `validation/`, `tenancy/`, `audit/`, `infra.module.ts`)
- Prisma schema + migrations + seed: `apps/backend/prisma/`
- e2e tests: `apps/backend/test/*.e2e-spec.ts`
- Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | PASS | Phase 9 changes ready to commit; stray 0-byte artifacts removed; `.claude-flow/` dirs untracked and never staged |
| Lint | PASS | Backend, zero errors/warnings |
| Typecheck | PASS | Backend and frontend, zero errors |
| Unit tests | NOT APPLICABLE | No dedicated unit-test suite exists project-wide yet (unchanged since Phase 4) |
| Integration/e2e tests | PASS | 175/175, 11/11 suites, re-run after the last change |
| Component tests | NOT APPLICABLE | No frontend work this phase |
| Build | PASS | `docker compose build api` succeeded, and the container was smoke-tested live |
| DB migrations | PASS | `20260924090000_add_medicine_low_stock_latch` applied via `migrate deploy`; shadow-DB `migrate diff` shows no drift |
| Docker | PASS | `api`/`postgres`/`redis`/`localstack` up; routes and scheduler registered; real expiry-scan job processed by the container's worker |
| Security review | PASS | RBAC for every §3.7 cell including Super Admin; cross-tenant checks in both directions (including the scan); raw-SQL tenancy; injection-safe parameterised SQL; concurrency locks proven by mutation; audit attribution asserted. See `PHASE-9-REVIEW.md` |

## Current Phase Gate

**Phase 9 — Pharmacy: PASS.** Full detail in `docs/phase-reviews/PHASE-9-REVIEW.md`. All of `FR-PHARM-001..005` are verified, including the mandatory expired-batch rejection extra gate. The FR-PHARM-005 email hop is deliberately stubbed and disclosed (D-025). One pre-existing medium-severity gap (`Hospital.timezone` validation) was found and fixed with a regression test. No known critical or high-severity defect remains open.

## Important Decisions / Context

- **D-022**: the low-stock "once per crossing" rule is a persisted latch, `Medicine.lowStockAlertedAt`. A new medicine starts latched, since zero stock at creation isn't a crossing. Reads never touch it.
- **D-023**: pharmacy dates use the hospital's local calendar day; expiry dates are inclusive; `Hospital.timezone` is now IANA-validated. It also records that the appointment module's "all UTC" simplification is claimed to be in the decision log but isn't: an open doc gap, not yet resolved.
- **D-024**:
  - Hospital Admin's 🟡 on catalog/batches means read-only.
  - Dispensing lives in the pharmacy module at the contract's `/prescriptions/:id/dispense` URL.
  - Optional `batchId` is a FEFO-enforced physical-pick check, not an override.
  - New error code `INSUFFICIENT_STOCK` (422); insufficient stock is all-or-nothing.
- **D-025**: the expiry digest's scan, recipients, and `Notification` rows are real; only SMTP is stubbed until Phase 11.
- **D-026**: Redis inventory-count caching is deferred (same reasoning as D-014).
- Carried from Phase 8: D-018 (one structured lab value per item), D-019 (lab `reportFileUrl`), D-020 (lab notification rows, Phase 11 dispatch), D-021 (per-item lab result visibility).
- **Known architectural debt (pre-existing, Phase 2):** the audit-log extension writes audit rows through the root Prisma client, outside any interactive transaction. Audit rows can therefore outlive a rolled-back transaction, and each transaction briefly needs two pool connections. Scheduled for Phase 15 hardening; see `PHASE-9-REVIEW.md` Technical Debt.
