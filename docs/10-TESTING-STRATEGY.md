# Testing Strategy — MedCore HMS

**Version:** 1.0
**Status:** Approved; unit/integration tests written alongside every phase, not deferred to Phase 15
**Related documents:** `02-SRS.md`, `07-RBAC-MATRIX.md`, `09-SECURITY.md`, `05-DEVELOPMENT-PLAN.md`

## 1. Testing Pyramid

| Layer       | Tooling                        | Scope                                                                                         | Target                                                             |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Unit        | Jest                           | Pure functions, service methods (mocked Prisma), Zod/class-validator schemas, utility helpers | ≥80% coverage on business-logic services                           |
| Integration | Jest + Supertest               | Full API endpoints against a real, ephemeral test Postgres (Docker service container in CI)   | All happy paths + all documented error codes per endpoint          |
| Component   | Vitest + React Testing Library | Individual React components in isolation                                                      | Form validation, conditional rendering, loading/empty/error states |
| E2E         | Playwright                     | Critical cross-app user journeys in a running stack                                           | Registration, booking, encounter, payment, report download         |

Each layer catches a different class of regression; none is a substitute for another. Integration tests specifically exist to catch the tenancy/authorization bugs that unit tests (which mock the database) structurally cannot catch.

## 2. Coverage & CI Gates

- Unit test coverage reported via Jest's HTML coverage report (a required deliverable per the brief); CI fails if backend business-logic coverage drops below 70% (target 80%+, gate set slightly below target to avoid brittle CI on legitimate edge cases).
- PR checks: lint, type-check, unit tests. Merge-to-main checks additionally run integration tests against the ephemeral database. E2E runs on a schedule and before release tags (too slow for every PR).
- A tenancy-isolation or authorization test failure is treated as a release-blocking category — CI configuration tags these specs so their failure is visually distinct in the pipeline output, matching the brief's explicit instruction to stop everything if one fails.

## 3. Mandatory Test Scenarios (Traced to Requirements)

These nine scenarios are named explicitly in the brief and are non-negotiable; each is written as an integration test (real DB, real guards) rather than a unit test with mocks, because the property under test is precisely the interaction between layers.

| #   | Scenario                                                                     | Traces to                           | Test shape                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A doctor cannot access another hospital's patient records                    | `FR-TENANT-001/002`, `SEC-TENANT-*` | Seed two hospitals; Doctor A (hospital 1) requests a patient record belonging to hospital 2 → expect `404 NOT_FOUND`                                                                                                                      |
| 2   | A patient cannot view another patient's medical records                      | `FR-EMR-007`                        | Patient A requests `GET /medical-records/:patientBId` → expect `403`/`404` per §6 of API contract                                                                                                                                         |
| 3   | Booking two appointments in the same slot simultaneously — only one succeeds | `FR-APPT-003`, exclusion constraint | Fire two concurrent `POST /appointments` for the identical doctor+slot from two async requests; assert exactly one `201` and one `409 SLOT_UNAVAILABLE`; assert exactly one `Appointment` row exists for that slot afterward              |
| 4   | A refresh token cannot be reused after rotation                              | `SEC-AUTHN-004`                     | Login, refresh once (token A → token B), attempt to refresh again with token A → expect `401 INVALID_REFRESH_TOKEN` and assert token B is also now revoked (session-family revocation)                                                    |
| 5   | An expired medicine cannot be dispensed                                      | `FR-PHARM-003`                      | Seed a batch with `expiryDate` in the past; attempt dispense → expect `422 MEDICINE_EXPIRED`, assert no `DispenseRecord` created and stock unchanged                                                                                      |
| 6   | An invoice total matches the sum of all line items                           | `FR-BILL-003`                       | Add several `InvoiceItem`s with varying quantity/price; assert `Invoice.total` equals the computed sum after every mutation, including after a deliberately malformed client-supplied `total` in the request body (which must be ignored) |
| 7   | Unauthorized role cannot access a protected endpoint                         | `SEC-AUTHZ-*`, `07-RBAC-MATRIX.md`  | Parametrised test iterating every ⛔ cell in the RBAC matrix for a representative sample of endpoints per module → expect `403 FORBIDDEN_ROLE`                                                                                            |
| 8   | Payment webhook signature verification rejects invalid signatures            | `SEC-PAY-002`                       | POST to `/payments/webhook/stripe` with a tampered signature header → expect `400 WEBHOOK_SIGNATURE_INVALID`, assert no `Payment` row created and no `Invoice` status change                                                              |
| 9   | Cross-tenant access attempt fails (general form, beyond patient records)     | `SEC-TENANT-*`                      | Parametrised across Appointment, Prescription, LabOrder, Invoice: an authenticated staff user from hospital 1 requests each resource type by ID belonging to hospital 2 → expect `404` uniformly                                          |

## 4. Additional Risk-Based Scenarios

Beyond the mandatory nine, identified from the domain's own risk surface:

- Duplicate webhook delivery for the same `providerEventId` does not double-apply a payment (`SEC-PAY-003`).
- A lab result cannot be approved by the same user who entered it (`FR-LAB-004` four-eyes check).
- A `MedicalRecord`'s core fields cannot be mutated after creation via any endpoint (`FR-EMR-002` immutability).
- A cancelled/no-show appointment does not block a new booking for the same slot (verifies the exclusion constraint's `WHERE` clause is scoped correctly, not overly broad).
- Emergency appointment creation still respects the doctor-overlap exclusion constraint even though it bypasses the availability pre-check (`FR-APPT-006`).
- FIFO batch selection picks the earliest-expiring eligible batch, not the most recently added one, across a multi-batch scenario (`FR-PHARM-002`).
- Low-stock alert fires exactly once per crossing of the reorder threshold, not on every subsequent read (`FR-PHARM-004`).
- A notification channel failure (mocked Twilio error) does not prevent the email/in-app channels for the same event from succeeding (`NFR-AVAIL-003`).

## 5. Test Data & Environment

- Integration/E2E tests run against a disposable Postgres instance (Docker service container in CI; local Docker Compose profile in dev) seeded fresh per test run — no shared mutable test database.
- Concurrency tests (#3 above) use `Promise.all` firing genuinely simultaneous requests against the running test server, not sequential awaits, to actually exercise the race condition rather than assume it away.
- Payment tests use Stripe/Razorpay test-mode fixtures and documented test card numbers (brief §15) — never live credentials.

## 6. Test Organisation

```
apps/backend/
  src/**/*.spec.ts          # unit tests, colocated with source
  test/**/*.e2e-spec.ts     # integration tests (Supertest against Nest app instance)
apps/frontend/
  src/**/*.test.tsx         # component tests (Vitest + Testing Library), colocated
  e2e/**/*.spec.ts          # Playwright, cross-app critical journeys
```

As built in Phase 12, the Playwright suite lives in `apps/frontend/e2e` (next to the app it drives and its `playwright.config.ts`) rather than a root `tests/` folder. It runs against a running stack (API on :3001, web on :3000, native or Docker). Global setup calls `apps/backend/scripts/e2e-portal-fixture.ts` to create two patients and a second lab technician, then builds the clinical history through the real API (encounter, vitals, prescription, lab result approved under four-eyes, finalized and part-paid invoice). Global teardown removes everything tied to that run. Journeys: sign-in redirect and return, wrong password, session survives reload, sign-out, staff redirect, registration to verification, records/vitals/allergies, prescription PDF download, lab result, receipt download, online payment unavailable (no provider keys), cancelled-checkout return, book → reschedule → cancel, live in-app notification over Socket.IO, cross-patient access denied in the UI and the API, and a phone-width pass with no horizontal scroll. Phase 13 adds `e2e/dashboards.spec.ts`: each staff role lands on its own dashboard with exactly its own navigation, the admin KPIs and described charts, the Super Admin platform view without search, a role refused another role's page (UI and API 403), a patient sent from the staff workspace to the portal, keyboard global search, per-role search scopes, and URL-kept filters on the lab queue, outstanding bills, and the audit log. Backend coverage is `test/analytics.e2e-spec.ts` (exact figures on fixed 2019 data across two timezones, per-endpoint role matrices, tenancy both ways, search scopes, queue ordering and filters).

Phase 13B adds `e2e/staff-journey.spec.ts`, the phase gate. One test runs the whole patient journey through the staff screens, each role in its own browser context:
- the receptionist registers the patient and books them;
- the doctor starts the visit, records vitals, prescribes, and orders a test;
- one lab technician collects, tests, and enters the result, and doesn't get an Approve button for their own entry;
- a second technician approves it;
- the pharmacist dispenses;
- the doctor completes the visit;
- the receptionist finds consultation, lab, and pharmacy lines billed automatically, finalises, and takes cash (PAID);
- the patient sees the paid bill, the prescription, and the result in the portal.

A second test checks that workflow screens refuse other roles in the UI and that the API refuses the same calls. The fixture script's `password` mode stands in for the patient's emailed set-password link. Backend coverage is `test/staff-workflows.e2e-spec.ts` (the new reads and filters: roles, tenancy both ways, scope narrowing) and `test/rate-limit.e2e-spec.ts` (the auth limiter, which had no test before). Phase 14 adds `e2e/accessibility.spec.ts` (an axe WCAG 2.1 A/AA scan of every screen as its role, in light and dark, plus keyboard-only sign-in, the skip link, a dialog's focus trap and return, and the tablet icon rail) and `src/lib/contrast.test.ts` (every token pair against AA, in both themes). The Phase 13B follow-up adds `e2e/practice-onboarding.spec.ts` (a doctor's hours, day off, and signature; vaccinations, family history, and a real browser upload read back from storage; Super Admin onboarding with verification gating the sign-up list) and `test/onboarding-schedule.e2e-spec.ts` (schedule self-only reads, the overlap rule, admin provisioning, and the bucket CORS rule). The Playwright fixture creates a doctor for each run, so no seeded doctor's hours change. Since Phase 13B the e2e setup clears the rate limiter before each spec file (`test/helpers/reset-rate-limits.ts`, D-041).

## 7. Exit Criteria for Phase 15 (Testing & Hardening)

- All nine mandatory scenarios (§3) green in CI.
- All additional risk-based scenarios (§4) implemented.
- Coverage gate met (§2).
- No open Critical or High severity finding from the Phase 15 security review.
- E2E suite covers: registration → email verification → login; full patient journey (booking → encounter → prescription → lab → invoice → payment → portal visibility); cancel/reschedule; a negative-path RBAC journey (attempted unauthorized action, verified rejected in the UI and the API).
