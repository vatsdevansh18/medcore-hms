# Security Architecture / Threat Model — MedCore HMS

**Version:** 1.0
**Status:** Approved; enforced continuously, not as a final phase
**Related documents:** `02-SRS.md` §4, `03-ARCHITECTURE.md` §5–6, §9, `07-RBAC-MATRIX.md`, `10-TESTING-STRATEGY.md`, `11-DECISIONS.md`

## 1. Identifier Scheme

`SEC-AUTHN-*` authentication · `SEC-AUTHZ-*` authorization/RBAC · `SEC-TENANT-*` tenancy · `SEC-DATA-*` data protection/encryption · `SEC-INPUT-*` input validation/injection/XSS · `SEC-NET-*` network/transport/headers · `SEC-AUDIT-*` audit logging · `SEC-FILE-*` file upload · `SEC-PAY-*` payment security.

## 2. Threat Model Summary (STRIDE-Oriented)

| Threat                                                           | Primary asset at risk              | Mitigation (ID)                                                                           |
| ---------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Spoofing a user identity                                         | Session/auth                       | bcrypt, JWT signature, refresh rotation+reuse detection (`SEC-AUTHN-*`)                   |
| Tampering with tenant-scoped IDs to read another hospital's data | Patient/clinical/financial records | Three-layer tenancy enforcement (`SEC-TENANT-*`)                                          |
| Repudiation of a clinical or billing action                      | Legal/audit trail                  | Immutable `AuditLog` on every write (`SEC-AUDIT-*`)                                       |
| Information disclosure of medical notes at rest                  | Clinical data                      | App-level field encryption (`SEC-DATA-001`)                                               |
| Information disclosure via verbose errors                        | Any                                | Normalised error envelope, no stack traces (`SEC-DATA-004`)                               |
| Denial of service via auth endpoint abuse                        | Availability                       | Rate limiting (`SEC-NET-003`)                                                             |
| Elevation of privilege via role/tenant confusion                 | All modules                        | RBAC guard chain, `07-RBAC-MATRIX.md` as enforced spec (`SEC-AUTHZ-*`)                    |
| Forged payment confirmation                                      | Billing integrity                  | Server never trusts client payment callback; webhook signature verification (`SEC-PAY-*`) |
| Malicious file upload                                            | Server/storage                     | MIME+extension allow-list, size cap, no public bucket (`SEC-FILE-*`)                      |

## 3. Authentication (`SEC-AUTHN`)

- **SEC-AUTHN-001** — Passwords hashed with bcrypt, cost factor ≥12. No password ever appears in a log, error message, or audit diff.
- **SEC-AUTHN-002** — JWT access tokens signed with a minimum 256-bit random secret (or asymmetric key in production), loaded only from environment configuration, never hard-coded or committed.
- **SEC-AUTHN-003** — Refresh tokens are opaque (not JWTs), 256-bit random, stored hashed (SHA-256) in Redis — the plaintext token exists only in the client's `httpOnly` cookie and the single response that issued it.
- **SEC-AUTHN-004** — Refresh rotation: every use issues a new token and revokes the old one atomically. If a revoked token is presented again, this is treated as evidence of token theft — the entire session family for that user is revoked, forcing re-authentication on all devices. This is the mechanism the mandatory "refresh token cannot be reused after rotation" test verifies.
- **SEC-AUTHN-005** — OTPs (email/phone) are 6 digits, rate-limited (max 5 attempts per OTP, max 3 OTP requests per 10 minutes per account), and single-use with a 10-minute TTL.
- **SEC-AUTHN-006** — `forgot-password` never reveals whether an email exists (uniform 200 response and timing-insensitive-enough behaviour) — prevents user enumeration.
- **SEC-AUTHN-007** — Login failures are rate-limited (100 req/15 min per IP, per the brief) and do not distinguish "wrong password" from "unknown email" in the response body.

## 4. Authorization (`SEC-AUTHZ`)

- **SEC-AUTHZ-001** — Every controller method carries an explicit `@Roles()` decorator; CI includes a static check that fails the build if a new controller method is added without one (implemented as a lint rule or a test that reflects over all routes).
- **SEC-AUTHZ-002** — `RolesGuard` is applied globally (`APP_GUARD`), not opt-in per module — a forgotten guard import can never leave a route unprotected.
- **SEC-AUTHZ-003** — Authorization decisions are made from the JWT's claims only; a request body or query parameter can never widen the caller's effective role or scope.

## 5. Tenancy (`SEC-TENANT`)

- **SEC-TENANT-001** through **003** — see `03-ARCHITECTURE.md` §5's three-layer model (automatic query scoping, service-layer re-verification, CI-blocking regression tests). Restated here as security controls, not just an architecture choice: a tenancy breach is classified as a **Critical** severity defect that blocks a phase gate outright, per the master build prompt's explicit instruction.
- **SEC-TENANT-004** — Cross-tenant lookups return `404`, not `403`, per `08-API-CONTRACT.md` §6, to avoid confirming another tenant's resource existence.

## 6. Data Protection & Encryption (`SEC-DATA`)

- **SEC-DATA-001** — `MedicalRecord.notes`/addendum text (and `Vitals`-adjacent free-text fields, if added) are encrypted at the application layer with AES-256-GCM before insert, using a per-environment data-encryption key sourced from environment configuration (production: a managed KMS-backed key). See `11-DECISIONS.md` D-008 for why this replaces raw Postgres `pgcrypto` SQL calls.
- **SEC-DATA-002** — TLS everywhere: HTTP is redirected to HTTPS at the Nginx edge; no plaintext traffic reaches the application tier in any deployed environment.
- **SEC-DATA-003** — A log-sanitising interceptor strips `password`, `passwordHash`, `token`, `refreshToken`, `otp`, `cvv`, `cardNumber`, `providerSecret`, and any field matching a configurable deny-list, from every log line, error report, and Sentry breadcrumb, before it leaves the process.
- **SEC-DATA-004** — API error responses never include stack traces, ORM error text, or internal file paths — only the standard `{code, message}` shape.
- **SEC-DATA-005** — Secrets (DB credentials, JWT secret, provider API keys) are never committed; `.env` is git-ignored from the first commit, `.env.example` documents every variable with a placeholder, and production secrets are injected via the deployment environment, not baked into images.

## 7. Input Validation & Injection Prevention (`SEC-INPUT`)

- **SEC-INPUT-001** — All DTOs validated with `class-validator`/`class-transformer`, `whitelist + forbidNonWhitelisted` enabled globally.
- **SEC-INPUT-002** — All database access goes through Prisma's parameterised query builder; `$queryRawUnsafe` with any interpolated value is forbidden by convention and code review — the only raw SQL in the codebase is the fixed, non-parameterised exclusion-constraint DDL in a migration file.
- **SEC-INPUT-003** — Any user-supplied HTML/rich text (e.g. treatment plan notes rendered back to the UI) is sanitised with DOMPurify on render; the API never trusts the frontend to have sanitised on the way in.
- **SEC-INPUT-004** — Zod schemas mirror backend DTOs on the frontend for early feedback, but are never treated as a security boundary — the backend re-validates unconditionally.

## 8. Network & Transport (`SEC-NET`)

- **SEC-NET-001** — Helmet.js enabled with the recommended security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, restrictive `Content-Security-Policy`).
- **SEC-NET-002** — CORS is a strict allow-list of the known frontend origin(s); no wildcard `*` in any environment, including development (development uses an explicit `http://localhost:3000` entry).
- **SEC-NET-003** — Rate limiting via `@nestjs/throttler` backed by Redis: 100 req/15 min per IP on auth endpoints, 1000 req/min general API, per the brief.
- **SEC-NET-004** — CSRF: refresh and session cookies are `SameSite=Strict`; state-changing requests additionally require the `Authorization` header (which a pure cross-site form post cannot forge), giving CSRF protection without a separate token scheme for the JSON API surface. A dedicated CSRF token is added only if a future feature requires cookie-authenticated form posts.

## 9. Audit Logging (`SEC-AUDIT`)

- **SEC-AUDIT-001** — Every create/update/delete of a domain entity is recorded in `AuditLog` with actor, action, entity type/id, timestamp, IP, and a before/after diff where the entity is mutable (append-only entities like `MedicalRecord` log the addendum event itself).
- **SEC-AUDIT-002** — Audit logs are themselves tenant-scoped and readable by a Hospital Admin only for their own hospital; Super Admin sees platform-wide audit activity.
- **SEC-AUDIT-003** — Audit logs are never mutated or deleted by application code; if retention limits are ever needed, they are enforced by a documented archival job, not ad hoc deletion.

## 10. File Upload Security (`SEC-FILE`)

- **SEC-FILE-001** — Uploads validated by both MIME type and file extension against an allow-list (`image/jpeg`, `image/png`, `application/pdf`, and a small set of document types) — executable and script-like extensions are rejected outright regardless of claimed MIME type.
- **SEC-FILE-002** — Size capped at 20 MB per EMR attachment, per the brief; smaller caps apply to profile images.
- **SEC-FILE-003** — Files are stored in a private S3 bucket; access is via short-lived pre-signed URLs generated per request, never a public bucket policy.
- **SEC-FILE-004** — A ClamAV scan step is documented as the production-hardening target for Phase 15/16; if infrastructure constraints prevent standing up ClamAV within the project timeline, this is logged as a documented, accepted risk in that phase's review — not silently dropped.

## 11. Payment Security (`SEC-PAY`)

- **SEC-PAY-001** — The client never sets `Payment.status` or `Invoice.status` directly; both transition only inside the verified-webhook handler or an explicit staff cash-payment action.
- **SEC-PAY-002** — Webhook signature verification uses the provider's SDK-provided verification function against the raw request body (captured before JSON parsing, since signature verification is byte-exact) and the provider's webhook secret from environment configuration.
- **SEC-PAY-003** — Webhook idempotency: `Payment.providerEventId` is unique; a redelivered event is detected and treated as a no-op success response (still `200`, so the provider does not retry indefinitely), never processed twice.
- **SEC-PAY-004** — Only Stripe/Razorpay **test mode** credentials are used throughout development and the demo deployment; no live payment processing occurs in this project.

## 12. Dependency & Supply Chain Hygiene

- `pnpm audit` (or equivalent) runs in CI; high/critical vulnerabilities in direct dependencies block merge unless explicitly waived with a documented reason and follow-up.
- Dependency additions are evaluated against the seven questions in the master build prompt §11 before being introduced (necessity, overlap, maintenance status, quality benefit, complexity cost, bundle/perf impact, stack compatibility).

## 13. Security Review Cadence

Security is reviewed at every phase gate (`05-DEVELOPMENT-PLAN.md` §5), not deferred to Phase 15. Phase 15 additionally runs a full OWASP Top 10-oriented pass across the whole system before hardening/deployment, using the `security-review` capability available in this environment.
