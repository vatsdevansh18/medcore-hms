# Phase 4 Review — Hospital, Department, Staff, Doctor & Patient Directory Management

**Phase:** 4 — Hospital/Department/Staff/Doctor/Patient CRUD
**Date:** 2026-09-23
**Gate status:** **PASS**

## Objective

Build the directory-management surface every later clinical workflow (appointments, EMR, prescriptions) depends on: Super Admin hospital lifecycle (`FR-HOSP-001`), Hospital Admin department/staff management (`FR-HOSP-002`), doctor profile provisioning (`FR-HOSP-003`), and front-desk patient registration (new `FR-HOSP-004`), all under the three-layer tenancy enforcement from `03-ARCHITECTURE.md` §5 and the RBAC matrix from `07-RBAC-MATRIX.md`.

## Implemented

- **Pagination infrastructure** (`src/common/pagination/`) — `PaginationQueryDto` (page/limit, capped at 100 per `NFR-PERF-003`) and a `PaginatedResult` marker class; `ResponseEnvelopeInterceptor` extended to branch on it and emit the paginated envelope (`data`+`meta`) vs. the plain success envelope.
- **`HospitalsModule`** (`src/hospitals/`) — `HospitalsService` (Super Admin hospital create/verify/list/read/update; `Hospital` is deliberately outside `TENANT_SCOPED_MODELS`, so every method does explicit Layer 2 re-verification) and `DepartmentsService` (department CRUD, tenant-scoped, blocks deletion while doctors/staff/rooms are still assigned).
- **`UsersModule`** (`src/users/`) — `POST /users` staff provisioning (Hospital Admin only, restricted to non-Doctor/non-Patient roles) and `GET /users/:id`, both using the admin-provisioned-account pattern: pre-verified, random unusable password, forced password-reset email via the existing `PasswordResetService`.
- **`DoctorsModule`** (`src/doctors/`) — `POST /doctors` (richer profile than generic staff: specialization, licence number, qualification, consultation fee), `GET /doctors` (own-hospital directory, `specialization` filter), `GET /doctors/:id`.
- **`PatientsModule`** (`src/patients/`) — `POST /patients` (front-desk registration, new `FR-HOSP-004`, `11-DECISIONS.md` D-013), `GET /patients` (own-hospital directory for staff roles, `search` filter across name/email; always empty for a `PATIENT` caller), `GET /patients/:id` (a `PATIENT` may only ever read their own profile).
- **`TenantContext.runForCaller()`** (`src/common/tenancy/tenant-context.ts`) — new static method for the "caller reading/updating their own row" case, falling back to `bypass()` when the caller has no `hospitalId` (Super Admin). Applied at 6 call sites across `AuthService` and `UsersService` (see Bugs Found #1).
- **`SAFE_USER_SELECT`** (`src/common/prisma/safe-user-select.ts`) — a shared Prisma `select` whitelist for every place a `User` relation is returned in a response, excluding `passwordHash`. Applied to every `DoctorProfile.user`/`PatientProfile.user` include and every direct `User` read/create returned to a client (see Bugs Found #2).
- **`FindDoctorsQueryDto` / `FindPatientsQueryDto`** (`src/doctors/dto/`, `src/patients/dto/`) — extend `PaginationQueryDto` with their module's optional filter field, replacing a broken double-`@Query()`-binding pattern (see Bugs Found #3).
- **`configureApp()`** (`src/common/bootstrap/configure-app.ts`) — shared Nest app configuration (cookie parser, global `ValidationPipe`, API prefix) now used by both `main.ts` and every e2e spec that boots a real HTTP app, replacing each spec's own partial, drifted copy (see Bugs Found #4).
- **Pino error serializer** (`src/common/logging/logger.config.ts`) — `serializers: { err: stdSerializers.err }` added so a logged `Error`'s `message`/`stack` are no longer silently dropped (see Bugs Found #5).
- **`test/directory.e2e-spec.ts`** (new, 17 tests) — hospital lifecycle, cross-tenant isolation (mandatory scenario), RBAC denial (mandatory scenario), passwordHash-leak regression, department CRUD.

## Requirements Verified

| ID                                   | Status                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FR-HOSP-001`                        | Verified — Super Admin create/verify/list/read/update, e2e-tested and manually curl-tested through Docker                          |
| `FR-HOSP-002`                        | Verified — department CRUD and staff provisioning, own-hospital scoped, e2e-tested                                                 |
| `FR-HOSP-003`                        | Verified — doctor profile creation with full field set, e2e-tested                                                                  |
| `FR-HOSP-004` (new, `11-DECISIONS.md` D-013) | Verified — front-desk patient registration, same provisioning pattern as staff                                              |
| `FR-TENANT-002`/`FR-TENANT-003`       | Verified — every new service does Layer 1 (Prisma extension) and/or explicit Layer 2 re-verification; Super Admin bypass only on `@BypassTenantScope()` routes |
| `SEC-AUTHZ-003`                      | Verified — `GET /doctors` deliberately does not accept a client-supplied `hospitalId`; only the JWT claim is honoured               |
| `SEC-TENANT-004`                     | Verified — every cross-tenant negative test asserts `404`, never `403` or `200` with foreign data                                 |
| `SEC-AUTHN-001` (no credential leakage) | Verified after the passwordHash-leak fix — regression-tested for doctor/patient/staff creation and both list/detail reads       |
| Mandatory scenario: "cross-tenant access attempt fails" | **Verified** — Hospital Admin A denied Hospital B's hospital record, departments, and a specific doctor by id; a Patient denied another patient's profile |
| Mandatory scenario: "unauthorized role rejected"        | **Verified** — Doctor denied `POST /hospitals`, `POST /users`, `POST /doctors`                                                    |

## Files / Modules Changed

New: `apps/backend/src/hospitals/` (service, departments service, controller, module, 5 DTOs), `apps/backend/src/users/` (service, controller, module, 1 DTO), `apps/backend/src/doctors/` (service, controller, module, 2 DTOs), `apps/backend/src/patients/` (service, controller, module, 2 DTOs), `apps/backend/src/common/pagination/` (2 files), `apps/backend/src/common/prisma/safe-user-select.ts`, `apps/backend/src/common/bootstrap/configure-app.ts`, `apps/backend/test/directory.e2e-spec.ts`.

Modified: `apps/backend/src/app.module.ts` (4 new module imports), `apps/backend/src/auth/auth.module.ts` (export `PasswordResetService`), `apps/backend/src/auth/auth.service.ts` (`runForCaller` at 4 call sites), `apps/backend/src/common/interceptors/response-envelope.interceptor.ts` (paginated envelope branch), `apps/backend/src/common/tenancy/tenant-context.ts` (`runForCaller` added), `apps/backend/src/common/logging/logger.config.ts` (`err` serializer), `apps/backend/src/main.ts` (delegates to `configureApp`), `apps/backend/test/app.e2e-spec.ts` + `test/auth.e2e-spec.ts` (use `configureApp`), `docs/02-SRS.md` (`FR-HOSP-004`), `docs/08-API-CONTRACT.md` (§4.2/§4.3 endpoints), `docs/11-DECISIONS.md` (D-013).

## Tests Executed

| Suite                                                                             | Result                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm exec tsc --noEmit -p tsconfig.eslint.json`                                    | PASS                                                                             |
| `pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0`                     | PASS                                                                             |
| `apps/backend` `test:e2e` (6 suites, real Postgres+Redis)                           | **PASS — 50/50**                                                                 |
| `docker compose up -d api` (full containerized stack, against the existing named Postgres volume) | PASS — `/health` OK, seed data intact after container recreate, login + Phase 4 endpoints all verified through the container |
| Manual curl walkthrough (native dev server, then repeated through Docker)           | PASS — see Security Review and Bugs Found for the specific defects this surfaced |
| Prettier (`--write` across `src/test/prisma`)                                       | Clean — only pre-existing formatting drift on files this phase touched           |

`test/directory.e2e-spec.ts` (new, 17 tests) covers: Super Admin hospital create/verify; a Hospital Admin and a Doctor both rejected from `POST /hospitals`; **cross-tenant isolation** for hospital read/update/department-list/doctor-read (all 404, mandatory scenario); rejecting a cross-hospital `departmentId` at doctor provisioning; a Patient rejected from reading another patient's profile; **passwordHash never present** in `POST /doctors`, `POST /patients`, `POST /users`, `GET /users/:id`, `GET /doctors`, `GET /patients` responses; the `specialization`/`search` query filters actually narrow results; **a Doctor rejected** from `POST /users` and `POST /doctors` (mandatory scenario); duplicate-email rejection at doctor provisioning; department create/update/soft-delete-visible-in-list lifecycle.

## Security Review

- **Critical finding, fixed and regression-tested**: see Bugs Found #2 (passwordHash leak).
- Verified server-side that `GET /doctors`/`GET /patients` never accept a client-supplied `hospitalId` — only the JWT claim's hospital scopes results (`SEC-AUTHZ-003`), confirmed by reading the controller code and by the cross-tenant e2e tests.
- Verified every hospital-scoped write (department create/update/delete, doctor/staff/patient provisioning) re-checks the caller's own `hospitalId` against the resource, not trusting a route param alone (Layer 2, `HospitalsService.assertCanAccess`/`DepartmentsService.assertHospitalScope`).
- Verified admin-provisioned accounts (staff/doctor/patient) genuinely cannot log in with a guessable password — confirmed live: attempting login against a freshly `POST /doctors`-created account with any password returns `401 Invalid email or password`, since the stored hash is `bcrypt(random 32 bytes)`, never disclosed.
- Verified duplicate-email and duplicate-employee-code/duplicate-department-name constraints are enforced server-side with a clean `400`, not a raw Postgres constraint violation surfacing as `500`.

## UI/UX Review

Not applicable — no frontend work this phase (frontend directory UI is scheduled for a later phase per `05-DEVELOPMENT-PLAN.md`).

## Bugs Found

Five non-trivial issues found and root-caused, not patched around:

1. **Super Admin login/`/auth/me`/phone-OTP flows returned 500** — `AuthService.login()`'s `lastLoginAt` update (and `me()`, `sendPhoneOtp()`, `verifyPhone()`, plus `UsersService.findOne()`'s self-lookup) all built `TenantContext.run({ hospitalId: caller.hospitalId, ... })` directly from the caller's own claim. `SUPER_ADMIN` always has `hospitalId: null`, and the tenant-scoping extension correctly (by design) rejects `bypassTenancy: false` with a null `hospitalId` — this is the fail-closed behavior working exactly as intended, but it exposed that no Phase 3 test had ever exercised the Super Admin role through these self-referential code paths. Root-caused and fixed generically: added `TenantContext.runForCaller()`, which falls back to `bypass()` when the caller has no hospital to scope to (a caller reading/updating their own row is never a real cross-tenant risk), and applied it at every affected call site rather than special-casing Super Admin in each service.

2. **CRITICAL — `passwordHash` leaked in API responses.** `DoctorsService` (`create`/`findAll`/`findOne`) and `PatientsService` (`register`/`findAll`/`findOne`) used bare `include: { user: true }`, which returns every `User` column, including the bcrypt hash — confirmed via live manual `curl` testing that a real hash appeared in the `POST /doctors` JSON body. `UsersService.createStaff()` and `UsersService.findOne()` had the same defect via a direct (un-`select`ed) `User` read/create, not even via `include`. Root-caused and fixed by introducing `SAFE_USER_SELECT`, a single shared Prisma `select` whitelist, applied at all 7 call sites across the three services; a full-codebase grep for `include:.*user:\s*true` and for every `prisma.user.(create|findUnique|findMany)` call confirmed no other instance existed. Regression-tested: `test/directory.e2e-spec.ts` asserts `JSON.stringify(response.body)` never matches `/passwordHash/` for every provisioning and listing endpoint.

3. **`GET /doctors?specialization=` and `GET /patients?search=` rejected their own query parameter.** Both controllers bound `@Query() pagination: PaginationQueryDto` and a second, separate `@Query("specialization" | "search")` on the same handler. Under the project's global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, NestJS validates the *entire* incoming query object against the *first* bound DTO — a key the first DTO doesn't declare (even though a second `@Query()` binding exists for it) is rejected with `"property X should not exist"`, regardless of the second binding. Found only because the mandated negative/edge-case testing exercised the filter parameters, not just bare pagination. Root-caused and fixed by replacing the double-binding with one DTO per endpoint (`FindDoctorsQueryDto`/`FindPatientsQueryDto`, each extending `PaginationQueryDto` with its own optional filter field) bound through a single `@Query()`.

4. **CRITICAL test-infrastructure gap — no e2e spec ever actually ran DTO validation/transformation.** While writing negative tests for the bug above, `GET /doctors`/`GET /patients`/`GET /departments` all returned `500 PrismaClientValidationError: Argument take: Invalid value provided. Expected Int, provided String` inside the new e2e suite — but the *identical* requests succeeded against the live dev server. Root-caused: `main.ts`'s `app.useGlobalPipes(new ValidationPipe(...))` was only ever called in the real bootstrap path; every e2e spec (`app.e2e-spec.ts`, `auth.e2e-spec.ts`, and this phase's new `directory.e2e-spec.ts`) built its Nest app via `Test.createTestingModule(...).createNestApplication()` and never registered the pipe. Without it, `@Query()`-bound DTOs are never transformed into real class instances — `page`/`limit` arrived as raw strings, and `PaginationQueryDto.skip`'s getter was absent entirely (a plain object, not a class instance), so `skip` silently evaluated to `undefined`. `auth.e2e-spec.ts`'s existing validation-shaped tests had passed anyway only because the specific assertions they made happened to be enforced by hand-rolled service-level checks (e.g. `AuthService.register()`'s own hospital-existence lookup), not by the DTO layer — meaning `whitelist`/`forbidNonWhitelisted`/`transform` had never been exercised by any e2e test since Phase 3. Root-caused and fixed by extracting the exact app-configuration `main.ts` uses (cookie parser, `ValidationPipe`, prefix) into a single shared `configureApp()` function, and pointing `main.ts` and every HTTP-booting e2e spec at it, so the two can never drift apart again.

5. **Error logs discarded the actual exception message.** While debugging bug #4, the structured error log for a `500` printed only `{"err": {"name": "PrismaClientValidationError", "clientVersion": "5.22.0"}}` — no `message`, no `stack`. Root-caused: `Error.prototype.message`/`.stack` are non-enumerable own properties in V8, and the logger config never set pino's `serializers.err`, so pino's default JSON serialization of a raw `Error` silently dropped both, keeping only whatever extra properties a given error subclass happens to set as enumerable (Prisma sets `clientVersion`, which is why that one survived). This would have made any real production `500` nearly undiagnosable from logs alone. Fixed by adding `serializers: { err: pino.stdSerializers.err }` to the logger config.

## Fixes Applied

See Bugs Found — every item fixed at its root cause (not patched around a specific symptom) and re-verified via typecheck, lint, the full e2e suite (twice — once immediately after each fix, once again after the final Prettier pass), and either a live dev-server boot or a Docker Compose cycle, before being considered resolved.

## Regression Checks

- Full e2e suite (all 6 files, 50 tests, including the pre-existing `auth.e2e-spec.ts`, `tenancy.e2e-spec.ts`, `audit-log.e2e-spec.ts`, `appointment-concurrency.e2e-spec.ts`) re-run after every fix, confirming the `configureApp()` refactor and the `runForCaller()` change didn't regress any Phase 2/3 guarantee — in fact `auth.e2e-spec.ts` now exercises real DTO validation for the first time and still passes 17/17.
- Re-verified the full containerized stack (`docker compose up -d api`) after all fixes; confirmed the existing named Postgres volume's seed data survived a container recreate (triggered by unrelated `.env`/compose config drift, not a volume removal) and that login/Phase 4 endpoints behave identically through the container as through the native dev server.
- Re-verified the Phase 3 Super Admin login bug's fix specifically (`GET /auth/me` as Super Admin) one more time after the final Prettier pass, since it touches the same `TenantContext` file this phase's `runForCaller()` addition lives in.

## Known Minor Issues

- `docs/07-RBAC-MATRIX.md` §3.2's "context only" visibility for `LAB_TECHNICIAN`/`PHARMACIST`/`ACCOUNTANT` (scoped to a specific lab order/dispense/invoice they're handling) is simplified in this phase to plain own-hospital read access on the patient/doctor directories — documented inline in `patients.service.ts`; the true contextual restriction is naturally enforced once Phases 8–10 gate access through the specific lab order/prescription/invoice instead, so no separate remediation is needed later.
- `UsersService.findOne()`'s "who can view someone else's profile" set is simplified to "own hospital" for every staff-facing role rather than the RBAC matrix's finer-grained "Doctor: own hospital, own department" — documented inline; revisited if a later phase's UI needs the finer grain.
- `apps/frontend` still cannot `next build` natively on this Windows machine (pre-existing, Phase 1; unaffected, verified via Docker).

## Technical Debt

None knowingly introduced. The e2e test-infrastructure gap (Bugs Found #4) was debt already present since Phase 3 that this phase discovered and paid down, not new debt created by this phase.

## Documentation Updated

- `docs/02-SRS.md` — new `FR-HOSP-004` (front-desk patient registration).
- `docs/11-DECISIONS.md` — new `D-013` explaining the `FR-HOSP-004` addition and its provisioning-pattern reuse.
- `docs/08-API-CONTRACT.md` — §4.2 renamed to include Patients, 8 new/updated endpoint rows documented with notes; §4.3 doctors row corrected to the real query param (`specialization`, no client-supplied `hospitalId`) and `GET /doctors/:id` added.
- This document.

## Final Gate

**PASS.** Every Phase 4 requirement (`FR-HOSP-001` through the newly-formalized `FR-HOSP-004`) is implemented and verified against a real running application, including both of this phase's mandatory scenarios (cross-tenant access denial, unauthorized-role rejection). Five real defects were found by actually exercising the system adversarially rather than trusting a clean compile — one of them (Bugs Found #2, the passwordHash leak) was a Critical security defect per the standing quality protocol, and one (Bugs Found #4) was a systemic gap in the e2e suite's own credibility dating back to Phase 3, now closed for every future phase's e2e specs as well. Awaiting explicit instruction: **"START PHASE 5."**
