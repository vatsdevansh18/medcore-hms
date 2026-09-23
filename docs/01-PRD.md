# Product Requirements Document — MedCore HMS

**Version:** 1.0
**Status:** Approved for Phase 1
**Source of truth:** `docs/source/InternMo_HMS_Brief.docx` (internship brief, v1.0)
**Related documents:** `02-SRS.md`, `03-ARCHITECTURE.md`, `06-DATABASE-DESIGN.md`, `07-RBAC-MATRIX.md`, `11-DECISIONS.md`

---

## 1. Product Vision

MedCore HMS is a multi-tenant, cloud-native Hospital Management Platform that digitises end-to-end clinical and administrative workflows for hospitals ranging from small clinics to large multi-speciality centres. A single deployment serves many hospitals ("tenants"), each with fully isolated data, while sharing one codebase, one database cluster, and one operational surface.

The product replaces the fragmented reality described in the brief — a separate registration tool, a separate pharmacy billing tool, and lab results hand-carried on paper — with one system where a patient's registration, appointment, encounter, prescription, lab order, and invoice are all facets of the same longitudinal record, visible in real time to every authorised role.

## 2. Problem Statement

Mid-sized hospitals coordinate patient care across disconnected systems and manual processes. The consequences named in the brief are concrete and testable against this product:

- A doctor cannot see a patient's latest lab result without a phone call or a walk to the lab → **solved by** real-time lab-result-to-EMR linkage and in-app/SMS notification on result approval.
- Duplicate diagnostic tests are ordered because prior results are not visible at the point of care → **solved by** a unified patient timeline surfaced in the doctor's encounter view.
- Billing errors occur because charges from consultation, lab, and pharmacy are reconciled manually → **solved by** a single invoice that aggregates line items automatically as services are rendered.
- Patients have no visibility into their own care → **solved by** a patient portal for records, reports, prescriptions, and payments.

## 3. Target Users

The platform serves two audiences:

1. **Hospital staff**, operating inside a specific tenant, differentiated by the nine roles defined in the brief (Super Admin excepted, who operates platform-wide).
2. **Patients**, who self-serve through a portal scoped to their own records within one or more hospitals they have visited.

### 3.1 User Roles

| Role           | Primary Responsibilities                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Super Admin    | Platform-wide management, hospital onboarding/verification, cross-tenant analytics. Not scoped to any single hospital. |
| Hospital Admin | Configures their hospital: departments, staff, rooms/beds, hospital-level analytics and billing configuration.         |
| Doctor         | Patient encounters, EMR authoring, prescriptions, lab/radiology orders, availability calendar management.              |
| Nurse          | Vitals recording, medication administration notes, ward/bed management.                                                |
| Receptionist   | Patient registration, appointment scheduling, draft invoice creation.                                                  |
| Lab Technician | Receives test orders, records/uploads results, drives the sample-to-report workflow.                                   |
| Pharmacist     | Verifies prescriptions, dispenses medicine against batches, manages inventory and expiry.                              |
| Accountant     | Financial reports, invoice finalisation, payment reconciliation, insurance claim tracking.                             |
| Patient        | Views own records, books appointments, downloads reports/prescriptions, pays invoices.                                 |

Each role's UI and API access are treated as distinct products sharing a design system — not one dashboard with re-labelled widgets (see `04-UI-UX.md` §Role-Specific UX).

## 4. Goals

- Deliver a small number of **complete, secure, tested workflows** end-to-end rather than many shallow ones (brief §"A Note from the Project Coordinator": _"Prioritise depth over breadth"_).
- Demonstrate defensible multi-tenant data isolation, with automated tests that fail the build on any regression.
- Demonstrate correct handling of the two hardest correctness problems in this domain: **concurrent appointment booking** and **payment webhook trust boundaries**.
- Produce a codebase and documentation set that reads as professional engineering work to a technical reviewer, independent of the academic grading rubric.

## 5. Non-Goals (Out of Scope for v1)

Per the brief §"Out of Scope," carried forward without modification:

- Video consultation (WebRTC / Daily.co)
- DICOM image rendering / radiology viewer
- AI-assisted diagnostics or ML predictions
- Native mobile apps (iOS/Android) — the web frontend is responsive but not packaged natively
- HL7/FHIR interoperability connectors

Additionally, the following are explicitly deferred as **Phase 2+ enhancements** (see `11-DECISIONS.md` D-007, D-011):

- Full inpatient (IPD) billing and clinical workflow — only bed/room occupancy tracking sufficient to support ward management UX and admin KPIs is in MVP scope.
- Full insurance/TPA claims processing — the data model reserves space for it (`InsuranceClaim`), but adjudication workflow is not implemented.
- Multi-role users (one login holding more than one role) — v1 assigns exactly one role per user, matching the brief's role table.

## 6. Feature Scope (Modules)

Scope is organised by domain module, each mapped to the phase(s) that implement it in `05-DEVELOPMENT-PLAN.md`:

1. **Authentication & Sessions** — registration, login, refresh rotation, email/phone OTP verification, password reset, device/session management, logout.
2. **RBAC & Tenancy** — nine-role permission model; every hospital-scoped record isolated by `hospitalId`.
3. **Hospital, Department & Staff Management** — Super Admin onboards hospitals; Hospital Admin configures departments, rooms/beds, and staff.
4. **Doctor Availability & Appointments** — weekly/date-based availability, conflict-free booking, full status lifecycle, emergency bypass, reminders.
5. **Electronic Medical Records (EMR)** — append-only encounter records: vitals, diagnosis, treatment plan, allergies, vaccination history, family history, attachments.
6. **Prescriptions** — medicine search against hospital inventory, dosage/frequency/duration, signed PDF export.
7. **Laboratory** — test ordering, sample tracking, result entry, review/approval gate, reference-range flagging.
8. **Pharmacy** — batch-tracked inventory, FIFO dispensing, expiry quarantine, low-stock alerts.
9. **Billing & Payments** — invoice aggregation across departments, Stripe/Razorpay integration with verified webhooks, cash payments, receipts.
10. **Notifications** — event-driven fan-out to email (Resend), SMS (Twilio), and in-app (Socket.IO) channels via background queues.
11. **Patient Portal** — self-service view of appointments, records, prescriptions, invoices, and payments.
12. **Analytics & Dashboards** — role-specific dashboards with charts, global search, filtering, pagination.

## 7. Key Business Rules

These rules are elevated from the brief because they drive schema and service-layer design (full detail in `02-SRS.md` and `06-DATABASE-DESIGN.md`):

- A doctor can never be double-booked; a patient can never hold two overlapping appointments across any doctor. Enforced at the database level, not just the API layer.
- Emergency appointments bypass normal slot availability and are flagged `EMERGENCY`.
- A Medical Record is append-only once created; corrections are additional signed addenda, never edits or deletes.
- Medicine dispensing consumes the oldest non-expired batch first (FIFO); expired or quarantined batches can never be dispensed, enforced in the service layer with a test proving the rejection.
- An invoice's total must always equal the sum of its line items; this is a database constraint plus an application invariant, verified by a dedicated test.
- Payment status only transitions on a verified, signature-checked webhook event from the payment provider — never on a client-reported "success."
- No hospital's staff or patients can read, list, or mutate another hospital's records under any circumstance, including by guessing IDs.

## 8. Success Criteria

The product is successful when a reviewer can, using seeded demo data and role-specific credentials:

1. Log in as each of the nine roles and see a dashboard designed for that role's actual workflow.
2. Complete the full patient journey: registration → appointment booking → doctor encounter with EMR → prescription issued → lab order → pharmacy dispensing → invoice → payment → patient portal visibility of all of the above.
3. Observe that a simulated concurrent booking attempt against the same slot fails for the loser and succeeds for the winner, with no double-booked row in the database.
4. Observe that cross-tenant and cross-role access attempts are rejected by the API, not merely hidden by the UI.
5. Inspect Swagger API docs, the ER diagram, and passing CI (lint, type-check, unit, integration) as evidence of engineering discipline.

## 9. MVP vs. Later Enhancements

| In MVP                                               | Deferred (Phase 2+, documented, not silently dropped)                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Row-level multi-tenancy with automatic query scoping | Schema-per-tenant or DB-per-tenant migration path (documented as future option) |
| Stripe + Razorpay test-mode payments, cash           | Live payment credentials, multi-currency                                        |
| Email + SMS + in-app notifications                   | Push notifications to native mobile apps                                        |
| Bed/room occupancy tracking for ward UX + admin KPI  | Full inpatient (IPD) clinical and billing workflow                              |
| Single role per user                                 | Multi-role users, delegated/impersonation access                                |
| Reference-range flagging for lab results             | Full LOINC-coded lab catalog integration                                        |
| Data model for insurance claims                      | TPA adjudication workflow and payer integrations                                |

## 10. Assumptions & Constraints

- The internship brief's 4-week calendar is treated as illustrative of _sequencing_, not as a hard deadline governing scope — the master build prompt supersedes it with a phase-gated methodology with no fixed calendar. This is a documented deviation (`11-DECISIONS.md` D-001).
- All third-party integrations (Stripe, Razorpay, Twilio, Resend, Cloudinary, Sentry, AWS) run in test/sandbox mode throughout development; no real patient, payment, or personal data is ever used (brief §13, §15).
- The developer is solo; architecture favours boring, well-documented technology choices over novel ones, per the brief's own technology stack mandate.

## 11. Requirements Classification

| Class            | Meaning                                                                                       | Examples                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mandatory**    | Explicitly required by the brief; failure to implement is a scope gap.                        | Auth+RBAC, tenancy isolation, appointment concurrency control, EMR, prescriptions, lab workflow, pharmacy FIFO/expiry, billing with verified webhooks, notifications, patient portal, Docker+CI, Swagger, ER diagram, testing pyramid. |
| **Recommended**  | Strongly implied by the brief's hints and evaluation rubric but with implementation latitude. | Redis-cached availability, BullMQ job architecture, Sentry from day one, audit logging depth, column-level encryption approach.                                                                                                        |
| **Optional**     | Nice-to-have, improves the demo but not separately graded.                                    | Cloudinary image optimisation, insurance claim data model, admission/bed tracking.                                                                                                                                                     |
| **Out of scope** | Explicitly excluded.                                                                          | Video consultation, DICOM viewer, AI diagnostics, native mobile, HL7/FHIR.                                                                                                                                                             |

## 12. Acceptance Criteria (Product-Level)

- All Mandatory items above are implemented, tested, and demonstrable.
- The nine mandatory test scenarios listed in the brief §11 pass in CI (see `10-TESTING-STRATEGY.md`).
- Every phase in `05-DEVELOPMENT-PLAN.md` closes with a `docs/phase-reviews/PHASE-X-REVIEW.md` at status `PASS` or `PASS WITH DOCUMENTED MINOR ISSUES` — never `FAIL` or silently skipped, following the quality-gate process in `12-QUALITY-PROTOCOL.md`.
