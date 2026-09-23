# Phase 5 Review — Appointments & Scheduling

## Phase

Phase 5 — Appointments & Scheduling

## Objective

Deliver doctor availability management (recurring weekly pattern + date exceptions), patient/receptionist appointment booking against computed open slots, database-enforced double-booking prevention, the appointment status lifecycle state machine, emergency (doctor-attention-bypass) appointments, and BullMQ-scheduled reminder jobs — `FR-APPT-001` through `FR-APPT-007`, with the phase's own extra gate (a genuinely concurrent double-booking test) passing.

## Implemented

- **`AvailabilityService`** (`apps/backend/src/doctors/availability.service.ts`) — recurring weekly `DoctorAvailability` rows plus per-date `DoctorAvailabilityException` overrides (full-day block or custom hours), with `computeAvailability` deriving open slots for a date range by subtracting exceptions and already-booked (non-`CANCELLED`/`NO_SHOW`) `Appointment` rows from the recurring pattern. Past-time slots are excluded. Range capped at 31 days per request.
- **Doctor availability endpoints** on `DoctorsController`: `GET/PUT /doctors/:id/availability`, `POST /doctors/:id/availability-exceptions`, RBAC-gated per `docs/07-RBAC-MATRIX.md` §3.3.
- **`AppointmentsModule`** (`apps/backend/src/appointments/`) — `AppointmentsService`/`AppointmentsController` implementing:
  - `POST /appointments` — patient (self) / receptionist (on behalf) booking against a genuinely open, schedule-aligned slot.
  - `POST /appointments/emergency` — doctor/receptionist emergency booking, bypasses slot-availability but not the doctor double-booking constraint; immediately `CONFIRMED`.
  - `GET /appointments`, `GET /appointments/:id` — role-scoped list/detail.
  - `PATCH /appointments/:id/status` — state-machine-gated transitions per role (`ALLOWED_TRANSITIONS` table, sourced from the RBAC matrix's per-role notes).
- **`QueueModule`** (`apps/backend/src/queue/`) — dedicated BullMQ Redis connection (`@nestjs/bullmq`), `AppointmentReminderQueueService` (schedule/cancel 24h and 1h reminder jobs, idempotent job IDs), `AppointmentReminderProcessor` (dev-stub delivery, logs a structured warning in place of real notification dispatch — Phase 11 wires the real channel).
- **Database enforcement**: `no_doctor_overlap`/`no_patient_overlap` `EXCLUDE USING gist` constraints (already migrated in Phase 2 per `D-005`) are the authoritative guard against double-booking; `AppointmentsService.translateBookingConflict` converts a DB-level rejection into a clean `409 SLOT_UNAVAILABLE` instead of a raw 500.

## Requirements Verified

| ID | Status | Notes |
| --- | --- | --- |
| FR-APPT-001 | PASS | Recurring pattern + exceptions; doctor self-management enforced (see Bugs Found #3) |
| FR-APPT-002 | PASS | Slot computation + booking against it; fabricated/misaligned slots rejected pre-DB |
| FR-APPT-003 | PASS | `no_doctor_overlap` exclusion constraint; verified live via direct-DB race probe and HTTP-layer concurrency test |
| FR-APPT-004 | PASS | `no_patient_overlap` exclusion constraint; verified in `appointment-concurrency.e2e-spec.ts` (pre-existing from Phase 2/3) |
| FR-APPT-005 | PASS | State machine restricts transitions per role; illegal transitions rejected |
| FR-APPT-006 | PASS | Emergency bypass verified to skip slot checks but still respect doctor overlap constraint |
| FR-APPT-007 | PASS | 24h/1h reminder jobs scheduled on `CONFIRMED`, cancelled on `CANCELLED`; verified against the real BullMQ/Redis queue |
| Extra gate — concurrent double-booking | PASS (after fix) | See Bugs Found #2 |

## Files/Modules Changed

New:
- `apps/backend/src/appointments/` (module, controller, service, DTOs)
- `apps/backend/src/doctors/availability.service.ts`
- `apps/backend/src/doctors/dto/availability-slot.dto.ts`, `create-availability-exception.dto.ts`, `get-availability-query.dto.ts`
- `apps/backend/src/queue/` (module, queue service, processor, constants, dev-stub delivery)
- `apps/backend/test/appointments.e2e-spec.ts`

Modified:
- `apps/backend/src/doctors/doctors.controller.ts`, `doctors.module.ts` — availability endpoints wired in
- `apps/backend/src/app.module.ts` — `QueueModule`, `AppointmentsModule` registered
- `apps/backend/package.json` — `@nestjs/bullmq`, `bullmq` dependencies
- `apps/backend/test/jest-e2e.json` — `transformIgnorePatterns` to let `ts-jest` transform `@nestjs/bullmq` (pure-ESM package; see Bugs Found #4)
- `docs/08-API-CONTRACT.md` §4.3 — corrected the availability-read row to state Doctor's "self only" restriction explicitly
- `docs/11-DECISIONS.md` — new `D-014`, documenting that `D-009`'s Redis caching and dedicated unit tests were not implemented this phase (see Known Minor Issues / Technical Debt)

Pre-existing, unmodified, exercised by this phase's gate: `apps/backend/test/appointment-concurrency.e2e-spec.ts` (DB-layer exclusion-constraint proof, written in Phase 2/3 before `AppointmentsModule` existed).

## Tests Executed

- `pnpm exec tsc --noEmit -p tsconfig.eslint.json` (backend)
- `pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` (backend)
- Full e2e suite: `pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json`
- `docker compose build api` (image build)
- Targeted repeated runs of `appointments.e2e-spec.ts` (12+ full-spec runs across the session) to hunt the intermittent concurrency failure described below
- A standalone direct-to-Postgres concurrency probe (25 truly-concurrent insert pairs against the `no_doctor_overlap` constraint, bypassing HTTP/service layers) to identify the exact Postgres error code under contention

## Test Results

- Typecheck: **PASS**, zero errors.
- Lint: **PASS**, zero errors/warnings.
- Full e2e suite (final run): **PASS**, 66/66 tests, 7/7 suites (`app`, `auth`, `directory`, `tenancy`, `audit-log`, `appointment-concurrency`, `appointments`).
- Docker build: **PASS**.
- Concurrency race probe: 25/25 truly-concurrent insert pairs against the same slot produced exactly one success and one `40P01` (deadlock detected) failure — **never** `23P01` (exclusion violation) at this raw-DB layer, which is what led to Bugs Found #2 below.

## Security Review

- **Tenancy**: every service method scopes through `TenantContext.run`/`loadDoctorForCaller`-style patterns with the caller's own `hospitalId`; cross-tenant doctor/patient/appointment IDs resolve to `404`, not `403` or a leaked row, per `docs/08-API-CONTRACT.md` §6's information-disclosure rule. Verified live: a receptionist from Hospital B gets `404` on Hospital A's doctor availability and on booking against them (`appointments.e2e-spec.ts`).
- **RBAC**: `AppointmentsController`'s and `DoctorsController`'s `@Roles()` lists were checked line-by-line against `docs/07-RBAC-MATRIX.md` §3.3 for every row (book, emergency-book, status-update, read, set-availability, availability-exceptions) — all match exactly.
- **`SAFE_USER_SELECT`**: `APPOINTMENT_INCLUDE` uses `select: SAFE_USER_SELECT` for both `doctor.user` and `patient.user` relations; verified live that a `HOSPITAL_ADMIN` listing appointments never receives `passwordHash` in the response body.
- **State machine**: transition table cross-checked against the RBAC matrix's per-role notes (`NURSE` check-in only, `PATIENT` cancel-own-pending-only, etc.); illegal transitions tested and rejected with `400`.
- Bug found and fixed during this review: DOCTOR role could view any doctor's availability in the same hospital, not just their own (Bugs Found #3) — a real, previously-untested RBAC gap, now fixed and regression-tested.

## UI/UX Review

Not applicable — Phase 5 is backend-only per `docs/05-DEVELOPMENT-PLAN.md` (frontend appointment screens are scoped to a later phase). No new frontend surface was added or reviewed.

## Bugs Found

1. **e2e teardown FK violation (test infrastructure, not app code).** `appointments.e2e-spec.ts`'s `afterAll` deleted `User` rows before the `RefreshTokenSession` rows created by the spec's own `login()` calls, violating `RefreshTokenSession_userId_fkey` and failing the entire suite before any test ran. The established pattern (already used in `directory.e2e-spec.ts` and `auth.e2e-spec.ts`) deletes `refreshTokenSession` rows first.
2. **Concurrent booking intermittently returned `500` instead of `409` (real, Critical-severity application bug — the phase's own mandatory extra gate).** `AppointmentsService.translateBookingConflict` only recognized Postgres `23P01` (exclusion constraint violation, by constraint-name substring match) as a booking conflict. Two truly concurrent inserts into the same `EXCLUDE USING gist`-indexed row can also make Postgres detect a deadlock between the two transactions' index-page locks and abort the loser with `40P01` instead — confirmed via a direct-to-Postgres repro outside the app (25/25 truly-concurrent insert pairs raised `40P01`, never `23P01`). `40P01` fell through `translateBookingConflict`'s detection and was re-thrown as a raw, unrecognized error, which `HttpExceptionFilter` correctly refused to leak details for but surfaced as an unhelpful `500 INTERNAL_ERROR` to a client that had simply lost a fair booking race.
3. **A `DOCTOR` could view any doctor's availability in their hospital, not just their own (RBAC gap, untested).** `docs/07-RBAC-MATRIX.md` §3.3 gives `DOCTOR` explicitly "self" for "View doctor availability," narrower than `HOSPITAL_ADMIN`/`NURSE`/`RECEPTIONIST`/`PATIENT`'s "own hospital." `AvailabilityService.computeAvailability` only verified the target doctor belonged to the caller's hospital (the broader check), matching the write-path methods' `assertSelf` guard was missing on the read path. No test exercised this case in either direction.
4. **`@nestjs/bullmq` failed to load under `ts-jest`'s e2e config with an ESM parse error** (`@nestjs/bullmq` and `bullmq` ship as `type: "module"`). Root-caused to `ts-jest`'s default `transformIgnorePatterns` excluding all of `node_modules`, including this pure-ESM package.

## Fixes Applied

1. Added `await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: createdUserIds } } })` before the `user.deleteMany` call in `appointments.e2e-spec.ts`'s `afterAll`, matching the existing pattern elsewhere.
2. Extended `translateBookingConflict`'s detection regex to also match `40P01` (and the literal `23P01` code string, for robustness against message-format drift), with an inline comment recording the root cause and the direct-DB repro that proved it. Re-verified with 5 additional full-spec runs plus one full-suite run — no further `500`s.
3. Added an ownership check to `AvailabilityService.computeAvailability`: when `caller.role === UserRole.DOCTOR`, the target doctor's `userId` must equal the caller's `sub`, else `404 NOT_FOUND` (consistent with the existing cross-tenant information-disclosure convention — never `403`, since that would confirm the colleague's doctor-profile ID exists). Added a new regression test asserting both the denial (colleague) and the still-working self case.
4. Added `transformIgnorePatterns` to `apps/backend/test/jest-e2e.json` allowing `ts-jest` to transform `@nestjs/bullmq`/`@nestjs/bull-shared`/`bullmq` instead of skipping them.

## Regression Checks

- Full e2e suite re-run after every fix, not just the directly affected spec: final state is 66/66 passing across all 7 suites, including `auth`, `directory`, `tenancy`, `audit-log`, and the pre-existing `appointment-concurrency` DB-layer suite — none of Phase 5's changes altered their behavior.
- The concurrency fix (Bug #2) was specifically stress-tested: 5 additional full-spec runs of `appointments.e2e-spec.ts` after the fix, all green, plus the standalone race probe confirming the underlying `40P01` behavior is real and reproducible (not a one-off flake being papered over).
- Docker image rebuilt (`docker compose build api`) and the running container recreated and health-checked after all fixes, to confirm the containerized build path also picks up the changes cleanly (not just the native `ts-jest` path).

## Known Minor Issues

- None outstanding that block the gate. (Two items below are tracked as deliberate technical debt, not defects.)

## Technical Debt

- **`D-009`'s Redis caching of computed availability was not implemented** (see `docs/11-DECISIONS.md` `D-014` for the full reasoning). `AvailabilityService.computeAvailability` recomputes from the database on every call. Acceptable at current scale; deferred rather than added to a concurrency-sensitive shared code path without dedicated tests proving the cache-TTL/booking-race interaction is safe.
- **`D-009`'s promised dedicated unit tests for slot-computation logic were not written**; coverage is via e2e tests against a real database instead (arguably stronger for this specific logic, but not what was originally promised). Documented in `D-014` rather than left silently unful­filled.
- The reminder delivery channel remains a structured-log dev stub (`ReminderDeliveryStub`) by design — Phase 11 (Notifications & Background Jobs) wires the real channel per `docs/05-DEVELOPMENT-PLAN.md`.
- All wall-clock scheduling (`DoctorAvailability` times, `Appointment.scheduledStart/End`) is treated as UTC; `Hospital.timezone` is stored but not yet consulted — documented as a Phase 5 simplification in `AvailabilityService`'s header comment, not a new decision-log entry since it doesn't deviate from anything previously decided.

## Documentation Updated

- `docs/11-DECISIONS.md` — new `D-014`.
- `docs/08-API-CONTRACT.md` §4.3 — corrected `GET /doctors/:id/availability` auth description.
- This file.

## Final Gate

**PASS.** All seven `FR-APPT-*` requirements (and the phase's extra concurrency gate) are implemented and verified against a real database and real HTTP layer, including negative/adversarial paths (cross-tenant, wrong-role, illegal state transitions, fabricated slots, patient booking for others). Four bugs were found through the mandated adversarial/negative testing process — one test-infrastructure bug, one real Critical-severity 500-instead-of-409 booking-race bug, one untested RBAC gap, and one test-tooling ESM issue — and all four were root-caused and fixed, not worked around. Two items are recorded as explicit, documented technical debt (`D-014`) rather than silently shipped or silently deferred. Typecheck, lint, full e2e suite (66/66), and Docker build are all green as of this review.
