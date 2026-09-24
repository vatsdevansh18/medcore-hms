# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions. Read it first, then verify it against the actual repository state: the repo is the source of truth for what's implemented; this file is the source of truth for session context only.

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable. Work follows a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules. Read before touching anything:**
1. **`CLAUDE.md`** (project root), every session. It points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in" and to the `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done. Its "Monorepo conventions" list encodes hard-won, real-bug lessons (**38 entries** as of this handoff; 9 added in Phase 12). Read all of them.
2. **`docs/12-QUALITY-PROTOCOL.md`**: the implement → verify → root-cause-fix → re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase can't be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user's explicit go-ahead ("START PHASE N").** This session the user chose "Commit, then Phase 12" (an explicit option offered after "continue"); that was the Phase 12 go-ahead. Phase 12 is complete and gated **PASS WITH DOCUMENTED MINOR ISSUES**. Don't start Phase 13 until the user says so.

Current objective as of this handoff: **wait for the user.** Ask whether to commit Phase 12, then wait for "START PHASE 13." Per `docs/05-DEVELOPMENT-PLAN.md`, Phase 13 is Analytics & Dashboards: role-specific dashboards (Recharts), global search, filters, pagination (`FR-ANALYTICS-001`, `FR-SEARCH-001`). It's also where the staff web workspace starts (today staff sign-ins land on a plain `/staff` notice). Re-read the plan section in full when authorized.

## Current State

**Thirteen phases complete** (Phase 0 through Phase 12), each with a review at `docs/phase-reviews/PHASE-{0..12}-REVIEW.md`:
- Phases 0–9: PASS.
- Phase 10: PASS WITH DOCUMENTED MINOR ISSUES (live Stripe/Razorpay checkout UNVERIFIED; no test keys).
- Phase 11: PASS WITH DOCUMENTED MINOR ISSUES (live Resend/Twilio sends UNVERIFIED; no credentials).
- Phase 12: PASS WITH DOCUMENTED MINOR ISSUES (the live payment-provider round-trip from the portal is UNVERIFIED for the same reason as Phase 10).

**Git:** Phase 11 was committed this session as `e78551d feat: Phase 11 — notifications & background jobs` (on `master`, excluding `.claude-flow/`). **Phase 12 is NOT committed**; it's all in the working tree. The user hasn't asked for a Phase 12 commit (see Next Steps #1).

Verified this session, all after the last code change:
- **Backend:** typecheck and lint (zero warnings, now including `scripts/`) **PASS**. Unit (`pnpm run test`) 5/5. Full e2e **260/260, 14/14 suites**, serial, about 48s (231 before + 29 new in `portal.e2e-spec.ts`), with no leftover rows.
- **Mutation checks on `portal.e2e-spec.ts`:** 15/15 caught.
- **Frontend:** typecheck and lint **PASS**. Vitest **42/42**; the single-flight refresh mutation is caught.
- **Playwright:** **15/15** against the native dev stack and **15/15** against the Docker stack. Fixture teardown leaves 0 `e2e-*` users.
- **Migration `20260926090000_patient_portal`:** applied with `migrate deploy`; `migrate status` is clean; shadow-DB `migrate diff` shows no difference.
- **Docker:** `docker compose build api frontend` **PASS** (the first try hit a transient DNS error, see Failed Attempts). `docker build --target runtime` for the frontend (full `next build` in Linux) **PASS**.
- **Native `next build` on Windows:** compile, types, and 18/18 pages succeed; the standalone trace copy fails with `EPERM symlink` (known since Phase 1).

**Docker stack right now:** `postgres`, `redis`, `localstack` running. `api` and `frontend` were **stopped** before the final backend e2e run (the api image and container were rebuilt/recreated this phase with `S3_PUBLIC_ENDPOINT`). The native dev servers were stopped too. Port 3000 is free now; the earlier "port conflict" note in this file is obsolete.

**Seeded accounts (correction):** earlier versions of this file said there was no seeded Pharmacist, Receptionist, or Accountant. **That was wrong.** `prisma/seed.ts` creates every staff role per hospital, and the database has them. All use password `Demo123!`:
- per hospital: `hospitaladmin@`, `nurse@`, `receptionist@`, `lab_technician@`, `pharmacist@`, `accountant@` + `medcore-city.medcore.test` / `medcore-metro.medcore.test`, and 4 `dr.<first>.<last>@...` doctors;
- plus `superadmin@medcore.test` and 30 `*@patient.medcore.test` patients.
- The seed has no appointments or clinical history (by design, see its header); the Playwright fixture builds one per run.

### What Phase 12 delivered (details in `PHASE-12-REVIEW.md`, D-035..D-038)

- **Backend:**
  - Patient lists: `GET /prescriptions`, `GET /lab-orders` (summary), and `GET /invoices` for patients (own, never DRAFT; DRAFT by id is 404).
  - `PATCH /appointments/:id/reschedule`, gated by the new `Hospital.patientRescheduleAllowed`/`patientRescheduleCutoffHours`, with 422 `RESCHEDULE_NOT_ALLOWED`.
  - `GET /payments/:id/receipt`: PDF rendered on first request and cached in `Payment.receiptUrl`, through the shared `PdfRendererService`.
  - Public `GET /hospitals/directory`; `/auth/me` adds `patientProfileId` and a `hospital` summary; `GET /appointments?sortOrder`.
- **Root-cause fixes to earlier phases:**
  - scheduling now uses `Hospital.timezone` (D-037, was UTC since Phase 5);
  - no storage keys in any response (D-036);
  - patients no longer get doctor email/phone;
  - Docker dev downloads work (`S3_PUBLIC_ENDPOINT` for browser URLs, `getInternalDownloadUrl` for server fetches).
- **Frontend** (first real UI):
  - auth screens, the patient portal (overview, appointments with 3-step booking, reschedule and cancel, records, prescriptions + PDF, lab reports, bills + online payment + receipts), live notification bell/panel over Socket.IO, light/dark themes, mobile drawer navigation;
  - `/staff` notice for staff roles.
- **Tests:** backend `portal.e2e-spec.ts`, `s3.service.spec.ts`; frontend Vitest (8 files) and Playwright (`apps/frontend/e2e`, 15 journeys, with `apps/backend/scripts/e2e-portal-fixture.ts`).

### The UNVERIFIED items

1. **Live Stripe/Razorpay checkout** (Phase 10, and the portal's Pay flow in Phase 12). Needs these in `.env`: `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `RAZORPAY_KEY_ID=rzp_test_...`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Then:
   - pay a bill from `/portal/invoices/:id` (Stripe card 4242 4242 4242 4242), with `stripe listen --forward-to localhost:3001/api/payments/webhook/stripe`;
   - confirm the page goes from "Confirming your payment…" to "Payment received";
   - for Razorpay, check that the hosted checkout opens from `checkout.razorpay.com`.
2. **Live Resend/Twilio sends** (Phase 11):
   - set `RESEND_API_KEY` (keep `EMAIL_FROM=onboarding@resend.dev` unless a domain is verified), and Twilio **test** credentials with `TWILIO_FROM_NUMBER=+15005550006`;
   - give a test user a verified phone, confirm one of their appointments, and check `NotificationDeliveryLog` for SENT rows with a `providerMessageId`.

### Other known limitations

- **Phase 12:**
  - the receipt date is the payment's creation time (checkout start for online payments);
  - staff aren't notified of a patient reschedule (the appointment just returns to PENDING);
  - registration reveals an existing email (Phase 3 behaviour);
  - no automated axe scan (Phase 14);
  - Playwright isn't in CI (it needs a full stack; Phase 16).
- **Phase 11:**
  - the Socket.IO handshake isn't rate-limited;
  - dead-lettered SMS/email jobs have no automatic re-drive;
  - no unit test of the adapters' error classification.
- **Phase 10:**
  - an abandoned Razorpay checkout stays PENDING;
  - an overpayment needs a manual refund;
  - `tax`/`discount` are always 0;
  - no invoice cancel endpoint.
- **Carried:** audit-log writes outside interactive transactions (Phase 15).
- **Seed vs docs:** `docs/06-DATABASE-DESIGN.md` §5 describes two weeks of seeded clinical history, but `seed.ts` deliberately seeds none (its header explains why). Not resolved this phase; note it when Phase 13 dashboards need demo data.

## Active Files

Relevant to Phase 13, or to touching Phase 12's surface:
- `docs/05-DEVELOPMENT-PLAN.md` (Phase 13), `docs/02-SRS.md` FR-ANALYTICS/FR-SEARCH, `docs/04-UI-UX.md` §5 (role dashboards), `docs/07-RBAC-MATRIX.md` §3.1 (analytics rows).
- `apps/frontend/src/lib/api-client.ts`: the only way to call the API or refresh the token (CLAUDE.md).
- `apps/frontend/src/services/portal.ts`: TanStack Query hooks and query keys; staff hooks should follow the same pattern in their own file.
- `apps/frontend/src/components/shared/*`: the shared components Phase 13 dashboards should reuse (StatusBadge, states, PageHeader, Pagination, FormField, ConfirmDialog).
- `apps/frontend/src/app/(portal)/portal/layout.tsx`: the shell pattern; a staff shell for `(dashboard)` is next.
- `apps/frontend/src/app/(dashboard)/staff/page.tsx`: the Phase 13 placeholder to replace.
- `packages/types/src/portal.ts`: the view types; add staff/analytics types in `packages/types` first.
- `apps/backend/src/common/time/zoned-time.ts`: use it for any date bucketing in analytics (hospital-local days).
- `apps/backend/scripts/e2e-portal-fixture.ts`, `apps/frontend/e2e/*`: extend for staff journeys.

## Changes Made (this session)

1. **Committed Phase 11** (`e78551d`), excluding `.claude-flow/`.
2. **Schema/migration** `20260926090000_patient_portal`: `Hospital.patientRescheduleAllowed`, `patientRescheduleCutoffHours` (`CHECK >= 0`), `Payment.receiptUrl`.
3. **Backend endpoints** as listed above. New files:
   - `common/time/zoned-time.ts`, `common/pdf/pdf-renderer.service.ts`;
   - `billing/payments/{receipts.service,payments.controller,receipt-pdf-template}.ts`;
   - `prescriptions/prescription-view.ts`, `prescriptions/dto/find-prescriptions-query.dto.ts`, `appointments/dto/reschedule-appointment.dto.ts`.
4. **Backend behaviour changes (documented):**
   - timezone scheduling;
   - narrow doctor projections;
   - no storage keys;
   - patient `GET /invoices` allowed (was 403) and DRAFT hidden;
   - the dispense response goes through `toPrescriptionView`.
5. **Config:**
   - `S3_PUBLIC_ENDPOINT` (env validation, `.env.example`, `docker-compose.yml` api service);
   - backend `tsconfig.eslint.json` and the `lint` script include `scripts/`;
   - CI builds `@medcore/types` before `pnpm run test`;
   - `.gitignore` ignores `apps/frontend/e2e/.fixture.json`.
6. **Frontend:** everything under `apps/frontend/src` except the Phase 1 favicon, plus `vitest.config.mts`, `vitest.setup.ts`, `playwright.config.ts`, and `e2e/`. Dependencies are listed in the review; all are from the brief's stack.
7. **`packages/types`:** `portal.ts` (new) and `ApiErrorCode.RESCHEDULE_NOT_ALLOWED`.
8. **Tests:**
   - new `test/portal.e2e-spec.ts` (29) and `src/common/storage/s3.service.spec.ts` (3);
   - `appointments.e2e-spec.ts` hospital pinned to UTC;
   - `billing.e2e-spec.ts` patient-list assertion updated.
9. **Docs:**
   - D-035..D-038, plus forward notes on D-023/D-030;
   - API contract, RBAC matrix, security (SEC-AUTHN-008, SEC-DATA-006, SEC-FILE-005), DB design, architecture §2/§10, SRS FR-PORTAL, testing strategy;
   - `CLAUDE.md` (+9 conventions);
   - `PHASE-12-REVIEW.md`.
10. **Removed** 9 empty stray files from a failed heredoc (the recurring pattern). `.claude-flow/` dirs remain untracked; **exclude them when staging**.

## Failed Attempts

- **Earlier sessions (still relevant):**
  - Decimal `isPositive()` treats 0 as positive; use `.gt(0)`.
  - Running Prettier on whole existing files reformats unrelated code; only format new files.
  - `async` wrappers around supertest lose `.expect()`.
  - Building supertest requests eagerly causes `ECONNREFUSED`.
  - `docker compose exec … psql` via Node `execSync` on Windows mangles `$POSTGRES_USER` quoting; use `spawnSync` with an args array.
  - Node scripts outside `apps/backend` can't resolve its packages; set `NODE_PATH=apps/backend/node_modules`.
- **Bash heredocs containing apostrophes still fail** ("unexpected EOF while looking for matching `''") and leave empty stray files named after code fragments. It happened again this session (an edit script containing "doesn't"/"can't"; 9 strays, removed). **Write any script or prose with apostrophes to a file with the Write tool, then run it.** Always check `git status` for strays.
- **Running e2e specs in parallel** makes the notification assertions flaky (D-034). **Don't revert `maxWorkers: 1`.** The same applies to any running API, native or Docker, during the backend suite: stop it first.
- **`createdAt <= now` filter on the outbox drain** (Phase 11): don't reintroduce it.
- **Phase 12:**
  - **The first Playwright run failed at global setup** (`fetch failed`): the native `nest start --watch` had restarted because a file under `apps/backend` was edited. Wait for "Nest application successfully started" after editing. The failed setup left fixture users behind; they were cleaned with the fixture script's `teardown <runId>`.
  - **Playwright selector failures:** Next's empty `role="alert"` route announcer made `getByRole("alert")` ambiguous, and `selectOption` doesn't take a regex label. Fixed in the spec.
  - **Headless Chromium downloads PDFs** instead of showing them, so `popup.waitForURL` fails with `ERR_ABORTED`. Capture the request instead.
  - **The first `docker compose build` failed** with `getaddrinfo EAI_AGAIN github.com` (bcrypt's prebuilt binary download inside the build). A transient DNS error; a plain retry succeeded. Don't "fix" the Dockerfile for it.
  - **`window.open` after an `await`** is popup-blocked; `DownloadButton` opens the tab synchronously on click and sets its URL afterwards.
  - One tool call (frontend typecheck + lint) was rejected by the user mid-session with no reason given; after "continue", the same checks ran fine as separate commands.

## Next Steps

1. **Ask the user whether to commit Phase 12.** Suggested, from the repo root after checking `git status` for stray empty files:
   `git add -A -- . ':!**/.claude-flow/**' && git commit -m "feat: Phase 12 — patient portal"`
2. **Wait for "START PHASE 13."** Then:
   - build a staff shell for `app/(dashboard)` (sidebar per role, §2.4) and replace `/staff`;
   - role dashboards per `04-UI-UX.md` §5 with Recharts (client components);
   - global search (`FR-SEARCH-001`, debounced, hospital-scoped);
   - use the brief's Server Components hint for data-heavy staff pages where a server-readable session exists, and record any deviation;
   - demo data for dashboards: decide whether the seed should build history (see the seed-vs-docs note).
3. **When the user provides credentials,** close the UNVERIFIED items (steps above) and update the Phase 10/11/12 gates.
4. **Carried debt:**
   - audit-log writes outside interactive transactions (Phase 15);
   - Socket.IO handshake rate limiting;
   - provider error-classification unit tests;
   - axe accessibility scan (Phase 14);
   - Playwright in CI (Phase 16).

## Important Commands, Paths, and Gotchas

### Commands (run from `apps/backend` unless noted)

```bash
# Typecheck / lint / unit
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm run lint                      # includes scripts/
pnpm run test                      # unit (jest)

# Full backend e2e (Postgres + Redis + LocalStack up; STOP any api: `docker compose stop api` / kill native dev). ~48s.
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json portal.e2e-spec.ts
# Output is long: redirect to a file and grep for "✕|●|Tests:".

# Clear the auth rate limiter between repeated runs (spurious 429s otherwise):
docker exec medcore-hms-redis-1 redis-cli --scan --pattern "throttle:*" | xargs -r docker exec -i medcore-hms-redis-1 redis-cli DEL

# Native dev servers (two terminals)
pnpm exec dotenv -e ../../.env -- pnpm run dev                       # apps/backend  -> :3001
cd ../frontend && pnpm exec dotenv -e ../../.env -- pnpm run dev     # apps/frontend -> :3000

# Frontend (from apps/frontend)
pnpm exec tsc --noEmit && pnpm run lint && pnpm run test             # typecheck, lint, Vitest
pnpm exec playwright test            # needs API :3001 + web :3000 running (native or Docker)
E2E_KEEP_FIXTURE=1 pnpm exec playwright test   # keep the run's fixture data for debugging
# Leftover fixture cleanup, if a run died mid-setup:
#   (apps/backend) pnpm exec dotenv -e ../../.env -- ts-node --transpile-only scripts/e2e-portal-fixture.ts teardown <runId>
#   runIds: select email from "User" where email like 'e2e-%'

# Docker (from repo root)
docker compose up -d postgres redis localstack
docker compose build api frontend    # after editing packages/types or dependencies
docker compose up -d api frontend    # web :3000, API :3001, LocalStack :4566
docker build -f infrastructure/docker/Dockerfile.frontend --target runtime -t medcore-hms-frontend-prod .   # prod next build

# Prisma (from apps/backend)
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
pnpm exec dotenv -e ../../.env -- prisma migrate status
# Drift check for a hand-written migration (temp shadow DB):
#   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE medcore_shadow;"'
#   pnpm exec dotenv -e ../../.env -- prisma migrate diff --from-migrations prisma/migrations \
#     --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with /medcore_shadow>
#   ...then DROP DATABASE medcore_shadow
```

### Gotchas (cumulative; `CLAUDE.md` "Monorepo conventions" is the canonical list)

- **Tooling:**
  - `dotenv` isn't on PATH; always use `pnpm exec dotenv ...`.
  - Windows file locks: a running node process can lock the Prisma engine (`EPERM`); find it via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`. Stopping a background `pnpm run dev` shell may leave its node child listening; check `Get-NetTCPConnection -LocalPort 3000,3001`.
  - After editing `packages/types/src/*`: `pnpm --filter=@medcore/types run build` (both apps and Vitest read `dist/`).
  - `prisma migrate dev` can't prompt in this shell. Hand-write the migration, apply it with `migrate deploy`, verify it.
  - Native frontend `next build` fails only at the standalone symlink step on this Windows machine; verify production builds with the Docker `runtime` target.
- **Phase 10/11:**
  - invoice lines only via `ChargesService`;
  - `.gt(0)` for money;
  - `purgeBilling` in spec teardown;
  - env for a spec goes in a helper imported before `AppModule`;
  - notifications via `record` + `publish`;
  - `toView` field by field;
  - e2e runs serially.
- **Phase 12:**
  - schedules in the hospital timezone (`zoned-time.ts`);
  - no storage keys in responses (`getDownloadUrl` for browsers, `getInternalDownloadUrl` for server fetches);
  - doctor data for patients is name only;
  - refresh only via `refreshAccessToken()`;
  - page files export only the page;
  - `FormField` keeps its message line;
  - Playwright alert/download selectors.

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md` (D-001 to D-038)
- Security IDs: `docs/09-SECURITY.md`. RBAC: `docs/07-RBAC-MATRIX.md`. API index: `docs/08-API-CONTRACT.md`
- Backend: `apps/backend/src/` (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `medicines/`, `prescriptions/`, `lab/`, `billing/` (+ `billing/payments/`), `notifications/`, `queue/`, `common/` (`messaging/`, `pdf/`, `time/`, `storage/`)), `apps/backend/scripts/`
- Frontend: `apps/frontend/src/` (`app/(auth)`, `app/(portal)/portal`, `app/(dashboard)/staff`, `components/{ui,shared,modules}`, `hooks`, `services`, `store`, `lib`, `constants`), `apps/frontend/e2e/`
- Prisma: `apps/backend/prisma/`. Backend e2e: `apps/backend/test/`. Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | UNCOMMITTED | Phase 11 committed (`e78551d`). Phase 12 is in the working tree on `master`. Stray files removed; `.claude-flow/` untracked and must be excluded when staging |
| Lint | PASS | Backend (incl. `scripts/`) and frontend, zero warnings |
| Typecheck | PASS | Backend (incl. tests and scripts), frontend, types |
| Unit tests | PASS | Backend jest 5/5 (2 suites); frontend Vitest 42/42 (8 files) |
| Integration/e2e tests | PASS | Backend 260/260, 14/14 suites, serial, 0 leftover rows; 15/15 mutation checks caught |
| Component tests | PASS | Vitest + Testing Library (forms, StatusBadge, api-client, rules, format) |
| Browser E2E (Playwright) | PASS | 15/15 native stack, 15/15 Docker stack; fixture teardown clean |
| Build | PASS (with the known Windows caveat) | Frontend production build passes in Docker (`runtime` target); native Windows build fails only at the standalone symlink step (known since Phase 1). Backend image built |
| DB migrations | PASS | `20260926090000_patient_portal` applied; `migrate status` clean; shadow-DB `migrate diff`: no difference |
| Docker | PASS | `api` + `frontend` images built and run; portal journeys incl. PDF downloads, receipts rendered in Alpine Chromium, and live Socket.IO pass against containers. `api`/`frontend` currently stopped |
| Security review | PASS | Own-only scoping, cross-patient/tenant 404s, staff 403s, reschedule races, storage-key and contact minimisation, in-memory token + single-flight refresh, open-redirect-safe `next` |
| Live Stripe/Razorpay checkout | UNVERIFIED | No test keys (Phase 10 and the Phase 12 Pay flow) |
| Live Resend/Twilio sends | UNVERIFIED | No credentials (Phase 11) |

## Current Phase Gate

**Phase 12 — Patient Portal: PASS WITH DOCUMENTED MINOR ISSUES.** Full detail in `docs/phase-reviews/PHASE-12-REVIEW.md`. `FR-PORTAL-001/002` are verified end to end in the API and the browser. `FR-PORTAL-003` is verified up to the payment provider; the live round-trip is UNVERIFIED (no test keys). No critical or high-severity defect is open. The earlier-phase defects found (timezone, storage keys, doctor contact details, Docker downloads) were fixed at the root, with tests. Phases 10 and 11 remain PASS WITH DOCUMENTED MINOR ISSUES.

## Important Decisions / Context

- **D-035:** patient-only list endpoints (staff queues are Phase 13); patients never see DRAFT invoices; reschedule = same appointment id back to PENDING, gated by hospital policy + cutoff, not for emergencies, and a single conditional UPDATE; patient cancellation stays PENDING-only; public hospital directory.
- **D-036:** no storage keys in responses; patients get doctor names only; receipts rendered on demand and cached; the client vs internal S3 signer (`S3_PUBLIC_ENDPOINT`).
- **D-037:** schedules are hospital-local wall-clock times (fixes Phase 5's UTC reading).
- **D-038:**
  - the browser calls the API directly (a proxy would collapse per-IP rate limiting);
  - the access token is in memory only;
  - single-flight refresh with a Web Lock;
  - portal pages are Client Components;
  - forms reserve their message line.
- **Earlier decisions still load-bearing:** D-032..D-034 (notifications, e2e serial), D-027..D-031 (billing), D-021 (lab visibility), D-022 (low-stock latch), D-023 (pharmacy local dates), D-024 (pharmacy RBAC).
- **Known architectural debt (Phase 2):** the audit-log extension writes through the root client outside interactive transactions. Fix in Phase 15.
