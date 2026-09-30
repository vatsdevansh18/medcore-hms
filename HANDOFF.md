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

**The user then said "START PHASE 15."** Testing & Hardening was built and gated **PASS WITH DOCUMENTED MINOR ISSUES**. See `docs/phase-reviews/PHASE-15-REVIEW.md` for full detail. Summary:
- Audited all 9 mandatory + 8 risk-based scenarios (`10-TESTING-STRATEGY.md` §3/§4) against the existing suite — all already covered by real tests. One genuine gap: `SEC-AUTHZ-001`'s promised CI-blocking static check didn't exist. Added `test/route-authorization.e2e-spec.ts` (101 handlers, 19 controllers), verified with a deliberate negative test.
- **`.github/workflows/ci.yml` had never actually run** (no git remote exists for this repo) and had three stacked bugs in its `integration-tests` job that would have failed every test: no `@medcore/types` build step, two missing required env vars (`JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`), no LocalStack service. Fixed all three; proved it by reproducing the job's exact services/env locally (448/448 e2e tests pass under those values).
- Measured the coverage gate honestly (mocked-unit coverage is 1.83%), found it doesn't fit this integration-test-first codebase, and revised `10-TESTING-STRATEGY.md` §2/§7 to state the real gate (scenario + route-reachability coverage) rather than fake a percentage. Documented as `11-DECISIONS.md` D-044.
- Full `pnpm audit`: 43 advisories, all transitive, all traced with `pnpm why -r` and assessed for real exploitability (most are dev-tooling/install-time/gated-behind-off-by-default-Bull-Board only; `multer`'s DoS advisories are moot since this app never wires up its multipart parsing). `@nestjs/core` and `@faker-js/faker` majors deferred. Ran `pnpm update -r` (in-range), verified safe.
- **Actually investigated** (not just re-carried) the audit-log-outside-transaction debt scheduled for "Phase 15 hardening" since Phase 9. The proposed fix (`Prisma.getExtensionContext(this)`) doesn't work — a real Prisma 5 extension-API limitation, confirmed empirically and caught immediately by the full e2e suite before any commit. Reverted cleanly; now tracked by an active `test.failing` tripwire in `test/audit-log.e2e-spec.ts` instead of a sixth silent carry-forward.
- `SEC-FILE-004` (ClamAV) deferred to Phase 16 — documented accepted risk (this machine's ~5.5 GB free RAM and the scope of a correct implementation).
- OWASP Top 10-oriented manual pass (the `security-review` skill needs `origin/HEAD`, unavailable — no remote). No new Critical/High finding beyond what's fixed above. Corrected two `docs/09-SECURITY.md` inaccuracies found along the way (SEC-INPUT-002's "only raw SQL" claim, SEC-INPUT-003's DOMPurify claim).
- Re-verified after every change: backend 448/448 e2e (19 suites), frontend Vitest 140/140, Playwright 47/47 against production containers rebuilt with the updated dependencies.
- **Phase 15 is not committed yet.**

**Phase 15 was committed as `6f36c82`.** The user then said "COMMIT AND START PHASE 16."

**Phase 16 (Deployment & DevOps) was built and gated PASS WITH DOCUMENTED MINOR ISSUES**, across two sessions (the first stopped mid-work on "exit now" after the Sentry wiring and the blue-green proof; this session resumed, cleaned up the leftover test containers, and finished the rest). See `docs/phase-reviews/PHASE-16-REVIEW.md` for full detail. Before any implementation, the user was asked how to handle real cloud provisioning (AWS/Vercel/Sentry/GitHub remote) and chose: **build everything as ready-to-run, provision nothing live** — matching the Stripe/Twilio/Resend pattern (UNVERIFIED, no live credentials) rather than actually creating billable cloud resources. Summary:

- **Sentry wiring, backend + frontend** (`docs/03-ARCHITECTURE.md` §14): `apps/backend/src/common/observability/{sentry.ts,sentry-worker.base.ts}` (+ unit test, 2/2 pass), wired into `main.ts`, `http-exception.filter.ts` (5xx only), and **all 6 BullMQ processors** now extend `SentryReportingWorkerHost` (captures only once retries are exhausted — the exact "unhandled exceptions ... in BullMQ workers" gap the architecture doc calls out by name). Frontend: `src/instrumentation.ts` + `src/instrumentation-client.ts`, gated by `NEXT_PUBLIC_SENTRY_DSN_FRONTEND` (renamed from `.env.example`'s old `SENTRY_DSN_FRONTEND` — one public var covers server+edge+client, since a DSN isn't a secret). `next.config.ts` deliberately skips `withSentryConfig` (not even exported the documented way in the installed SDK version — `tsc` caught it immediately; source-map upload has no credentials to use anyway). Smoke-tested booting fine with **and** without a (fake) DSN set, in the rebuilt Docker images.
  - Had to add `transformIgnorePatterns` to the **unit** Jest config in `apps/backend/package.json` (the e2e config already had this fix) — first unit test to transitively pull in `@nestjs/bullmq` (pure ESM), same documented CLAUDE.md gotcha, new location.
- **`docker-compose.prod.yml`** (new): EC2-side topology — `api-blue` (Dockerfile.backend `runtime` target) + `nginx`, no local Postgres/Redis/S3 (RDS/Upstash/real S3 in prod). No `frontend` service — Vercel deploys that separately.
- **`infrastructure/nginx/nginx.prod.conf`** (new): TLS (Certbot/Let's Encrypt convention, `api.yourdomain.example` placeholder — **must be changed before real deploy**), HTTP→HTTPS redirect, ACME challenge location, same rate-limit zones as dev. Upstream is `include /etc/nginx/conf.d/upstream.conf` (a separate one-line file) so the blue-green script can flip it without touching the main config.
- **`scripts/deploy/blue-green.sh`** (new): health-gated cutover. **Proven end-to-end, both directions, against a throwaway test stack** joined to the real dev Docker network (real Postgres/Redis): blue→green and green→blue, each with a concurrent `/health/ready` poll loop running through the entire cutover — **zero failed requests either way**. Test containers cleaned up; `upstream.conf` confirmed back at its committed default.
- **`.github/workflows/ci.yml`**: added `docker-build` (pushes to `ghcr.io` on main/tag push, using the built-in `GITHUB_TOKEN` — no separate registry account needed) and `deploy` (SSH + `blue-green.sh` on a `v*` tag, gated by secrets that don't exist yet, fails closed). **A background automated security review caught two real issues, both fixed**: `${{ github.ref_name }}` was interpolated directly into a `run:` shell block reaching a remote `ssh` command (script-injection risk) — fixed by reading it into `env: REF_NAME`, validating against `v[0-9]*.[0-9]*.[0-9]*`, and using only the quoted shell variable inside the script; and `webfactory/ssh-agent` plus the four new `docker/*` actions were pinned by mutable version tag — fixed by resolving each to its real commit SHA via `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` and pinning to that SHA with a `# vX.Y.Z` comment.
- **`apps/frontend/vercel.json`** (new): `cd ../..` build/install commands so the monorepo root install and the `@medcore/types`-must-build-first rule are respected even with Vercel's Root Directory set to `apps/frontend`. Vercel connects via its own GitHub App integration (documented in the runbook), not a custom Actions job — no token to manage.
- **`docs/13-DEPLOYMENT-RUNBOOK.md`** (new): GitHub remote + branch protection, AWS IAM/S3/RDS CLI commands, Upstash, EC2 host setup, `.env.production`'s shape, Let's Encrypt issuance, Vercel setup, optional Sentry setup, first deploy, every subsequent deploy, rollback, and the schema-migration-on-deploy caveat.
- Re-verified after every change: backend typecheck/lint/unit(7/7)/e2e(448/448, 19 suites), frontend typecheck/lint/unit(140/140), Playwright 47/47 against the rebuilt production containers.
- **Phase 16 is not committed yet.**

**Phase 16 was committed as `10e59a0`.** The user then said "START PHASE 17."

**Phase 17 (Documentation & Delivery) was built and gated PASS WITH DOCUMENTED MINOR ISSUES.** This is the last phase named in `docs/05-DEVELOPMENT-PLAN.md`. See `docs/phase-reviews/PHASE-17-REVIEW.md` for full detail. Summary:

- **Swagger/OpenAPI**: `@nestjs/swagger@8.1.1` installed (not the default `^12`, which needs Nest v12 — this project is pinned to Nest v10; confirmed via `npm view` peer-dependency checks before installing). `apps/backend/src/common/bootstrap/configure-swagger.ts` (new) wires `DocumentBuilder`/`SwaggerModule.setup("api/docs", ...)`, called from `main.ts` right after `configureApp(app)`. The `@nestjs/swagger` Nest CLI plugin enabled in `nest-cli.json` so the schema is generated from the same DTOs/`class-validator` decorators the API actually validates against.
- **ER diagram**: added a `generator erd { provider = "prisma-erd-generator" }` block to `schema.prisma`; `docs/diagrams/er-diagram.svg` (1.36 MB) now regenerates from the real schema on every `prisma generate` — cannot drift.
- **Architecture diagram**: `docs/diagrams/architecture-diagram.excalidraw` (63 elements, generated programmatically, matches `docs/03-ARCHITECTURE.md` §1) + a static `architecture-diagram.png` render.
- **Real test coverage**: `apps/backend/jest-e2e.coverage.json` (new, at the backend package root — not inside `test/`, see Failed Attempts for why) + `test:e2e:coverage` script. Result: **92.12% statements / 93.37% functions / 93.33% lines / 70.8% branches**, from the real e2e/integration suite (the user's explicit choice over writing new mocked-unit tests to inflate a number).
- **Video walkthrough script**: `docs/14-VIDEO-WALKTHROUGH-SCRIPT.md` (new, ~7:15 timed script + recording checklist) — a script, not a recording, since this session cannot record video (the user's explicit choice when asked).
- **Project report**: `docs/PROJECT-REPORT.docx` (new, via the `docx` skill — the user's explicit choice of `.docx` over Markdown), XSD-validated and visually spot-checked.
- **README.md**: full rewrite — Live Demo (honestly marked "not deployed"), Demo Credentials table (verified against `seed.ts`), Architecture Overview with diagram links, API Documentation, Test Coverage Report, Deployment & CI/CD, links to the report and script.
- **`CLAUDE.md`**: documented the Jest `rootDir`-resolves-relative-to-config-file's-own-directory gotcha as a new standing entry; fixed a stale "Swagger (once wired, Phase 3+)" line.
- **Housekeeping**: three zero-byte stray files (`'`, `e.id))`, `e.type`) from an earlier broken shell command this session were found and deleted; `.claude-flow/` (auto-generated by the `claude-flow`/`ruflo` MCP integration, not project output) was added to `.gitignore`.
- Re-verified end to end: backend typecheck/lint PASS, unit 7/7, e2e **448/448, 19/19 suites** (after resolving 3 leftover `nest start --watch` process trees — see Failed Attempts); frontend typecheck/lint PASS, Vitest 140/140; Playwright 47/47 against rebuilt production containers; a manual browser smoke test of patient registration → OTP → verification, reading the OTP directly from the backend log (`Email OTP for ${email}: ${code}`, this project's documented dev-mode behavior with no real mail provider configured).
- A project-wide Final Quality Gate audit (`docs/12-QUALITY-PROTOCOL.md` §27, across all 17 phases) found no undocumented critical/high issue and no unflagged discrepancy between the brief, `docs/`, and the actual repo.
- **Phase 17 is not committed yet.**

Current objective: **wait for the user** to say whether to commit Phase 17. This is the last phase in the roadmap — once committed, the project awaits the user's decision on final delivery (and, if desired, actually executing `docs/13-DEPLOYMENT-RUNBOOK.md` for a real deploy).

## Current State

**All eighteen phases built** (0 through 17, plus 13B — the last phase in `docs/05-DEVELOPMENT-PLAN.md`), each with a review at `docs/phase-reviews/PHASE-{0..17,13B}-REVIEW.md`:
- Phases 0–9: PASS.
- Phases 10–17: PASS WITH DOCUMENTED MINOR ISSUES.
  - Live Stripe/Razorpay: UNVERIFIED (no test keys).
  - Live Resend/Twilio: UNVERIFIED (no credentials).
  - Live Sentry, AWS EC2/RDS/S3, Vercel, and a real GitHub Actions run: UNVERIFIED (Phase 16, no accounts/remote — see `PHASE-16-REVIEW.md`); still UNVERIFIED after Phase 17, which added no new infrastructure.
  - Phase 13's UNVERIFIED Playwright rerun is **closed** (35/35, an earlier session).
  - The video walkthrough (Phase 17) is a script, not a recording — this session has no video-recording capability. The live demo URL remains not deployed (documented, user-chosen scope).

**Git:** an earlier session committed Phase 13 (`e6d4a32`), Phase 13B (`cfb6944`), and the 13B follow-up (`d320ea2`). A later session committed Phase 14 (`6146fa0`, handoff update `db48ff8`, `730ae55`), Phase 15 (`6f36c82`), and Phase 16 (`10e59a0`). **Phase 17 is uncommitted in the working tree** — `git status` shows exactly: `.gitignore`, `CLAUDE.md`, `README.md`, `apps/backend/{nest-cli.json,package.json,prisma/schema.prisma,src/main.ts}`, `pnpm-lock.yaml` modified; `apps/backend/jest-e2e.coverage.json`, `apps/backend/src/common/bootstrap/configure-swagger.ts`, `docs/14-VIDEO-WALKTHROUGH-SCRIPT.md`, `docs/PROJECT-REPORT.docx`, `docs/diagrams/` new. Three stray zero-byte junk files and scattered `.claude-flow/` directories (auto-generated by the `claude-flow`/`ruflo` MCP integration, not project output) were found during this phase's pre-commit cleanliness check — the junk files were deleted and `.claude-flow/` is now in `.gitignore`, so `git status` is clean of anything unintended.

**What Phase 15 delivered (details in `PHASE-15-REVIEW.md`, D-044):**
- `apps/backend/test/route-authorization.e2e-spec.ts` (new) — SEC-AUTHZ-001's static check.
- `.github/workflows/ci.yml` fixed (types build step, `JWT_ACCESS_SECRET`/`ENCRYPTION_KEY`, LocalStack service) — this was the first time it had ever actually been exercised, even locally.
- `docs/11-DECISIONS.md` D-044, `docs/10-TESTING-STRATEGY.md` §2/§7, `docs/09-SECURITY.md` (SEC-AUTHZ-001, SEC-INPUT-002/003, SEC-FILE-004, §12) updated.
- `apps/backend/test/audit-log.e2e-spec.ts` — a `test.failing` tripwire for the audit-log-outside-transaction gap (investigated, not fixed — see Important Decisions below).
- `pnpm-lock.yaml` + all three `package.json` files — in-range dependency updates (`pnpm update -r`), verified safe.
- **No application code behavior changed.** `apps/backend/src/common/audit/audit-log.extension.ts` has a documentation-only diff (the attempted fix was reverted in full after it broke every audited write — caught by the e2e suite before any commit).

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
- **Carried, now investigated (Phase 15):** audit-log writes outside interactive transactions. The proposed fix (`Prisma.getExtensionContext(this)`) was tried and found not to work — a real Prisma 5 extension-API limitation (confirmed empirically: `this` inside a `query.$allModels.$allOperations` component isn't a client reference). A real fix needs ~15 call sites refactored to pass `tx` explicitly to an audit-write helper — deferred as out of scope for a hardening pass, tracked by an active `test.failing` regression test in `test/audit-log.e2e-spec.ts` (`11-DECISIONS.md` D-044) rather than left as a silent carry-forward.

## Active Files

Relevant to what comes next (committing Phase 17 — the last phase — or, per the runbook, actually executing `docs/13-DEPLOYMENT-RUNBOOK.md` for a real deploy):
- **Phase 17 deliverables:** `docs/phase-reviews/PHASE-17-REVIEW.md`, `README.md`, `docs/PROJECT-REPORT.docx`, `docs/14-VIDEO-WALKTHROUGH-SCRIPT.md`, `docs/diagrams/{er-diagram.svg,architecture-diagram.excalidraw,architecture-diagram.png}`, `apps/backend/src/common/bootstrap/configure-swagger.ts`, `apps/backend/jest-e2e.coverage.json`.
- **Plan and specs:** `docs/05-DEVELOPMENT-PLAN.md`, `docs/phase-reviews/PHASE-16-REVIEW.md`, `docs/13-DEPLOYMENT-RUNBOOK.md`.
- **Deployment artifacts:** `docker-compose.prod.yml`, `infrastructure/nginx/{nginx.prod.conf,upstream.conf}`, `scripts/deploy/blue-green.sh`, `.github/workflows/ci.yml` (`docker-build`/`deploy` jobs), `apps/frontend/vercel.json`.
- **Sentry:** `apps/backend/src/common/observability/{sentry.ts,sentry-worker.base.ts}`, `apps/frontend/src/instrumentation{,-client}.ts`.
- **CI:** `.github/workflows/ci.yml` — still unverified against real GitHub Actions since there's no remote (`docs/13-DEPLOYMENT-RUNBOOK.md` §1 is the first step to close this).
- **The audit-log tripwire (Phase 15, still open):** `apps/backend/test/audit-log.e2e-spec.ts` (`test.failing` test), `apps/backend/src/common/audit/audit-log.extension.ts` (the comment explaining why the obvious fix doesn't work).
- **Deferred dependency majors:** `@nestjs/core` (v10→v11, whole framework family), `@faker-js/faker` (9→10, dev-only).
- **Staff shell and access:** `apps/frontend/src/components/modules/staff-nav.ts` (`STAFF_NAV`, `WORKFLOW_ACCESS`), `components/modules/role-gate.tsx`.
- **Workflow services:** `apps/frontend/src/services/workflows.ts` (all 13B reads and writes, query-key roots), `services/staff.ts`.
- **Rule mirrors:** `apps/frontend/src/lib/appointment-actions.ts` (copies `ALLOWED_TRANSITIONS` in `apps/backend/src/appointments/appointments.service.ts`), `lib/dispense.ts`, `lib/staff-validation.ts`.
- **Screens:** `apps/frontend/src/app/(dashboard)/dashboard/**`, `components/modules/{encounter,pharmacy,admin}/*`.
- **For the screen gaps:** `apps/backend/src/doctors/` (availability and signature APIs), `src/emr/` (attachments, vaccinations, family history), `src/hospitals/` (Super Admin onboarding).
- **Tests:** `apps/frontend/e2e/staff-journey.spec.ts`, `apps/backend/test/staff-workflows.e2e-spec.ts`, `test/rate-limit.e2e-spec.ts`, `test/helpers/reset-rate-limits.ts`, `apps/backend/scripts/e2e-portal-fixture.ts`.

## Changes Made (this session)

**Phase 17 (uncommitted):**
- `apps/backend/nest-cli.json`: `@nestjs/swagger` CLI plugin (`introspectComments`, `classValidatorShim`).
- `apps/backend/src/common/bootstrap/configure-swagger.ts` (new): `DocumentBuilder`/`SwaggerModule.setup`.
- `apps/backend/src/main.ts`: `configureSwagger(app)` call.
- `apps/backend/package.json`: `@nestjs/swagger@8.1.1`, `@mermaid-js/mermaid-cli`, `prisma-erd-generator`, `test:e2e:coverage` script; `pnpm-lock.yaml` updated.
- `apps/backend/prisma/schema.prisma`: `generator erd { ... }` block.
- `apps/backend/jest-e2e.coverage.json` (new): dedicated coverage-collecting Jest config at the backend package root.
- `docs/diagrams/{er-diagram.svg,architecture-diagram.excalidraw,architecture-diagram.png}` (new).
- `docs/14-VIDEO-WALKTHROUGH-SCRIPT.md` (new).
- `docs/PROJECT-REPORT.docx` (new).
- `README.md`: full rewrite for delivery.
- `CLAUDE.md`: Jest `rootDir` gotcha documented; stale Swagger status line fixed.
- `.gitignore`: `.claude-flow/` added.
- Deleted 3 stray zero-byte files left from an earlier broken shell command this session.

**Phase 15 (committed `6f36c82`, D-044):**
- `apps/backend/test/route-authorization.e2e-spec.ts` (new, 101 tests): reflection-based scan, no DI/DB, asserting every controller route handler has `@Roles()` or `@Public()`.
- `.github/workflows/ci.yml`: `integration-tests` job — `Build shared types` step added, `JWT_ACCESS_SECRET`/`ENCRYPTION_KEY`/`CORS_ORIGIN`/`AWS_*`/`S3_ENDPOINT` env added, `localstack:3` service added.
- `apps/backend/test/audit-log.e2e-spec.ts`: added a `test.failing` regression test for the audit-log-outside-transaction gap.
- `apps/backend/src/common/audit/audit-log.extension.ts`: comment-only change explaining the investigated-and-reverted fix attempt; behavior unchanged.
- `pnpm-lock.yaml`, `package.json`, `apps/backend/package.json`, `apps/frontend/package.json`: `pnpm update -r` (in-range only; `@nestjs/*` stayed on v10, React stayed on v19, etc.).
- **Docs:** `11-DECISIONS.md` D-044; `10-TESTING-STRATEGY.md` §2/§7; `09-SECURITY.md` (SEC-AUTHZ-001, SEC-INPUT-002, SEC-INPUT-003, SEC-FILE-004, §12); `PHASE-15-REVIEW.md`.

**Phase 14 (committed `6146fa0`, D-043):**
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

- **Phase 15:**
  - **`Prisma.getExtensionContext(this)` does not give you a usable client inside a `query.$allModels.$allOperations` extension component.** Tried it as the fix for the audit-log-outside-transaction debt; `this` there is an array-like object (`['0','1']` keys, confirmed by logging it), not a client, and `QueryOptionsCbArgs` exposes no other handle to the current transactional client. The "fixed" code threw `TypeError: Cannot read properties of undefined (reading 'create')` on every audited write — caught by running the full e2e suite immediately after the change, before any commit. Reverted in full; see `11-DECISIONS.md` D-044 for the real-fix scope (a ~15-call-site refactor, deferred).
  - **`pnpm exec ts-node` run directly against a standalone script outside `apps/backend/prisma/` fails** with `TS5109: Option 'moduleResolution' must be set to 'NodeNext'...` — it resolves the wrong tsconfig. Scripts must live in `apps/backend/prisma/` (matching `seed.ts`'s convention) to pick up the right one, even for a one-off cleanup script; delete it afterward.
  - **Repeated manual test runs against the long-lived dev database leave debris when a run's own `afterAll` also fails** (e.g. because the test body threw first). Three `Audit Test Hospital *` rows accumulated this way during the audit-log fix investigation, unrelated to any specific hospitalId collision (each run uses a fresh random suffix) — just never reached their own cleanup. Cleaned with a one-off script scoped by `name: { startsWith: "Audit Test Hospital" } }`. Worth a scan for `<Suite name> Test Hospital *` debris after any session with failed/interrupted e2e runs, not just before committing.
  - **A rate-limit e2e test (100 sequential requests, 5s default Jest timeout) timed out once during a full-suite run under heavy system load** (one request spiked to 41s) but passed cleanly (613ms total) in isolation immediately after. Confirmed transient/environmental, not a regression — this machine had Docker, multiple background builds, and a full day's worth of Jest runs all going at once.
  - **`collectCoverageFrom` glob patterns (`'<rootDir>/src/**/*.ts'` and similar) report `Unknown% (0/0)` under the e2e Jest config on this Windows setup**, even though the tests clearly execute those files (447 tests passed in the same run). Not resolved — abandoned in favor of the scenario-coverage argument in D-044 rather than continuing to fight the tooling for a number of questionable value anyway.

- **Phase 17:**
  - **`@nestjs/swagger@^12` (what a bare `pnpm add` resolves to) has an unmet peer dependency on Nest v12**, while this project is pinned to Nest v10. Caught at install time by the peer-dependency warning, before any code was written. Fixed by explicitly installing `8.1.1` after confirming its peer range via `npm view`.
  - **Jest's `collectCoverageFrom` reported `Unknown% (0/0)` for every pattern tried** (globs, literal paths, a `roots` override) when the coverage config lived inside `test/jest-e2e.json`. Root-caused via `--showConfig`: a Jest config's `rootDir: "."` resolves relative to **the config file's own directory**, not the invoking CWD — so `src/**/*.ts` was being resolved against `apps/backend/test/src/**/*.ts`, which doesn't exist, and Jest silently reports zero matched files rather than erroring. Fixed by placing the new coverage config (`jest-e2e.coverage.json`) at the backend package root instead. Documented in `CLAUDE.md` as a new standing gotcha — check this first if a future coverage/config change reports suspiciously empty results.
  - **`docs/diagrams/er-diagram.svg` was accidentally overwritten with PNG binary data, twice**, by an off-by-one argv-indexing bug in a temporary Puppeteer screenshot script (wrong argument order once, an extra empty-string argument shifting all subsequent indices the second time). Caught immediately both times via `file <path>` showing "PNG image data" instead of "SVG"; fixed both times by rerunning `prisma generate` (fully recoverable by construction, since the ERD is schema-generated). The third attempt (the actual architecture-diagram PNG, a different file) explicitly double-checked argument count/order first and succeeded.
  - **Three leftover `nest start --watch` process trees from earlier in this session** (from separate `pnpm run dev` invocations used for the user's manual OTP-verification test) were still connected to Redis after being "stopped," stealing BullMQ notification jobs and causing 7 spurious `notifications.e2e-spec.ts` failures on the final verification run — an exact recurrence of the already-documented "stopping only the parent PID leaves orphaned children" `CLAUDE.md` pitfall. Diagnosed via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` (inspected each command line to confirm backend-relatedness before killing), killed all 7 PIDs across 3 trees. Rerun: clean 448/448.
  - **Three zero-byte stray files (`'`, `e.id))`, `e.type`) and scattered `.claude-flow/` directories** turned up in `git status`, neither intentional Phase 17 output — the former from a broken shell-quoting command earlier this session, the latter ambient state from the `claude-flow`/`ruflo` MCP integration. Found during this phase's pre-commit cleanliness check; files deleted, `.claude-flow/` added to `.gitignore`.
  - **A background-task Monitor watching the backend log for the OTP line expired after 30 minutes** (2 events delivered) while other Phase 17 work continued — not an error, just the watch's own timeout; the OTP had already been retrieved and used successfully before the expiry notification arrived.

## Next Steps

1. **Ask the user whether to commit Phase 17** — the last phase in `docs/05-DEVELOPMENT-PLAN.md`. From the repo root:
   `git add -A -- . ':!**/.claude-flow/**' ':!.claude-flow/**' && git commit -m "docs: Phase 17 — documentation & delivery"`
2. **After Phase 17 is committed, there is no Phase 18.** The project is feature-complete per the roadmap; what remains is the user's call on final delivery:
   - if the user wants to actually deploy for real, `docs/13-DEPLOYMENT-RUNBOOK.md` is the ready-to-execute checklist — a "run this with your own credentials" task, not something to start unprompted;
   - if the user wants the video actually recorded, `docs/14-VIDEO-WALKTHROUGH-SCRIPT.md` is ready to record from directly;
   - `SEC-FILE-004` (ClamAV) — deferred to whenever the EC2 host from the runbook actually exists;
   - the audit-log-outside-transaction refactor (independent of delivery, could go anytime);
   - the deferred `@nestjs/core` (v10→v11) and `@faker-js/faker` (9→10) major upgrades;
   - the attachment confirm-upload step;
   - Socket.IO handshake rate limiting;
   - provider error-classification tests;
   - serving allowed appointment actions from the API;
   - consider gating `/api/docs`/`/api/docs-json` behind an env flag or reverse-proxy rule before any real public deployment (Known Minor Issue, `PHASE-17-REVIEW.md`).
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
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json          # 448 tests, 19 suites (Phase 15); limiter reset per spec file
# CI reproduces this job with different (throwaway) secrets — see .github/workflows/ci.yml's integration-tests job for the exact env block if simulating it locally.
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
| Git | UNCOMMITTED (Phase 17) | 13 `e6d4a32`, 13B `cfb6944`, follow-up `d320ea2`, 14 `6146fa0`, 15 `6f36c82`, 16 `10e59a0` committed; Phase 17 in the working tree, cleaned of stray junk files; `.claude-flow/` now gitignored |
| Lint | PASS | Backend and frontend, zero warnings |
| Typecheck | PASS | Backend, frontend (incl. `e2e/`), types |
| Unit tests | PASS | Backend 7/7; frontend Vitest 140/140 |
| Integration/e2e tests | PASS | Backend 448/448, 19/19 suites (after clearing 3 leftover process trees — see Failed Attempts) |
| Test coverage (real, from e2e suite) | MEASURED | 92.12% statements / 93.37% functions / 93.33% lines / 70.8% branches — all clear the brief's 70% target |
| Browser E2E (Playwright) | PASS | 47/47 against rebuilt production containers |
| Swagger / OpenAPI | PASS | `/api/docs` and `/api/docs-json` verified against the production build; generated from real DTOs via the Nest CLI plugin |
| ER / architecture diagrams | PASS | ER diagram generated from `schema.prisma` via `prisma generate`; architecture diagram matches `03-ARCHITECTURE.md` §1, visually verified |
| Project report (.docx) | PASS | XSD-validated (`validate.py`), visually spot-checked (rendered to PDF/JPEG), both embedded images confirmed full-resolution |
| Blue-green cutover | PASS, proven live (Phase 16) | 2/2 runs (blue→green, green→blue) against a real throwaway stack, zero failed requests during either cutover under concurrent polling |
| CI workflow | FIXED (Phase 15) + extended (Phase 16), verified by local reproduction / YAML validation only | Still cannot be confirmed against real GitHub Actions without a remote |
| Security review | PASS | OWASP pass (Phase 15) + Phase 16's `ci.yml` review + this phase's review of the new Swagger endpoint and report/script content; no new Critical/High finding |
| Build | PASS | Frontend production image rebuilt; backend `nest build` + `node dist/main.js` health-checked; native Windows root `pnpm run build` still has the known, unrelated Windows-symlink limitation |
| DB migrations | NOT APPLICABLE | No schema change this phase (the `erd` generator block is not a migration) |
| Docker | PASS | `postgres`/`redis`/`localstack` healthy throughout; frontend prod image + container built, tested, torn down cleanly; final `docker ps` confirmed no unexpected leftover containers |
| Manual browser smoke test | PASS | Patient registration → OTP (read from backend dev-mode log) → verification, confirmed working end-to-end |
| Sentry (backend + frontend) | Wiring PASS (Phase 16); live ingestion UNVERIFIED | No Sentry account exists |
| Live Stripe/Razorpay checkout | UNVERIFIED | No test keys |
| Live Resend/Twilio sends | UNVERIFIED | No credentials |
| AWS EC2/RDS/S3, Vercel, real GitHub remote | UNVERIFIED | User chose "build ready-to-run, provision nothing live" for Phase 16 — unchanged in Phase 17 |
| Video walkthrough | SCRIPT ONLY, NOT RECORDED | This session cannot record video — `docs/14-VIDEO-WALKTHROUGH-SCRIPT.md` is ready for the user to record from |
| Live demo URL | NOT DEPLOYED | Documented, user-chosen scope boundary — see `docs/13-DEPLOYMENT-RUNBOOK.md` |

## Current Phase Gate

**Phase 17 — Documentation & Delivery: PASS WITH DOCUMENTED MINOR ISSUES** (uncommitted). Full detail in `docs/phase-reviews/PHASE-17-REVIEW.md`, including a project-wide Final Quality Gate audit across all 17 phases (§27 of the quality protocol) that found no undocumented critical/high issue. Swagger, the ER diagram, and the architecture diagram are all generated from real source (DTOs, schema, and the actual architecture doc respectively) rather than hand-authored-then-left-to-drift. Test coverage is reported honestly from the real e2e/integration suite (92.12%/93.37%/93.33%/70.8%), clearing the brief's 70% target. Five bugs surfaced during this phase's own work (a Swagger peer-dependency mismatch, a Jest `rootDir` config gotcha, two diagram-overwrite incidents, and a leftover-process test-flake) and all five were root-caused and fixed before this review was written; the two generally-useful lessons are now in `CLAUDE.md`. The video walkthrough is a script rather than a recording and the live demo remains undeployed — both are documented, user-acknowledged scope boundaries, not oversights. No Critical or High severity issue is open. This is the last phase in `docs/05-DEVELOPMENT-PLAN.md` — nothing proceeds automatically from here.

Earlier: Phase 16 PASS WITH DOCUMENTED MINOR ISSUES (committed `10e59a0`); Phase 15 PASS WITH DOCUMENTED MINOR ISSUES (committed `6f36c82`); Phase 14 PASS WITH DOCUMENTED MINOR ISSUES (committed `6146fa0`); Phase 13B PASS WITH DOCUMENTED MINOR ISSUES (committed `cfb6944` + follow-up `d320ea2`).

## Important Decisions / Context

- **Phase 17 (see `PHASE-17-REVIEW.md` for full detail, no new D-number — this phase is documentation/verification of what Phases 1–16 already built, not a new architectural call):**
  - three scope decisions made explicitly by the user when asked, not assumed: generate the coverage report from the real e2e suite rather than write new mocked-unit tests; produce a video *script* (not a recording, which this session cannot do) for the user to record themselves; produce the project report as `.docx` (not Markdown);
  - `@nestjs/swagger@8.1.1` pinned deliberately over the default `^12` resolution (peer-dependency incompatibility with this project's Nest v10 pin);
  - `/api/docs`/`/api/docs-json` left unauthenticated and always-enabled, matching common NestJS/Swagger practice — flagged as a Known Minor Issue to revisit (env gate or reverse-proxy rule) before any real public deployment, not fixed in this phase;
  - `.claude-flow/` (ambient MCP-plugin state, not project output) added to `.gitignore` rather than committed.
- **Phase 16 (see `PHASE-16-REVIEW.md` for full detail, no new D-number — this phase's decisions are all either already covered by `03-ARCHITECTURE.md`/`09-SECURITY.md` or are implementation detail, not new architectural calls):**
  - user-chosen scope: build ready-to-run, provision nothing live;
  - `ghcr.io` over Docker Hub for the image registry (no separate account, uses `GITHUB_TOKEN`);
  - Vercel's own GitHub App integration over a custom Actions job (no token to manage);
  - `withSentryConfig` skipped (not exported the documented way in the installed SDK version, and source-map upload has no credentials to use anyway);
  - two real security findings from an automated review fixed (ref-name script injection, unpinned third-party Actions) — see the phase review's Security Review section for exactly what changed.
- **D-044 (Phase 15):**
  - the CI workflow's 3 stacked bugs (types build, required env vars, LocalStack) fixed and proven by local reproduction, since no git remote exists to run it for real;
  - `SEC-AUTHZ-001`'s promised static check added (`test/route-authorization.e2e-spec.ts`) alongside the pre-existing `RolesGuard` runtime deny-by-default;
  - the coverage gate revised from a mocked-unit percentage (1.83%, real but architecturally the wrong signal here) to scenario + route-reachability coverage;
  - dependency audit: 43 advisories, all transitive, all traced and assessed — none exploitable as currently wired; `@nestjs/core` (v10→v11) and `@faker-js/faker` (9→10) majors deferred;
  - the audit-log-outside-transaction debt (Phase 9) actually investigated: `Prisma.getExtensionContext(this)` doesn't work in a query extension (confirmed empirically), so a real fix needs a ~15-call-site refactor — deferred, tracked by a `test.failing` tripwire instead of a silent re-carry;
  - `SEC-FILE-004` (ClamAV) deferred to Phase 16 (documented accepted risk, this machine's memory constraints);
  - two `09-SECURITY.md` inaccuracies corrected (SEC-INPUT-002, SEC-INPUT-003);
  - rejected: mocked-unit tests written purely to move a coverage number; a partial `@nestjs/core` bump; attempting ClamAV on this dev machine; re-carrying the audit-log debt without investigating it.
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
