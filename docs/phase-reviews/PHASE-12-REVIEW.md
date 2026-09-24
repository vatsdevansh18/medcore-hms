# Phase 12 Review — Patient Portal

## Phase

Phase 12 — Patient Portal (`docs/05-DEVELOPMENT-PLAN.md`). Started on the user's go-ahead, given after Phase 11 was committed (`e78551d`).

## Objective

Give patients a self-service web portal over their own appointments, medical records, prescriptions, lab reports, and invoices, with self-service booking, rescheduling, cancellation, and payment (`FR-PORTAL-001..003`). This is the first phase with real frontend work: until now `apps/frontend` was the Phase 1 skeleton.

## Implemented

**Backend: patient-scoped reads** (D-035):
- `GET /prescriptions` (patient, own; paginated, `status` filter) and `GET /lab-orders` (patient, own; a summary with no results, which are still read through `GET /lab-orders/:id` and the D-021 rule).
- `GET /invoices` now serves patients too, forced to their own invoices, never DRAFTs. `GET /invoices/:id` is 404 for a patient's own DRAFT.
- `GET /auth/me` adds `patientProfileId` and a `hospital` summary (name, timezone, reschedule policy).
- `GET /hospitals/directory` (public): ACTIVE hospitals, id/name/slug/city only, for the sign-up form.
- `GET /appointments?sortOrder=asc|desc`.

**Backend: self-service reschedule** (D-035): `PATCH /appointments/:id/reschedule`, patient (self) only. It's gated by the new `Hospital.patientRescheduleAllowed` and `patientRescheduleCutoffHours`, which Hospital Admins edit through `PATCH /hospitals/:id`. Allowed from PENDING/CONFIRMED, never for EMERGENCY. The new window must be an open slot with the same doctor. The appointment keeps its id, returns to PENDING, and its reminders are cancelled. The move is one conditional UPDATE: the exclusion constraints decide a slot race, and a concurrent change gets 409. The new 422 `RESCHEDULE_NOT_ALLOWED` covers policy, cutoff, and type refusals.

**Backend: receipts** (D-036, deferred from Phase 10 by D-030): `GET /payments/:id/receipt` for the paying patient and same-hospital billing staff. It returns `{downloadUrl}` for a SUCCEEDED payment and 409 otherwise. The PDF is rendered on first request, cached in S3, and its key kept on the new `Payment.receiptUrl`. Puppeteer rendering moved into a shared `PdfRendererService` (`src/common/pdf/`), also used by prescription PDFs.

**Backend: scheduling in the hospital timezone** (D-037): a fix for a Phase 5 simplification. `computeAvailability` reads schedules as wall-clock times in `Hospital.timezone` (`src/common/time/zoned-time.ts`, `Intl` only), and booking/reschedule look a slot up on its hospital-local date.

**Backend: response minimisation** (D-036): no response carries an S3 storage key any more (doctor signature → `hasSignature`; prescription PDF/signature → `pdfReady`; attachment `storageKey` dropped). Appointment and lab-order responses carry a name-only doctor projection, and the doctor directory drops email/phone for patient callers.

**Backend: Docker dev downloads** (D-036): `S3Service` signs URLs for browsers with `S3_PUBLIC_ENDPOINT` when set (compose: `http://localhost:4566`), and URLs the server fetches itself with the internal endpoint (`getInternalDownloadUrl`).

**Schema** (migration `20260926090000_patient_portal`): `Hospital.patientRescheduleAllowed` (default true), `Hospital.patientRescheduleCutoffHours` (default 24, `CHECK >= 0`), and `Payment.receiptUrl`.

**Shared types** (`packages/types/src/portal.ts`): the view shapes the portal reads (`CurrentUser`, `HospitalSummary`, `DoctorView`, `AppointmentView`, `MedicalRecordView`, `PrescriptionView`, `LabOrderView`/`LabOrderSummaryView`, `InvoiceView`/`InvoiceSummaryView`, `CheckoutSessionView`, and others), plus `ApiErrorCode.RESCHEDULE_NOT_ALLOWED`.

**Frontend** (Next.js 15 App Router, D-038):
- **Foundation:** design tokens from `04-UI-UX.md` §2.1 with dark mode (OS preference or a manual toggle, no flash). shadcn-style `components/ui` primitives (Button, Input/Textarea/Select, Label, Dialog, Card, Skeleton). The shared components the UI doc names: StatusBadge (words + icon + colour), EmptyState/ErrorState/ListSkeleton/FormError, PageHeader, ConfirmDialog (consequence stated), Pagination, FormField (aria wiring, reserved message line), Toaster (`aria-live`), DownloadButton, StepIndicator.
- **Data layer:** `lib/api-client.ts` (envelopes, error codes, single-flight refresh with a cross-tab Web Lock) and TanStack Query hooks in `services/`. Zustand `authStore`, `notificationStore`, `uiStore`.
- **Auth screens:** sign-in (with `next` return and a "verify now" link), registration with the hospital picker, email verification with resend, and forgot/reset password.
- **Portal:**
  - Overview: next appointment, bills due, latest prescription, latest lab tests.
  - Appointments: upcoming/past tabs, three-step booking (doctor search, a week-by-week slot picker in hospital time, confirm), and a detail page with reschedule and cancel (reason required).
  - Records: visits, allergies, vaccinations, family history, and a visit detail page with vitals, notes, addenda, and attachment downloads.
  - Prescriptions: list, and a detail page with PDF download (polls until the PDF is rendered; stacked list on phones).
  - Lab reports: list, and a detail page with values, range flags, and the report file.
  - Bills: list, and a detail page with items, totals, payments, receipts, and online payment. Stripe redirects to its hosted page; Razorpay opens its hosted checkout script. On return the page polls the invoice until the webhook settles, and shows a cancelled-checkout banner.
  - Live notifications: a bell with the unread count and a slide-over panel. Socket.IO with token refresh on reconnect; each notification links to its entity and invalidates the affected queries.
- **Staff sign-ins** land on `/staff`, which says plainly that staff workspaces arrive in Phase 13 (no mock dashboard).

**Tests:**
- Vitest + Testing Library (`apps/frontend/src/**/*.test.ts(x)`, 42 tests).
- Playwright (`apps/frontend/e2e`, 15 journeys, with a backend fixture script for setup/teardown).
- A new backend `portal.e2e-spec.ts` (29 tests) and an `S3Service` unit spec (3 tests).
- CI builds `@medcore/types` before `pnpm run test`, which now includes the frontend's Vitest.

## Requirements Verified

| ID | Status | Evidence |
| --- | --- | --- |
| FR-PORTAL-001 (view own appointments, records, prescriptions + PDF, lab reports post-approval, invoices/payments) | Verified | `portal.e2e-spec.ts` (own-only lists, D-021 on the patient read, DRAFT hidden, no storage keys); Playwright records/prescription-PDF/lab/receipt journeys |
| FR-PORTAL-002 (book, reschedule if policy allows, cancel own; same conflict rules) | Verified | Reschedule suite: policy, cutoff, type, status, ownership, cross-tenant, staff 403, open-slot check, same-appointment race, same-slot race between two patients; Playwright book → reschedule → cancel |
| FR-PORTAL-003 (pay a FINALIZED invoice) | Verified up to the provider; live checkout UNVERIFIED | Checkout request, the 503 path, return polling, and the cancelled banner in Playwright. Webhook settlement is covered by Phase 10. A live Stripe/Razorpay checkout needs test keys (carried from Phase 10) |
| FR-BILL-006 receipt (Phase 10 deferral) | Verified | Receipt rendered in-process and in the Alpine container, cached once, ownership/tenancy/role/status refusals |
| FR-APPT-001/002 in hospital time (D-037) | Verified | IST slots (09:00 IST = 03:30Z); the old UTC reading rejected with 409 |
| FR-NOTIF-003 in the browser | Verified | Playwright: staff confirm → bell count rises without a reload → the panel link opens the appointment |
| Mandatory scenario #2 (a patient can't see another patient's records) | Verified in UI and API | Playwright access-control journey + backend 404s |
| SEC-AUTHN-008, SEC-DATA-006, SEC-FILE-005 (new) | Verified | api-client unit tests (single-flight, mutation-checked); minimisation assertions; `S3Service` unit spec; Docker download journeys |

## Files/Modules Changed

- **Backend (changed):**
  - `appointments/` (service: reschedule, shared slot check, narrow doctor include, `sortOrder`; controller; new DTO);
  - `doctors/availability.service.ts` (timezone) and `doctors/doctors.service.ts` (`toDoctorView`);
  - `prescriptions/` (list endpoint, new `prescription-view.ts`, DTO; template uses the shared escaper);
  - `lab/` (list endpoint, narrow doctor include);
  - `billing/invoices.*` (patient list, DRAFT hidden) and `billing/payments/` (new `receipts.service.ts`, `payments.controller.ts`, `receipt-pdf-template.ts`);
  - `emr/medical-records.service.ts` (no storage keys);
  - `hospitals/` (directory, policy DTO fields);
  - `auth/auth.service.ts` (`/auth/me`);
  - `medicines/dispensing.service.ts` (prescription view);
  - `queue/prescription-pdf.processor.ts` (shared renderer, internal URL for the signature);
  - `common/storage/s3.service.ts` (public vs internal signer) and `config/env.validation.ts` (`S3_PUBLIC_ENDPOINT`).
- **Backend (new):**
  - `common/time/zoned-time.ts`, `common/pdf/pdf-renderer.service.ts`;
  - `scripts/e2e-portal-fixture.ts`;
  - migration `20260926090000_patient_portal`.
  - `tsconfig.eslint.json` and the `lint` script now include `scripts/`.
- **Tests:**
  - `test/portal.e2e-spec.ts` (new);
  - `test/appointments.e2e-spec.ts` (hospital pinned to UTC);
  - `test/billing.e2e-spec.ts` (patient list assertion updated to D-035);
  - `src/common/storage/s3.service.spec.ts` (new).
- **Shared types:** `packages/types/src/portal.ts` (new), `api-envelope.ts`, `index.ts`.
- **Frontend:** `apps/frontend/src/**` (app routes, components, hooks, services, store, lib, constants), `vitest.config.mts`, `vitest.setup.ts`, `playwright.config.ts`, `e2e/**`, `package.json` (dependencies and `test`/`test:e2e` scripts).
- **Infrastructure:** `docker-compose.yml` (`S3_PUBLIC_ENDPOINT`), `.env.example`, `.github/workflows/ci.yml` (types build before tests), `.gitignore` (fixture file).
- **Dependencies (frontend):**
  - runtime: `@tanstack/react-query`, `zustand`, `react-hook-form`, `zod`, `@hookform/resolvers`, `@radix-ui/react-{dialog,slot,label}`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `socket.io-client`, `framer-motion`;
  - dev: `vitest`, `@vitejs/plugin-react`, `@testing-library/{react,user-event,jest-dom,dom}`, `jsdom`, `@playwright/test`.
  - All are named in the brief's stack or needed by it (shadcn = Radix + cva + clsx + tailwind-merge). No backend dependency was added.

## Tests Executed

- Backend: typecheck and lint (zero warnings, now including `scripts/`); unit (`pnpm run test`: 2 suites); full e2e, serial, with every API process stopped first.
- 15 mutation checks on `portal.e2e-spec.ts`, each breaking one guard:
  - DRAFT hidden from the list, and by id;
  - reschedule ownership, conditional update, policy, cutoff, and reminder cancellation;
  - timezone;
  - attachment key strip;
  - receipt ownership and status;
  - doctor contact strip;
  - prescription and lab list ownership;
  - directory ACTIVE-only.
- Frontend: typecheck, lint, Vitest, and one mutation check on the refresh single-flight test.
- Native `next build`: compile, type validation, and all 18 pages succeed. Only the standalone trace-copy step fails, on the known Windows symlink limit (Phase 1). The full production build passes in Linux (`docker build --target runtime`).
- Playwright, 15 journeys: against the native dev stack, and again against the Docker stack (`docker compose build api frontend` + `up`).
- Visual review from screenshots: desktop, dark mode, and phone width.

## Test Results

- Backend e2e: **260/260, 14/14 suites**, 48s (231 before this phase + 29 in `portal.e2e-spec.ts`). No leftover test rows (hospital count back to the 2 seeded).
- Backend unit: 5/5 (2 suites). Mutation checks: **15/15 caught**.
- Frontend Vitest: **42/42** (8 files). Single-flight mutation: caught.
- Playwright: **15/15** against native dev and **15/15** against Docker (earlier native runs of the first 14 journeys also passed). Fixture teardown left 0 `e2e-*` users each time.
- The first Docker Playwright run failed 2/15 (downloads), which exposed Bug #4 below. The earlier Playwright failures (selectors, a lost click) are covered under Bugs Found and Fixes Applied.
- Migration `20260926090000_patient_portal`: applied; shadow-DB `migrate diff` against the schema shows no difference.
- Typecheck/lint: backend, frontend, and types all clean. Docker images: api and frontend (dev) built; frontend production target built.

## Security Review

**Tenancy and ownership:**
- Every new read derives the patient from the JWT's user, never from input. A `patientId` filter can't widen `GET /invoices` for a patient.
- Another patient's or hospital's appointment, invoice, lab order, prescription, receipt, or record is a 404, tested in the API and the UI.
- Staff roles are 403 on patient-only endpoints (`GET /prescriptions`, `GET /lab-orders`, `PATCH .../reschedule`), and a non-billing staff role is 403 on receipts.

**Concurrency:** the reschedule is a single conditional update, and two concurrent reschedules of one appointment give exactly one 200. Two patients racing for one new slot give one 200 and one 409 (the DB constraint decides).

**Data minimisation:** SEC-DATA-006 and SEC-FILE-005 (new). Storage keys are gone from every response; doctor email/phone no longer reach patients; DRAFT invoices aren't shared; the public directory returns names and cities only.

**Authentication (frontend):**
- The access token lives in memory only.
- The refresh cookie stays `httpOnly`, `SameSite=Strict`, path `/api/auth`.
- One refresh at a time, so the client can't trigger replay revocation against itself (SEC-AUTHN-008).
- `next` redirects accept same-app paths only (no `//host` open redirect).
- Route guards are UX; the API enforces everything.

**XSS:** the portal renders every server string as React text (escaped). There is no `dangerouslySetInnerHTML` except the fixed theme script, so SEC-INPUT-003's DOMPurify isn't needed yet (no rich text is rendered). The receipt and prescription templates escape every interpolated value, now including `'`.

**Payments:** the page never treats the provider's redirect or Razorpay's handler as success. It polls the server, and the webhook (Phase 10) decides.

**Residual:**
- The public directory adds a small, rate-limited, unauthenticated read.
- Registration still says "An account with this email already exists" (pre-existing Phase 3 behaviour, noted as a minor enumeration issue below).

## UI/UX Review

Checked against `04-UI-UX.md` §9, from the running app and screenshots at 1366px, dark mode, and 390px:
- **Primary action and density:** one primary action per view (Book appointment, Pay, Download PDF, Reschedule). Token-only colours, the 14px base type scale, and a calm, low-density overview (§5 Patient).
- **Status legibility:** every status is a word, an icon, and a colour (§1.3); lab flags are an arrow and a word.
- **States:** loading skeletons shaped like the content, empty states with a next step, errors derived from the error code with retry only when retrying helps, a toast for the user's own actions, and a dedicated confirmation screen for a booking.
- **Confirmations and forms:** cancellation states its consequence and needs a reason (§8). Forms validate on blur and submit, with inline errors wired by `aria-describedby`/`aria-invalid`.
- **Responsive:** mobile-first. A drawer menu on phones (Playwright checks no horizontal scroll on four pages), and the prescription table becomes a stacked list.
- **Accessibility:** keyboard operation through native controls and Radix dialogs, visible focus rings, `prefers-reduced-motion` respected, and motion only for toasts.
- Automated accessibility scanning (axe) isn't set up; that's the Phase 14 pass.

## Bugs Found

1. **Scheduling ignored the hospital timezone** (Medium; Phase 5 origin). A 09:00 IST schedule produced 14:30 IST slots, and the decision entry the code cited was never written. It became visible the moment the portal showed times to patients.
2. **S3 storage keys in API responses** (Low; Phases 6/7 origin): doctor `signatureImageUrl` (doctor directory and every appointment), prescription `pdfUrl`/`signatureImageUrl`, and EMR `storageKey`. The bucket is private, so it isn't exploitable alone, but it contradicts the project's reading of SEC-FILE-003.
3. **Doctor email and phone reached patients** (Low, privacy) through the doctor directory and appointment responses (`SAFE_USER_SELECT`).
4. **Every file download failed in the Docker dev stack** (Medium; Phase 6 origin). Pre-signed URLs were signed for `localstack:4566`, which only containers resolve. Nothing had opened a URL from a real browser before. Found by the Playwright download journeys against Docker.
5. **A submit click could be swallowed** (frontend). A validation message appearing on blur moved the Submit button away mid-click. Found by the Playwright registration journey.
6. **`HANDOFF.md` said no Receptionist, Pharmacist, or Accountant was seeded** (documentation). The seed creates one per role per hospital, and the database has them.
7. A patient could read their own DRAFT invoice by id (Phase 10 behaviour). This isn't a leak, but it contradicts "finalised and shared with the patient"; changed by D-035.

## Fixes Applied

1. Timezone-aware slot generation and slot lookup (D-037), with IST tests. The appointments spec pins its hospital to UTC. Forward note on D-023.
2. View mappers drop every storage key (`toPrescriptionView`, `toDoctorView`, `toAttachmentView`), with assertions in `portal.e2e-spec.ts`.
3. A name-only doctor projection for appointments and lab orders, and email/phone dropped for patient callers of the directory.
4. `S3_PUBLIC_ENDPOINT` for client URLs and `getInternalDownloadUrl` for server fetches; compose sets it. A unit regression spec, and Playwright downloads now pass against Docker.
5. `FormField` reserves its message line, and forms re-validate on change after a submit attempt.
6. Corrected in `HANDOFF.md` (this session).
7. DRAFT is 404 for its patient, and the patient's list excludes DRAFTs (`billing.e2e-spec.ts` updated to the new rule).

## Regression Checks

- **Full backend suite**, 260/260, including the Phase 5 concurrency specs (the booking path was refactored into `assertOpenSlot`), Phase 7 prescriptions and signature, Phase 9 pharmacy dispensing (whose response now goes through `toPrescriptionView`), Phase 10 billing (patient list rule), and Phase 11 notifications (confirmation notifications still fire; the appointment include changed shape).
- **Prescription PDF job:** after the renderer refactor it renders in-process during e2e and in the container (Playwright downloads a real `%PDF`).
- **`/auth/me`:** the auth spec's `/auth/me` checks still pass with the added fields.

## Known Minor Issues

- **Live Stripe/Razorpay checkout UNVERIFIED** (carried from Phase 10): no test keys. The Stripe redirect and the Razorpay hosted-checkout script path in the portal are built but haven't run against the providers; the 503 path is verified.
- **Live Resend/Twilio sends UNVERIFIED** (carried from Phase 11).
- **Receipt date** is the payment's creation time. For an online payment that's when checkout started, not when the webhook settled it (`Payment` has no settlement timestamp).
- **No notification tells staff about a patient reschedule.** The appointment simply returns to PENDING for them to confirm; the brief's trigger table has no such event.
- **Registration reveals an existing email** ("An account with this email already exists", Phase 3). Minor enumeration; login and forgot-password don't.
- **No automated accessibility scan (axe) yet.** Manual checks only; the Phase 14 pass.

## Technical Debt

- Portal pages are Client Components (the token is in memory), which departs from the brief's Server Components hint for data-heavy pages. That hint targets staff lists and analytics, which are Phase 13; recorded in D-038 and the architecture doc.
- The browser E2E suite isn't in CI yet: it needs the full stack. It belongs with the Phase 16 pipeline (the testing strategy already runs E2E on a schedule, not per PR).
- Carried:
  - audit-log writes outside interactive transactions (Phase 15);
  - Socket.IO handshake rate limiting;
  - unit tests for provider error classification.

## Documentation Updated

- `11-DECISIONS.md`: D-035 (portal API scope and reschedule), D-036 (response minimisation and receipts), D-037 (timezone scheduling), D-038 (frontend session and shell); forward notes on D-023 and D-030.
- `08-API-CONTRACT.md`: new endpoints, changed rows, and the `RESCHEDULE_NOT_ALLOWED` error code.
- `07-RBAC-MATRIX.md`: reschedule and receipt rows, and Patient scoping notes.
- `09-SECURITY.md`: SEC-AUTHN-008, SEC-DATA-006, SEC-FILE-005.
- `06-DATABASE-DESIGN.md`: Hospital policy fields, `Payment.receiptUrl`, timezone semantics.
- `03-ARCHITECTURE.md`: §2 as-implemented frontend, and §10 signer split.
- `02-SRS.md`: FR-PORTAL interpretation.
- `10-TESTING-STRATEGY.md`: Playwright location and journeys.
- `.env.example`, and `CLAUDE.md` (+9 conventions).

## Final Gate

**PASS WITH DOCUMENTED MINOR ISSUES.**

`FR-PORTAL-001` and `FR-PORTAL-002` are verified end to end in the API and the browser. `FR-PORTAL-003` is verified up to the payment provider; the live provider round-trip is UNVERIFIED for lack of test keys, the same as Phase 10. No critical or high-severity defect is open. The four defects found that came from earlier phases (timezone, storage keys, doctor contact details, Docker downloads) were fixed at the root, with regression tests. Phase 13 (Analytics & Dashboards) doesn't start until the user says so.
