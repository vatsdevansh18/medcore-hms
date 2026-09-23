# Phase 2 Review — Database & Core Architecture

**Phase:** 2 — Database & Core Architecture
**Date:** 2026-09-23
**Gate status:** **PASS**

## Objective

Translate `docs/06-DATABASE-DESIGN.md` into a working Prisma schema and migration, implement the three-layer tenant-scoping enforcement and audit-logging Prisma extensions from `docs/03-ARCHITECTURE.md` §4–5, and produce a seed script covering the reference/master data the rest of the project builds against.

## Implemented

- **Full Prisma schema** (`apps/backend/prisma/schema.prisma`) — every entity from `06-DATABASE-DESIGN.md` §3.1–3.5 (30 models), enums mirrored exactly from `packages/types/src/enums.ts` (which was extended with `Gender`, `ReferenceRangeGender`, `RoomType`, `BedStatus`, `FamilyHistoryCondition`, `AttachmentOwnerType`, `InsuranceClaimStatus` — previously only had the enums Phase 1 needed).
- **Initial migration** (`20260923030035_init`), including the two hand-written `EXCLUDE USING gist` constraints (`no_doctor_overlap`, `no_patient_overlap`) and `CREATE EXTENSION IF NOT EXISTS btree_gist` per D-005 — Prisma's schema DSL cannot express these, so they're appended directly to `migration.sql`.
- **`TenantContext`** (`src/common/tenancy/tenant-context.ts`) — `AsyncLocalStorage`-based per-request store (`hospitalId`, `userId`, `bypassTenancy`), with `run()`, `bypass()`, `getStore()`, `requireStore()` (fail-closed).
- **Tenant-scoping Prisma extension** (`src/common/tenancy/tenant-scoping.extension.ts`) — Layer 1 of the three-layer model: auto-injects/enforces `hospitalId` on every operation for the 19 models that carry their own `hospitalId` column; throws if no context is active or if `bypassTenancy=false` with no `hospitalId`.
- **Audit-log Prisma extension** (`src/common/audit/audit-log.extension.ts`) — mirrors create/update/delete on 29 audited models to `AuditLog`, with `beforeData` captured via a pre-mutation read for update/delete and `afterData` from the operation's own result; bulk operations log one summary row per SEC-AUDIT-001's "where feasible" allowance.
- **`PrismaModule`** (`src/prisma/`) — `$extends()`-composed client behind a DI token (`PRISMA_CLIENT`), since extension application changes the client's type and doesn't compose cleanly with class-based `extends PrismaClient`.
- **`/health/ready`** now runs a real `SELECT 1` against Postgres via a `DatabaseHealthIndicator`, replacing Phase 1's placeholder.
- **Seed script** (`apps/backend/prisma/seed.ts`) — 2 hospitals, 8 doctors, 30 patients, 12 staff (one per non-doctor/patient role per hospital), 40 availability slots, rooms/beds, a 10-medicine/20-batch pharmacy catalog, a 10-test lab catalog with reference ranges. Deliberately excludes appointments/EMR/prescriptions/lab orders/invoices — those are transactional workflows owned by Phases 5–10, and seeding them directly here would bypass the business rules those phases implement (documented in the script's own header, not silently scoped down).
- **CI**: added the missing `prisma migrate deploy` step to the `integration-tests` job — it previously ran `test:e2e` against a schema-less ephemeral database.

## Requirements Verified

| ID                                                                            | Status                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FR-TENANT-001` (hospitalId on every tenant table, sourced from auth context) | Verified — schema + extension                                                                                                                    |
| `FR-TENANT-002` (automatic query scoping, no service calls Prisma directly)   | Verified — extension is the only path; no service layer exists yet to violate this                                                               |
| `FR-APPT-003` / `FR-APPT-004` (no doctor/patient double-booking)              | Verified — exclusion constraints, tested under real concurrency                                                                                  |
| `SEC-AUDIT-001` (every write logged with actor/timestamp)                     | Verified for the 29 audited models                                                                                                               |
| `SEC-TENANT-*` (three-layer enforcement, Layer 1)                             | Verified — Layer 2 (service-layer re-check) and Layer 3 (CI-blocking tests) apply once Phase 3+ adds services calling this layer                 |
| Schema fidelity to `06-DATABASE-DESIGN.md`                                    | Verified by manual cross-check against every entity table in that doc; two minor doc inconsistencies found and fixed (see Documentation Updated) |

## Files / Modules Changed

`apps/backend/prisma/` (schema, migration, seed — new), `apps/backend/src/prisma/` (new), `apps/backend/src/common/tenancy/` and `src/common/audit/` (new), `src/health/database.health-indicator.ts` (new), `src/health/health.{controller,module}.ts`, `src/app.module.ts`, `src/config/env.validation.ts` (added `DATABASE_URL`), `apps/backend/package.json` (Prisma/bcrypt/faker/dotenv-cli deps, `db:*` scripts), `packages/types/src/enums.ts` (7 new enums), `infrastructure/docker/Dockerfile.backend` (OpenSSL, `prisma generate` steps), `.github/workflows/ci.yml` (migration step), `docker-compose.yml` (healthcheck fix), `docs/06-DATABASE-DESIGN.md` (two corrections).

## Tests Executed

| Suite                                                 | Result                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run typecheck` (workspace)                      | PASS                                                                                                                                         |
| `pnpm run lint` (workspace)                           | PASS                                                                                                                                         |
| `pnpm run test` (unit)                                | PASS — 2/2                                                                                                                                   |
| `apps/backend` `test:e2e` against real Postgres       | PASS — 16/16 across 4 suites (run twice consecutively to confirm cleanup idempotency; also re-run clean after a full `prisma migrate reset`) |
| `prisma migrate reset --force` (clean-slate re-apply) | PASS — migration reapplies cleanly from empty, matching the "clean from empty DB" gate criterion                                             |
| `pnpm run db:seed`                                    | PASS — verified row counts match targets via direct SQL, zero cross-tenant FK mismatches found                                               |
| `docker compose build` + `up` (full stack)            | PASS — `/health/ready` returns real DB-backed `200`, verified through Nginx too                                                              |

New integration tests, each an "active break-it" exercise per the quality protocol, not a happy-path-only check:

- **`test/tenancy.e2e-spec.ts`** (6 tests) — scoped reads return only the active hospital's data; a hospital-A context cannot read a hospital-B row by id; `create` always uses the context's `hospitalId` even when a caller supplies a different one (spoofing attempt); a tenant-scoped query with no active context throws; `bypassTenancy=false` + null `hospitalId` throws; `TenantContext.bypass()` can legitimately read across hospitals (Super Admin path).
- **`test/appointment-concurrency.e2e-spec.ts`** (4 tests) — two genuinely concurrent (`Promise.allSettled`, not sequential) bookings for the identical doctor+slot: exactly one succeeds, one rejects with the exclusion-constraint error, exactly one row exists afterward; overlapping-but-not-identical ranges also rejected; a `CANCELLED` appointment does not block a new booking for the same slot (proves the constraint's `WHERE` clause is scoped correctly, not overly broad); the same patient cannot hold overlapping appointments across two different doctors.
- **`test/audit-log.e2e-spec.ts`** (4 tests) — create writes `afterData` attributed to the real acting user; update captures both `beforeData` and `afterData`; the extension never recursively audits its own `AuditLog` writes; reads never create audit rows.

## Security Review

- Tenancy fail-closed behavior verified directly (see tests above) — a bug that forgets to establish `TenantContext` throws immediately rather than silently returning unscoped data.
- `AuditLog.actorUserId` is a real FK to `User`, not a free-text field — an audit row can never claim an actor that doesn't exist.
- Sensitive fields (`notesEncrypted`, `noteEncrypted`, `passwordHash`) are stripped before anything reaches the audit trail (`sanitizeForAudit`).
- No secrets introduced; `.env` still git-ignored, `DATABASE_URL` documented in `.env.example` since Phase 1.
- Docker image now installs `openssl` and pins `binaryTargets` — closes a real gap where the production image (Phase 16 reuses this Dockerfile) would have crashed on first query with no DB connectivity at all (see Bugs Found).

## UI/UX Review

Not applicable — no frontend work this phase.

## Bugs Found

All found and fixed in-session, root-caused per `docs/12-QUALITY-PROTOCOL.md` §2, not patched around:

1. **Stale Postgres volume credentials** — Phase 1's verification run left a named volume initialized with different credentials than the current `.env`; `prisma migrate dev` failed `P1000` authentication. Root cause: Postgres skips re-initialization (and thus `POSTGRES_PASSWORD`) on an existing data directory. Fixed by removing the disposable local volume (`docker compose down -v`) — no real data existed in it.
2. **`AsyncLocalStorage` context lost across nested Prisma calls made from within an extension, specifically when the outer callback passed to `TenantContext.run()`/`bypass()` was a non-`async` function returning Prisma's lazy `PrismaPromise` directly** (e.g. `() => prisma.user.create(...)` instead of `async () => { return await prisma.user.create(...) }`). Reproduced in isolation, root-caused precisely (see `tenant-context.ts`'s own doc comment), and fixed at the source: `TenantContext.run`/`bypass` now always wrap the callback in an internal `async () => callback()`, so the class is safe regardless of caller style — this can't be reintroduced by a future phase writing the "wrong" callback shape.
3. **`packages/types/dist/` staleness** — added new enums to `src/enums.ts` but forgot to rebuild; surfaced as a confusing runtime `Cannot read properties of undefined` rather than a type error (since `ts-node --transpile-only` skips type-checking). Fixed by rebuilding; sharpened the existing `CLAUDE.md` warning about this class of issue.
4. **Missing `.dockerignore`-adjacent gap: Dockerfile never ran `prisma generate`** — the dev/build stages copied `schema.prisma` in but never generated a client against it, so the Prisma Client inside the container was the schema-less stub from the `deps` stage's `pnpm install` (which ran before the schema file even existed in the image). Surfaced as `Prisma.ModelName` not existing at compile time inside the container. Fixed by adding explicit `prisma generate` steps to both stages.
5. **Alpine/OpenSSL runtime crash** — `node:20-alpine` doesn't include a libssl matching Prisma's default-guessed engine binary; the container crashed on the very first query attempt (`PrismaClientInitializationError: Error loading shared library libssl.so.1.1`) — this would have been a silent, undetected production-deployment failure had it not been caught by actually running the container and hitting `/health/ready`, not just checking that the image built. Fixed with `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` in the schema and `apk add --no-cache openssl` in the Dockerfile.
6. **Test fixtures, not extension bugs**: an audit test used a synthetic (non-existent) `actorUserId`, violating the real FK; two tests' cleanup deleted a `Hospital` row before its dependent rows (and before audit rows the cleanup deletes themselves generated). Both fixed in the test files.
7. **Unit test regression**: `health.controller.spec.ts` never provided the new `DatabaseHealthIndicator` dependency `HealthController` now requires, since it went from a no-op check to a real Prisma-backed one. Fixed by mocking the indicator in the unit test (a live DB check belongs in the e2e suite, which already covers it) rather than wiring a real database into what should stay a fast, isolated unit test.
8. **CI gap**: `integration-tests` never ran `prisma migrate deploy`, so the e2e tests would have run against a completely empty ephemeral database. Fixed by adding the step.

## Fixes Applied

See Bugs Found — every item above was fixed at its root cause and re-verified (full lint/typecheck/unit/e2e re-run, plus a real Docker Compose up/health-check cycle) before being considered resolved, not merely patched to stop erroring.

## Regression Checks

- Full workspace `lint`/`typecheck`/`test` re-run after every fix in this phase, not just after the fix that seemed related.
- e2e suite run twice consecutively (idempotency) and once more after a full `prisma migrate reset` (clean-slate).
- Phase 1's own verification (health endpoints direct + via Nginx, all 5 containers) re-confirmed working after the Dockerfile changes, since those changes touched shared infrastructure Phase 1 depended on.

## Known Minor Issues

- `apps/frontend` cannot `next build` natively on this Windows machine (Developer Mode disabled, blocking unprivileged symlinks) — pre-existing, documented in Phase 1, unaffected by this phase; verified via Docker instead.
- The visual ER diagram (brief deliverable, PNG/SVG export) is deferred to Phase 17 per the original deliverables list — this phase's schema-to-documentation fidelity was instead verified by direct manual cross-check against every entity table in `06-DATABASE-DESIGN.md`.

## Technical Debt

None knowingly introduced. The `PrismaHealthIndicator` built into `@nestjs/terminus` exists but wasn't used because its `pingCheck()` signature expects a raw `PrismaClient`, not our `$extends()`-composed type — a small custom indicator using the same `HealthIndicator` base class was written instead; revisit only if Terminus adds first-class support for extended clients.

## Documentation Updated

- `docs/06-DATABASE-DESIGN.md` — added `User` to the soft-delete scope list (already shown in the §3.1 ER diagram but missing from the §1 prose summary) and documented that `AuditLog.actorUserId` nullability represents system-triggered writes.
- `CLAUDE.md` — sharpened the `packages/types` rebuild warning with the specific failure symptom.
- This document.

## Final Gate

**PASS.** Every Phase 2 requirement is implemented and verified against a real PostgreSQL database, not mocked. Six non-trivial bugs were found through actually running the system (not just reading code) and root-caused per the quality protocol, including one — the Alpine/OpenSSL runtime crash — that would otherwise have silently broken the Phase 16 production deployment path. Awaiting explicit instruction: **"START PHASE 3."**
