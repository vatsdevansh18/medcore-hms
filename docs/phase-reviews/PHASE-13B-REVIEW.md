# Phase 13B Review — Staff Workflow Screens

## Phase

Phase 13B — Staff Workflow Screens (`docs/05-DEVELOPMENT-PLAN.md`, added by D-039). Started on the user's choice "rerun, commit, then 13B" after Phase 13 was committed (`e6d4a32`). The Phase 13 Playwright rerun was first skipped (another project, task_2, held port 3001); the user later chose to stop task_2 for the Phase 13B gate run, and that run closed the Phase 13 item too.

## Objective

Build the staff screens for the workflows Phases 4–11 built API-first, so the whole patient journey runs through the UI. The plan's screens are:
- front-desk registration and scheduling;
- the doctor's encounter workspace (EMR, vitals, prescribing, lab ordering);
- lab result entry and four-eyes approval;
- pharmacy dispensing and stock receiving;
- the billing desk (draft lines, finalisation, cash payments);
- hospital administration (departments, staff, reschedule policy).

Gate: a Playwright journey runs registration → booking → encounter → prescription → lab → dispensing → invoice → payment → portal visibility through the UI.

## Implemented

**Backend: reads the screens needed** (D-041). Each is tenant-scoped from the JWT and follows the RBAC matrix:
- `GET /lab-tests?search=`: the test catalog with reference ranges (Doctor, Lab Technician, Hospital Admin). Nothing listed it before; the Phase 8 specs wrote tests straight into the database.
- `GET /users?role=&search=`: the Hospital Admin's staff directory (`SAFE_USER_SELECT` + employee code, department, doctor profile; never patients or Super Admins).
- `GET /medical-records/by-appointment/:appointmentId`: a visit's encounter, with the same visibility as a read by id.
- Narrowing filters: `medicalRecordId` on `GET /prescriptions` and `GET /lab-orders`; `patientId` on `GET /appointments`. Each narrows within the caller's scope and never widens it.
- Response additions:
  - `/auth/me` adds `doctorProfileId`;
  - `GET /prescriptions/:id` adds each line's `dispensedQuantity`, and the patient's name for staff;
  - staff `GET /invoices/:id` adds the patient's name.

**Frontend: screens** (`app/(dashboard)/dashboard/**`):
- **Front desk:**
  - the patient directory (search, URL-kept);
  - front-desk registration;
  - the patient profile with visits (and allergies for clinicians);
  - booking on a patient's behalf (doctor → slot → confirm, `SLOT_UNAVAILABLE` sends you back to fresh slots);
  - emergency visits (receptionist, or a doctor for themselves);
  - the appointment page: status moves per role, cancel with a reason, and billing.
- **Encounter workspace** (`components/modules/encounter/*`):
  - start the encounter (complaint prefilled from the booking reason, ICD-10 validated);
  - vitals (BMI from the server);
  - append-only addenda;
  - allergies;
  - prescribing (medicine search with live stock, several lines);
  - lab ordering (catalog search, urgent flag);
  - completing the visit.
  - Nurses get vitals, allergies, and addenda.
- **Laboratory:** per-item actions: mark collected → start testing → enter the result (unit and reference range shown) → review by a different technician (approve, or reject with a reason). The technician who entered a result sees no Approve button.
- **Pharmacy:**
  - dispensing: per-line "hand over now", defaulting to what's left, with live stock; FEFO on the server; atomic;
  - the medicine catalog (create);
  - medicine detail (edit, batches in FEFO order, receive a batch).
- **Billing desk:**
  - invoice lines;
  - add a line on a DRAFT, or a credit once finalised;
  - finalise;
  - take cash (capped at the balance);
  - payments with receipt downloads;
  - "Open a bill" from the visit (a supplementary bill once one is finalised).
- **Admin:**
  - the staff directory with role and search filters;
  - add staff / add doctor;
  - departments (create, rename, delete, with the API's "still in use" refusal shown);
  - the patient reschedule policy.
- **Linking:** every Phase 13 list and dashboard queue row now opens its workflow screen (`PanelRow href`, `RowLink`).
- **Access mirroring:** `WORKFLOW_ACCESS` in `staff-nav.ts` lists each list-reached screen with its roles for `RoleGate`. `lib/appointment-actions.ts` copies the API's appointment state machine to decide which buttons show; `lib/dispense.ts` builds the dispense request. The nav gains Patients, Medicines, Staff, Departments, and Settings; "Inventory" is now "Stock alerts" (next to Medicines).
- **Validation:** `lib/staff-validation.ts` mirrors each DTO (ranges, decimals, ICD-10 format, BP pairs, batch dates, cash ≤ balance, no zero lines).

**Types:** `packages/types/src/staff.ts` (every 13B request and response shape); `CurrentUser.doctorProfileId`.

**Test infrastructure:** `test/helpers/reset-rate-limits.ts` clears the auth limiter before each e2e spec file; `test/rate-limit.e2e-spec.ts` tests the limiter itself; the Playwright fixture script gains a `password` mode.

## Requirements Verified

| ID / criterion | Status | Evidence |
| --- | --- | --- |
| PRD §6 "complete the full patient journey" (the 13B gate) | Verified | `e2e/staff-journey.spec.ts`: receptionist registers → books → doctor starts the visit, records vitals, prescribes, orders a test → technician collects, tests, enters (no Approve for their own entry) → second technician approves → pharmacist dispenses → doctor completes → receptionist sees consultation, lab, and pharmacy lines billed automatically, finalises, takes cash (PAID) → the patient sees the paid bill, the prescription, and the result in the portal. Each role in its own browser context |
| FR-HOSP-002/003/004 (UI) | Verified | Journey (registration); staff screen screenshot-reviewed; `staff-workflows.e2e-spec.ts` (directory: roles, tenancy, filters, no hashes) |
| FR-APPT-002/003/005/006 (UI) | Verified | Journey (booking, confirm, start, complete); `appointment-actions.test.ts` (per-role moves mirror the API); emergency path build-checked and reviewed |
| FR-EMR-001/002/003/004/005 allergies (UI) | Verified | Journey (start, ICD-10, vitals); spec (`by-appointment` visibility: doctor/nurse/own patient 200, other patient/other hospital/no record 404, other roles 403) |
| FR-RX-001/002 (UI) | Verified | Journey; spec (`medicalRecordId` narrowing: own only, patient own only, non-UUID 400, cross-hospital empty) |
| FR-LAB-001..004 (UI) | Verified | Journey (four-eyes in the UI); spec (catalog: own hospital only, search, role matrix) |
| FR-PHARM-001..003 (UI) | Verified | Journey (dispense); spec (`dispensedQuantity` after a partial dispense, patient name staff-only, no batch id leaked); `dispense.test.ts` |
| FR-BILL-001/002/004/006 (UI) | Verified | Journey (automatic lines, finalise, cash, PAID); spec (staff invoice names the patient, patient view doesn't) |
| RBAC (UI mirrors the API) | Verified | Playwright: pharmacist refused the encounter, registration, and bill screens; lab technician refused a prescription; the API returns 403 for the same calls. `staff-nav.test.ts` covers `WORKFLOW_ACCESS` |
| Not delivered at the first 13B gate | **Closed by the follow-up** (see below) | FR-APPT-001 availability editor, FR-EMR-005 vaccinations and family history, FR-EMR-006 attachment upload, FR-RX-003 signature upload, FR-HOSP-001 Super Admin hospital onboarding |

## Files/Modules Changed

- **Backend (new):**
  - `src/lab/lab-tests.controller.ts`, `lab-tests.service.ts`, `dto/find-lab-tests-query.dto.ts`;
  - `src/users/dto/find-staff-query.dto.ts`;
  - `test/staff-workflows.e2e-spec.ts`, `test/rate-limit.e2e-spec.ts`, `test/helpers/reset-rate-limits.ts`.
- **Backend (changed):**
  - `users/users.service.ts`, `users.controller.ts` (directory);
  - `emr/medical-records.service.ts`, `controller` (by appointment);
  - `prescriptions/prescriptions.service.ts` and DTO (filter, dispensed quantity, patient);
  - `lab/lab.service.ts`, DTO, module (filter, catalog);
  - `appointments/` service and DTO (`patientId`);
  - `billing/invoices.service.ts` (patient on staff detail);
  - `auth/auth.service.ts` (`doctorProfileId`);
  - `test/jest-e2e.json` (setup file);
  - `scripts/e2e-portal-fixture.ts` (journey email, `password` mode).
- **Frontend (new):**
  - pages under `app/(dashboard)/dashboard/`: `patients/`, `patients/new`, `patients/[id]`, `appointments/new`, `appointments/[id]`, `encounters/[id]`, `lab-orders/[id]`, `prescriptions/[id]`, `medicines/`, `medicines/[id]`, `invoices/[id]`, `staff/`, `departments/`, `settings/`;
  - `components/modules/encounter/*`, `components/modules/pharmacy/medicine-form.tsx`, `components/modules/admin/staff-forms.tsx`;
  - `components/shared/detail-list.tsx`, `components/shared/lab-flag.tsx` (moved out of the portal page);
  - `services/workflows.ts`;
  - `lib/appointment-actions.ts`, `lib/dispense.ts`, `lib/staff-validation.ts`, and their 3 Vitest files;
  - `e2e/staff-journey.spec.ts`.
- **Frontend (changed):**
  - `staff-nav.ts` (+test), `constants/index.ts`, `panel.tsx` (`href`), `status-badge.tsx` (batch/account states);
  - the Phase 13 list pages and dashboards (row links), the portal lab report page (shared `Flag`);
  - `e2e/dashboards.spec.ts` (new nav labels), `e2e/global-setup.ts`.
- **Types:** `packages/types/src/staff.ts`, `portal.ts`, `index.ts`.
- **Docs:** below.

## Tests Executed

- **Backend:**
  - typecheck and lint (src, test, prisma, scripts);
  - unit;
  - the new spec alone, then the full e2e suite (twice, see Bugs Found #1);
  - 2 mutation checks on the new filters.
- **Frontend:** typecheck, lint, and Vitest.
- **Playwright:** the journey alone, then the whole suite twice against the native dev stack (the second time after the last UI fixes).
- **Visual and console review:**
  - screenshots of the encounter, lab order, dispense, bill, appointment, patient, registration errors, staff, and settings screens at 1440px and 390px;
  - a console sweep of every new screen as each role (a temporary spec, not committed).
- **Build:** the frontend production image (`docker build --target runtime`) and the API image (`docker compose build api`).
- **Cleanup check:** 0 `e2e-*` users left after the runs, and the fixture file removed.

## Test Results

- **Backend e2e: 338/338, 17/17 suites.** That's the Phase 13 289, plus 47 in `staff-workflows.e2e-spec.ts` and 2 in `rate-limit.e2e-spec.ts`.
  - The first full run was 305/336 (31 failed with 429, Bugs Found #1).
  - The rerun, with the limiter reset and the new rate-limit spec, was 338/338 (the same 336 plus the rate-limit spec's 2).
- **Backend unit:** 5/5.
- **Mutation checks:** removing the `medicalRecordId` filter, and letting `GET /users` list every role, failed 6 tests between them. Both are caught.
- **Frontend:** Vitest **77/77** (15 files; 62 before, plus 15 new).
- **Playwright: 35/35** (17 dashboards, 14 portal, 2 journey, 2 mobile). This closes Phase 13's UNVERIFIED rerun.
- **Console sweep:** no errors or warnings on any new screen for any role, apart from the known 401 token refresh at load and the socket closing during navigation.
- **Build:** the frontend production build passes (46 routes). The form-heavy screens load 186–246 kB first; `/dashboard` stays at 122 kB. The API image builds.

## Security Review

- **Tenancy:** every new read takes the hospital from the JWT, and each is tested both ways:
  - the lab catalog never shows the other hospital's same-code test;
  - each admin's directory holds only their own staff;
  - `by-appointment` is 404 across hospitals;
  - the per-encounter filters return nothing for another hospital's encounter;
  - `patientId` is empty across hospitals.
- **RBAC:** role matrices on each new endpoint (403 for every other role). The narrowing filters can't widen scope (a doctor gets nothing for a colleague's encounter; a patient nothing for another patient's). The UI's `WORKFLOW_ACCESS` refuses the same roles, and a Playwright test confirms the API refuses them independently.
- **Data minimisation:**
  - the staff directory uses `SAFE_USER_SELECT` (no password hash; tested);
  - `dispensedQuantity` is a sum: who dispensed and which batch stay out (tested);
  - patient names on the prescription and invoice detail are staff-only, the name fields only (tested);
  - the patient's own views are unchanged.
- **Input:** new query params are validated (UUIDs, enum roles, 100-character search, unknown fields rejected), and every form mirrors its DTO. The server stays the authority: slot races, stock, expiry, four-eyes, invoice locks, and the cash cap are all re-checked by the API and shown as the server's message.
- **Rate limiting:** the auth limiter had no test; it now has one (100 per route and client, then 429 `RATE_LIMITED`; other routes unaffected).
- **Front-desk registration** still never lets staff see or set the patient's password (an emailed link); the e2e fixture sets it directly only as a stand-in for that link.

## UI/UX Review

Checked against `04-UI-UX.md` §2.7, §2.8, §2.10, §6, §8, and the §9 checklist, from screenshots at 1440px and 390px and the Playwright runs:
- **One primary action per view:** Start encounter, Complete visit, Dispense, Finalise bill, Record cash, Register patient. Destructive and secondary actions are secondary or ghost buttons.
- **Confirmations (§8)** state consequences in plain language for cancel, no-show, complete, approve, reject, dispense, finalise, record cash, and delete department. Additive steps have none.
- **Forms:**
  - errors inline under each field with an icon, and the line is reserved (no layout shift);
  - re-validation on change after a submit attempt;
  - server errors in an alert region.
- **States:** skeletons while loading, specific empty states (e.g. "No batches yet — receive a batch to put this medicine in stock"), and errors with retry. Status is always words + icon + colour.
- **Density and layout:** desktop-first two- and three-column layouts that stack on phones without horizontal scroll (screenshots). Tables use compact density for batches, lines, and staff.
- **Fixed during review:** a skeleton `<div>` inside a `<p>` on the dispense screen (invalid HTML, a hydration error); "Open a bill" wording when a finalised bill already exists.

## Bugs Found

1. **The e2e suite hit the auth rate limiter.** Auth routes allow 100 requests per 15 minutes per route and client, counted in Redis. All specs share one loopback IP and run serially, so the new spec's logins took the suite past 100, and 31 tests in the two specs that ran after it failed with 429. Nothing reset the limiter, and nothing tested it.
2. **Screen-blocking API gaps:** no lab test catalog read, no staff list, no way to open a visit's encounter directly, no per-encounter prescription or lab lists, no dispensed quantity per line, and no patient name on a staff invoice or prescription detail.
3. **Invalid DOM nesting on the dispense screen** (a `<div>` skeleton inside a `<p>`), reported by Next as a hydration error. Found by the console sweep.
4. **"Open a bill" on a visit that already had a finalised bill** read as if no bill existed (it creates a supplementary DRAFT).
5. **Test-side (not product):**
   - `getByLabel("Doctor")` also matched the global search box ("…doctors…");
   - `getByText("Paid")` matched both the badge and the summary label;
   - the first rate-limit test assumed one budget per client, but it's per route.

## Fixes Applied

1. `test/helpers/reset-rate-limits.ts` (`setupFilesAfterEnv`) clears `throttle:*` before each spec file, and `test/rate-limit.e2e-spec.ts` now tests the limiter. Production limits are unchanged; an env override for tests was rejected (D-041). Full suite 338/338.
2. The reads, filters, and fields in D-041, each with role, tenancy, and narrowing tests.
3. An inline `<span>` placeholder with the same shimmer; the console sweep is clean.
4. The button reads "Start a supplementary bill" when bills exist, with a one-line explanation.
5. Tests:
   - exact label matching, and `[data-status]` for badges;
   - the rate-limit test was corrected to the real per-route behaviour (checked against the running API);
   - `CLAUDE.md` records the label pitfall.

## Regression Checks

- **Full backend suite 338/338** after every backend change, including:
  - appointments (the `patientId` filter sits beside `doctorId`);
  - prescriptions and pharmacy (the detail's new fields);
  - billing (the staff detail's patient name);
  - portal (patients' own views unchanged: no `patient` field, DRAFT still 404);
  - auth (the `/auth/me` shape).
- **The whole Playwright suite after the last UI change: 35/35.** That covers the Phase 12 portal journeys (the shared `Flag` moved out of the portal page) and the Phase 13 dashboards (row links, new nav).
- **Build:** the production frontend and API images build.

## Known Minor Issues

- ~~**UI not built for some API-complete requirements.**~~ **Closed by the follow-up below** (the user chose to build them before Phase 14). As first recorded: they were outside the plan's explicit 13B screen list, but inside its "UI half of FR-…" wording. Each worked through the API and was tested there.
  - the doctor's weekly availability and exceptions editor (FR-APPT-001);
  - vaccinations and family history entry (FR-EMR-005; allergies are built);
  - EMR attachment upload and download (FR-EMR-006);
  - the doctor's signature upload (FR-RX-003; prescription PDFs download);
  - Super Admin hospital creation and verification (FR-HOSP-001).
  - The seeded data covers them for demos. **The user should decide whether they come before Phase 14.**
- **Receptionist sample collection** is API-only: the receptionist has no lab-order read, and the lab technician marks collection (D-041).
- **Nurses see no prescription or lab-order lists in the encounter workspace:** the API gives them no list read.
- **Dispensing is FEFO-only;** the API's `batchId` override isn't offered (D-041).
- **Form-heavy screens load 186–246 kB first** (react-hook-form, zod, Radix dialog); measure and trim in Phase 14's performance pass.
- **A hospital-settings change isn't reflected in other signed-in users' cached `/auth/me`** until they sign in again. The success message says so.
- **Carried:**
  - live Stripe/Razorpay and Resend/Twilio UNVERIFIED (no credentials);
  - Phase 13's scoped-out items (Super Admin switcher, Nurse medication checklist).

## Technical Debt

- **`lib/appointment-actions.ts` copies the API's appointment state machine** for button visibility. It's documented in both places and `CLAUDE.md`, and unit-tested, but it's a copy. Serving allowed actions from the API would remove it.
- **`FREQUENCY_LABEL` is exported from the prescription panel component** and reused by the dispense page; move it to `lib/` if a third user appears.
- **Carried:**
  - audit-log writes outside interactive transactions (Phase 15);
  - Socket.IO handshake rate limiting;
  - provider error-classification tests;
  - axe (Phase 14);
  - Playwright in CI (Phase 16);
  - analytics caching (Phase 14).

## Documentation Updated

- `11-DECISIONS.md`: D-041.
- `08-API-CONTRACT.md`: new reads, filters, and fields in §4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.9, 4.11.
- `07-RBAC-MATRIX.md`: Phase 13B scoping note.
- `03-ARCHITECTURE.md`: §2 "As implemented in Phase 13B".
- `10-TESTING-STRATEGY.md`: the journey, the new specs, and the limiter reset.
- `02-SRS.md`: the Phase 13 note updated.
- `CLAUDE.md`: +3 conventions (limiter reset, Playwright label pitfall, `WORKFLOW_ACCESS`).
- `PHASE-13-REVIEW.md`: the UNVERIFIED rerun is closed (history kept).
- `HANDOFF.md`.

## Follow-up: the five remaining screens (added after the first gate)

After Phase 13B was committed (`cfb6944`), the user asked for the five screens listed under Known Minor Issues before Phase 14. They're built, and building them exposed two defects older than Phase 13B (D-042).

**Implemented:**
- **My practice** (`/dashboard/practice`, doctors):
  - weekly hours editor (add, remove, and edit windows; overlap and range checks mirroring the API);
  - days off and one-day hours changes, with removal;
  - the prescription signature upload.
- **Encounter workspace:** vaccinations, family history, and attachments panels (upload with a type and size check, open through a short-lived link).
- **Hospitals** (`/dashboard/hospitals`, Super Admin): create a hospital (slug and time-zone validation, optional address), add its Hospital Admin, and verify it (confirmed).
- **Backend:**
  - `GET /doctors/:id/schedule` and `DELETE /doctors/:id/availability-exceptions/:date` (self only);
  - `POST /hospitals/:id/admins` (Super Admin);
  - an overlap check on `PUT /doctors/:id/availability`;
  - the dev bucket CORS rule.
- **`Panel` is a named region** (accessibility, and stable test scoping).

**Bugs found:**
1. **Every browser upload to storage failed (since Phase 6).** The bucket had no CORS rule, so the preflight from the web origin got 403 ("CORS is not enabled for this bucket"). That covered attachments, signatures, and lab report files. The specs uploaded only from Node, which ignores CORS. **Fixed** at the source (`S3Service.onModuleInit` applies the rule from `CORS_ORIGIN`; production needs it from infrastructure). Regression tests: the rule's contents, a real preflight (200 for the web origin, none for a foreign one), and a Playwright upload read back from storage.
2. **A new hospital couldn't get its first Hospital Admin:** `POST /users` needs the caller's own hospital, and a Super Admin has none. **Fixed** with `POST /hospitals/:id/admins`. Tested: provisioning, a `role` in the body rejected, unknown hospital 404, non-Super-Admin 403, and anonymous 401.
3. **Overlapping weekly windows were accepted,** which would offer the same time twice. **Fixed** in the API (400) and mirrored in the editor.
4. **Test-side:**
   - The portal booking test picked "the first doctor". Once the fixture added a run-specific doctor (with no hours at that point), it picked the wrong one. It now names the seeded doctor.
   - The download helper listened for the popup's request after the popup opened, a race that fast links lose. It now listens on the browser context before clicking.
   - `getByLabel("Name")` also matched "Short name (slug)".

**Tests and results (after the last change):**
- **Backend e2e:** 346/346 across 18 suites, adding `onboarding-schedule.e2e-spec.ts` (8). Backend unit 5/5.
- **Frontend:** typecheck and lint pass; Vitest 81/81 (adds `schedule.test.ts`).
- **Playwright 38/38.** This adds `practice-onboarding.spec.ts` (3): hours, day off, and signature; vaccinations, family history, and a real browser upload read back; Super Admin create, add admin, and verify, with the sign-up list gated on verification.
- **Clean fixture teardown:** 0 `e2e-*` users or hospitals left. The fixture now creates its own doctor, so no seeded doctor's hours change.
- **Build:** production frontend and API images (see the handoff for the run).

**Security:**
- The schedule reads are self only (a colleague or another hospital's doctor gets 404; other roles 403).
- Admin provisioning is Super Admin only, and the role is fixed by the route.
- The CORS rule lists the web origins only, with PUT and GET, never `*`.
- Upload type and size are still enforced by the API; the browser check only mirrors them.

**Remaining minor items:**
- An attachment row is created when the upload is declared, so a failed or abandoned upload leaves a listed file whose link gives a storage 404. The API has no "confirm upload" step. This existed since Phase 6 and is now visible in the UI; candidate for Phase 15.
- Hospital suspension and editing another hospital's details aren't on the Super Admin screen (FR-HOSP-001 is create and verify).

## Final Gate

**PASS WITH DOCUMENTED MINOR ISSUES** (reaffirmed after the follow-up, which closed the five screen gaps).

Every screen in the plan's 13B list is built, wired to the real API, and exercised. The gate test (the whole patient journey through the UI, with four-eyes lab approval and automatic billing) passes, as do the negative access checks in the UI and the API, the full backend suite (338/338), and the full browser suite (35/35). No critical or high-severity defect is open.

The minor items at the first gate were the five API-complete requirements without a screen; the follow-up above built them and fixed the two older defects they exposed. What remains is minor: the documented scope choices, the attachment confirm step, and the carried provider items.

Phase 14 doesn't start until the user says so.
