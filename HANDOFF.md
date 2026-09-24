# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions. Read it first, then verify it against the actual repository state: the repo is the source of truth for what's implemented; this file is the source of truth for session context only.

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable. Work follows a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules. Read before touching anything:**
1. **`CLAUDE.md`** (project root), every session. It points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in" and to the `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done. Its "Monorepo conventions" list encodes hard-won, real-bug lessons (**43 entries** as of this handoff; 5 added in Phase 13). Read all of them.
2. **`docs/12-QUALITY-PROTOCOL.md`**: the implement → verify → root-cause-fix → re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase can't be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user's explicit go-ahead ("START PHASE N").** This session:
- after "continue", the user chose "Commit, then Phase 12";
- later they said "commit and START PHASE 13".
- Phase 13 is complete and gated **PASS WITH DOCUMENTED MINOR ISSUES**.

**The plan changed this session (D-039, the user's decision):** a new **Phase 13B — Staff Workflow Screens** sits between Phase 13 and Phase 14 (`docs/05-DEVELOPMENT-PLAN.md`). No phase had ever planned the staff screens for the Phase 4–11 workflows.

Current objective as of this handoff: **wait for the user.** Ask whether to commit Phase 13, then wait for "START PHASE 13B". 13B builds:
- front-desk registration and scheduling;
- the doctor's encounter workspace (EMR, vitals, prescribing, lab ordering);
- lab result entry and four-eyes approval;
- pharmacy dispensing and stock receiving;
- the billing desk;
- hospital admin screens.

Its gate is a full-patient-journey Playwright test through the UI. Re-read the plan section in full when authorized.

## Current State

**Fourteen phases complete** (Phase 0 through Phase 13), each with a review at `docs/phase-reviews/PHASE-{0..13}-REVIEW.md`:
- Phases 0–9: PASS.
- Phases 10–13: PASS WITH DOCUMENTED MINOR ISSUES.
  - Live Stripe/Razorpay: UNVERIFIED (no test keys).
  - Live Resend/Twilio: UNVERIFIED (no credentials).
  - Phase 13's own UNVERIFIED item is below.

**Git:** this session committed Phase 11 (`e78551d`) and Phase 12 (`bf6e45d feat: Phase 12 — patient portal`), both on `master`, excluding `.claude-flow/`. **Phase 13 is NOT committed**; it's all in the working tree (see Next Steps #1).

**Verified this session, after the last code change unless noted:**
- **Backend:** typecheck and lint **PASS**. Unit 5/5. Full e2e **289/289, 15/15 suites** (about 48s: 260 before + 29 in the new `analytics.e2e-spec.ts`), with no leftover rows. Mutation checks on the analytics spec: 13/14 caught; the 14th is masked by the tenant extension, as designed.
- **Frontend:** typecheck and lint **PASS**. Vitest **62/62**; the debounce mutation is caught.
- **Playwright:** **33/33** against the native dev stack (15 portal, 16 dashboards, 2 mobile). This was **before** the last code change, the per-role `next/dynamic` split in `app/(dashboard)/dashboard/page.tsx` (see UNVERIFIED).
- **Docker:** `docker compose build api` **PASS**. `docker build --target runtime` for the frontend (full `next build`, 28 pages) **PASS**, including after the split: `/dashboard` first load is 122 kB (was 304 kB).
- **Demo history seeded** in the dev DB (`pnpm run db:seed:history`): about 300 appointments per hospital. A SQL audit of billing and lab consistency found 0 violations.

**Environment right now:**
- `postgres`, `redis`, `localstack` containers are running.
- The `api`/`frontend` containers are stopped (images rebuilt this phase, not started).
- **The native dev servers were stopped by Claude Code for low system memory** late in the session. Their leftover Node children were then stopped by hand; ports 3000/3001 are free.
- **Memory is tight on this machine:** start only what a step needs, and stop it afterwards.

**Seeded accounts** (password `Demo123!`, correct as of this session):
- per hospital: `hospitaladmin@`, `nurse@`, `receptionist@`, `lab_technician@`, `pharmacist@`, `accountant@` + `medcore-city.medcore.test` / `medcore-metro.medcore.test`, and 4 `dr.<first>.<last>@...` doctors (e.g. `dr.jeremy.keebler@medcore-city.medcore.test`);
- `superadmin@medcore.test`, and 30 `*@patient.medcore.test` patients;
- the history seed added a second lab technician per hospital, `lab_reviewer@medcore-city-hospital.medcore.test` (and the Metro equivalent), for four-eyes approvals.

### What Phase 13 delivered (details in `PHASE-13-REVIEW.md`, D-039/D-040)

- **Backend** (`src/analytics/`):
  - `GET /analytics/{overview,appointments,revenue,occupancy}`: hospital-local days in SQL; Super Admin gets a UTC platform view.
  - `GET /search` (role-scoped patients/doctors/medicines; Patient and Super Admin get 403).
  - `GET /audit-logs` (no before/after data) and `GET /payments` (reconciliation).
  - Staff queues on `GET /lab-orders` (Lab Tech: urgent first; Doctor: own) and `GET /prescriptions` (Pharmacist; Doctor: own).
  - Comma-separated status filters (`CommaSeparatedEnum`); `GET /appointments?doctorId` narrows within scope.
  - Staff invoice rows carry patient names.
  - The patient directory list is closed to Lab Tech and Pharmacist (RBAC §3.2).
- **Demo history:** `prisma/seed-history.ts`.
- **Frontend:**
  - the `/dashboard` staff workspace on a shared `AppShell` (the portal uses it too);
  - one dashboard per role (Recharts, per-role chunks);
  - a global search combobox and a results page;
  - 8 filtered, paginated list pages with URL-kept filters;
  - `RoleGate`; `/staff` now redirects to `/dashboard`.

### The UNVERIFIED items

1. **Playwright after the dashboard code split** (Phase 13). The suite was 33/33 before the last change; after it, typecheck, lint, Vitest, and the Linux production build pass, but Playwright wasn't rerun: the dev servers were killed for memory and not restarted without the user. To close it:
   - start the backend (`apps/backend`: `pnpm exec dotenv -e ../../.env -- pnpm run dev`) and the frontend (`apps/frontend`: `pnpm run dev`);
   - run `pnpm exec playwright test` from `apps/frontend`, then stop both servers.
2. **Live Stripe/Razorpay checkout** (Phases 10 and 12). Needs `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `.env`. Then:
   - pay from `/portal/invoices/:id` with card 4242 4242 4242 4242, running `stripe listen --forward-to localhost:3001/api/payments/webhook/stripe`;
   - confirm the page goes from "Confirming…" to "Payment received";
   - check that Razorpay's hosted checkout opens.
3. **Live Resend/Twilio** (Phase 11):
   - set `RESEND_API_KEY`, and Twilio test credentials with `TWILIO_FROM_NUMBER=+15005550006`;
   - give a user a verified phone, confirm one of their appointments, and check `NotificationDeliveryLog` for SENT rows with a `providerMessageId`.

### Other known limitations

- **Phase 13:**
  - seeded prescriptions all stay ISSUED (the seed doesn't dispense), so the pharmacist queue is long;
  - "collected" uses the payment's creation time;
  - the lab queue is oldest-first for every stage;
  - no Super Admin hospital switcher;
  - no Nurse medication checklist (D-007);
  - analytics aren't cached;
  - queue rows don't link anywhere until 13B.
- **Phase 12:**
  - the receipt date is the payment creation time;
  - staff aren't notified of a patient reschedule;
  - registration reveals an existing email;
  - no axe scan (Phase 14);
  - Playwright isn't in CI (Phase 16).
- **Phase 11:**
  - the Socket.IO handshake isn't rate-limited;
  - no automatic re-drive of dead-lettered jobs;
  - no adapter error-classification unit tests.
- **Phase 10:**
  - an abandoned Razorpay checkout stays PENDING;
  - overpayments need a manual refund;
  - `tax`/`discount` are always 0;
  - no invoice cancel endpoint.
- **Carried:** audit-log writes outside interactive transactions (Phase 15).

## Active Files

Relevant to Phase 13B, or to touching Phase 13's surface:
- **Plan and specs:** `docs/05-DEVELOPMENT-PLAN.md` (Phase 13B), `docs/11-DECISIONS.md` D-039/D-040, `docs/04-UI-UX.md` (§2.7 forms, §2.8 dialogs, §6 role priorities, §8 confirmations), `docs/07-RBAC-MATRIX.md` (every write row).
- **Staff shell:** `apps/frontend/src/app/(dashboard)/dashboard/layout.tsx` and `components/modules/staff-nav.ts`. New 13B screens get nav entries here; `canOpen` drives `RoleGate`.
- **Services:** `apps/frontend/src/services/staff.ts` (read hooks and `toQuery`). 13B adds mutations next to them, following the `services/portal.ts` mutation pattern.
- **Queues to link from:** `apps/frontend/src/components/modules/dashboards/*` and `app/(dashboard)/dashboard/*/page.tsx`. Rows become links once 13B screens exist.
- **Shared UI:** `apps/frontend/src/components/shared/{data-table,panel,stat-card,filter-bar,confirm-dialog,form-field}.tsx`.
- **Backend endpoints 13B consumes** (built in Phases 4–11): see `docs/08-API-CONTRACT.md` §4.
- **Test fixtures:** `apps/backend/scripts/e2e-portal-fixture.ts` and `apps/frontend/e2e/*` (the fixture plus seeded accounts); the 13B gate test goes here.

## Changes Made (this session)

**Phase 12 (committed `bf6e45d`):**
- the patient portal, patient list endpoints, reschedule, receipts, timezone scheduling, storage-key and contact minimisation, the Docker dev download fix;
- the frontend foundation and portal, Vitest, and Playwright.

Details are in `PHASE-12-REVIEW.md`.

**Phase 13 (uncommitted):**
1. **Plan and decisions:** Phase 13B added to `05-DEVELOPMENT-PLAN.md`; D-039 (13B) and D-040 (analytics, search, queues, directory, seed).
2. **Backend (new):**
   - `src/analytics/` (analytics, search, and audit-log services; controllers; 3 DTOs);
   - `src/common/validation/comma-separated-enum.decorator.ts`;
   - `src/billing/payments/payments-query.service.ts`, `src/billing/dto/find-payments-query.dto.ts`, `src/lab/dto/find-lab-orders-query.dto.ts`;
   - `prisma/seed-history.ts` and the `db:seed:history` script.
3. **Backend (changed):**
   - lab and prescriptions services and controllers (staff queues);
   - appointments (status list, `doctorId` narrowing);
   - invoices (status list, patient names);
   - the payments controller and billing module;
   - patients (directory list roles);
   - `app.module.ts`.
4. **Types:** `packages/types/src/analytics.ts`.
5. **Frontend (new):**
   - `app/(dashboard)/dashboard/**`;
   - `components/modules/{app-shell,staff-nav,global-search,role-gate}.tsx(.ts)`, `components/modules/charts/*`, `components/modules/dashboards/*`;
   - `components/shared/{data-table,stat-card,panel,filter-bar}.tsx`;
   - `hooks/use-url-filters.ts`, `lib/{chart-data,zoned-time}.ts`, `services/staff.ts`;
   - 4 Vitest files, `e2e/dashboards.spec.ts`;
   - dependency: `recharts`.
6. **Frontend (changed):**
   - the portal layout (now `AppShell`), `portal-nav.ts`, `(dashboard)/staff` (redirect);
   - `use-auth.ts` (staff home → `/dashboard`), `use-hospital.ts`;
   - `constants`, `status-badge.tsx` (staff wording);
   - `e2e/portal.spec.ts`, `e2e/mobile.spec.ts`.
7. **Tests:** new `test/analytics.e2e-spec.ts` (29); `test/portal.e2e-spec.ts` updated (doctor list rules).
8. **Docs:**
   - API contract §4.11;
   - RBAC notes, SRS, DB design seed, architecture §2, testing strategy;
   - SEC-AUDIT-002;
   - `CLAUDE.md` (+5);
   - `PHASE-13-REVIEW.md`.
9. **Removed** 4 more empty stray files from heredocs. `.claude-flow/` dirs remain untracked; **exclude them when staging**.

## Failed Attempts

- **Earlier sessions (still relevant):**
  - Decimal `isPositive()` treats 0 as positive; use `.gt(0)`.
  - Run Prettier only on new files.
  - `async` wrappers around supertest lose `.expect()`.
  - Building supertest requests eagerly causes `ECONNREFUSED`.
  - `docker compose exec … psql` via Node `execSync` on Windows mangles quoting; use `spawnSync` with an args array.
  - Node scripts outside `apps/backend` need `NODE_PATH=apps/backend/node_modules`.
  - Don't reintroduce a `createdAt <= now` filter on the outbox drain.
  - Don't revert `maxWorkers: 1` (D-034).
- **Bash heredocs with apostrophes still fail** and leave empty stray files named after code fragments. It happened in both Phase 12 and Phase 13 this session. **Write scripts and prose with the Write tool, then run them.** Check for empty strays with `find . -maxdepth 4 -type f -empty -not -path '*/node_modules/*' -not -path './.git/*' -not -path '*/.next/*' -not -path '*claude-flow*'` before committing.
- **Phase 12:**
  - Playwright setup failed while `nest start --watch` was restarting after an edit.
  - Selector gotchas: Next's `role="alert"` announcer; `selectOption` takes no regex label.
  - Headless PDF downloads abort the tab's navigation; capture the request instead.
  - A transient `EAI_AGAIN` during `docker compose build` needed only a retry.
  - `window.open` after an `await` is popup-blocked.
- **Phase 13:**
  - **The first full backend run failed 9 notification tests:** leftover dev-server Node processes (their shells had been stopped) were running outbox workers that took the specs' jobs. **Check `Get-NetTCPConnection -LocalPort 3000,3001 -State Listen` and stop leftover processes before the backend suite.**
  - **The frontend package has no `dotenv-cli`:** `pnpm exec dotenv -e ...` in `apps/frontend` resolves a different `dotenv` and fails. Use plain `pnpm run dev` there.
  - **Two Playwright failures were test bugs, not product bugs:** a Phase 12 test still expected the `/staff` notice, and the lab "Result ready" filter's row was on the last page (oldest first). Both tests were fixed.
  - **Mutation "DRAFT counted as invoiced" was first missed** (drafts have no `finalizedAt`). A cancelled-after-finalize fixture now catches it.
  - **Background dev servers were reaped by Claude Code under memory pressure.** Don't auto-restart them; ask.

## Next Steps

1. **Ask the user whether to commit Phase 13.** From the repo root, after the empty-file check:
   `git add -A -- . ':!**/.claude-flow/**' && git commit -m "feat: Phase 13 — analytics & dashboards"`
2. **Close the Phase 13 UNVERIFIED item** when the user allows starting the dev servers: run Playwright (steps above), expect 33/33, and update `PHASE-13-REVIEW.md` and this file.
3. **Wait for "START PHASE 13B."** Then, per `05-DEVELOPMENT-PLAN.md`:
   - build the staff workflow screens and link the Phase 13 queues to them;
   - write the full-journey Playwright gate test (registration → booking → encounter → prescription → lab → dispensing → invoice → payment → portal visibility);
   - follow `04-UI-UX.md` §2.7/§2.8/§8 (forms, dialogs, confirmations).
4. **When credentials arrive,** close the provider UNVERIFIED items and update the Phase 10–12 gates.
5. **Carried debt:**
   - audit-log writes outside interactive transactions (Phase 15);
   - Socket.IO handshake rate limiting;
   - provider error-classification tests;
   - axe (Phase 14);
   - Playwright in CI (Phase 16);
   - analytics caching (measure first, Phase 14).

## Important Commands, Paths, and Gotchas

### Commands (run from `apps/backend` unless noted)

```bash
# Typecheck / lint / unit
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm run lint                      # src, test, prisma, scripts
pnpm run test                      # unit (jest)

# Full backend e2e (Postgres + Redis + LocalStack up). FIRST stop any API:
#   docker compose stop api ; check ports: powershell "Get-NetTCPConnection -LocalPort 3000,3001 -State Listen"
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json          # ~48s, 289 tests
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json analytics.e2e-spec.ts
# Output is long: redirect to a file and grep for "✕|●|Tests:".

# Clear the auth rate limiter between repeated runs:
docker exec medcore-hms-redis-1 redis-cli --scan --pattern "throttle:*" | xargs -r docker exec -i medcore-hms-redis-1 redis-cli DEL

# Seed (from apps/backend)
pnpm run db:seed            # master data (hospitals, staff, patients, catalogs)
pnpm run db:seed:history    # two weeks of visits/bills/labs + a week of bookings; idempotent

# Native dev servers
pnpm exec dotenv -e ../../.env -- pnpm run dev       # apps/backend  -> :3001
pnpm run dev                                         # apps/frontend -> :3000 (no dotenv-cli there)

# Frontend (from apps/frontend)
pnpm exec tsc --noEmit && pnpm run lint && pnpm run test     # typecheck, lint, Vitest (62)
pnpm exec playwright test            # needs API :3001 + web :3000 (33 journeys)
E2E_KEEP_FIXTURE=1 pnpm exec playwright test   # keep fixture data for debugging
# Leftover fixture cleanup: (apps/backend) pnpm exec dotenv -e ../../.env -- ts-node --transpile-only scripts/e2e-portal-fixture.ts teardown <runId>

# Docker (from repo root)
docker compose up -d postgres redis localstack
docker compose build api frontend
docker compose up -d api frontend
docker build -f infrastructure/docker/Dockerfile.frontend --target runtime -t medcore-hms-frontend-prod .   # prod next build

# Prisma (from apps/backend)
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
pnpm exec dotenv -e ../../.env -- prisma migrate status
```

### Gotchas (cumulative; `CLAUDE.md` "Monorepo conventions" is the canonical list)

- **Tooling:**
  - `pnpm exec dotenv` works in the backend only;
  - Windows file locks on the Prisma engine;
  - rebuild `@medcore/types` after editing it;
  - hand-write migrations and apply them with `migrate deploy`;
  - verify the native frontend build via the Docker `runtime` target.
- **Phase 10/11:**
  - invoice lines only via `ChargesService`;
  - `.gt(0)` for money;
  - `purgeBilling` in teardown;
  - env for a spec is set before `AppModule`;
  - `record` + `publish`;
  - `toView` field by field;
  - e2e runs serially.
- **Phase 12:**
  - hospital-timezone schedules;
  - no storage keys;
  - patients get doctor names only;
  - `refreshAccessToken()` only;
  - page files export only the page;
  - `FormField` keeps its message line;
  - Playwright alert/download selectors.
- **Phase 13:**
  - analytics day bucketing in SQL with explicit `hospitalId`;
  - `@CommaSeparatedEnum` for multi-status filters;
  - a filter narrows within a role's scope;
  - demo seed commands;
  - leftover dev processes steal e2e jobs.

### Key file locations

- **Phase/quality process:** `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/`
- **Scope/architecture:** `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md` (D-001 to D-040)
- **Security IDs:** `docs/09-SECURITY.md`. RBAC: `docs/07-RBAC-MATRIX.md`. API index: `docs/08-API-CONTRACT.md`
- **Backend:** `apps/backend/src/`, including:
  - `analytics/`, `appointments/`, `billing/`, `lab/`, `prescriptions/`, `notifications/`, and the other feature modules;
  - `common/` (`messaging/`, `pdf/`, `time/`, `storage/`, `validation/`).
  - Also `apps/backend/scripts/` and `apps/backend/prisma/` (`seed.ts`, `seed-history.ts`).
- **Frontend:** `apps/frontend/src/`:
  - `app/(auth)`, `app/(portal)/portal`, `app/(dashboard)/dashboard`;
  - `components/{ui,shared,modules}`;
  - `hooks`, `services`, `store`, `lib`, `constants`.
  - Also `apps/frontend/e2e/`.
- **Shared types:** `packages/types/src/` (`portal.ts`, `analytics.ts`, `notifications.ts`, `enums.ts`)

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | UNCOMMITTED | Phases 11 (`e78551d`) and 12 (`bf6e45d`) committed. Phase 13 is in the working tree on `master`; strays removed; exclude `.claude-flow/` when staging |
| Lint | PASS | Backend (src/test/prisma/scripts) and frontend, zero warnings |
| Typecheck | PASS | Backend, frontend, types |
| Unit tests | PASS | Backend jest 5/5; frontend Vitest 62/62 |
| Integration/e2e tests | PASS | Backend 289/289, 15/15 suites, serial, 0 leftover rows; analytics mutations 13/14 caught (the 14th masked by the tenancy layer, by design) |
| Component tests | PASS | Vitest + Testing Library (search combobox, DataTable states, forms, badges, api-client) |
| Browser E2E (Playwright) | PASS before the last change; UNVERIFIED after it | 33/33 native before the per-role code split; not rerun since (dev servers reaped for memory) |
| Build | PASS | Frontend production build in Docker (28 pages, `/dashboard` 122 kB first load); API image built. Native Windows build fails only at the standalone symlink step (known) |
| DB migrations | NOT APPLICABLE | No schema change in Phase 13; `20260926090000_patient_portal` (Phase 12) is the latest, drift-checked clean |
| Docker | PARTIAL | Phase 13 images built; containers not started this phase (memory). Phase 12 container run verified end to end |
| Security review | PASS | Tenancy on every analytics/search query incl. raw SQL; per-endpoint role matrices; scope-narrowing filters; directory closed to Lab/Pharmacy; audit and payment rows minimised |
| Live Stripe/Razorpay checkout | UNVERIFIED | No test keys |
| Live Resend/Twilio sends | UNVERIFIED | No credentials |

## Current Phase Gate

**Phase 13 — Analytics & Dashboards: PASS WITH DOCUMENTED MINOR ISSUES.** Full detail in `docs/phase-reviews/PHASE-13-REVIEW.md`.
- `FR-ANALYTICS-001` and `FR-SEARCH-001` are verified in the API (exact figures, tenancy, RBAC) and the browser.
- No critical or high-severity defect is open.
- The minor items are:
  - the Playwright rerun after the final code split (UNVERIFIED);
  - the carried provider items;
  - the scoped-out pieces (Super Admin switcher, the Nurse medication checklist, and the read-only queues until Phase 13B).

## Important Decisions / Context

- **D-039:** Phase 13B (Staff Workflow Screens) is inserted before Phase 14; it's "13B" so later phase numbers stay valid.
- **D-040:**
  - analytics endpoints with hospital-local SQL day buckets (UTC platform view);
  - role-scoped search (403 for forbidden scopes, Patient, Super Admin);
  - audit rows without data;
  - staff queues on the existing list endpoints;
  - comma-separated status filters;
  - the directory list follows the RBAC matrix;
  - the demo history seed;
  - no analytics caching;
  - per-role dashboard chunks.
- **D-035..D-038 (Phase 12):**
  - patient list scope and reschedule;
  - response minimisation and receipts;
  - timezone scheduling;
  - frontend session (in-memory token, single-flight refresh with a Web Lock, direct API calls).
- **Earlier decisions still load-bearing:**
  - D-032..D-034 (notifications, serial e2e);
  - D-027..D-031 (billing);
  - D-021 (lab visibility);
  - D-022 (low-stock latch);
  - D-023 (pharmacy local dates);
  - D-024 (pharmacy RBAC);
  - D-007 (inpatient scope).
- **Known architectural debt (Phase 2):** the audit-log extension writes through the root client outside interactive transactions. Fix in Phase 15.
