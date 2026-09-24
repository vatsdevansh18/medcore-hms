# Phase 13 Review — Analytics & Dashboards

## Phase

Phase 13 — Analytics & Dashboards (`docs/05-DEVELOPMENT-PLAN.md`). Started on the user's "commit and START PHASE 13" (Phase 12 committed as `bf6e45d`).

## Objective

Role-specific dashboards with Recharts charts, global search, filters, and pagination (`FR-ANALYTICS-001`, `FR-SEARCH-001`, and `NFR-PERF-003` for the lists). This is the first staff-facing UI.

**Scope decision taken at the start** (D-039, the user's choice): no phase in the plan built the staff workflow screens (encounter, prescribing, lab entry, dispensing, billing desk, registration). Phase 13 stays dashboards, analytics, and search; a new **Phase 13B — Staff Workflow Screens** was added to the plan before Phase 14. So the Phase 13 dashboards are read-only work queues whose rows don't link to workflow screens yet.

## Implemented

**Backend** (`src/analytics/`, D-040):
- `GET /analytics/overview`: today's KPIs.
- `GET /analytics/appointments`: daily counts by status (a doctor sees only their own).
- `GET /analytics/revenue`: collected, invoiced, outstanding.
- `GET /analytics/occupancy`: the bed board.
- Days are hospital-local calendar days grouped in SQL; the Super Admin gets a UTC platform view.
- `GET /search`: role-scoped patients, doctors, and medicines. Every term must match; grouped top-5 or a paginated scope; hospital from the JWT.
- `GET /audit-logs`: Hospital Admin own hospital, Super Admin all; never before/after data.

**Backend: staff work queues:**
- `GET /lab-orders` for Lab Technician (URGENT first, then oldest) and Doctor (own).
- `GET /prescriptions` for Pharmacist (oldest first) and Doctor (own).
- `GET /payments`: the reconciliation list.
- Comma-separated status filters (`CommaSeparatedEnum`) on lab orders, prescriptions, appointments, invoices, and payments.
- `GET /appointments?doctorId=` narrows within the caller's scope.
- Staff invoice rows carry the patient's name.

**Backend: patient directory:** the list follows the RBAC matrix; Lab Technician and Pharmacist get an empty list. This closes the Phase 4 stopgap.

**Demo history:** `prisma/seed-history.ts` (`pnpm run db:seed:history`). About 300 appointments per hospital over the last two weeks and the next one, with encounters, vitals, prescriptions, lab results (four-eyes), invoices in every state with matching payments, admissions, and bed states. Idempotent. A SQL audit afterwards found 0 status/payment mismatches, 0 line or subtotal mismatches, and 0 self-approved results.

**Frontend:**
- **Workspace:** a staff workspace at `/dashboard`, built on a shared `AppShell` that the portal also uses now. Role navigation (`staff-nav.ts`), a `RoleGate` refusal for pages outside a role's navigation, the notification bell, and a theme toggle.
- **Dashboards** (§5), one per role:
  - Hospital Admin: KPIs, 7-day stacked appointments, 30-day revenue, department occupancy, low stock, recent activity.
  - Doctor: today's timeline, patient lookup, month calendar, pending lab results, recent prescriptions.
  - Nurse: bed board, patients in clinic.
  - Receptionist: today's schedule, awaiting confirmation, draft bills.
  - Lab Technician: counts by stage, urgent-first queue.
  - Pharmacist: to dispense, low stock, expiring, medicine lookup.
  - Accountant: 7/30/90-day range, collected/invoiced/outstanding, chart, outstanding bills, reconciliation.
  - Super Admin: platform KPIs, charts, audit.
- **Search:** a global search combobox (debounced 300 ms, ARIA, keyboard) and a full results page with a tab per allowed scope.
- **Lists:** eight filtered, paginated list pages (appointments, lab orders, prescriptions, bills, payments, inventory, beds, audit), with filters in the URL. Shared `DataTable`, `StatCard`, `Panel`, `FilterBar`.
- **Performance:** each role's dashboard is its own chunk.
- **Wording:** staff see a prescription as "Issued"; patients keep "Ready to collect".

**Types:** `packages/types/src/analytics.ts` (analytics, search, audit, payment, and queue row views; `SearchScope`; inventory rows).

## Requirements Verified

| ID | Status | Evidence |
| --- | --- | --- |
| FR-ANALYTICS-001 | Verified | `analytics.e2e-spec.ts`: exact figures on fixed 2019 data in two timezones, zero-filled days, doctor limited to own, platform totals, per-endpoint role matrices, tenancy both ways. Playwright: each role lands on its own dashboard with exactly its own navigation; admin KPIs and described charts; Super Admin platform view. Screenshots reviewed for all 8 roles plus phone |
| FR-SEARCH-001 | Verified | Spec: multi-term matching, scopes per role (403 for a forbidden scope, Patient, Super Admin), cross-tenant isolation, pagination, validation, no password hashes. Vitest: one debounced request per burst, keyboard operation. Playwright: keyboard search to results; per-role tabs |
| NFR-PERF-003 (lists) | Verified | Every new list is server-paginated (limit ≤ 100), filterable, URL-kept; `/dashboard` first load 304 kB → 122 kB after per-role chunks |
| SEC-AUDIT-002 | Verified | Own-hospital vs platform scoping, entity filter validated, no before/after data in rows |
| RBAC §3.2 directory row | Verified | Lab Technician/Pharmacist directory list is empty; Receptionist finds the patient |

## Files/Modules Changed

- **Backend (new):**
  - `src/analytics/` (module; analytics, search, and audit-log services; controllers; 3 DTOs);
  - `src/common/validation/comma-separated-enum.decorator.ts`;
  - `src/billing/payments/payments-query.service.ts`, `src/billing/dto/find-payments-query.dto.ts`, `src/lab/dto/find-lab-orders-query.dto.ts`;
  - `prisma/seed-history.ts`;
  - `test/analytics.e2e-spec.ts`.
- **Backend (changed):**
  - `app.module.ts`;
  - `lab/lab.service.ts` and `lab.controller.ts` (staff queue);
  - `prescriptions/prescriptions.service.ts` and controller, plus the DTO (staff queue);
  - `appointments/` (status list, `doctorId` narrowing);
  - `billing/invoices.service.ts` (status list, patient names), `billing/dto/find-invoices-query.dto.ts`, `billing/payments/payments.controller.ts`, `billing/billing.module.ts`;
  - `patients/patients.service.ts` (directory list roles);
  - `package.json` (`db:seed:history`);
  - `test/portal.e2e-spec.ts` (doctor list rules).
- **Frontend (new):**
  - `app/(dashboard)/dashboard/` (layout, dashboard, 9 pages);
  - `components/modules/` (`app-shell`, `staff-nav`, `global-search`, `role-gate`, `charts/*`, `dashboards/*`);
  - `components/shared/` (`data-table`, `stat-card`, `panel`, `filter-bar`);
  - `hooks/use-url-filters.ts`, `lib/chart-data.ts`, `lib/zoned-time.ts`, `services/staff.ts`;
  - 4 Vitest files; `e2e/dashboards.spec.ts`.
- **Frontend (changed):**
  - portal layout (now on `AppShell`), `portal-nav.ts`, `(dashboard)/staff` (now a redirect);
  - `hooks/use-auth.ts` (staff home) and `use-hospital.ts`;
  - `constants/index.ts`, `status-badge.tsx` (staff wording);
  - `e2e/portal.spec.ts` (staff landing), `e2e/mobile.spec.ts`.
- **Dependency:** `recharts` (named in the brief).
- **Types:** `packages/types/src/analytics.ts`, `index.ts`.
- **Docs:** listed below.

## Tests Executed

- Backend:
  - typecheck and lint (incl. `scripts/`, `prisma/`);
  - unit (`pnpm run test`);
  - full e2e, serial, after stopping every leftover dev process;
  - 14 mutation checks on the analytics spec;
  - a SQL consistency audit of the seeded history.
- Frontend:
  - typecheck, lint, Vitest;
  - a mutation check on the debounce test;
  - Playwright against the native dev stack;
  - screenshots of all 8 staff dashboards, search, the lab queue, and phone width.
- Docker: `docker compose build api`, and `docker build --target runtime` for the frontend (a full `next build`, 28 pages), before and after the code-splitting change.

## Test Results

- **Backend e2e: 289/289, 15/15 suites** (48s): 260 before + 29 in `analytics.e2e-spec.ts`, with 2 portal assertions updated to the Phase 13 rules. No leftover rows (hospital count back to the 2 seeded).
  - The first full run failed 9 notification tests: a leftover dev-server API process was taking their jobs (D-034). With it stopped, the notification spec passed 33/33 and the full suite 289/289.
- **Backend unit:** 5/5.
- **Mutation checks:** 13/14 caught. The "search patients cross-tenant" mutation (dropping the explicit `hospitalId`) is masked by the tenant-scoping extension, which adds it anyway. That's defense in depth working as designed.
  - "DRAFT counted as invoiced" was first missed, since drafts have no `finalizedAt`. A cancelled-after-finalize fixture invoice was added, and it's now caught.
- **Frontend:** Vitest **62/62** (12 files); the debounce mutation is caught. Playwright **33/33** (15 portal, 16 dashboards, 2 mobile), with fixture teardown clean.
- **Build:** the frontend production image builds (28 pages; `/dashboard` 122 kB first load after the split); the API image builds.

## Security Review

- **Tenancy:**
  - every analytics and search query takes the hospital from the JWT;
  - raw SQL binds `hospitalId` explicitly, and removing it was caught by the tenancy test;
  - hospital B's admin sees none of A's revenue, beds, audit rows, or payments, and B's receptionist doesn't find A's patient;
  - the platform view is reachable only by Super Admin (`@BypassTenantScope()` applies only to that role).
- **RBAC:** a 7-endpoint role matrix (allowed roles 200, every other role 403, anonymous 401). A disallowed search scope is 403. The patient directory is closed to Lab Technician and Pharmacist, as the matrix says.
- **Data minimisation:**
  - the audit log returns no before/after data;
  - payment rows are an explicit field list (no provider payload, reference, or verification flag);
  - staff queue rows carry names only (tested: no email or phone in invoice rows);
  - search responses never contain password hashes (tested).
- **Input:** date ranges are validated (format, real date, order, 92-day cap); search is 2–100 characters, trimmed, at most 5 terms; `entityType` matches `^[A-Z][A-Za-z]{1,40}$`; status lists are enum-checked. All SQL is parameterised (`Prisma.sql`); the only `Prisma.raw` is a fixed, code-supplied table alias.
- **Frontend:** a hand-typed URL for another role's page shows a refusal (UX), and the API returns 403 regardless (tested in Playwright).

## UI/UX Review

Checked against `04-UI-UX.md` §5 and the §9 checklist, from screenshots of all 8 roles at 1440px and the admin at 390px:
- **Distinct layouts:** each dashboard answers its role's first-hour questions, not a relabelled copy (§6).
- **Status and data density:** status stays words + icon + colour, and bed cells add a symbol. Charts use the semantic tokens with a legend and a text summary (`figcaption`). The revenue chart uses straight segments; the smoothed curves had implied activity on empty weekend days.
- **States:** loading skeletons, per-panel empty states with specific wording, errors with retry only when useful, and KPI tiles with explicit loading.
- **Tables:** sticky headers, server pagination, filters above the table, compact density for high-volume queues, and secondary columns hidden on phones.
- **Keyboard and focus:** the search combobox (arrows, Enter, Escape, `aria-activedescendant`), radio-group range picker, and ARIA tabs.
- **Motion:** first-load stagger only; none under reduced motion.
- **Responsive:** the admin dashboard and bed board have no horizontal scroll at 390px (Playwright checks the bed board).
- **Outstanding:** workflow screens (Phase 13B). The Super Admin "hospital switcher" from §2.4 isn't built; the platform view aggregates instead.

## Bugs Found

1. **A `doctorId` filter was silently replaced by a doctor's own scope,** so a doctor asking for a colleague's appointments got their own list. Found by the new analytics spec.
2. **The patient directory list was still open to Lab Technician and Pharmacist** (a Phase 4 stopgap that the later phases never closed). It contradicts RBAC §3.2 and would have leaked into global search.
3. **Staff invoice rows had only a `patientId`,** which made the billing queues unusable.
4. **The revenue chart's smoothing drew activity on days with none.**
5. **Staff saw patient wording ("Ready to collect") for issued prescriptions.**
6. **`/dashboard` shipped every role's dashboard and Recharts to everyone** (304 kB first load).
7. **Environment:** leftover dev-server Node processes (after the background shells were stopped for memory pressure) took e2e notification jobs.

## Fixes Applied

1. The filter now narrows within the caller's scope (a colleague's id returns an empty list); tested and mutation-checked.
2. `DIRECTORY_LIST_ROLES` follows the matrix; single-patient reads in context are unchanged; tested and mutation-checked.
3. Staff invoice rows include the patient's name only; tested.
4. The revenue chart uses linear segments.
5. A `staff-rx` status wording ("Issued") is used in staff views.
6. Per-role `next/dynamic` chunks: 122 kB first load.
7. The orphans were stopped, and a `CLAUDE.md` convention now says to check ports 3000/3001 before the backend suite.

## Regression Checks

- **Full backend suite 289/289**, including portal (patient lists still own-only), billing (patient invoice list), appointments (status filter now a list), pharmacy, and lab.
- **Portal Playwright journeys (15)** pass on the shared `AppShell`.
- **Build:** the frontend production build passes after the portal layout refactor and the dashboard code split.

## Known Minor Issues

- **Closed during Phase 13B: Playwright after the dashboard code split.** At the Phase 13 gate this was UNVERIFIED: the last code change (per-role `next/dynamic` chunks in `app/(dashboard)/dashboard/page.tsx`) passed typecheck, lint, Vitest, and the Linux production build, but the Playwright suite (33/33 just before it) wasn't rerun, because Claude Code had stopped the dev servers for low memory. Phase 13 was committed (`e6d4a32`) with the item still open. It was rerun on 2026-09-24 during Phase 13B: all 33 earlier journeys passed (17 in `dashboards.spec.ts`, 14 in `portal.spec.ts`, 2 mobile), within a 34/34 run that also included the Phase 13B journey. The navigation-label assertions were updated for the Phase 13B navigation (see `PHASE-13B-REVIEW.md`).
- **The Phase 13 containers were built but not started** (memory). The Phase 12 compose stack was verified end to end in containers; Phase 13 adds no infrastructure.
- **Seeded prescriptions all stay ISSUED** (the seed doesn't dispense), so the pharmacist's queue shows about 80 items.
- **"Collected" uses the payment's creation time** (checkout start for online payments), as noted for receipts in Phase 12.
- **The lab queue sorts oldest first for every stage,** including finished ones (when filtered to "Result ready" the newest are on the last page).
- **Out of scope:** no Super Admin hospital switcher; no Nurse medication-administration checklist (D-007).
- **Carried:** live Stripe/Razorpay and Resend/Twilio UNVERIFIED (no credentials).

## Technical Debt

- **No caching of analytics** (D-040 rejects it without a measured need); revisit in Phase 14's performance pass.
- **`zonedWallTimeToUtc` exists in both apps** (frontend `lib/zoned-time.ts` mirrors the API helper). They're small and tested separately; move them to a shared package if a third copy appears.
- **Carried:**
  - audit-log writes outside interactive transactions (Phase 15);
  - Socket.IO handshake rate limiting;
  - provider error-classification unit tests;
  - axe scanning (Phase 14);
  - Playwright in CI (Phase 16).

## Documentation Updated

- `05-DEVELOPMENT-PLAN.md`: Phase 13B added (D-039).
- `11-DECISIONS.md`: D-039, D-040.
- `08-API-CONTRACT.md`: §4.11 rewritten, changed list endpoints.
- `07-RBAC-MATRIX.md`: Phase 13 scoping notes.
- `09-SECURITY.md`: SEC-AUDIT-002 implementation.
- `02-SRS.md`: FR-ANALYTICS/FR-SEARCH interpretation.
- `06-DATABASE-DESIGN.md`: seed-as-built.
- `03-ARCHITECTURE.md`: §2 staff workspace.
- `10-TESTING-STRATEGY.md`: new journeys and spec.
- `CLAUDE.md`: +5 conventions.
- `HANDOFF.md`.

## Final Gate

**PASS WITH DOCUMENTED MINOR ISSUES.**

`FR-ANALYTICS-001` and `FR-SEARCH-001` are implemented and verified in the API (exact figures, tenancy, RBAC) and the browser. No critical or high-severity defect is open.

The minor items were one UNVERIFIED re-run (the Playwright suite after the final code-splitting change, blocked by the machine's memory pressure; since closed, see Known Minor Issues), the carried provider items, and the scoped-out pieces above.

Next is Phase 13B (Staff Workflow Screens), and it doesn't start until the user says so.
