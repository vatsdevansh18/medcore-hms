# API Contract — MedCore HMS

**Version:** 1.0
**Status:** Approved for Phase 3+ (grows incrementally per phase; this document is the contract, Swagger/OpenAPI generated from code is the executable mirror of it)
**Related documents:** `02-SRS.md`, `06-DATABASE-DESIGN.md`, `07-RBAC-MATRIX.md`

## 1. Conventions

- Base path: `/api` (versionless for v1; a breaking change ships as `/api/v2`, per `NFR-COMPAT-002`).
- All request/response shapes are defined once in `packages/types` and imported by both apps — this document describes them; it does not duplicate the source of truth.
- Resource naming: plural nouns, kebab-case multi-word resources (`lab-orders`, not `labOrders`).
- Auth: `Authorization: Bearer <accessToken>` header for all protected routes; refresh token travels only as an `httpOnly` cookie, never in a header or body.
- Pagination: `?page=1&limit=20` (limit capped at 100 server-side regardless of what's requested).
- Filtering/sorting: `?status=CONFIRMED&sortBy=scheduledStart&sortOrder=asc` — documented per-endpoint in Swagger, not enumerated exhaustively here.

## 2. Standard Response Envelopes

**Success:**

```json
{ "success": true, "data": {}, "message": "OK" }
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "This slot was just booked by another patient."
  }
}
```

**Paginated list:**

```json
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 348, "totalPages": 18 } }
```

Every thrown exception in the backend is normalised into the error envelope by a global exception filter — no raw stack traces, Prisma error text, or framework default error bodies ever reach the client (`02-SRS.md` §4).

## 3. Standard Error Codes (Non-Exhaustive Core Set)

| Code                        | HTTP Status | Meaning                                                                                                                                                    |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`          | 400         | DTO validation failed; `error.details` carries field-level messages                                                                                        |
| `UNAUTHENTICATED`           | 401         | Missing/invalid/expired access token                                                                                                                       |
| `INVALID_REFRESH_TOKEN`     | 401         | Refresh token invalid, expired, or reused after rotation                                                                                                   |
| `FORBIDDEN_ROLE`            | 403         | Caller's role is not permitted for this action                                                                                                             |
| `TENANT_MISMATCH`           | 403         | Resource belongs to a different hospital than the caller's scope                                                                                           |
| `NOT_FOUND`                 | 404         | Resource does not exist within the caller's visible scope (used identically whether the resource truly doesn't exist or exists in another tenant — see §6) |
| `SLOT_UNAVAILABLE`          | 409         | Appointment slot conflict (pre-check or DB exclusion constraint)                                                                                           |
| `MEDICINE_EXPIRED`          | 422         | Attempted dispense from an expired/quarantined batch                                                                                                       |
| `INVOICE_LOCKED`            | 409         | Attempted edit of a finalised invoice's line items                                                                                                         |
| `WEBHOOK_SIGNATURE_INVALID` | 400         | Payment webhook signature verification failed                                                                                                              |
| `RATE_LIMITED`              | 429         | Throttle threshold exceeded                                                                                                                                |
| `INTERNAL_ERROR`            | 500         | Unhandled server fault (logged to Sentry with correlation ID)                                                                                              |

## 4. Core Endpoints by Module

Full parameter/DTO detail lives in Swagger (generated in Phase 3+ from `@nestjs/swagger` decorators); this table is the contract-level index, cross-referenced to the SRS requirement and RBAC row that govern it.

### 4.1 Auth

| Method + Path                 | Auth           | FR          | Notes                                                                                                                                                                    |
| ----------------------------- | -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/register`         | Public         | FR-AUTH-001 | Patient self-registration only — see `07-RBAC-MATRIX.md` §3.2; creates a `PENDING` account, sends email OTP                                                              |
| `POST /auth/verify-email`     | Public (token) | FR-AUTH-001 | 6-digit OTP, 10 min TTL                                                                                                                                                  |
| `POST /auth/resend-email-otp` | Public         | FR-AUTH-001 | Added in Phase 3 (not in the original endpoint index) — silently no-ops for an unknown/already-verified email, matching the non-enumeration posture of `forgot-password` |
| `POST /auth/send-phone-otp`   | Authenticated  | FR-AUTH-005 | Added in Phase 3 — triggers the SMS OTP `verify-phone` consumes; requires a phone number already on file                                                                 |
| `POST /auth/verify-phone`     | Authenticated  | FR-AUTH-005 | Twilio SMS OTP                                                                                                                                                           |
| `POST /auth/login`            | Public         | FR-AUTH-002 | Returns access token + sets refresh cookie                                                                                                                               |
| `POST /auth/refresh`          | Refresh cookie | FR-AUTH-003 | Rotates refresh token                                                                                                                                                    |
| `POST /auth/forgot-password`  | Public         | FR-AUTH-004 | Always 200, regardless of email existence (no user enumeration)                                                                                                          |
| `POST /auth/reset-password`   | Public (token) | FR-AUTH-004 | Single-use, 60 min TTL                                                                                                                                                   |
| `POST /auth/logout`           | Authenticated  | FR-AUTH-002 | Revokes current device's refresh token                                                                                                                                   |
| `GET /auth/sessions`          | Authenticated  | FR-AUTH-006 | Lists active device sessions                                                                                                                                             |
| `DELETE /auth/sessions/:id`   | Authenticated  | FR-AUTH-006 | Revoke one or all (`:id = all`)                                                                                                                                          |
| `GET /auth/me`                | Authenticated  | FR-AUTH-007 | Profile + role + permission set                                                                                                                                          |

### 4.2 Hospitals, Departments, Users, Patients

| Method + Path                                      | Auth (RBAC ref)                     | FR          | Notes                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /hospitals`                                  | Super Admin                         | FR-HOSP-001 |                                                                                                                                                    |
| `PATCH /hospitals/:id/verify`                      | Super Admin                         | FR-HOSP-001 |                                                                                                                                                    |
| `GET /hospitals`                                   | Super Admin                         | §3.1        |                                                                                                                                                    |
| `GET /hospitals/:id`                               | Super Admin, own Hospital Admin     | §3.1        |                                                                                                                                                    |
| `PATCH /hospitals/:id`                             | Super Admin, own Hospital Admin     | §3.1        | Added in Phase 4 — hospital settings update; a non-owning Hospital Admin gets 404, not 403 (SEC-TENANT-004)                                       |
| `GET /hospitals/:id/departments`                   | Hospital staff (own)                | FR-HOSP-002 |                                                                                                                                                    |
| `POST /hospitals/:id/departments`                  | Hospital Admin (own)                | FR-HOSP-002 |                                                                                                                                                    |
| `PATCH /hospitals/:id/departments/:departmentId`   | Hospital Admin (own)                | FR-HOSP-002 | Added in Phase 4                                                                                                                                  |
| `DELETE /hospitals/:id/departments/:departmentId`  | Hospital Admin (own)                | FR-HOSP-002 | Added in Phase 4 — blocked (400) while doctors/staff/rooms are still assigned to the department                                                  |
| `POST /users` (staff provisioning)                 | Hospital Admin (own)                | FR-HOSP-002 |                                                                                                                                                    |
| `GET /users/:id`                                   | Self or Admin (own hospital)        | §3.2        |                                                                                                                                                    |
| `POST /patients` (front-desk registration)         | Receptionist, Hospital Admin (own)  | FR-HOSP-004 | Added in Phase 4 — pre-verified account, unusable random password + forced reset email, same pattern as staff provisioning                       |
| `GET /patients?search=`                            | Hospital staff (own)                | §3.2        | Added in Phase 4 — a `PATIENT` caller always gets an empty directory; own profile is read only via `GET /patients/:id`                            |
| `GET /patients/:id`                                | Self (own), hospital staff (own)    | §3.2        | Added in Phase 4                                                                                                                                  |

### 4.3 Doctors & Availability

| Method + Path                               | Auth                              | FR               | Notes                                                                                                                                    |
| --------------------------------------------- | ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /doctors?specialization=`               | Any authenticated (own hospital)  | §3.3             | `hospitalId` is deliberately not accepted as a query param — only the caller's own JWT hospitalId is honoured (SEC-AUTHZ-003)            |
| `POST /doctors` (profile creation)          | Hospital Admin (own)              | FR-HOSP-003      |                                                                                                                                           |
| `GET /doctors/:id`                           | Any authenticated (own hospital)  | §3.3             | Added in Phase 4                                                                                                                         |
| `GET /doctors/:id/availability`             | HA/Nurse/Receptionist/Patient (own hospital), Doctor (self only) | FR-APPT-001/002  | §3.3 gives Doctor "self" specifically, narrower than the other roles' "own hospital" |
| `PUT /doctors/:id/availability`             | Doctor (self)                     | FR-APPT-001      |                                                                                                                                           |
| `POST /doctors/:id/availability-exceptions` | Doctor (self)                     | FR-APPT-001      |                                                                                                                                           |

### 4.4 Appointments

| Method + Path                    | Auth                                         | FR                  |
| -------------------------------- | -------------------------------------------- | ------------------- |
| `POST /appointments`             | Patient (self) / Receptionist (own hospital) | FR-APPT-002/003/004 |
| `GET /appointments`              | Role-scoped list (§3.3)                      | FR-APPT-005         |
| `GET /appointments/:id`          | Role-scoped                                  | FR-APPT-005         |
| `PATCH /appointments/:id/status` | Doctor / Receptionist (own)                  | FR-APPT-005         |
| `POST /appointments/emergency`   | Doctor / Receptionist                        | FR-APPT-006         |

### 4.5 EMR

| Method + Path                                                      | Auth                                          | FR         | Notes                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /medical-records`                                             | Doctor                                        | FR-EMR-001 | "Own encounter" only — the appointment must be `IN_PROGRESS` and the caller must be its doctor; unique on `appointmentId`                                                                   |
| `GET /medical-records/:patientId`                                   | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-007 | `:patientId` is a `PatientProfile.id`; paginated list of that patient's encounters. A Patient caller requesting a `:patientId` other than their own gets `404`, not an empty list (`docs/10-TESTING-STRATEGY.md` §3 mandatory scenario #2) — this route is parameterized by one specific patient, unlike a role-scoped directory listing |
| `GET /medical-records/by-id/:id`                                     | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-007 | Added in Phase 6 (not in the original index) — a single encounter with its vitals/addenda/attachments                                                                                        |
| `POST /medical-records/:id/addenda`                                  | Doctor / Nurse (own hospital)                 | FR-EMR-002 | Append-only — there is no update/delete endpoint for a `MedicalRecord` or its addenda by design                                                                                              |
| `POST /medical-records/:id/vitals`                                   | Doctor / Nurse                                | FR-EMR-003 | `bmi` is never accepted from the client — always server-computed from `heightCm`/`weightKg`                                                                                                  |
| `POST /medical-records/:id/attachments`                              | Doctor / Nurse                                | FR-EMR-006 | Lab Technician's "lab reports only" 🟡 upload access (`AttachmentOwnerType.LAB_RESULT`) is out of scope until Phase 8 wires up lab orders — Phase 6 attachments are `MEDICAL_RECORD`-owned only; returns `{attachment, uploadUrl}` (pre-signed PUT), never accepts the file body itself |
| `GET /medical-records/:id/attachments/:attachmentId/download-url`   | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-006 | Added in Phase 6 — returns `{downloadUrl}` (pre-signed GET), short-lived, generated per request (`SEC-FILE-003`)                                                                             |
| `POST /patients/:id/allergies`                                      | Doctor / Nurse                                | FR-EMR-005 | Added in Phase 6 — patient-level, persists across encounters                                                                                                                                  |
| `GET /patients/:id/allergies`                                       | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `POST /patients/:id/vaccinations`                                    | Doctor / Nurse                                | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `GET /patients/:id/vaccinations`                                     | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `POST /patients/:id/family-history`                                  | Doctor / Nurse                                | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `GET /patients/:id/family-history`                                   | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |

### 4.6 Prescriptions

| Method + Path                | Auth                                      | FR            |
| ---------------------------- | ----------------------------------------- | ------------- |
| `POST /prescriptions`        | Doctor                                    | FR-RX-001/002 |
| `GET /prescriptions/:id`     | Doctor / Pharmacist (own) / Patient (own) | FR-RX-001     |
| `GET /prescriptions/:id/pdf` | Doctor / Patient (own)                    | FR-RX-003     |

### 4.7 Laboratory

| Method + Path                                 | Auth                                                   | FR             |
| --------------------------------------------- | ------------------------------------------------------ | -------------- |
| `POST /lab-orders`                            | Doctor                                                 | FR-LAB-001     |
| `PATCH /lab-orders/:id/items/:itemId/status`  | Receptionist (collect) / Lab Tech                      | FR-LAB-002     |
| `PATCH /lab-orders/:id/items/:itemId/result`  | Lab Technician                                         | FR-LAB-003     |
| `PATCH /lab-orders/:id/items/:itemId/approve` | Lab Technician (different from enterer)                | FR-LAB-004     |
| `GET /lab-orders/:id`                         | Doctor / Lab Tech (own) / Patient (own, post-approval) | FR-LAB-004/005 |

### 4.8 Pharmacy

| Method + Path                        | Auth                              | FR               |
| ------------------------------------ | --------------------------------- | ---------------- |
| `GET /medicines?search=&hospitalId=` | Pharmacist / Doctor (own)         | FR-PHARM-001     |
| `POST /medicines/:id/batches`        | Pharmacist (own)                  | FR-PHARM-001     |
| `POST /prescriptions/:id/dispense`   | Pharmacist (own)                  | FR-PHARM-002/003 |
| `GET /medicines/low-stock`           | Pharmacist / Hospital Admin (own) | FR-PHARM-004     |

### 4.9 Billing & Payments

| Method + Path                         | Auth                                              | FR              |
| ------------------------------------- | ------------------------------------------------- | --------------- |
| `POST /invoices`                      | Receptionist / Accountant (own)                   | FR-BILL-001     |
| `POST /invoices/:id/items`            | Receptionist / Accountant / system-internal (own) | FR-BILL-001     |
| `PATCH /invoices/:id/finalize`        | Receptionist / Accountant (own)                   | FR-BILL-002     |
| `GET /invoices/:id`                   | Receptionist / Accountant (own) / Patient (own)   | §3.8            |
| `POST /invoices/:id/checkout-session` | Patient (self)                                    | FR-BILL-004     |
| `POST /payments/webhook/stripe`       | Provider (signature-verified, no role)            | FR-BILL-004/005 |
| `POST /payments/webhook/razorpay`     | Provider (signature-verified, no role)            | FR-BILL-004/005 |
| `POST /invoices/:id/cash-payment`     | Receptionist / Accountant (own)                   | FR-BILL-004     |

### 4.10 Notifications

| Method + Path                                         | Auth                                 | FR           |
| ----------------------------------------------------- | ------------------------------------ | ------------ |
| `GET /notifications/me`                               | Any authenticated                    | FR-NOTIF-003 |
| `PATCH /notifications/:id/read`                       | Owner only                           | FR-NOTIF-003 |
| WebSocket `notifications` namespace, room `user:{id}` | Authenticated socket handshake (JWT) | FR-NOTIF-003 |

### 4.11 Analytics & Search

| Method + Path                                       | Auth                            | FR               |
| --------------------------------------------------- | ------------------------------- | ---------------- |
| `GET /analytics/revenue?from=&to=`                  | Admin / Accountant (own)        | FR-ANALYTICS-001 |
| `GET /analytics/appointments?from=&to=`             | Admin / Doctor (own)            | FR-ANALYTICS-001 |
| `GET /search?q=&scope=patients\|doctors\|medicines` | Role-appropriate (own hospital) | FR-SEARCH-001    |

### 4.12 Health

| Method + Path       | Auth   | NFR           |
| ------------------- | ------ | ------------- |
| `GET /health`       | Public | NFR-AVAIL-001 |
| `GET /health/ready` | Public | NFR-AVAIL-001 |

## 5. DTO & Validation Rules

Every mutating endpoint has a `class-validator`-annotated DTO with `whitelist: true, forbidNonWhitelisted: true` applied globally — unexpected fields are rejected (400), not stripped silently. DTOs shared with the frontend live in `packages/types` as Zod schemas on the frontend side and are kept structurally in sync with the backend DTOs by convention (both generated from the same field list documented per-endpoint in Swagger); this is reviewed explicitly at each phase gate that touches a DTO.

## 6. Information Disclosure Rule

A resource that exists but belongs to another tenant, or that the caller's role cannot access, returns `404 NOT_FOUND` — identical to a resource that truly does not exist. The API never returns `403 TENANT_MISMATCH` for a cross-tenant ID lookup, because doing so would confirm the resource's existence to an unauthorized caller (a minor but real information leak). `403 FORBIDDEN_ROLE` is reserved for same-tenant, wrong-role attempts only, where existence is already implicit in the caller's own context (e.g. a Nurse hitting a Doctor-only endpoint within their own hospital).

## 7. Documentation Delivery

Swagger UI is served at `/api/docs` on the deployed backend (non-production-secret-bearing, but still behind basic auth in production per `09-SECURITY.md`), generated from the same decorators that drive runtime validation — the contract in this document and the contract enforced at runtime cannot drift, because both are sourced from the same DTOs.
