# Software Requirements Specification — MedCore HMS

**Version:** 1.0
**Status:** Approved for Phase 1
**Related documents:** `01-PRD.md`, `03-ARCHITECTURE.md`, `07-RBAC-MATRIX.md`, `08-API-CONTRACT.md`, `09-SECURITY.md`, `10-TESTING-STRATEGY.md`

## 1. Identifier Scheme

Every non-trivial requirement in this document and its dependents carries a stable ID so it can be traced to code, tests, and phase reviews.

| Prefix | Domain |
|---|---|
| `FR-AUTH` | Authentication & sessions |
| `FR-RBAC` | Roles & permissions |
| `FR-TENANT` | Multi-tenancy |
| `FR-HOSP` | Hospital / department / staff management |
| `FR-APPT` | Appointments & scheduling |
| `FR-EMR` | Electronic medical records |
| `FR-RX` | Prescriptions |
| `FR-LAB` | Laboratory |
| `FR-PHARM` | Pharmacy / inventory |
| `FR-BILL` | Billing & payments |
| `FR-NOTIF` | Notifications |
| `FR-PORTAL` | Patient portal |
| `FR-ANALYTICS` | Dashboards & analytics |
| `FR-SEARCH` | Global search |
| `NFR-PERF` | Performance |
| `NFR-SCALE` | Scalability |
| `NFR-AVAIL` | Availability & resilience |
| `NFR-A11Y` | Accessibility |
| `NFR-OBS` | Observability |
| `NFR-COMPAT` | Compatibility |
| `SEC-*` | Security (full catalog in `09-SECURITY.md`, cross-referenced here) |

Each FR/NFR below states **Requirement**, **Rationale** (why, tied to the brief or a business rule), and **Acceptance Signal** (how a test or review confirms it).

## 2. Functional Requirements

### 2.1 Authentication & Sessions (`FR-AUTH`)

- **FR-AUTH-001** — Users register with email, password, and role-appropriate profile data; the account is `PENDING` until email is verified via a 6-digit OTP with a 10-minute TTL. *Acceptance:* unverified accounts cannot log in; OTP expires and is single-use.
- **FR-AUTH-002** — Login issues a 15-minute JWT access token and a 7-day opaque refresh token delivered in an `httpOnly`, `Secure`, `SameSite=Strict` cookie. *Acceptance:* access token is rejected 1 second after its `exp`; refresh cookie is never readable from JS.
- **FR-AUTH-003** — Every refresh exchange rotates the refresh token: the old token is revoked and a new one issued in the same response. *Acceptance:* replaying a rotated-out refresh token fails and revokes the entire session family (see `SEC-AUTHN-004`).
- **FR-AUTH-004** — Users can request a password reset; the reset token is single-use, expires in 60 minutes, and invalidates all other pending reset tokens for that user on use.
- **FR-AUTH-005** — Phone verification via Twilio SMS OTP follows the same shape as email OTP (`FR-AUTH-001`).
- **FR-AUTH-006** — Users can view and revoke individual device sessions, or revoke all sessions ("log out everywhere") from `GET/DELETE /auth/sessions`.
- **FR-AUTH-007** — `GET /auth/me` returns the authenticated user's profile, role, hospital scope, and effective permission set for frontend UX gating.
- **FR-AUTH-008** — Passwords are hashed with bcrypt at cost factor 12 or higher; plaintext passwords are never logged, stored, or included in any response.

### 2.2 RBAC & Tenancy (`FR-RBAC`, `FR-TENANT`)

- **FR-RBAC-001** — Every API route declares the roles permitted to call it via a `@Roles()` decorator enforced by a global guard; routes with no explicit decorator default to deny-all, not allow-all.
- **FR-RBAC-002** — Role checks run strictly server-side; frontend role gating is UX-only and never treated as a security boundary.
- **FR-TENANT-001** — Every hospital-scoped table carries a non-null `hospitalId`; a user's `hospitalId` is derived only from their authenticated session claim, never from client-supplied input.
- **FR-TENANT-002** — All tenant-scoped Prisma queries are automatically scoped to the caller's `hospitalId` by a shared data-access layer; no service is permitted to call the Prisma client for a tenant-scoped model directly (enforced by code review + lint rule, see `03-ARCHITECTURE.md` §Tenancy).
- **FR-TENANT-003** — Super Admin is the only role permitted to operate without a `hospitalId` scope, and only on endpoints explicitly annotated to allow it.

### 2.3 Hospital, Department & Staff (`FR-HOSP`)

- **FR-HOSP-001** — Super Admin creates and verifies new hospital tenants; a hospital is `PENDING_VERIFICATION` until approved.
- **FR-HOSP-002** — Hospital Admin manages departments, rooms/beds, and staff accounts within their own hospital only.
- **FR-HOSP-003** — Doctor profiles capture specialisation, licence number, qualification, consultation fee, and digital signature asset.

### 2.4 Appointments & Scheduling (`FR-APPT`)

- **FR-APPT-001** — Doctors define recurring weekly availability (day, start/end time, slot duration) plus date-specific exceptions (leave, holiday overrides).
- **FR-APPT-002** — A patient or receptionist books an appointment against an open slot; the system computes available slots from `DoctorAvailability` minus already-booked `Appointment` rows.
- **FR-APPT-003** — No two active appointments (`status` not in `CANCELLED`, `NO_SHOW`) may overlap for the same doctor. Enforced by a database exclusion constraint, not only an application check.
- **FR-APPT-004** — No two active appointments may overlap for the same patient across any doctor. Enforced the same way as `FR-APPT-003`.
- **FR-APPT-005** — Appointment status follows `PENDING → CONFIRMED → IN_PROGRESS → COMPLETED`, with side branches to `CANCELLED` and `NO_SHOW`; illegal transitions are rejected by the service layer's state machine.
- **FR-APPT-006** — Emergency appointments (`type = EMERGENCY`) bypass slot-availability checks but still respect the no-double-booking constraint for the doctor; they are visually and functionally flagged for immediate doctor attention.
- **FR-APPT-007** — Reminder notifications fire at 24 hours and 1 hour before `scheduledStart` via a scheduled BullMQ job, idempotent against duplicate sends.

### 2.5 Electronic Medical Records (`FR-EMR`)

- **FR-EMR-001** — A `MedicalRecord` is created exactly once per appointment, at encounter start, and is never deleted.
- **FR-EMR-002** — Once created, a `MedicalRecord`'s core fields are immutable; further clinical notes are appended as `MedicalRecordAddendum` rows, each attributed to an author and timestamp.
- **FR-EMR-003** — Vitals (BP, pulse, temperature, SpO2, height, weight) are recorded per encounter; BMI is computed server-side from height/weight, never client-supplied.
- **FR-EMR-004** — Diagnosis fields support free text plus an optional ICD-10 code array.
- **FR-EMR-005** — Allergies, vaccination history, and family-history flags are patient-level (persist across encounters), not encounter-level.
- **FR-EMR-006** — Attachments (scans, images) are capped at 20 MB per file, validated by MIME type and extension, and stored in S3 with access mediated by signed URLs — never publicly readable.
- **FR-EMR-007** — A patient can read their own medical records; a doctor/nurse can read records only for patients within their own hospital; no other role has direct read access to clinical notes (accountants, receptionists see billing-relevant metadata only).

### 2.6 Prescriptions (`FR-RX`)

- **FR-RX-001** — A prescription is linked to exactly one `MedicalRecord` and issued by the encounter's doctor.
- **FR-RX-002** — Each prescription item references a medicine from the hospital's own inventory, with dosage, frequency (`OD/BD/TDS/QID/SOS`), duration in days, and optional instructions.
- **FR-RX-003** — A finalised prescription is rendered to a signed PDF (doctor's stored signature image overlaid on a letterhead template) and is immutable once generated; corrections require a new prescription referencing the superseded one.

### 2.7 Laboratory (`FR-LAB`)

- **FR-LAB-001** — A doctor creates a `LabOrder` with one or more `LabOrderItem`s against the hospital's test catalog, linked to the active `MedicalRecord`.
- **FR-LAB-002** — Lab order status flows `ORDERED → SAMPLE_COLLECTED → IN_PROGRESS → RESULT_UPLOADED → APPROVED` (or `REJECTED`), with each transition attributed to a user and timestamp.
- **FR-LAB-003** — Structured results are stored as parameter/value/unit rows and compared against `LabTestReferenceRange` (by gender and age band) to compute an out-of-range flag automatically.
- **FR-LAB-004** — A result is not visible to the patient or referring doctor until it reaches `APPROVED`; approval requires a different user than the one who entered the result (four-eyes principle).
- **FR-LAB-005** — Approval triggers a notification fan-out to both patient and doctor.

### 2.8 Pharmacy (`FR-PHARM`)

- **FR-PHARM-001** — Medicine stock is tracked at the batch level: batch number, manufacturing date, expiry date, quantity on hand, unit cost, MRP.
- **FR-PHARM-002** — Dispensing always consumes the earliest-expiring non-expired, non-quarantined batch first (FIFO by expiry, not by receipt date — this is the patient-safety-correct interpretation, documented in `11-DECISIONS.md` D-004).
- **FR-PHARM-003** — A batch past its expiry date is automatically marked `QUARANTINED` by a scheduled job and can never be selected for dispensing; an attempt to dispense from a quarantined or exhausted batch raises a validation error, not a silent fallback.
- **FR-PHARM-004** — When a medicine's total on-hand quantity falls below its configured reorder level, a low-stock alert notification is generated for pharmacists and the Hospital Admin.
- **FR-PHARM-005** — A nightly job scans for batches expiring within 30 days and emails a digest to pharmacy staff.

### 2.9 Billing & Payments (`FR-BILL`)

- **FR-BILL-001** — An invoice is created in `DRAFT` and accumulates `InvoiceItem` rows automatically as consultation, lab, and pharmacy charges are incurred during a visit.
- **FR-BILL-002** — A Receptionist or Accountant finalises a `DRAFT` invoice to `FINALIZED`; finalised line items are immutable — corrections require a credit line item, never an edit.
- **FR-BILL-003** — `invoice.total` is always recomputed server-side as the exact sum of its line items; it is never accepted from client input and is re-verified in a database check/trigger.
- **FR-BILL-004** — Payment status changes only occur from a verified webhook event from Stripe or Razorpay (signature validated) or from an explicit cash-payment action by staff; a client-reported "payment succeeded" callback never mutates payment or invoice state on its own.
- **FR-BILL-005** — Webhook processing is idempotent: a duplicate delivery of the same provider event does not create a duplicate `Payment` row or double-apply funds (enforced by a unique constraint on provider event/reference ID).
- **FR-BILL-006** — Full or partial payment sets invoice status to `PAID` or `PARTIALLY_PAID` respectively, and triggers a receipt notification.

### 2.10 Notifications (`FR-NOTIF`)

- **FR-NOTIF-001** — Every notification originates from a domain event raised by a service (e.g. `AppointmentConfirmed`, `LabResultApproved`); notification dispatch is decoupled from the triggering request via a queue, never sent synchronously inline with the API response.
- **FR-NOTIF-002** — Each event fans out to one or more channels (email, SMS, in-app) per the trigger table in `03-ARCHITECTURE.md` §Notification Architecture; each channel is an independently retryable job so a failed SMS provider does not block the email or in-app entry.
- **FR-NOTIF-003** — In-app notifications are delivered over Socket.IO to connected clients and persisted so a reconnecting or new session can fetch unread history via `GET /notifications/me`.

### 2.11 Patient Portal (`FR-PORTAL`)

- **FR-PORTAL-001** — A patient can view their own appointments (past/upcoming), medical records, prescriptions (with PDF download), lab reports (post-approval only), and invoices/payment history.
- **FR-PORTAL-002** — A patient can book, reschedule (if the hospital's policy allows), or cancel their own appointments, subject to the same conflict rules as staff-initiated booking.
- **FR-PORTAL-003** — A patient can pay a `FINALIZED` invoice through the integrated payment flow.

### 2.12 Analytics, Dashboards & Search (`FR-ANALYTICS`, `FR-SEARCH`)

- **FR-ANALYTICS-001** — Each role's dashboard surfaces the KPIs and widgets specified in `04-UI-UX.md` §Dashboard Patterns, computed from that role's own hospital scope (or platform-wide only for Super Admin).
- **FR-SEARCH-001** — Global search across patients, doctors, and medicines is scoped to the caller's hospital, paginated, and debounced client-side to avoid request storms.

## 3. Non-Functional Requirements

### 3.1 Performance (`NFR-PERF`)

- **NFR-PERF-001** — P95 API response time under 300 ms for read endpoints and under 800 ms for write endpoints under seeded-demo-scale load (hundreds, not millions, of rows) — a reasonable target for a solo-built system, revisited only if profiling shows it's unrealistic.
- **NFR-PERF-002** — Doctor availability queries are cached in Redis with a 60-second TTL (not longer — availability changes frequently, per the brief's own caching hint) and invalidated on booking/cancellation.
- **NFR-PERF-003** — All list endpoints are paginated by default (`limit` capped at 100) — no unbounded `findMany` is permitted in a controller.

### 3.2 Scalability (`NFR-SCALE`)

- **NFR-SCALE-001** — The API layer is stateless; horizontal scaling requires no sticky sessions (session state lives in Redis/Postgres, not process memory), except for Socket.IO which uses a Redis adapter to fan out events across instances.
- **NFR-SCALE-002** — Row-level multi-tenancy is chosen with an explicit, documented migration path to schema-per-tenant if a single hospital's data volume or isolation requirements outgrow it (`11-DECISIONS.md` D-002).

### 3.3 Availability & Resilience (`NFR-AVAIL`)

- **NFR-AVAIL-001** — `GET /health` and `GET /health/ready` endpoints report liveness and readiness (DB + Redis connectivity) for container orchestration and uptime checks.
- **NFR-AVAIL-002** — Background jobs are retried with exponential backoff (BullMQ default 3 attempts) and dead-lettered to a failed-job queue for manual inspection rather than silently dropped.
- **NFR-AVAIL-003** — A failure in one notification channel must not roll back or block the domain transaction that triggered it (notification dispatch is always post-commit).

### 3.4 Accessibility (`NFR-A11Y`)

- **NFR-A11Y-001** — All interactive elements are keyboard-reachable and operable; focus states are visible and never suppressed.
- **NFR-A11Y-002** — Color is never the sole carrier of status information (e.g. appointment status also uses text/icon, not colour alone) — supports colour-blind users and print/export contexts.
- **NFR-A11Y-003** — Forms surface validation errors both visually and via `aria-describedby`/`aria-live` for screen readers.
- **NFR-A11Y-004** — Target WCAG 2.1 AA contrast ratios across the design system's colour tokens.

### 3.5 Observability (`NFR-OBS`)

- **NFR-OBS-001** — All API requests are logged with a correlation/request ID, route, status code, duration, and caller's `userId`/`hospitalId` (never with request/response bodies containing secrets — see `SEC-DATA-003`).
- **NFR-OBS-002** — Sentry is wired for both frontend and backend from Phase 1, including unhandled promise rejection capture in BullMQ workers.
- **NFR-OBS-003** — Every create/update/delete of a domain entity writes an `AuditLog` row with actor, action, entity, and a before/after diff where feasible.

### 3.6 Compatibility (`NFR-COMPAT`)

- **NFR-COMPAT-001** — The frontend supports the last two major versions of Chrome, Edge, Firefox, and Safari; no IE11 support.
- **NFR-COMPAT-002** — The API is versionless at `/api/*` for v1; a breaking change introduces `/api/v2/*` rather than mutating v1 contracts in place.

## 4. Error Handling & Logging Requirements

- All API errors follow the standard envelope defined in `08-API-CONTRACT.md`; error codes are stable, machine-readable strings (`SLOT_UNAVAILABLE`, `TENANT_MISMATCH`, `MEDICINE_EXPIRED`, etc.), never raw stack traces or ORM error text.
- 4xx errors are logged at `warn`; 5xx at `error`, with Sentry capture.
- A log-sanitising interceptor strips `password`, `token`, `refreshToken`, `otp`, `cvv`, `cardNumber`, and any field matching a configurable sensitive-field list before any log line is emitted.

## 5. Traceability

Every FR/NFR ID introduced here is expected to appear again in: the phase that implements it (`05-DEVELOPMENT-PLAN.md`), the endpoint(s) that expose it (`08-API-CONTRACT.md`), and — for the mandatory scenarios — the test that proves it (`10-TESTING-STRATEGY.md`). IDs are never renumbered once a phase references them; a superseded requirement is marked `[SUPERSEDED by FR-xxx-0yy]` rather than deleted.
