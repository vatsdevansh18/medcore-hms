# Phase 3 Review — Authentication, Sessions & RBAC

**Phase:** 3 — Authentication, Sessions & RBAC
**Date:** 2026-09-23
**Gate status:** **PASS**

## Objective

Build the `AuthModule` (register/login/refresh/logout/verify-email/verify-phone/forgot-reset-password), refresh-token rotation with reuse detection, the global `JwtAuthGuard`/`RolesGuard` chain, `TenantContextInterceptor` (Layer 1 tenancy enforcement wired to real authenticated requests for the first time), and rate limiting on auth routes.

## Implemented

- **Redis integration** (`src/redis/`) — first real use of Redis in the project: a `RedisModule` behind a DI token, wired into `/health/ready`.
- **Response/error infrastructure** (`src/common/errors/`, `src/common/filters/`, `src/common/interceptors/response-envelope.interceptor.ts`) — `AppException`, a global exception filter normalizing every thrown error into the standard envelope (`08-API-CONTRACT.md` §2), and a success-response envelope interceptor. Deferred from Phase 1/2 since nothing produced real domain responses yet; this is the first phase that does.
- **`TenantContextInterceptor`** (`src/common/tenancy/tenant-context.interceptor.ts`) — implements "TenantScopeGuard" from the architecture doc, built as a NestJS _Interceptor_ rather than a Guard (see Bugs Found — a Guard cannot keep `AsyncLocalStorage` context alive through the controller's execution).
- **`AuthModule`** (`src/auth/`) — 12 endpoints: register (patient self-registration only, per `07-RBAC-MATRIX.md` §3.2), verify-email, resend-email-otp, send-phone-otp, verify-phone, login, refresh, forgot-password, reset-password, logout, sessions (list/revoke), me. Two endpoints (`resend-email-otp`, `send-phone-otp`) go beyond the original `08-API-CONTRACT.md` table — documented there now.
- **`TokenService`** — access-token signing (JWT, 15 min) and refresh-token issue/rotate/revoke, with reuse detection (SEC-AUTHN-004): a rotated-out token isn't deleted but marked `rotated` and kept for a grace window, so a replay is traceable to the user and revokes their entire session family. Redis key design adapted from the brief's suggested `rt:{userId}:{deviceId}` to a token-hash-keyed scheme — documented in the service's own header comment (needed for reuse detection to work at all, since an opaque presented token carries no userId/deviceId to look up by).
- **`OtpService`** — 6-digit, 10-minute TTL, single-use, rate-limited OTPs (SEC-AUTHN-005) for email/phone verification.
- **`PasswordResetService`** — single-use 60-minute reset tokens (FR-AUTH-004), revokes all sessions on successful reset.
- **`OtpDeliveryStub`** — explicitly temporary, clearly logged stub standing in for Resend/Twilio (Phase 11's scope); the OTP generation/storage/verification logic it sits behind is fully real, not mocked.
- **Guards & decorators** — `JwtAuthGuard` (passport-jwt), `RolesGuard` (deny-by-default per SEC-AUTHZ-001 — a route with neither `@Public()` nor `@Roles()` is refused, not silently allowed), `@Public()`, `@Roles()`/`ALL_ROLES`, `@CurrentUser()`, `@BypassTenantScope()`.
- **Redis-backed rate limiting** (`src/common/throttler/`) — a real `ThrottlerStorage` implementation over Redis (fixed-window INCR+PEXPIRE), not the default in-memory storage, per `NFR-SCALE-001`/`03-ARCHITECTURE.md` §13. 1000 req/min general default, 100 req/15min on `AuthController` per the brief.
- **`User` schema gap fixed**: added required `firstName`/`lastName` (new migration `20260923074718_add_user_name_fields`) — Phase 2's schema had no name field anywhere (not on `User`, `DoctorProfile`, or `PatientProfile`), found while building the registration DTO.
- **`packages/types` enum refactor**: converted all Prisma-mirrored enums from real TS `enum` to `as const` object + derived union type, fixing a real cross-nominal-type incompatibility between Prisma's generated enums and this package's (see Bugs Found).
- **Log redaction extended** to cover request-body field paths (`password`, `newPassword`, `code`, `token`, etc.) per SEC-DATA-003, fulfilling the note left in Phase 1's logger config.

## Requirements Verified

| ID                                                                         | Status                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FR-AUTH-001` through `FR-AUTH-008`                                        | Verified — register/verify/login/refresh/forgot/reset/sessions/me all implemented and e2e-tested against a real running app                                                                                                                                     |
| `FR-RBAC-001`/`FR-RBAC-002`                                                | Verified — deny-by-default guard, tested against a real restricted route                                                                                                                                                                                        |
| `FR-TENANT-003`                                                            | Verified — `TenantContextInterceptor` only honours `@BypassTenantScope()` for `SUPER_ADMIN`                                                                                                                                                                     |
| `SEC-AUTHN-001` through `SEC-AUTHN-007`                                    | Verified — bcrypt cost from config, 256-bit JWT secret validated at boot, hashed opaque refresh tokens, rotation+reuse detection (mandatory scenario, see below), rate-limited OTPs, no-enumeration on forgot-password and login, generic login failure message |
| `SEC-AUTHZ-001` through `SEC-AUTHZ-003`                                    | Verified — deny-by-default, global guard registration, claims-only authorization                                                                                                                                                                                |
| Mandatory scenario: "refresh token cannot be reused after rotation"        | **Verified end-to-end**, both manually (curl against a live server) and as an automated e2e test                                                                                                                                                                |
| Mandatory scenario: "unauthorized role cannot access a protected endpoint" | Verified via a dedicated `DOCTOR`-only test route (no real role-restricted business route exists until Phase 4+)                                                                                                                                                |

## Files / Modules Changed

`apps/backend/src/auth/` (new — 20 files: module, controller, service, 3 sub-services, 6 DTOs, 2 guards, 4 decorators, strategy, 2 interfaces), `apps/backend/src/redis/` (new), `apps/backend/src/common/{errors,filters,interceptors,throttler}/` (new), `src/common/tenancy/tenant-context.interceptor.ts` (new), `src/health/redis.health-indicator.ts` (new), `src/app.module.ts` (global guards/interceptors/filter wiring), `src/main.ts` (cookie-parser), `apps/backend/prisma/schema.prisma` + new migration (`firstName`/`lastName`), `apps/backend/prisma/seed.ts` (populate new fields), `packages/types/src/enums.ts` (enum→const-object refactor), `docs/08-API-CONTRACT.md` (two added endpoints documented).

## Tests Executed

| Suite                                                                             | Result                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm run typecheck` (workspace)                                                  | PASS                                                                                                                |
| `pnpm run lint` (workspace)                                                       | PASS                                                                                                                |
| `pnpm run test` (unit)                                                            | PASS — 2/2                                                                                                          |
| `apps/backend` `test:e2e` (5 suites, real Postgres+Redis)                         | **PASS — 33/33**, run twice consecutively for idempotency                                                           |
| `docker compose build && up` (full stack)                                         | PASS — `/health/ready` reports both DB and Redis up, direct and via Nginx                                           |
| Full manual curl walkthrough against the live containerized stack (through Nginx) | PASS — register → verify-email (OTP read from container logs) → login → `/auth/me`, matching the automated coverage |

`test/auth.e2e-spec.ts` (new, 17 tests) covers: registration + OTP verification + wrong-code rejection; registration against a nonexistent hospital; unverified accounts cannot log in; login issues a token + httpOnly/SameSite=Strict refresh cookie; wrong password and unknown email produce an identical error (no enumeration); **the mandatory refresh-reuse-detection scenario** (rotate → replay of old token fails → the legitimately-rotated new token is _also_ now dead, proving whole-family revocation); garbage/missing refresh tokens rejected without a 500; no-token and garbage-token requests to a protected route rejected; a valid token returns the caller's own profile; **a PATIENT is rejected from a DOCTOR-only route** (mandatory RBAC scenario); forgot-password 200s for both known and unknown emails; a successful password reset revokes the prior session and the old password stops working; an invalid reset token is rejected; session listing and "revoke all" work and actually invalidate the refresh cookie.

## Security Review

- `.env`'s `JWT_ACCESS_SECRET` is a freshly generated 256-bit random value, not the `.env.example` placeholder — confirmed distinct.
- Refresh tokens are never stored in plaintext anywhere (Redis holds only the SHA-256 hash; Postgres `RefreshTokenSession.tokenHash` likewise).
- Verified manually that login/register/forgot-password responses never differ in a way that reveals account existence (identical error bodies compared byte-for-byte in the e2e test).
- Verified the log redaction change doesn't interfere with the OTP dev-stub's own deliberately-readable log line (the stub logs a plain message string, not a structured `code` field, so it isn't touched by the new redaction paths — confirmed by reading the actual log output during manual testing).
- Rate-limit headers (`X-RateLimit-*`) confirmed present on real responses; Redis-backed storage confirmed via direct observation of `throttle:*` keys existing after requests (not spot-checked further — full rate-limit-exhaustion testing deferred to Phase 15 hardening, noted below).

## UI/UX Review

Not applicable — no frontend work this phase.

## Bugs Found

Ten non-trivial issues found and root-caused, not patched around:

1. **`Prisma.ModelName` enum-interop failure** — Prisma's generated `UserRole` enum and `@medcore/types`'s hand-written `UserRole` enum are structurally identical but nominally incompatible (two TS `enum`s with matching members aren't mutually assignable). Root-caused and fixed at the source: converted every Prisma-mirrored enum in `packages/types` to the `as const` object + derived union-type pattern, which Prisma's enum members (branded string literals) are assignable to without a cast. This was going to recur in every future phase touching both Prisma results and shared-type signatures, so fixing it now rather than casting at each call site was the right scope.
2. **`User` had no name field anywhere** — not on `User`, `DoctorProfile`, or `PatientProfile` (a genuine Phase 2 schema gap, found while writing `RegisterDto`). Fixed with a new migration adding `firstName`/`lastName` to `User`; seed script updated to populate them.
3. **`AsyncLocalStorage` context lost across nested Prisma calls when the outer `TenantContext.run()`/`.bypass()` callback isn't itself `async`** — reproduced in isolation with a minimal repro script (bisecting "works" vs. "fails" by toggling only the callback's `async` keyword), root-caused precisely, and fixed inside `TenantContext` itself (wraps every callback in an internal `async () => callback()`) so the fix can't be undone by a future call site's style choice. Full mechanism documented in `tenant-context.ts`.
4. **`TenantScopeGuard` cannot be a Guard** — a Guard's `canActivate()` only controls the synchronous window _before_ the controller runs; by the time the controller (and the services/Prisma calls it makes) execute, whatever `AsyncLocalStorage` context a Guard established has already unwound. Built as `TenantContextInterceptor` instead, which wraps `next.handle()` — the NestJS construct that actually spans the controller's execution. Documented as a deliberate naming/implementation split from the architecture doc.
5. **Circular import between `redis.module.ts` and `RedisThrottlerStorageService`** — the module imported the service to register it; the service imported the `REDIS_CLIENT` token back from the module. Left the token `undefined` at evaluation time, surfacing as a DI resolution failure only at boot, not at compile time. Fixed by extracting the token into a standalone `redis.constants.ts` both sides import from.
6. **`ThrottlerModule.forRootAsync`'s `inject` couldn't resolve `RedisThrottlerStorageService`** — it was registered directly on `AppModule`, but `forRootAsync`'s factory only resolves from the modules listed in _its own_ `imports`. Fixed by moving the service into `RedisModule` (where it belongs anyway, being Redis-specific), which `ThrottlerModule.forRootAsync` already imports.
7. **`/health` and `/health/ready` returned 401** after wiring the global guards — main.ts's global-prefix _exclusion_ for these paths only affects URL prefixing, not guard application; the global `JwtAuthGuard`/`RolesGuard` still ran against them. Found immediately by actually curling the endpoint after boot, not just observing a clean startup log. Fixed with `@Public()` + `@SkipThrottle()` on `HealthController`.
8. **`jwt-auth.guard.ts` missing `override` modifier** — caught by `tsc` under our strict config; one-line fix.
9. **Test fixture bugs** (not production code): three e2e test files' `prisma.user.create` calls didn't include the newly-required `firstName`/`lastName`, breaking the build — fixed by updating the fixtures, not by loosening the schema requirement.
10. **`EADDRINUSE` during manual verification** — a stale backgrounded `node` process from an earlier boot attempt held port 3001; found and killed via `netstat`/`taskkill` rather than picking a different port to work around it.

## Fixes Applied

See Bugs Found — every item fixed at its root cause and re-verified (typecheck, lint, full e2e suite, and either a live boot or a Docker Compose cycle) before being considered resolved.

## Regression Checks

- Full workspace `lint`/`typecheck`/unit tests re-run after every fix, not just the one that seemed related.
- Full e2e suite (all 5 files, 33 tests) re-run after each schema/module change, twice consecutively for idempotency.
- Phase 1/2's own health-check and tenancy/audit/concurrency coverage re-confirmed passing throughout — nothing in this phase's guard/interceptor/schema changes regressed earlier phases.
- Re-verified the full containerized stack (Docker Compose + Nginx) after all fixes, not just the native dev-server path.

## Known Minor Issues

- Rate-limit _exhaustion_ (actually hitting the 100/15min or 1000/min ceiling and confirming a `429 RATE_LIMITED` response) was confirmed structurally (headers present, Redis keys observed) but not driven to actual exhaustion in an automated test — deferred to Phase 15 hardening, where it belongs alongside the other adversarial/load-shaped tests.
- `apps/frontend` still cannot `next build` natively on this Windows machine (pre-existing, documented in Phase 1; verified via Docker instead, unaffected).

## Technical Debt

None knowingly introduced. `OtpDeliveryStub` is an explicitly-labeled temporary stand-in for Phase 11's real Resend/Twilio wiring — tracked, not hidden, and the interface (`OtpDeliveryPort`) it implements means Phase 11 swaps the implementation without touching `OtpService`/`PasswordResetService`.

## Documentation Updated

- `docs/08-API-CONTRACT.md` — documented the two endpoints (`resend-email-otp`, `send-phone-otp`) added beyond the original table, with rationale.
- `CLAUDE.md` — four new durable conventions: the enum pattern, "schema change ⇒ migration in the same change," "AsyncLocalStorage cross-cutting concerns need an Interceptor not a Guard," and the circular-import-token pattern.
- This document.

## Final Gate

**PASS.** Every Phase 3 requirement is implemented and verified against a real running application — including the two scenarios this phase's own extra gate criteria named explicitly (refresh-reuse-detection, cross-tenant/RBAC enforcement). Ten real bugs were found by actually booting and exercising the system (not just reading code or trusting a clean compile) and root-caused per the quality protocol, including three — the `AsyncLocalStorage`/Prisma interaction, the Guard-vs-Interceptor architecture correction, and the `/health` 401 regression — that would have been easy to ship broken if verification had stopped at "the app starts." Awaiting explicit instruction: **"START PHASE 4."**
