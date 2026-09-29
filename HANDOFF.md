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

Prior instruction: "Do step 1 then step 2 then continue with START PHASE 14". So:
1. Phase 13B was committed (`cfb6944`).
2. The five missing screens were built as a 13B follow-up (D-042) and committed (`d320ea2`).
3. **Phase 14 (UI/UX polish) was built and gated PASS WITH DOCUMENTED MINOR ISSUES.** See `docs/phase-reviews/PHASE-14-REVIEW.md`.

**This session:** resumed with no code changes pending beyond the uncommitted Phase 14 diff. User asked to re-verify before committing. Docker Desktop's engine was not running at first, so only typecheck/lint/unit could run initially — frontend `tsc --noEmit`/`eslint --max-warnings=0`/Vitest 140/140, backend `tsc --noEmit`/`eslint --max-warnings=0`/Jest unit 5/5, all clean, on the exact same working tree. User said to commit on that basis; **Phase 14 was committed as `6146fa0`**, followed by a `HANDOFF.md`-only commit (`db48ff8`).

User then said "continue" and, when asked, chose to start Docker Desktop and fully re-run e2e/Playwright/build rather than leave them carried-over-unverified. Docker Desktop was launched (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`); its engine came up in ~5s and `postgres`/`redis`/`localstack` auto-started and reported healthy within ~15s (they'd been left running by a prior Docker Desktop session, per its restart policy). With ports 3000/3001 confirmed free first, this session then ran, and closed out cleanly:
- backend e2e: **346/346, 18/18 suites** (`pnpm run test:e2e` in `apps/backend`) — matches the Phase 14 review's own numbers exactly.
- backend production build (`pnpm run build`) **PASS**; started with `pnpm exec dotenv -e ../../.env -- node dist/main.js` on :3001, confirmed healthy via `GET /health`.
- frontend production image (`docker build -f infrastructure/docker/Dockerfile.frontend --target runtime -t medcore-hms-frontend-prod .`) **PASS**, run as a container (`docker run -d --name medcore-web-e2e -p 3000:3000 -e HOSTNAME=0.0.0.0 ...`).
- Playwright against both production servers: **47/47 passed (4.7m)** — all of `accessibility.spec.ts`, `dashboards.spec.ts`, `portal.spec.ts`, `practice-onboarding.spec.ts`, `staff-journey.spec.ts`, `mobile.spec.ts`.

Afterward the `medcore-web-e2e` container was stopped and removed, and the native backend process (PID 1203) was killed; `postgres`/`redis`/`localstack` were left running. **Every number in the "Phase 14 verified" block below is now independently reconfirmed this session, not carried over.**

Current objective: **wait for the user** to say "START PHASE 15" (Testing & Hardening).

## Current State

**Fifteen phases complete** (0 through 13, plus 13B), each with a review at `docs/phase-reviews/PHASE-{0..13,13B}-REVIEW.md`:
- Phases 0–9: PASS.
- Phases 10–13B: PASS WITH DOCUMENTED MINOR ISSUES.
  - Live Stripe/Razorpay: UNVERIFIED (no test keys).
  - Live Resend/Twilio: UNVERIFIED (no credentials).
  - Phase 13's UNVERIFIED Playwright rerun is **closed** (35/35 this session).

**Git:** an earlier session committed Phase 13 (`e6d4a32`), Phase 13B (`cfb6944`), and the 13B follow-up (`d320ea2`). **This session committed Phase 14 as `6146fa0`.** Exclude `.claude-flow/` when staging — it's untracked cruft from a claude-flow/ruflo plugin scattered across the tree, not project output.

**Phase 14 verified, after the last change:**
- frontend typecheck and lint PASS; Vitest 140/140 (59 contrast checks);
- **Playwright 47/47 against production builds** (web `runtime` image + API `node dist/main.js`), including the axe scan of every screen in both themes and the keyboard tests;
- backend 346/346 (18 suites), unit 5/5;
- the frontend production image builds; 20 routes are 41–43 kB lighter (largest first load 207 kB, was 250).

**Verified this session, after the last code change:**
- **Backend:** typecheck and lint **PASS**; unit 5/5; full e2e **338/338, 17/17 suites** (289 + 47 in `staff-workflows.e2e-spec.ts` + 2 in `rate-limit.e2e-spec.ts`); two filter mutations caught.
- **Frontend:** typecheck and lint **PASS**; Vitest **77/77**; Playwright **35/35** against the native dev stack (17 dashboards, 14 portal, 2 staff journey, 2 mobile).
- **Build:** frontend production image (`docker build --target runtime`, 46 routes) **PASS**; `docker compose build api` **PASS**.
- **Console sweep:** every new screen as each role, no errors. **Screenshots** reviewed at 1440px and 390px.
- **No leftover e2e rows** (0 `e2e-*` users) and no stray empty files.

**Phase 13B's five screen gaps were closed by the follow-up (D-042).** It also fixed two older defects: no browser upload to storage had ever worked (missing bucket CORS, since Phase 6), and a new hospital couldn't get its first admin. Verified: backend 346/346 (18 suites), Vitest 81/81, Playwright 38/38, both production images build. The original gap list, now closed:
- the doctor's availability editor (FR-APPT-001);
- vaccinations and family history entry (FR-EMR-005);
- EMR attachment upload (FR-EMR-006);
- the doctor's signature upload (FR-RX-003);
- Super Admin hospital onboarding (FR-HOSP-001).

**Environment right now (end of this session):** Docker Desktop is running; `postgres`, `redis`, and `localstack` containers are up and healthy. The `medcore-web-e2e` frontend container was removed after the Playwright run. Ports 3000/3001 are free (backend production process stopped). The `medcore-hms-frontend-prod` image remains built locally (339MB) if a quick rerun is wanted without rebuilding.

**Environment (earlier in the session):**
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

**Phase 14 (uncommitted, D-043):**
- **Contrast:** `src/lib/contrast.ts` and its test; 5 token shades adjusted; a new `--danger-foreground` token.
- **Accessibility:**
  - `e2e/accessibility.spec.ts` (axe on every screen in both themes, plus keyboard tests), with `@axe-core/playwright` as a dev dependency;
  - in-text link underline, hidden file inputs, chart `accessibilityLayer={false}`, a focusable table scroll region;
  - a skip link, the tablet icon rail, and `useReturnFocus` on all 7 dialogs;
  - `Panel` is a named region.
- **Motion:** CSS keyframes (`page-in` through `template.tsx`, `badge-change`, `reveal-in`, `toast-in/out`), and **framer-motion removed**.
- **Performance:** list caps on sessions and on patient allergies/vaccinations/family history (NFR-PERF-003).
- **Visual fixes:** practice time inputs and exception form; low stock shows a word and an icon.
- **Test harness:** `resetRateLimits` in `e2e/fixture.ts`, with a `beforeEach` in every spec; the journey's `isVisible()` race fixed.
- **Docs:**
  - D-043; `04-UI-UX.md` §3 and §7; architecture §2; testing strategy;
  - `CLAUDE.md` (+4);
  - `PHASE-14-REVIEW.md`.

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

- **Phase 14:**
  - **The whole browser suite ran out of the auth rate limit** once the axe scan was added (every page load refreshes the token). Fixed with a per-test reset. Don't raise the production limit.
  - **Dev servers gave false failures:**
    - Next compiled routes on demand in 10–15 s with under 1 GB of RAM free;
    - `nest start --watch` restarted mid-run when the fixture script ran in the backend folder.
    - Run the gate suite on production builds (see `CLAUDE.md`).
  - **A second Playwright run was started while an earlier one was still running.** They shared `.fixture.json`, and one run's teardown could delete the other's data. Stop every runner (and tear down leftover fixtures with `scripts/e2e-portal-fixture.ts teardown <runId>`) before starting another.
  - **Prettier was run on existing e2e files and reflowed them to a narrower width** (the documented lesson again). Reverted with `git checkout`, and only the intended edits re-applied. **Run Prettier on new files only.**
  - **The first `--danger-foreground` edit put the dark value into the wrong block** (a substring match hit the indented copy). The contrast test's "dark blocks match" check caught it.
  - **Empty stray files appeared again** from shell quoting (`%6s`, `->` in an awk format). Checked and removed before finishing.

## Next Steps

1. **Ask the user whether to commit Phase 14.** From the repo root, after the empty-file check:
   `git add -A -- . ':!**/.claude-flow/**' ':!.claude-flow/**' && git commit -m "feat: Phase 14 — UI/UX polish"`
2. **Wait for "START PHASE 15"** (Testing & Hardening: the testing pyramid, the nine mandatory scenarios in CI, the OWASP review, the dependency audit). Inputs:
   - audit-log writes outside interactive transactions;
   - the attachment confirm-upload step;
   - Socket.IO handshake rate limiting;
   - provider error-classification tests;
   - serving allowed appointment actions from the API.
3. **For any browser-suite run,** use production builds: rebuild the web image after frontend changes, and `pnpm run build` for the API.
4. **When credentials arrive,** close the provider UNVERIFIED items.

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
| Git | UNCOMMITTED (Phase 14) | 13 `e6d4a32`, 13B `cfb6944`, follow-up `d320ea2` committed; Phase 14 in the working tree; exclude `.claude-flow/` |
| Lint | PASS | Backend and frontend, zero warnings |
| Typecheck | PASS | Backend, frontend (incl. `e2e/`), types |
| Unit tests | PASS | Backend 5/5; frontend Vitest 140/140 (59 contrast checks) |
| Integration/e2e tests | PASS | Backend 346/346, 18/18 suites |
| Browser E2E (Playwright) | PASS | 47/47 against production builds, incl. the axe scan (all screens, both themes) and keyboard tests; fixtures cleaned |
| Accessibility | PASS | axe WCAG 2.1 A/AA clean; token contrast test; keyboard/focus tests |
| Build | PASS | Frontend production image (largest first load 207 kB); backend `nest build` |
| DB migrations | NOT APPLICABLE | No schema change since Phase 12 |
| Docker | PARTIAL | Images built; the compose stack not started this phase (the web image ran standalone for the browser tests) |
| Security review | PASS | No auth/tenancy change; test-only limiter reset; dev-only axe dependency |
| Live Stripe/Razorpay checkout | UNVERIFIED | No test keys |
| Live Resend/Twilio sends | UNVERIFIED | No credentials |

## Current Phase Gate

**Phase 14 — UI/UX Polish: PASS WITH DOCUMENTED MINOR ISSUES** (uncommitted). Full detail in `docs/phase-reviews/PHASE-14-REVIEW.md`. `NFR-A11Y-001..004` and `NFR-PERF-003` are verified by checks that run with the suite. Minor items: native time inputs display in the browser's locale; the zod chunk remains; carried items.

Earlier this session: Phase 13B PASS WITH DOCUMENTED MINOR ISSUES (committed `cfb6944` + follow-up `d320ea2`).

## Important Decisions / Context

- **D-043 (Phase 14):**
  - contrast enforced by a test;
  - axe on every screen;
  - dialog focus return via a hook (not by editing `components/ui`);
  - the tablet rail;
  - CSS-only motion, framer-motion removed;
  - capped (not paginated) patient clinical lists;
  - browser-suite limiter reset and production-build gate runs.
- **D-042 (13B follow-up):**
  - bucket CORS (browser uploads were broken since Phase 6);
  - `POST /hospitals/:id/admins`;
  - schedule read and delete;
  - the overlap rule.
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
