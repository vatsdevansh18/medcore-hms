# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions. Read it first, then verify it against the actual repository state: the repo is the source of truth for what's implemented; this file is the source of truth for session context only.

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable. Work follows a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules. Read before touching anything:**
1. **`CLAUDE.md`** (project root), every session. It points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in" and to the `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done. Its "Monorepo conventions" list encodes hard-won, real-bug lessons (**46 entries**; 3 added in Phase 13B). Read all of them.
2. **`docs/12-QUALITY-PROTOCOL.md`**: the implement → verify → root-cause-fix → re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase can't be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user's explicit go-ahead ("START PHASE N").** Session history:
- earlier session: Phases 11 and 12 committed; Phase 13 built and gated;
- this session: the user said "continue" and chose "rerun, commit, then 13B". Phase 13 was committed as `e6d4a32` (its Playwright rerun first skipped because another project held port 3001), then **Phase 13B was built and gated PASS WITH DOCUMENTED MINOR ISSUES**.

Current objective as of this handoff: **wait for the user.** Ask:
1. whether to commit Phase 13B;
2. whether the five API-complete requirements without a screen (see Current State) should get screens before Phase 14;
3. then wait for "START PHASE 14" (UI/UX polish).

## Current State

**Fifteen phases complete** (0 through 13, plus 13B), each with a review at `docs/phase-reviews/PHASE-{0..13,13B}-REVIEW.md`:
- Phases 0–9: PASS.
- Phases 10–13B: PASS WITH DOCUMENTED MINOR ISSUES.
  - Live Stripe/Razorpay: UNVERIFIED (no test keys).
  - Live Resend/Twilio: UNVERIFIED (no credentials).
  - Phase 13's UNVERIFIED Playwright rerun is **closed** (35/35 this session).

**Git:** Phase 13 committed this session (`e6d4a32 feat: Phase 13 — analytics & dashboards`). **Phase 13B is NOT committed**; it's all in the working tree (see Next Steps #1). Exclude `.claude-flow/` when staging.

**Verified this session, after the last code change:**
- **Backend:** typecheck and lint **PASS**; unit 5/5; full e2e **338/338, 17/17 suites** (289 + 47 in `staff-workflows.e2e-spec.ts` + 2 in `rate-limit.e2e-spec.ts`); two filter mutations caught.
- **Frontend:** typecheck and lint **PASS**; Vitest **77/77**; Playwright **35/35** against the native dev stack (17 dashboards, 14 portal, 2 staff journey, 2 mobile).
- **Build:** frontend production image (`docker build --target runtime`, 46 routes) **PASS**; `docker compose build api` **PASS**.
- **Console sweep:** every new screen as each role, no errors. **Screenshots** reviewed at 1440px and 390px.
- **No leftover e2e rows** (0 `e2e-*` users) and no stray empty files.

**Phase 13B's known gaps (the user should decide on them):** these work through the API and are tested there, but have no screen:
- the doctor's availability editor (FR-APPT-001);
- vaccinations and family history entry (FR-EMR-005);
- EMR attachment upload (FR-EMR-006);
- the doctor's signature upload (FR-RX-003);
- Super Admin hospital onboarding (FR-HOSP-001).

**Environment right now:**
- `postgres`, `redis`, `localstack` containers are running; `api`/`frontend` containers are stopped (images rebuilt this phase).
- The native dev servers were started for the Playwright runs and **stopped afterwards**; ports 3000/3001 are free.
- **Another project on this machine, `D:\Coding\InternMo\task_2\backend` (`tsx watch src/server.ts`), also uses port 3001.** With the user's permission it was stopped this session (the watcher PID 20400 and its child) for the browser tests, and **not restarted**; the user restarts it themselves. Next time 3001 is busy, identify the owner and **ask before stopping anything**. Stopping only the child isn't enough: the `tsx watch` parent restarts it.
- **Memory is tight on this machine:** start only what a step needs, and stop it afterwards.

**Seeded accounts** (password `Demo123!`):
- per hospital: `hospitaladmin@`, `nurse@`, `receptionist@`, `lab_technician@`, `pharmacist@`, `accountant@` + `medcore-city.medcore.test` / `medcore-metro.medcore.test`, and 4 `dr.<first>.<last>@...` doctors (e.g. `dr.wade.weimann@medcore-city.medcore.test`);
- `superadmin@medcore.test`, and 30 `*@patient.medcore.test` patients;
- a second lab technician per hospital from the history seed, `lab_reviewer@medcore-city-hospital.medcore.test` (and the Metro equivalent), for four-eyes approvals.

### What Phase 13B delivered (details in `PHASE-13B-REVIEW.md`, D-041)

- **Backend reads:**
  - `GET /lab-tests`, `GET /users` (staff directory), `GET /medical-records/by-appointment/:id`;
  - `medicalRecordId` filters on prescriptions and lab orders, and `patientId` on appointments (all narrow within scope);
  - `/auth/me` `doctorProfileId`; `dispensedQuantity` and the patient's name on the prescription detail; the patient's name on the staff invoice detail.
- **Screens** under `app/(dashboard)/dashboard/`: patients (list, register, profile), booking and emergency visits, the appointment page, the encounter workspace, the lab order (four-eyes), dispensing, medicines and batches, the billing desk, staff, departments, and settings. Phase 13 rows link into them.
- **Test infrastructure:** the e2e limiter reset per spec file, the rate-limit spec, the fixture `password` mode, and the gate journey `e2e/staff-journey.spec.ts`.

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

1. ~~Playwright after the Phase 13 dashboard code split~~: **closed this session** (35/35, including every Phase 13 journey). History is kept in `PHASE-13-REVIEW.md`.
2. **Live Stripe/Razorpay checkout** (Phases 10 and 12). Needs `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `.env`. Then:
   - pay from `/portal/invoices/:id` with card 4242 4242 4242 4242, running `stripe listen --forward-to localhost:3001/api/payments/webhook/stripe`;
   - confirm the page goes from "Confirming…" to "Payment received";
   - check that Razorpay's hosted checkout opens.
3. **Live Resend/Twilio** (Phase 11):
   - set `RESEND_API_KEY`, and Twilio test credentials with `TWILIO_FROM_NUMBER=+15005550006`;
   - give a user a verified phone, confirm one of their appointments, and check `NotificationDeliveryLog` for SENT rows with a `providerMessageId`.

### Other known limitations

- **Phase 13B:**
  - the five screen gaps above;
  - receptionist sample collection is API-only (no lab-order read);
  - nurses see no prescription or lab-order lists in the encounter workspace;
  - dispensing is FEFO-only in the UI;
  - form-heavy screens load 186–246 kB first (Phase 14);
  - a settings change reaches other users' cached `/auth/me` only on their next sign-in.
- **Phase 13:**
  - seeded prescriptions all stay ISSUED (the seed doesn't dispense), so the pharmacist queue is long;
  - "collected" uses the payment's creation time;
  - the lab queue is oldest-first for every stage;
  - no Super Admin hospital switcher;
  - no Nurse medication checklist (D-007);
  - analytics aren't cached;
  - ~~queue rows don't link anywhere until 13B~~ (they link now).
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

Relevant to what comes next (the 13B commit, the screen gaps, Phase 14):
- **Plan and specs:** `docs/05-DEVELOPMENT-PLAN.md` (Phase 14), `docs/04-UI-UX.md` (§9 checklist, §3 accessibility), `docs/11-DECISIONS.md` D-041, `docs/phase-reviews/PHASE-13B-REVIEW.md`.
- **Staff shell and access:** `apps/frontend/src/components/modules/staff-nav.ts` (`STAFF_NAV`, `WORKFLOW_ACCESS`), `components/modules/role-gate.tsx`.
- **Workflow services:** `apps/frontend/src/services/workflows.ts` (all 13B reads and writes, query-key roots), `services/staff.ts`.
- **Rule mirrors:** `apps/frontend/src/lib/appointment-actions.ts` (copies `ALLOWED_TRANSITIONS` in `apps/backend/src/appointments/appointments.service.ts`), `lib/dispense.ts`, `lib/staff-validation.ts`.
- **Screens:** `apps/frontend/src/app/(dashboard)/dashboard/**`, `components/modules/{encounter,pharmacy,admin}/*`.
- **For the screen gaps:** `apps/backend/src/doctors/` (availability and signature APIs), `src/emr/` (attachments, vaccinations, family history), `src/hospitals/` (Super Admin onboarding).
- **Tests:** `apps/frontend/e2e/staff-journey.spec.ts`, `apps/backend/test/staff-workflows.e2e-spec.ts`, `test/rate-limit.e2e-spec.ts`, `test/helpers/reset-rate-limits.ts`, `apps/backend/scripts/e2e-portal-fixture.ts`.

## Changes Made (this session)

**Phase 13 (committed `e6d4a32`):** analytics, dashboards, search, and queues; details in `PHASE-13-REVIEW.md`. Its UNVERIFIED Playwright item was closed later this session, and the review was updated with the history kept.

**Phase 13B (uncommitted):**
1. **Decision:** D-041.
2. **Backend (new):**
   - `src/lab/lab-tests.{controller,service}.ts` + DTO;
   - `src/users/dto/find-staff-query.dto.ts`;
   - `test/staff-workflows.e2e-spec.ts` (47), `test/rate-limit.e2e-spec.ts` (2), `test/helpers/reset-rate-limits.ts`.
3. **Backend (changed):**
   - users (directory), EMR (by appointment), prescriptions (filter, `dispensedQuantity`, patient), lab (filter, catalog module wiring);
   - appointments (`patientId`), invoices (staff patient name), auth (`doctorProfileId`);
   - `test/jest-e2e.json` (`setupFilesAfterEnv`);
   - `scripts/e2e-portal-fixture.ts` (journey email in teardown, `password` mode).
4. **Types:** `packages/types/src/staff.ts`; `CurrentUser.doctorProfileId`.
5. **Frontend (new):**
   - 14 pages under `app/(dashboard)/dashboard/`;
   - `components/modules/{encounter,pharmacy,admin}/*`, `components/shared/{detail-list,lab-flag}.tsx`;
   - `services/workflows.ts`;
   - `lib/{appointment-actions,dispense,staff-validation}.ts` + 3 Vitest files;
   - `e2e/staff-journey.spec.ts` (2 tests).
6. **Frontend (changed):**
   - `staff-nav.ts` (+test), `constants`, `panel.tsx` (`href`), `status-badge.tsx`;
   - the Phase 13 list pages and dashboards (row links);
   - the portal lab report page (shared `Flag`);
   - `e2e/dashboards.spec.ts` (nav labels), `e2e/global-setup.ts`.
7. **Docs:**
   - API contract (§4.1/4.2/4.4/4.5/4.6/4.7/4.9/4.11);
   - RBAC note, architecture §2, testing strategy, SRS note;
   - `CLAUDE.md` (+3);
   - `PHASE-13B-REVIEW.md`, and `PHASE-13-REVIEW.md` (UNVERIFIED closed).
8. **Removed 6 stray files** created by mangled shell commands (5 empty, 1 terminal-screen dump named `item.href`).

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

- **Phase 13B:**
  - **The full backend suite first failed 31 tests with 429.** The auth limiter (100 per route and client per 15 min, in Redis) is shared by every serial spec, and the new spec pushed logins past 100. Fixed by resetting the limiter per spec file; **don't "fix" it by raising the production limit**.
  - **Wrong assumption, corrected:** the limiter budget is per *route* and client, not per client (a 101st forgot-password is 429, but login still works). Checked against the running API.
  - **Playwright `getByLabel("Doctor")` matched the global search box.** Use `{ exact: true }`, and `[data-status=…]` for badges ("Paid" is also a summary label).
  - **A skeleton `<div>` inside a `<p>` caused a hydration error,** found only by a console sweep, not by the tests. Worth repeating for new screens.
  - **Screenshots taken on `networkidle` showed loading skeletons** (requests after the token refresh). Add a short settle delay, or wait for content.
  - **Stopping task_2's server child alone didn't free port 3001:** its `tsx watch` parent restarted it. The parent had to be stopped (with the user's permission).
  - **A Python-in-bash heredoc failed again** ("unexpected EOF while looking for matching `'`") for a long script. The fix was the documented one: Write the script to a file, then run it. Stray files turned up again, including a terminal-screen dump. Keep checking before committing.

## Next Steps

1. **Ask the user whether to commit Phase 13B.** From the repo root, after the empty-file check (`find . -maxdepth 4 -type f -empty -not -path '*/node_modules/*' -not -path './.git/*' -not -path '*/.next/*' -not -path '*claude-flow*'`):
   `git add -A -- . ':!**/.claude-flow/**' ':!.claude-flow/**' && git commit -m "feat: Phase 13B — staff workflow screens"`
2. **Ask whether the five screen gaps come before Phase 14:** the availability editor (FR-APPT-001), vaccinations and family history (FR-EMR-005), attachments (FR-EMR-006), the signature upload (FR-RX-003), and Super Admin hospital onboarding (FR-HOSP-001). If yes:
   - build them on the 13B patterns (`services/workflows.ts`, `WORKFLOW_ACCESS`, `staff-validation.ts`);
   - extend `staff-journey.spec.ts` or add journeys;
   - update `PHASE-13B-REVIEW.md`.
3. **Wait for "START PHASE 14"** (UI/UX polish). Its inputs from 13B:
   - trim the form-heavy screens' first load (186–246 kB);
   - axe scanning;
   - the §9 checklist across all screens.
4. **When credentials arrive,** close the provider UNVERIFIED items and update the Phase 10–12 gates.
5. **Carried debt:**
   - audit-log writes outside interactive transactions (Phase 15);
   - Socket.IO handshake rate limiting;
   - provider error-classification tests;
   - Playwright in CI (Phase 16);
   - analytics caching (measure first, Phase 14);
   - the copied appointment state machine (serve allowed actions from the API).

## Important Commands, Paths, and Gotchas

### Commands (run from `apps/backend` unless noted)

```bash
# Typecheck / lint / unit
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm run lint                      # src, test, prisma, scripts
pnpm run test                      # unit (jest)

# Full backend e2e (Postgres + Redis + LocalStack up). FIRST stop any API:
#   docker compose stop api ; check ports: powershell "Get-NetTCPConnection -LocalPort 3000,3001 -State Listen"
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json          # 338 tests; limiter reset per spec file
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
pnpm exec tsc --noEmit && pnpm run lint && pnpm run test     # typecheck, lint, Vitest (77)
pnpm exec playwright test            # needs API :3001 + web :3000 (35 tests, ~4 min)
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
- **Phase 13B:**
  - e2e limiter reset per spec file (don't raise the production limit);
  - exact Playwright labels in the staff workspace;
  - new list-reached screens go in `WORKFLOW_ACCESS`;
  - another project (task_2) may hold :3001: ask before stopping it.
- **Phase 13:**
  - analytics day bucketing in SQL with explicit `hospitalId`;
  - `@CommaSeparatedEnum` for multi-status filters;
  - a filter narrows within a role's scope;
  - demo seed commands;
  - leftover dev processes steal e2e jobs.

### Key file locations

- **Phase/quality process:** `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/`
- **Scope/architecture:** `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md` (D-001 to D-041)
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
| Git | UNCOMMITTED | Phase 13 committed (`e6d4a32`). Phase 13B is in the working tree on `master`; strays removed; exclude `.claude-flow/` when staging |
| Lint | PASS | Backend (src/test/prisma/scripts) and frontend, zero warnings |
| Typecheck | PASS | Backend, frontend (incl. `e2e/`), types |
| Unit tests | PASS | Backend jest 5/5; frontend Vitest 77/77 |
| Integration/e2e tests | PASS | Backend 338/338, 17/17 suites, serial; 2 filter mutations caught; limiter now tested |
| Component tests | PASS | Vitest + Testing Library |
| Browser E2E (Playwright) | PASS | 35/35 native, after the last UI change, incl. the 13B gate journey; fixture teardown clean (0 `e2e-*` users) |
| Build | PASS | Frontend production image (46 routes); API image |
| DB migrations | NOT APPLICABLE | No schema change in Phase 13B; `20260926090000_patient_portal` is still the latest |
| Docker | PARTIAL | Images built; containers not started this phase (memory). Phase 12 container run verified end to end |
| Security review | PASS | Tenancy both ways on every new read; role matrices; scope-narrowing filters; minimised fields; UI access mirrors refuse and the API refuses independently |
| Live Stripe/Razorpay checkout | UNVERIFIED | No test keys |
| Live Resend/Twilio sends | UNVERIFIED | No credentials |

## Current Phase Gate

**Phase 13B — Staff Workflow Screens: PASS WITH DOCUMENTED MINOR ISSUES.** Full detail in `docs/phase-reviews/PHASE-13B-REVIEW.md`.
- Every screen in the plan's 13B list is built and wired to the real API.
- The gate journey (registration through portal visibility, four-eyes lab approval, automatic billing, cash payment) passes in the browser.
- No critical or high-severity defect is open.
- The minor items are the five API-complete requirements without a screen (for the user to schedule), documented scope choices, and the carried provider items.

## Important Decisions / Context

- **D-041 (Phase 13B):**
  - the new reads, narrowing filters, and response fields;
  - `WORKFLOW_ACCESS` mirroring;
  - confirmations per §8;
  - FEFO-only dispensing in the UI;
  - receptionist collection API-only;
  - the e2e limiter reset (rejected: raising the limit through env).
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
