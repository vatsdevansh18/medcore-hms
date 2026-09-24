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
| `INSUFFICIENT_STOCK`        | 422         | Added in Phase 9: not enough eligible (unexpired, non-quarantined) stock to fill a dispense line, or a named batch is exhausted. Nothing is partially dispensed (`11-DECISIONS.md` D-024) |
| `INVOICE_LOCKED`            | 409         | Attempted edit of a finalised invoice's line items                                                                                                         |
| `WEBHOOK_SIGNATURE_INVALID` | 400         | Payment webhook signature verification failed                                                                                                              |
| `PAYMENT_PROVIDER_UNAVAILABLE` | 503 / 502 | Added in Phase 10: the requested online payment provider isn't configured (503) or failed to create the checkout (502). No payment state changes (`11-DECISIONS.md` D-030) |
| `RESCHEDULE_NOT_ALLOWED`    | 422         | Added in Phase 12: a patient reschedule refused by the hospital's policy, the cutoff window, or the appointment type (`11-DECISIONS.md` D-035). `error.details.cutoffHours` is set for a cutoff refusal |
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
| `GET /auth/me`                | Authenticated  | FR-AUTH-007 | Profile + role + permission set. Phase 12 adds `patientProfileId` (PATIENT only, else null) and `hospital` (`id, name, timezone, patientRescheduleAllowed, patientRescheduleCutoffHours`); shape is `CurrentUser` in `packages/types`. Phase 13B adds `doctorProfileId` (DOCTOR only, else null; D-041) |

### 4.2 Hospitals, Departments, Users, Patients

| Method + Path                                      | Auth (RBAC ref)                     | FR          | Notes                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /hospitals`                                  | Super Admin                         | FR-HOSP-001 |                                                                                                                                                    |
| `PATCH /hospitals/:id/verify`                      | Super Admin                         | FR-HOSP-001 |                                                                                                                                                    |
| `GET /hospitals`                                   | Super Admin                         | §3.1        |                                                                                                                                                    |
| `POST /hospitals/:id/admins`                       | Super Admin                         | FR-HOSP-001/002 | Added in the Phase 13B follow-up (D-042) — the hospital's Hospital Admin, provisioned like `POST /users` (pre-verified, emailed password link). Body `email, firstName, lastName, phone?, employeeCode`; a `role` field is rejected; unknown hospital → 404 |
| `GET /hospitals/:id`                               | Super Admin, own Hospital Admin     | §3.1        |                                                                                                                                                    |
| `PATCH /hospitals/:id`                             | Super Admin, own Hospital Admin     | §3.1        | Added in Phase 4 — hospital settings update; a non-owning Hospital Admin gets 404, not 403 (SEC-TENANT-004). Phase 12 adds `patientRescheduleAllowed` (boolean) and `patientRescheduleCutoffHours` (0-720) (D-035) |
| `GET /hospitals/directory`                         | Public                              | FR-AUTH-001 | Added in Phase 12 — ACTIVE hospitals for the registration form: `id, name, slug, city` only (`HospitalDirectoryEntry`). Rate-limited globally (D-035) |
| `GET /hospitals/:id/departments`                   | Hospital staff (own)                | FR-HOSP-002 |                                                                                                                                                    |
| `POST /hospitals/:id/departments`                  | Hospital Admin (own)                | FR-HOSP-002 |                                                                                                                                                    |
| `PATCH /hospitals/:id/departments/:departmentId`   | Hospital Admin (own)                | FR-HOSP-002 | Added in Phase 4                                                                                                                                  |
| `DELETE /hospitals/:id/departments/:departmentId`  | Hospital Admin (own)                | FR-HOSP-002 | Added in Phase 4 — blocked (400) while doctors/staff/rooms are still assigned to the department                                                  |
| `POST /users` (staff provisioning)                 | Hospital Admin (own)                | FR-HOSP-002 |                                                                                                                                                    |
| `GET /users?role=&search=`                         | Hospital Admin (own)                | §3.2        | Added in Phase 13B (D-041) — the staff directory, paginated, by last name. Rows are `SAFE_USER_SELECT` + `staffProfile {employeeCode, department}` + `doctorProfile {id, specialization, department}` (`StaffMemberView`). Never patients or Super Admins; `role=PATIENT` → 400. Every `search` term must match a name or the email |
| `GET /users/:id`                                   | Self or Admin (own hospital)        | §3.2        |                                                                                                                                                    |
| `POST /patients` (front-desk registration)         | Receptionist, Hospital Admin (own)  | FR-HOSP-004 | Added in Phase 4 — pre-verified account, unusable random password + forced reset email, same pattern as staff provisioning                       |
| `GET /patients?search=`                            | Hospital staff (own)                | §3.2        | Added in Phase 4 — a `PATIENT` caller always gets an empty directory; own profile is read only via `GET /patients/:id`                            |
| `GET /patients/:id`                                | Self (own), hospital staff (own)    | §3.2        | Added in Phase 4                                                                                                                                  |

### 4.3 Doctors & Availability

| Method + Path                               | Auth                              | FR               | Notes                                                                                                                                    |
| --------------------------------------------- | ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /doctors?specialization=`               | Any authenticated (own hospital)  | §3.3             | `hospitalId` is deliberately not accepted as a query param — only the caller's own JWT hospitalId is honoured (SEC-AUTHZ-003)            |
| `POST /doctors` (profile creation)          | Hospital Admin (own)              | FR-HOSP-003      |                                                                                                                                           |
| `GET /doctors/:id`                           | Any authenticated (own hospital)  | §3.3             | Added in Phase 4. Since Phase 12 (both doctor reads): `signatureImageUrl` is replaced by `hasSignature`, and a PATIENT caller gets the doctor's name without email/phone (D-036) |
| `GET /doctors/:id/availability`             | HA/Nurse/Receptionist/Patient (own hospital), Doctor (self only) | FR-APPT-001/002  | §3.3 gives Doctor "self" specifically, narrower than the other roles' "own hospital" |
| `PUT /doctors/:id/availability`             | Doctor (self)                     | FR-APPT-001      |                                                                                                                                           |
| `POST /doctors/:id/availability-exceptions` | Doctor (self)                     | FR-APPT-001      |                                                                                                                                           |
| `GET /doctors/:id/schedule`                  | Doctor (self)                     | FR-APPT-001      | Added in the Phase 13B follow-up (D-042) — `{timezone, weekly[], exceptions[]}`: the weekly hours and exceptions from today (hospital calendar). Another doctor → 404 |
| `DELETE /doctors/:id/availability-exceptions/:date` | Doctor (self)              | FR-APPT-001      | Added in the Phase 13B follow-up — `:date` is `YYYY-MM-DD` (else 400); none on that date → 404. `PUT /doctors/:id/availability` now also refuses overlapping windows on one weekday (400) |

### 4.4 Appointments

| Method + Path                    | Auth                                         | FR                  |
| -------------------------------- | -------------------------------------------- | ------------------- |
| `POST /appointments`             | Patient (self) / Receptionist (own hospital) | FR-APPT-002/003/004 |
| `GET /appointments`              | Role-scoped list (§3.3)                      | FR-APPT-005         |
| `PATCH /appointments/:id/reschedule` | Patient (self)                           | FR-PORTAL-002       |
| `GET /appointments/:id`          | Role-scoped                                  | FR-APPT-005         |
| `PATCH /appointments/:id/status` | Doctor / Receptionist (own)                  | FR-APPT-005         |
| `POST /appointments/emergency`   | Doctor / Receptionist                        | FR-APPT-006         |

Phase 12 notes (D-035, D-037):
- `GET /appointments` accepts `sortOrder=asc|desc` (by `scheduledStart`, default `desc`).
- `PATCH /appointments/:id/reschedule` takes `{scheduledStart, scheduledEnd}`, which must be an open slot for the same doctor. Allowed from PENDING or CONFIRMED, not for EMERGENCY; the result is PENDING with the same id and the old reminders cancelled. 422 `RESCHEDULE_NOT_ALLOWED` for policy, cutoff, or type; 409 `SLOT_UNAVAILABLE` for a taken or invalid slot; 409 for a concurrent change; 404 for another patient's appointment.
- Phase 13B (D-041): `GET /appointments` adds `patientId`. It narrows within the caller's scope: a patient asking for another patient's id, or a doctor for a patient they haven't seen, gets an empty list.
- Every appointment's `doctor` is a narrow projection: `id, userId, departmentId, specialization, user {id, firstName, lastName}`.
- Slots and booking use the hospital's timezone: availability windows are local wall-clock times, `dateFrom`/`dateTo`/`date` are local calendar dates, and slot instants are UTC.

### 4.5 EMR

| Method + Path                                                      | Auth                                          | FR         | Notes                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /medical-records`                                             | Doctor                                        | FR-EMR-001 | "Own encounter" only — the appointment must be `IN_PROGRESS` and the caller must be its doctor; unique on `appointmentId`                                                                   |
| `GET /medical-records/:patientId`                                   | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-007 | `:patientId` is a `PatientProfile.id`; paginated list of that patient's encounters. A Patient caller requesting a `:patientId` other than their own gets `404`, not an empty list (`docs/10-TESTING-STRATEGY.md` §3 mandatory scenario #2) — this route is parameterized by one specific patient, unlike a role-scoped directory listing |
| `GET /medical-records/by-appointment/:appointmentId`                | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-007 | Added in Phase 13B (D-041) — the encounter record of one appointment, same shape and visibility as `by-id`. 404 when the visit has no record yet or isn't visible to the caller |
| `GET /medical-records/by-id/:id`                                     | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-007 | Added in Phase 6 (not in the original index) — a single encounter with its vitals/addenda/attachments. Since Phase 12 no record or upload response includes an attachment's `storageKey` (D-036) |
| `POST /medical-records/:id/addenda`                                  | Doctor / Nurse (own hospital)                 | FR-EMR-002 | Append-only — there is no update/delete endpoint for a `MedicalRecord` or its addenda by design                                                                                              |
| `POST /medical-records/:id/vitals`                                   | Doctor / Nurse                                | FR-EMR-003 | `bmi` is never accepted from the client — always server-computed from `heightCm`/`weightKg`                                                                                                  |
| `POST /medical-records/:id/attachments`                              | Doctor / Nurse                                | FR-EMR-006 | `MEDICAL_RECORD`-owned attachments only. Phase 8 resolved the lab-report-file question via `LabResult.reportFileUrl` directly (§4.7, `docs/11-DECISIONS.md` D-019), not this endpoint or `AttachmentOwnerType.LAB_RESULT`, which stays unused; returns `{attachment, uploadUrl}` (pre-signed PUT), never accepts the file body itself |
| `GET /medical-records/:id/attachments/:attachmentId/download-url`   | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-006 | Added in Phase 6 — returns `{downloadUrl}` (pre-signed GET), short-lived, generated per request (`SEC-FILE-003`)                                                                             |
| `POST /patients/:id/allergies`                                      | Doctor / Nurse                                | FR-EMR-005 | Added in Phase 6 — patient-level, persists across encounters                                                                                                                                  |
| `GET /patients/:id/allergies`                                       | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `POST /patients/:id/vaccinations`                                    | Doctor / Nurse                                | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `GET /patients/:id/vaccinations`                                     | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `POST /patients/:id/family-history`                                  | Doctor / Nurse                                | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |
| `GET /patients/:id/family-history`                                   | Doctor / Nurse (own hospital) / Patient (own) | FR-EMR-005 | Added in Phase 6                                                                                                                                                                               |

### 4.6 Prescriptions

| Method + Path                | Auth                                                | FR            | Notes                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /prescriptions`        | Doctor                                              | FR-RX-001/002 | "Own encounter" only — caller must be `medicalRecord.doctor`; optional `supersedesId` for a correction (must be `ISSUED`, same patient, not already superseded) |
| `GET /prescriptions`         | Patient (self)                                      | FR-PORTAL-001 | Added in Phase 12 — the caller's own prescriptions, newest first, paginated, optional `status`; each with items, medicine, and the prescribing doctor's name (D-035) |
| `GET /prescriptions/:id`     | Doctor / Nurse (own hospital) / Pharmacist (own) / Patient (own) | FR-RX-001     | Nurse added per §3.5's "for admin note" row, simplified to full own-hospital read (same pattern as other 🟡-scoped roles). Since Phase 12 every prescription response replaces `pdfUrl`/`signatureImageUrl` with `pdfReady` (D-036). Phase 13B: each item adds `dispensedQuantity`, and staff get `patient` (name only) (D-041) |
| `GET /prescriptions/:id/pdf` | Doctor / Patient (own)                              | FR-RX-003     | Narrower than "View prescription" — no Nurse/Pharmacist. Returns `{downloadUrl}` (pre-signed GET), `409` if the async PDF job hasn't finished yet          |
| `POST /doctors/:id/signature` | Doctor (self)                                       | FR-RX-003     | Added in Phase 7 (not in the original index) — same declare-then-pre-signed-upload pattern as EMR attachments; returns `{uploadUrl}`                        |
| `GET /medicines?search=`     | Hospital Admin (own) / Doctor (own) / Pharmacist (own) | §3.7          | Added in Phase 7, read-only — brought forward from the Phase 9 `FR-PHARM-001` row for prescription-creation search (`docs/11-DECISIONS.md` D-017); catalog/batch management added in Phase 9, see §4.8 |
| `GET /medicines/:id`         | Hospital Admin (own) / Doctor (own) / Pharmacist (own) | §3.7          | Added in Phase 7                                                                                                                                       |

### 4.7 Laboratory

| Method + Path                                 | Auth                                                   | FR             | Notes                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /lab-orders`                            | Doctor                                                 | FR-LAB-001     | "Own encounter" only — caller must be `medicalRecord.doctor`; `items[].labTestId` must exist in the caller's hospital catalog                                                                                          |
| `PATCH /lab-orders/:id/items/:itemId/status`  | Receptionist (collect) / Lab Tech                      | FR-LAB-002     | Only `SAMPLE_COLLECTED`/`IN_PROGRESS` accepted here — `RESULT_UPLOADED` and `APPROVED`/`REJECTED` are set by `/result` and `/approve`, never directly                                                                    |
| `PATCH /lab-orders/:id/items/:itemId/result`  | Lab Technician                                         | FR-LAB-003     | Item must be `IN_PROGRESS`; `values` is exactly one `{parameter,value,unit}` entry (`docs/11-DECISIONS.md` D-018); optional `reportFile` metadata returns a pre-signed `uploadUrl` for the scan/PDF (D-019)             |
| `PATCH /lab-orders/:id/items/:itemId/approve` | Lab Technician (different from enterer)                | FR-LAB-004     | Item must be `RESULT_UPLOADED`; body is `{decision: "APPROVED"\|"REJECTED", notes?}`; `APPROVED` triggers the notification fan-out (D-020)                                                                              |
| `GET /lab-orders`                             | Patient (self)                                         | FR-PORTAL-001  | Added in Phase 12 — the caller's own orders, newest first, paginated: `id, priority, createdAt, doctor (name), items [{id, status, labTest {id, name}}]`. No results; read them through `GET /lab-orders/:id` (D-035) |
| `GET /lab-tests?search=`                      | Doctor / Lab Tech / Hospital Admin (own)               | FR-LAB-001     | Added in Phase 13B (D-041) — the hospital's test catalog by name: `id, name, code, sampleType, price, turnaroundHours, referenceRanges[]` (`LabTestView`). `search` matches name or code |
| `GET /lab-orders/:id`                         | Doctor / Nurse (own hospital) / Lab Tech (own) / Patient (own) | FR-LAB-004/005 | Order/item status always visible to an authorized caller; each item's `result` is `null` until visible to that role — D-021 (Lab Tech: always; Doctor/Nurse: once `APPROVED` or `REJECTED`; Patient: once `APPROVED` only) |

### 4.8 Pharmacy

Implemented in Phase 9 on the existing `medicines/` module (`11-DECISIONS.md` D-017). RBAC per `07-RBAC-MATRIX.md` §3.7, with Hospital Admin's 🟡 on catalog/batch management read as read-only oversight (D-024). Dates are `YYYY-MM-DD` calendar dates, evaluated against the hospital's own local date (D-023). `hospitalId` always comes from the JWT; the original index's `hospitalId` query parameter is not accepted.

| Method + Path                           | Auth                                       | FR               | Notes |
| --------------------------------------- | ------------------------------------------ | ---------------- | ----- |
| `GET /medicines?search=`                | Hospital Admin / Doctor / Pharmacist (own) | FR-PHARM-001     | Built Phase 7. Phase 9 adds a live `availableQuantity` per row (ACTIVE, unexpired batches only). |
| `GET /medicines/:id`                    | Hospital Admin / Doctor / Pharmacist (own) | FR-PHARM-001     | Also includes `availableQuantity`. A soft-deleted medicine returns 404. |
| `POST /medicines`                       | Pharmacist (own)                           | FR-PHARM-001     | Catalog entry: `name, genericName?, form, manufacturer?, unit, reorderLevel?`. Stock only ever arrives via batches. |
| `PATCH /medicines/:id`                  | Pharmacist (own)                           | FR-PHARM-001/004 | Changing `reorderLevel` re-evaluates the low-stock latch (D-022). |
| `GET /medicines/:id/batches`            | Pharmacist / Hospital Admin (own)          | FR-PHARM-001     | Paginated, in FEFO order. |
| `POST /medicines/:id/batches`           | Pharmacist (own)                           | FR-PHARM-001     | `batchNumber, manufacturingDate, expiryDate, quantity, unitCost, mrp`. Duplicate batch number → 409. Already-expired → 422 `MEDICINE_EXPIRED`. Future manufacturing date or expiry ≤ manufacturing → 400. |
| `POST /prescriptions/:id/dispense`      | Pharmacist (own)                           | FR-PHARM-002/003 | Body `{items:[{prescriptionItemId, quantity, batchId?}]}`. FEFO allocation that may split a line across batches. Atomic and row-locked. Returns the prescription with `dispenseRecords`. Errors: 422 `MEDICINE_EXPIRED` / `INSUFFICIENT_STOCK`; 422 `VALIDATION_ERROR` + `expectedBatchId` for a non-FEFO `batchId`; 400 over-dispense or foreign item; 409 `CANCELLED`/`DISPENSED` prescription. Sets `PARTIALLY_DISPENSED`/`DISPENSED`. |
| `GET /medicines/low-stock`              | Pharmacist / Hospital Admin (own)          | FR-PHARM-004     | Live read of medicines below `reorderLevel`. Never raises an alert itself. Alerts are `Notification` rows raised once per crossing by the write paths (D-022). |
| `GET /medicines/expiring?days=30`       | Pharmacist / Hospital Admin (own)          | FR-PHARM-005     | Added in Phase 9 (not in the original index). Dispensable batches expiring within `days` (1–365), soonest first. The same window as the nightly digest. |
| _(job)_ `medicine-expiry-scan`, nightly | System                                     | FR-PHARM-003/005 | Quarantines expired ACTIVE batches, re-evaluates low stock, writes one digest `Notification` per recipient per day. Email send stubbed until Phase 11 (D-025). |

### 4.9 Billing & Payments

Implemented in Phase 10 (`11-DECISIONS.md` D-027 to D-031). Money amounts are decimals with 2 places, returned as strings. Every invoice response includes `items`, `payments` (id/method/amount/currency/status/createdAt only), and the derived `amountPaid`/`balanceDue`.

| Method + Path                         | Auth                                                      | FR              | Notes |
| ------------------------------------- | --------------------------------------------------------- | --------------- | ----- |
| _(system)_ automatic charges          | n/a                                                       | FR-BILL-001     | Encounter creation → CONSULTATION (doctor's fee). Lab order → one LAB line per test. Dispense → one PHARMACY line per dispense record (quantity × batch MRP). Each is written in the same transaction as the clinical record, onto the visit's DRAFT invoice; a supplementary DRAFT is opened if the visit's invoice is already finalized (D-027). |
| `POST /invoices`                      | Receptionist / Accountant (own)                           | FR-BILL-001     | `{appointmentId}`. Returns the visit's open DRAFT invoice, creating one if none exists (idempotent). |
| `GET /invoices?status=&patientId=&appointmentId=` | Receptionist / Accountant / Hospital Admin (own) / Patient (self) | §3.8        | Added in Phase 10: paginated work queues and reconciliation (D-031). Phase 12: a Patient gets only their own non-DRAFT invoices (`InvoiceSummaryView`); `patientId` can't widen it and `status=DRAFT` is empty (D-035). |
| `POST /invoices/:id/items`            | Receptionist / Accountant (own)                           | FR-BILL-001/002 | `{sourceType: ROOM\|OTHER, description, quantity, unitPrice}`. Negative `unitPrice` = credit line. Positive lines only on DRAFT (else 409 `INVOICE_LOCKED`). Credits allowed on DRAFT/FINALIZED/PARTIALLY_PAID, but may not take the total below the amount paid (422). A client `total`/`lineTotal` is rejected with 400 (D-029). |
| `PATCH /invoices/:id/finalize`        | Receptionist / Accountant (own)                           | FR-BILL-002     | DRAFT only (else 409 `INVOICE_LOCKED`). Needs at least one line (400). A zero total goes straight to PAID. Records `finalizedBy`/`finalizedAt`. |
| `GET /invoices/:id`                   | Receptionist / Accountant / Hospital Admin (own) / Patient (self) | §3.8    | Another patient's invoice, or another hospital's, is 404. Since Phase 12 a DRAFT is also 404 for its own patient (D-035). Phase 13B: staff get `patient` (name only) (D-041). |
| `POST /invoices/:id/cash-payment`     | Receptionist / Accountant (own)                           | FR-BILL-004/006 | `{amount}`: at most the balance due (422). FINALIZED/PARTIALLY_PAID only (409). Returns `{receipt, invoice}` and notifies the patient. |
| `POST /invoices/:id/checkout-session` | Patient (self)                                            | FR-BILL-004     | `{provider: STRIPE\|RAZORPAY}`. The amount is always the server balance. Creates a PENDING Payment and returns `{paymentId, reference, checkoutUrl (Stripe), keyId (Razorpay), amount, currency}`. 503 `PAYMENT_PROVIDER_UNAVAILABLE` if the provider isn't configured. |
| `GET /payments/:id/receipt`           | Patient (self) / Receptionist / Accountant / Hospital Admin (own) | FR-BILL-006 | Added in Phase 12 — `{downloadUrl}` (pre-signed GET) for a SUCCEEDED payment's receipt PDF, rendered on first request and cached (D-036). 409 for a payment that hasn't succeeded; 404 for another patient's or hospital's. |
| `POST /payments/webhook/stripe`       | Provider (signature-verified, no role)                    | FR-BILL-004/005 | Raw-body `Stripe-Signature` check (300s tolerance) → 400 `WEBHOOK_SIGNATURE_INVALID`. Acts on `checkout.session.completed` (paid), `async_payment_succeeded`/`failed`, and `expired`. Duplicates and unmatched events → 200 `{received, applied: false}`. |
| `POST /payments/webhook/razorpay`     | Provider (signature-verified, no role)                    | FR-BILL-004/005 | `X-Razorpay-Signature` HMAC check → 400 if invalid. Acts on `payment.captured`/`order.paid` (success) and `payment.failed`. Same idempotency. |

### 4.10 Notifications

| Method + Path                                         | Auth                                 | FR           | Notes (Phase 11) |
| ----------------------------------------------------- | ------------------------------------ | ------------ | ---------------- |
| `GET /notifications/me?page=&limit=&unreadOnly=`      | Any authenticated (every role, incl. Super Admin) | FR-NOTIF-003 | The caller's own **in-app** notifications (rows whose channels include `IN_APP`), newest first, paginated. `meta.unreadCount` is added to the usual pagination meta. Items are `NotificationView` (`packages/types`): `id, type, title, body, relatedEntityType, relatedEntityId, readAt, createdAt`. `unreadOnly` must be `true`/`false` (400 otherwise). |
| `PATCH /notifications/:id/read`                       | Owner only                           | FR-NOTIF-003 | Sets `readAt` once (idempotent: re-reading keeps the first time). Anyone else's id, an email/SMS-only row, or an unknown id → 404. Returns the `NotificationView`. |
| WebSocket `notifications` namespace, room `user:{id}` | Authenticated socket handshake (JWT) | FR-NOTIF-003 | Socket.IO namespace `/notifications` (same host/port as the API). Connect with `auth: { token: <accessToken> }`; a missing, invalid, or expired token, or a disabled account, fails the handshake with `connect_error` `"UNAUTHENTICATED"`. The server emits `notification:new` with a `NotificationView`. It's disconnected when the token expires, and the client reconnects with a refreshed token. No client-to-server events. Constants: `NOTIFICATIONS_NAMESPACE`, `NotificationSocketEvent` in `packages/types`. |
| `GET /admin/queues` (Bull Board UI)                   | HTTP Basic (dev only)                | NFR-AVAIL-002 | Mounted only when `BULL_BOARD_ENABLED=true`, which env validation refuses in production (SEC-NOTIF-005). Otherwise 404. |

Which events notify whom, on which channels, is the trigger table in `docs/11-DECISIONS.md` D-032 (brief §7.8). Delivery is asynchronous, after the triggering request commits, so none of these events changes any endpoint's response.

### 4.11 Analytics & Search

| Method + Path                                       | Auth                            | FR               |
| --------------------------------------------------- | ------------------------------- | ---------------- |
| `GET /analytics/overview`                           | Hospital Admin (own), Super Admin (platform) | FR-ANALYTICS-001 |
| `GET /analytics/revenue?from=&to=`                  | Hospital Admin / Accountant (own), Super Admin (platform) | FR-ANALYTICS-001 |
| `GET /analytics/appointments?from=&to=`             | Hospital Admin (own), Doctor (own appointments), Super Admin (platform) | FR-ANALYTICS-001 |
| `GET /analytics/occupancy`                          | Hospital Admin / Nurse (own)    | FR-ANALYTICS-001 |
| `GET /search?q=&scope=patients\|doctors\|medicines` | Role-appropriate (own hospital) | FR-SEARCH-001    |
| `GET /audit-logs?entityType=`                       | Hospital Admin (own), Super Admin (all) | §3.9 |
| `GET /payments?status=&method=`                     | Accountant / Hospital Admin (own) | §3.8 |

As built in Phase 13 (`11-DECISIONS.md` D-040; shapes in `packages/types/src/analytics.ts`):
- `from`/`to` are `YYYY-MM-DD` calendar dates in the hospital's timezone (UTC for the platform view). The default is the last 7 days; a range covers at most 92 days; `from` after `to` or an impossible date → 400. Each day in the range appears once, zero-filled.
- `overview` → `DashboardKpis`: today's non-cancelled appointments, distinct patients, SUCCEEDED payments, occupied/total beds, active doctors, plus `activeHospitals` for the platform.
- `revenue` → `RevenueTrend`: per-day `collected` (SUCCEEDED payments, by method) and `invoiced` (finalized totals, never DRAFT/CANCELLED); `outstanding` is the current balance across FINALIZED and PARTIALLY_PAID invoices.
- `occupancy` → `OccupancyView`: departments → rooms → beds with status counts. A Super Admin gets 403 (it's per hospital).
- `search`: `q` 2–100 characters (trimmed); every term must match a field. Without `scope` → `GlobalSearchView` (top 5 and a total per allowed scope). With `scope` → a paginated hit list. A scope the role can't search → 403. Patients and Super Admin → 403.
- `audit-logs` → `AuditLogView` rows (who, what, which record, when). `beforeData`/`afterData` are never returned.
- `payments` → `PaymentListView` (explicit fields; no provider payload or reference). `status`/`method` accept comma-separated lists.
- Changed in Phase 13 (all lists accept comma-separated `status`):
  - `GET /lab-orders` adds Lab Technician (hospital queue, URGENT first, then oldest) and Doctor (own orders), with `status` (item status) and `priority` filters; staff rows carry the patient's name.
  - `GET /prescriptions` adds Pharmacist (oldest first) and Doctor (own).
  - `GET /appointments` adds `doctorId` (it narrows within the caller's own scope).
  - `GET /invoices` staff rows carry the patient's name.
  - `GET /patients` (directory list) excludes Lab Technician and Pharmacist, who get an empty list.
- Changed in Phase 13B (D-041): `GET /prescriptions` and `GET /lab-orders` accept `medicalRecordId` (one encounter's rows, narrowing within the caller's scope).

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
