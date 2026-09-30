# Phase 16 Review — Deployment & DevOps

## Phase

Phase 16 — Deployment & DevOps (`docs/05-DEVELOPMENT-PLAN.md`). Started on the user's explicit "COMMIT AND START PHASE 16", after Phase 15 was committed (`6f36c82`).

## Objective

Production Docker Compose, Nginx TLS config, full GitHub Actions pipeline (PR checks → main build → tag deploy), AWS EC2/RDS/S3 provisioning, Vercel frontend deploy, Sentry production wiring, health-check-gated blue-green cutover.
Delivers: `NFR-AVAIL-001`, deployment architecture from `docs/03-ARCHITECTURE.md` §11/§15.

## A note on scope: what "done" means for this phase

Every prior phase's work could be fully built and fully verified inside this one machine. Phase 16 is different: half its deliverables (AWS EC2/RDS/S3, Vercel, a real GitHub remote with branch protection, live Sentry ingestion) require real external accounts and, for AWS, real ongoing money — things this session cannot and should not create unilaterally. Before writing any code, the user was asked how to handle this and chose: **build everything as ready-to-run, provision nothing live** — the same posture this project has held toward Stripe/Razorpay/Resend/Twilio since Phase 6 (real integration code, test-mode/UNVERIFIED credentials, phase gate not blocked on live execution). This review follows that same discipline: every claim below is marked either **verified locally** (I ran it and watched it pass) or **UNVERIFIED — needs real credentials** (the code/config is complete and, as far as static and local testing can prove, correct; it has not been run against the real service it targets).

## Implemented

- **Sentry error reporting, backend + frontend** (`docs/03-ARCHITECTURE.md` §14 — "Sentry captures unhandled exceptions and unhandled promise rejections in both the Nest process and BullMQ workers"):
  - `apps/backend/src/common/observability/sentry.ts`: `initSentry()` (gated on `SENTRY_DSN_BACKEND`) and `installProcessErrorHandlers()` (`uncaughtException`/`unhandledRejection`), called first thing in `main.ts`.
  - `apps/backend/src/common/filters/http-exception.filter.ts`: `Sentry.captureException` on every 5xx (unexpected) error, never on a normal 4xx business error.
  - `apps/backend/src/common/observability/sentry-worker.base.ts`: a shared `SentryReportingWorkerHost` base class with an `@OnWorkerEvent("failed")` handler that reports only once a job's retries are exhausted (a mid-retry failure is expected BullMQ behaviour, not a bug). **All six BullMQ processors** now extend it — `EmailProcessor`/`SmsProcessor`/`InAppProcessor` (via the shared `ChannelProcessor` base) and `AppointmentReminderProcessor`/`MedicineExpiryScanProcessor`/`PrescriptionPdfProcessor` — closing the exact gap the architecture doc calls out by name.
  - Frontend: `apps/frontend/src/instrumentation.ts` (server + edge) and `src/instrumentation-client.ts` (browser), both gated on `NEXT_PUBLIC_SENTRY_DSN_FRONTEND`. Renamed from `.env.example`'s original `SENTRY_DSN_FRONTEND` — one `NEXT_PUBLIC_` var covers all three runtimes, since a Sentry DSN isn't a secret.
  - `next.config.ts` deliberately does **not** use `withSentryConfig` — that wrapper's main value is source-map upload, which needs `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (none configured, matching every other UNVERIFIED provider), and the installed SDK version's `withSentryConfig` isn't even exported the way older docs describe (confirmed by a failing `tsc` before this was reverted to explicit `Sentry.init()` calls — simpler and version-stable).
  - **Verified locally**: backend unit tests for the gating logic (`sentry-worker.base.spec.ts`, 2/2 — reports once retries exhaust, doesn't mid-retry); both backend and frontend smoke-tested booting cleanly **with and without** a DSN set (a fake DSN was used to prove the init path itself doesn't crash anything — never a real one, since none exists). **UNVERIFIED**: an event actually arriving in a real Sentry project (no account exists).

- **`docker-compose.prod.yml`** (new): the EC2-side topology from `docs/03-ARCHITECTURE.md` §11 — `api-blue` (built from `Dockerfile.backend`'s `runtime` target, added in this phase's Dockerfile per its own "used from Phase 16 onward" comment) plus `nginx`, and nothing else. No Postgres/Redis/LocalStack containers (RDS/Upstash/real S3 in production instead), and no `frontend` service (Vercel deploys that separately, per the architecture diagram's `Vercel --REST+WS--> EC2` cross-origin arrow, not a same-origin proxy). Uses a YAML anchor (`x-api`) so `api-blue`'s config is defined once and the blue-green script's `docker compose run --name api-green` reuses it verbatim for the other colour.
  - **Verified locally**: `docker compose -f docker-compose.prod.yml config` resolves cleanly; the `api-blue` service builds and runs successfully (see the blue-green proof below, which used this exact file). **UNVERIFIED**: running for real against RDS/Upstash/real S3 (none provisioned).

- **`infrastructure/nginx/nginx.prod.conf`** (new): TLS via Certbot/Let's Encrypt convention (cert paths at the standard `/etc/letsencrypt/live/<domain>/` location), an HTTP→HTTPS redirect plus the ACME HTTP-01 challenge location, HSTS, and the same rate-limit zones as the dev config. The upstream is `include /etc/nginx/conf.d/upstream.conf` — a separate one-line file (`infrastructure/nginx/upstream.conf`) specifically so `scripts/deploy/blue-green.sh` can flip which container is live by rewriting one file and reloading, without touching the main config at all.
  - **Verified locally**: `nginx -t` against a throwaway self-signed certificate confirmed the config parses and loads correctly, failing only on DNS resolution for the `api` upstream hostname (expected outside the real compose network — proves the TLS/directive syntax, not the network). **UNVERIFIED**: a real Let's Encrypt certificate issuance (needs a real, publicly-resolvable domain, which doesn't exist for this project).

- **`scripts/deploy/blue-green.sh`** (new), implementing `docs/03-ARCHITECTURE.md` §11's cutover exactly: start the other colour → poll its Docker `HEALTHCHECK` (which calls `/health/ready`, `NFR-AVAIL-001`) with a timeout → flip `upstream.conf` and `nginx -s reload` → drain 10s → stop the old colour. Aborts and leaves the old colour untouched if health never arrives; reverts `upstream.conf` and re-reloads if the Nginx reload itself fails.
  - **Verified locally, end to end, both directions** — the one piece of this phase that a local Docker Compose environment can actually prove for real, not just "config that should work": stood up a throwaway test stack (project name `bgtest`, joined to the real dev Docker network so `postgres`/`redis` were the genuine, already-running dev containers, not mocks), then ran the script twice (blue→green, then green→blue) while a concurrent loop polled `/health/ready` every 100ms through the entire cutover window. **Zero failed requests, in either direction.** `infrastructure/nginx/upstream.conf` ended the test back at its correct committed default.

- **`.github/workflows/ci.yml`**: two new jobs.
  - `docker-build` (on every push to `main` and on a `v*` tag): builds `infrastructure/docker/Dockerfile.backend`'s `runtime` target and pushes to `ghcr.io/<owner>/<repo>/api` — chosen specifically because it authenticates with the workflow's own built-in `GITHUB_TOKEN`, needing no separate registry account or secret (unlike Docker Hub), matching the "minimize new external accounts" instruction.
  - `deploy` (on a `v*` tag only, gated by `EC2_HOST`/`EC2_SSH_USER`/`EC2_SSH_KEY` secrets that don't exist yet — fails closed, doesn't skip silently): SSHes to the EC2 host and runs `scripts/deploy/blue-green.sh <tag>`.
  - **Verified locally**: YAML syntax parses correctly (`python -c "import yaml; yaml.safe_load(...)"`), all 5 jobs present with the expected trigger conditions. **UNVERIFIED**: an actual GitHub Actions run — this repository has no git remote, so `ci.yml` has never executed even once, on any job, in any phase.
  - **A background automated security review caught two real findings in the new `deploy` job, both fixed and re-verified in this phase, not just noted**: (1) `${{ github.ref_name }}` was interpolated directly into a `run:` shell block reaching a remote `ssh` command — a script-injection vector, since ref names are attacker-influenceable text and `${{ }}` expansion happens before the shell ever sees the line (GitHub's own hardening guidance flags this exact pattern). Fixed by reading it into `env: REF_NAME` and validating it against a strict `vX.Y.Z` pattern before any use, with the shell variable quoted everywhere it's used instead of the expression. (2) `webfactory/ssh-agent@v0.9.0` and the four new `docker/*` actions were referenced by mutable version tag rather than an immutable commit SHA — the standard supply-chain hardening for third-party Actions. Fixed by resolving each tag to its real commit SHA via `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` (not guessed) and pinning to that, with a `# vX.Y.Z` comment recording the intended version.

- **`apps/frontend/vercel.json`** (new): sets `buildCommand`/`installCommand` to `cd ../..` first, so the monorepo's own root install and the `@medcore/types`-must-build-first rule (`CLAUDE.md`) are respected even though Vercel's configured Root Directory is `apps/frontend`.
  - **Verified locally**: valid JSON. **UNVERIFIED**: an actual Vercel deployment (no Vercel project connected — Vercel's own GitHub App integration is the documented path, deliberately not a custom Actions job, since it needs no token/secret management and is Vercel's own recommended pattern).

- **`docs/13-DEPLOYMENT-RUNBOOK.md`** (new): a from-scratch, copy-pasteable runbook covering GitHub remote + branch protection, GitHub Actions secrets, AWS IAM/S3/RDS provisioning (with exact `aws` CLI commands), Upstash Redis, the EC2 host setup, `.env.production`'s shape, Let's Encrypt cert issuance, Vercel project setup, optional Sentry setup, the first deploy, every subsequent deploy, rollback, and the schema-migration-on-deploy caveat (migrations aren't run automatically by the blue-green script, and must be backward-compatible with the previous release for the cutover's brief dual-version window).

## Requirements Verified

| ID | Status |
| --- | --- |
| `NFR-AVAIL-001` (health endpoints for orchestration) | PASS — pre-existing from Phase 5-ish, now also the actual gate `blue-green.sh` polls; proven end-to-end in the local cutover test |
| Deployment architecture (`03-ARCHITECTURE.md` §11) | Built and locally verified where a local machine can prove it (compose topology, Nginx TLS syntax, blue-green mechanics); UNVERIFIED where it can't (RDS/Upstash/real S3/EC2/Vercel/GitHub remote) |
| CI/CD architecture (`03-ARCHITECTURE.md` §15) | PR checks and main-merge integration tests were already PASS from Phase 15; `docker-build` and `deploy` jobs added this phase, syntax-verified, UNVERIFIED end-to-end (no remote) |
| Sentry production wiring | PASS locally (init/no-op gating, exception capture wiring, BullMQ worker capture); UNVERIFIED for live ingestion |

## Files/Modules Changed

- `apps/backend/src/common/observability/{sentry.ts,sentry-worker.base.ts,sentry-worker.base.spec.ts}` (new)
- `apps/backend/src/main.ts`, `src/common/filters/http-exception.filter.ts`, `src/config/env.validation.ts` (Sentry wiring + `SENTRY_DSN_BACKEND`)
- `apps/backend/src/notifications/channel.processors.ts`, `src/queue/{appointment-reminder,medicine-expiry-scan,prescription-pdf}.processor.ts` (now extend `SentryReportingWorkerHost`)
- `apps/backend/package.json` (`@sentry/node`; unit-config `transformIgnorePatterns` — first unit test to transitively pull in `@nestjs/bullmq`, same documented `CLAUDE.md` gotcha as the e2e config already had, new location)
- `apps/frontend/src/instrumentation.ts`, `src/instrumentation-client.ts`, `next.config.ts`, `package.json` (`@sentry/nextjs`), `vercel.json` (new)
- `.env.example` (`SENTRY_DSN_BACKEND`, `NEXT_PUBLIC_SENTRY_DSN_FRONTEND` renamed from `SENTRY_DSN_FRONTEND`)
- `docker-compose.prod.yml`, `infrastructure/nginx/{nginx.prod.conf,upstream.conf}` (new)
- `scripts/deploy/blue-green.sh` (new)
- `.github/workflows/ci.yml` (`docker-build`, `deploy` jobs)
- `docs/13-DEPLOYMENT-RUNBOOK.md` (new)

## Tests Executed

- Backend: `tsc --noEmit`, `eslint --max-warnings=0`, Jest unit (incl. the new Sentry worker gating test), full e2e suite.
- Frontend: `tsc --noEmit`, `eslint --max-warnings=0`, Vitest.
- Backend production build (`nest build`) run as `node dist/main.js`, health-checked, smoke-tested with and without a Sentry DSN.
- Frontend production Docker image, smoke-tested with and without a Sentry DSN.
- Full Playwright suite against both rebuilt production artifacts.
- `docker compose -f docker-compose.prod.yml config` (twice — once mid-build, once as final confirmation).
- `nginx -t` against `nginx.prod.conf` with a throwaway self-signed certificate.
- **The blue-green cutover script, run twice against a real (throwaway) stack**, each run with a concurrent 30–40 second `/health/ready` polling loop spanning the entire cutover.
- `.github/workflows/ci.yml` YAML syntax validated with Python's `yaml.safe_load`.
- `apps/frontend/vercel.json` validated with `JSON.parse`.

## Test Results

- Backend: typecheck/lint **PASS**; unit **7/7** (was 5/5 before this phase — +2 for the new Sentry worker test); e2e **448/448, 19/19 suites** (one transient rate-limit timeout under heavy system load reproduced as a clean pass in an immediate rerun — same documented pattern as Phase 15, not a regression).
- Frontend: typecheck/lint **PASS**; Vitest **140/140**.
- Playwright: **47/47** against the rebuilt production containers.
- Blue-green cutover: **2/2 runs clean, zero failed requests during either cutover.**
- `docker compose config`: valid. `nginx -t`: valid (network-resolution failure only, expected outside the real compose network).

## Security Review

An automated background security review of `.github/workflows/ci.yml` (the only genuinely new attack surface this phase — everything else is either read from environment/secrets or runs on infrastructure that doesn't exist yet) found two real issues, both fixed in this phase:

1. **[High] GitHub Actions script injection**: `${{ github.ref_name }}` was interpolated directly into a `run:` block that reaches a remote `ssh` command. Fixed: moved to `env: REF_NAME`, validated against `v[0-9]*.[0-9]*.[0-9]*` before use, referenced only as `"$REF_NAME"` (shell variable, never the `${{ }}` expression) inside the script, with `git checkout --` to also guard against an option-injection edge case.
2. **[Medium] Unpinned third-party Actions**: `webfactory/ssh-agent` and the four `docker/*` actions introduced this phase were referenced by mutable version tag. Fixed: each resolved to its real commit SHA via `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` and pinned, with a `# vX.Y.Z` comment.

Beyond the automated findings: the `deploy` job is gated behind a GitHub Environment (`production`) and three secrets that don't exist, so it fails closed rather than silently deploying with garbage credentials; the `docker-build` job's `ghcr.io` push needs no long-lived registry secret at all (uses the ephemeral `GITHUB_TOKEN`); `.env.production` is `.gitignore`d (`.env.*` pattern, pre-existing) and the runbook is explicit that it's created directly on the host, never committed; the S3 bucket policy in the runbook blocks all public access and scopes the IAM policy to exactly that one bucket's objects (SEC-FILE-003); the RDS security group is documented as EC2-security-group-only, never `0.0.0.0/0`.

## UI/UX Review

Not applicable — no UI code changed this phase. The full Playwright suite (including Phase 14's accessibility scan) was re-run against the Sentry-instrumented production build to confirm no regression; all 47 journeys pass.

## Bugs Found

1. **`Prisma.getExtensionContext(this)` was not the actual bug this phase** — that was Phase 15's investigation (see `PHASE-15-REVIEW.md`), unrelated here; noted only to avoid confusion since both phases touch backend internals.
2. **`withSentryConfig` is not exported the way it's commonly documented** in the installed `@sentry/nextjs@11.1.0` — `tsc` caught this immediately (`Module '"@sentry/nextjs"' has no exported member 'withSentryConfig'`) before it reached any build or runtime step. Resolved by not using it at all (see Implemented) rather than chasing the version-specific correct import path for a feature (source-map upload) that has no credentials to use anyway.
3. **The security review's two findings** (script injection, unpinned actions) — see Security Review above.

## Fixes Applied

All three bugs above were fixed in this phase, not deferred: the Sentry Next.js config was simplified to avoid the broken import entirely; both security findings were fixed and the workflow's YAML re-validated afterward.

## Regression Checks

Full backend e2e (448/448) and frontend Vitest (140/140) re-run after the Sentry wiring; Playwright (47/47) re-run against the fully rebuilt production containers (backend + frontend) with Sentry instrumentation active; `docker compose config` and `nginx -t` re-validated after the blue-green script development; `ci.yml` YAML re-validated after the security fixes.

## Known Minor Issues

- **Everything marked UNVERIFIED above** is exactly that — code and config believed correct by static validation and local proxy-testing, never exercised against the real external service it targets. This is a deliberate, user-chosen scope boundary for this phase (see "A note on scope" above), not an oversight.
- **This repository still has no git remote** — `.github/workflows/ci.yml` has never executed, in this phase or any prior one. `docs/13-DEPLOYMENT-RUNBOOK.md` §1 is the first step to close this.
- **`infrastructure/nginx/nginx.prod.conf` has a placeholder domain** (`api.yourdomain.example`) that must be edited before any real deploy — called out in three places (the file itself, the runbook, and here).
- **Database migrations are not automated by `blue-green.sh`** — deliberate (see the runbook §13's reasoning about the cutover's dual-version window), but worth remembering before a schema-changing release.
- **Carried from Phase 15**: the audit-log-outside-transaction gap (tracked by its `test.failing` tripwire), the deferred `@nestjs/core`/`@faker-js/faker` major upgrades, deferred ClamAV (now explicitly *this* phase's infrastructure, once it exists — see `11-DECISIONS.md` D-044).
- **Carried from Phase 14**: live Stripe/Razorpay/Resend/Twilio UNVERIFIED; the native Windows `pnpm run build` symlink quirk (irrelevant to the actual CI/deploy path, which is Linux/Docker).

## Technical Debt

- ClamAV integration (`SEC-FILE-004`) — the EC2 host this phase provisions-on-paper is exactly the infrastructure D-044 deferred it to; worth picking up once the host is real.
- Consider Dependabot's `github-actions` ecosystem to keep the newly-pinned SHAs current (flagged by the security review as a follow-up, not applied this phase — it's a repo-settings change, not a code change, and needs the GitHub remote from §1 of the runbook to exist first).
- The `docker-build` job builds the API image on every `main` push, not just tags — reasonable for keeping `:latest` fresh, but means untagged commits accumulate images in `ghcr.io` with no retention policy configured; a cleanup policy is worth adding once real usage patterns are visible.

## Documentation Updated

- `docs/13-DEPLOYMENT-RUNBOOK.md` (new).
- `.env.example` (Sentry vars).
- `HANDOFF.md`.

## Final Gate

**PASS WITH DOCUMENTED MINOR ISSUES.**

Every piece of this phase that a local machine can actually prove has been proven: Sentry's gating and capture logic (unit-tested and smoke-tested both with and without a DSN), the production Docker Compose topology and Nginx TLS config (both syntax- and load-validated), and — the centrepiece — the blue-green deploy script, verified end-to-end in both directions against a real (if throwaway) stack with a concurrent zero-downtime proof, not just read for correctness. The GitHub Actions additions are syntactically valid and were caught and fixed for two real security issues by an automated review before being considered done. Everything that genuinely cannot be verified without a real AWS account, a real domain, a real GitHub remote, or a real Vercel/Sentry project is named specifically as UNVERIFIED rather than silently assumed working — the same discipline this project has held toward every other external provider since Phase 6, now extended to infrastructure instead of APIs.

The minor items are the UNVERIFIED-pending-real-credentials list above, the placeholder domain, and the items carried from Phase 15/14.

Phase 17 doesn't start until the user says so.
