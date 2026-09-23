# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions — read it first, then verify against the actual repository state (the repo is the source of truth for what's implemented; this file is the source of truth for session context only).

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable, under a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules — read before touching anything:**
1. **`CLAUDE.md`** (project root) — read every session. Points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in," `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done, and has a growing "Monorepo conventions" list of hard-won, real-bug-encoding project conventions (16 entries as of this handoff — read all of them).
2. **`docs/12-QUALITY-PROTOCOL.md`** — the implement→verify→root-cause-fix→re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase cannot be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user explicitly typing "START PHASE N."** Phase 8 is now done and gated PASS (this session). Do not start Phase 9 implementation until the user says so.

Current objective as of this handoff: **wait for "START PHASE 9."** Phase 9 is Pharmacy per `docs/05-DEVELOPMENT-PLAN.md` (batch inventory, FIFO-by-expiry dispensing, quarantine job, low-stock alerts, nightly expiry digest — `FR-PHARM-001..005`) — re-read the actual doc section in full when authorized, don't assume this summary is complete.

## Current State

**Eight phases complete and gated PASS** (Phase 0 through Phase 8), each with a full review at `docs/phase-reviews/PHASE-{0,1,2,3,4,5,6,7,8}-REVIEW.md`. Working tree has Phase 8's changes staged/ready for commit as of this handoff — the session's plan is to commit immediately after this handoff, so by the time you read this, `git log` should show a `feat: Phase 8 — laboratory` commit at HEAD. If it doesn't, check `git status` first — that's a signal something went wrong between writing this file and committing.

- Typecheck (`pnpm exec tsc --noEmit -p tsconfig.eslint.json` from `apps/backend`) → **PASS**, clean.
- Lint (`pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` from `apps/backend`) → **PASS**, clean.
- Full e2e suite (`pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json` from `apps/backend`) → **PASS**, 140/140 tests, 10/10 suites (112 pre-existing + 28 new for Phase 8), verified this session.
- `docker compose build api` → **PASS**, verified this session. The rebuilt container was brought up and smoke-tested live (`POST /lab-orders` as a seeded Hospital Admin correctly returned `403 FORBIDDEN_ROLE`), confirming the new module is actually wired up inside the built image, not just that the image compiles. No new native/binary dependency was added this phase, so the deeper Puppeteer-style in-container functional check from Phase 7 (D-016) wasn't needed again.
- Docker Compose stack is **currently running**: `postgres`, `redis`, `localstack`, `api` all up and healthy (`docker compose ps` from repo root; `api` was recreated this session on the freshly built image). `frontend`/`nginx` were **not** started — same host port-3000 conflict noted in prior handoffs (an unrelated Next.js dev server on this machine), not a project defect.
- Seeded test accounts unchanged from Phase 4 (password `Demo123!`): `superadmin@medcore.test`, `hospitaladmin@medcore-city.medcore.test` / `hospitaladmin@medcore-metro.medcore.test`, `dr.jeremy.keebler@medcore-city.medcore.test`, plus 30 seeded `*.patient.medcore.test` accounts. `prisma/seed.ts` already seeds a `LabTest`/`LabTestReferenceRange` catalog (5 tests, ANY-gender ranges, no age bands) per hospital — see `apps/backend/prisma/seed.ts`. **No `LabOrder`/`LabOrderItem`/`LabResult` seed data exists** (see Technical Debt below — same pre-existing gap pattern as `Appointment`/`Prescription`, not newly introduced).

### What Phase 8 actually delivered

`FR-LAB-001` through `FR-LAB-005`: `POST /lab-orders` (own-encounter-gated, catalog-verified), the `ORDERED→SAMPLE_COLLECTED→IN_PROGRESS` status lifecycle split by role (Receptionist: collect only; Lab Technician: both transitions) via `PATCH .../status`, structured result entry via `PATCH .../result` with automatic reference-range out-of-range flagging (`NORMAL`/`LOW`/`HIGH`/`NO_REFERENCE_RANGE`) and an optional pre-signed-upload report file, four-eyes approval/rejection via `PATCH .../approve` (same-user rejection verified negative-tested), and a real `Notification`-row fan-out to doctor + patient on approval. `GET /lab-orders/:id` gates each item's `result` payload independently by role/approval-state rather than 404-ing the whole order pre-approval (a documented interpretation, `docs/11-DECISIONS.md` D-021). Three genuine design ambiguities in the pre-existing Phase 2 schema/Phase 6 docs breadcrumbs were found and resolved with documented rationale rather than guessed at — see `docs/phase-reviews/PHASE-8-REVIEW.md` "Bugs Found" and Decisions D-018/D-019/D-020/D-021. Unlike every phase since Phase 4, **no actual code defect was found this phase** — the schema and Prisma extensions were already correctly set up for the Lab domain since Phase 2, verified explicitly rather than assumed.

### Nothing is currently broken

No known open defect blocking the gate. Three items are **documented, accepted limitations** (see `docs/phase-reviews/PHASE-8-REVIEW.md` "Known Minor Issues"): `EnterLabResultDto.values` only accepts exactly one structured value (a true multi-analyte panel needs a `parameter` column added to `LabTestReferenceRange` first — not needed by anything in the current catalog); there's no `GET /notifications/me` yet, so Phase 8's `Notification` rows are real/queryable via direct DB query but not yet retrievable through any API (Phase 11 scope); a patient with no linked portal account (front-desk-registered, `PatientProfile.userId` null) never receives a lab-approval notification since there's no `User` to attach one to (inherent to the Phase 4 design, not a Phase 8 defect — the doctor is still always notified). Also carried forward: no `LabOrder`/`LabOrderItem`/`LabResult` seed data (same pre-existing gap pattern from Phases 5-7), and `apps/frontend` still can't `next build` natively on this Windows machine.

## Active Files

Only what's relevant to picking Phase 9 up, or to understanding Phase 8's surface if touching lab orders/results again:

- `docs/05-DEVELOPMENT-PLAN.md` — re-read Phase 9's scope before starting anything.
- `docs/12-QUALITY-PROTOCOL.md` — mandatory re-read every phase, not just once.
- `docs/07-RBAC-MATRIX.md` §3.7, `docs/08-API-CONTRACT.md` §4.8, `docs/11-DECISIONS.md` (especially D-004 FIFO-by-expiry, D-017 the existing read-only `medicines/` module Phase 9 extends) — check before writing Phase 9 code; `Medicine`/`MedicineBatch`/`DispenseRecord` schema already exists from Phase 2/7 (same pre-built-schema pattern every phase so far has relied on — check `apps/backend/prisma/schema.prisma` for what's already there before assuming a schema change is needed, but also *don't assume it's complete* — Phases 6, 7, and (in a milder, no-code-defect form) 8 all found genuine gaps or ambiguities against the SRS/docs in what looked complete at a glance).
- `docs/phase-reviews/PHASE-8-REVIEW.md` — what Phase 8 actually verified, the three design-ambiguity resolutions, technical debt.
- `apps/backend/src/medicines/` — Phase 7's read-only `GET /medicines`/`GET /medicines/:id` module (`docs/11-DECISIONS.md` D-017) that Phase 9 **extends**, not creates: `POST /medicines`, batch management, dispensing, low-stock alerts, expiry digest all land in this existing module/controller.
- `apps/backend/src/lab/lab.service.ts` — Phase 8's state-machine + four-eyes + notification-fan-out pattern; Phase 9's dispensing/quarantine logic will likely want a similar `$transaction`-wrapped state-transition shape (see `enterResult`/`approveResult` for the `TenantContext.run(...) => this.prisma.$transaction([...])` pattern — required so the audit-log extension attributes the writes to the right actor, not just for atomicity).
- `apps/backend/src/queue/` — Phase 5's `appointment-reminder` and Phase 7's `pdf-generate` BullMQ queue patterns; Phase 9's `medicine-expiry-scan` nightly cron job (already named in `docs/03-ARCHITECTURE.md` §12 since Phase 3, never implemented until now) will follow the same `queue.module.ts`/processor/queue-service shape.
- `CLAUDE.md` — "Monorepo conventions" section has 16 entries; re-skim before writing new code.

## Changes Made (this session)

1. **Built `LabModule`** (`apps/backend/src/lab/`) — `POST /lab-orders`, `PATCH /lab-orders/:id/items/:itemId/status`, `PATCH /lab-orders/:id/items/:itemId/result`, `PATCH /lab-orders/:id/items/:itemId/approve`, `GET /lab-orders/:id`. Order creation gated on "own encounter" (same pattern as Phase 6/7); status transitions restricted per role via an `ALLOWED_STATUS_TRANSITIONS` table (same shape as Phase 5's appointment state machine).
2. **Built reference-range out-of-range computation** (`lab-reference-range.util.ts`): `selectReferenceRange` picks the best-matching `LabTestReferenceRange` for a patient's gender/age (preferring specific over `ANY`/unbounded), `computeFlag` produces `NORMAL`/`LOW`/`HIGH`/`NO_REFERENCE_RANGE`. Deliberately typed against plain `string`/`string | null` rather than importing `@medcore/types`' enum-shaped types as parameter types for Prisma-sourced values, to avoid the real-enum-vs-as-const-type assignability friction CLAUDE.md already flags as a known hazard.
3. **Built four-eyes approval/rejection** with a real `Notification`-row fan-out on approval (`LabService.notifyResultApproved`) — deliberately scoped to row-persistence only, not full multi-channel dispatch, matching Phase 5's `ReminderDeliveryStub` "real-but-partial" precedent (`docs/11-DECISIONS.md` D-020) since the full event-bus/dispatcher architecture is Phase 11's job.
4. **Added `packages/types` enums**: `LabResultFlag`, `LabResultDecision` (as-const object + derived union, never a real `enum`), rebuilt via `pnpm --filter=@medcore/types run build`.
5. **Resolved three genuine design ambiguities** found while cross-checking requirements against the existing Phase 2 schema and Phase 6 docs breadcrumbs, each documented with full rationale in `docs/11-DECISIONS.md`: D-018 (structured values restricted to one per item — `LabTestReferenceRange` has no `parameter` column), D-019 (`LabResult.reportFileUrl` used directly instead of wiring up the unused `AttachmentOwnerType.LAB_RESULT`, which has no matching FK on `Attachment` anyway), D-021 (`GET /lab-orders/:id` gates the result payload per-item/per-role rather than 404-ing the whole order pre-approval, since the literal matrix reading would leave the ordering doctor unable to track an in-flight order at all).
6. Added `apps/backend/test/lab.e2e-spec.ts` (28 tests) covering the full order lifecycle, every RBAC boundary per `docs/07-RBAC-MATRIX.md` §3.6, cross-tenant 404s, invalid state transitions, the four-eyes negative path, in-range/out-of-range/no-reference-range flagging, the optional report-file upload round-trip through S3, the notification fan-out (verified via direct Prisma query, since no `GET /notifications/me` exists yet), and the per-item result-visibility gating including the `REJECTED`-visible-to-staff-but-not-patient case.
7. Updated `docs/08-API-CONTRACT.md` §4.5 (EMR attachment note pointing at the D-019 resolution) and §4.7 (full Phase 8 endpoint table with the actual implemented request/response shape).
8. Cleaned up stray 0-byte artifact files found in the working tree again this session (`,`, `,+`, `v.flag` — same accidental-shell-mishap pattern flagged in the Phase 6/7 handoffs; `.claude-flow/` telemetry directories left alone, never staged).
9. Wrote `docs/phase-reviews/PHASE-8-REVIEW.md` in full §23 format and gated the phase **PASS**.

## Failed Attempts

**None.** Unlike every phase since Phase 4, no actual code defect (schema gap, extension-registration gap, tooling failure) was found this phase — the Lab domain's schema, tenant-scoping, and audit-log wiring were all already correct since Phase 2, verified explicitly rather than assumed. The three items resolved this phase (D-018/D-019/D-021) were design ambiguities in underspecified areas, not bugs in already-written code, so there was nothing to revert or replace.

## Next Steps

1. **Wait for the user to say "START PHASE 9."** Do not start Phase 9 implementation on your own initiative.
2. When authorized: read `docs/05-DEVELOPMENT-PLAN.md`'s Phase 9 section in full (Pharmacy — batch inventory, FIFO-by-expiry dispensing, quarantine job, low-stock alerts, nightly expiry digest, `FR-PHARM-001..005` — but re-read the actual doc, don't trust this paraphrase), `docs/12-QUALITY-PROTOCOL.md` again, and `docs/07-RBAC-MATRIX.md` §3.7.
3. Check `docs/11-DECISIONS.md` for anything already decided relevant to pharmacy before writing code — D-004 (FIFO-by-expiry rationale) and D-017 (the existing `medicines/` module Phase 9 extends, not creates) are both directly relevant.
4. Follow the same phase discipline as every prior phase: implement → typecheck → lint → e2e (native, then Docker) → mandatory negative/RBAC/cross-tenant adversarial testing (this is where nearly every real bug across Phases 4-7 was actually found — never skip it to save time, even though Phase 8 itself didn't turn one up) → root-cause any failure → re-verify → write `docs/phase-reviews/PHASE-9-REVIEW.md` (§23 format) → update `docs/08-API-CONTRACT.md`/`docs/11-DECISIONS.md`/`CLAUDE.md` as needed → commit → **stop and wait for "START PHASE 10."**
5. The extra gate for Phase 9 per `docs/05-DEVELOPMENT-PLAN.md`: "expired-batch dispensing rejection test passes" — write this negative test (dispense against an already-expired `MedicineBatch`) before considering the feature done, not after, same discipline as Phase 8's four-eyes test.

## Important Commands, Paths, and Gotchas

### Commands (all run from `apps/backend` unless noted)

```bash
# Typecheck / lint
pnpm exec tsc --noEmit -p tsconfig.eslint.json
pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0

# Full e2e suite (needs Postgres + Redis + LocalStack reachable — either native or via Docker)
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json
# ...or a single file:
pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json <filename>.e2e-spec.ts

# If re-running e2e specs repeatedly in a short window, the auth rate limiter
# will start returning 429s and produce spurious total-suite failures that look
# like real bugs but aren't. Clear it between runs if needed:
docker exec medcore-hms-redis-1 redis-cli --scan --pattern "throttle:*" | xargs -r docker exec -i medcore-hms-redis-1 redis-cli DEL

# Docker (from repo root, not apps/backend)
docker compose up -d api          # postgres + redis + localstack + api only
docker compose up -d               # everything, including frontend + nginx
docker compose ps
docker compose logs api --tail 60
docker compose build api frontend  # needed after editing packages/types OR apps/backend src
                                    # in a way you want reflected in a rebuilt image

# Verify a new native/binary dependency actually works INSIDE the container
# (not just that the image builds) — e.g. what caught Phase 7's Puppeteer/Alpine bug:
docker exec medcore-hms-api-1 sh -c "cd /workspace/apps/backend && node -e \"...\""

# LocalStack (dev/test S3) — needed for any EMR/prescription/lab-report work
docker compose up -d localstack

# Prisma (from apps/backend, needs .env vars — use the dotenv wrapper)
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name X   # interactive — will FAIL in
                                                                  # this shell if a confirmation
                                                                  # prompt is needed (see CLAUDE.md)
pnpm exec dotenv -e ../../.env -- prisma migrate deploy          # non-interactive apply — use this
                                                                  # if migrate dev refuses to run
pnpm exec dotenv -e ../../.env -- prisma migrate reset --force --skip-seed && pnpm run db:seed
```

### Gotchas (cumulative — see `CLAUDE.md` "Monorepo conventions" for the canonical, maintained list; highlights only below)

- `dotenv` as a bare CLI command is not on PATH — always `pnpm exec dotenv ...`.
- Backend's dev script is `pnpm run dev`, not `start:dev`.
- Windows file-locking: a running backend process (native `nest start --watch`, or a leftover jest process) can hold the Prisma query engine `.dll.node` locked, causing `EPERM` on `prisma generate`/`migrate`. Find it via `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId,CommandLine` and kill it.
- `@medcore/types` is consumed as compiled JS — edit `packages/types/src/*` → `pnpm --filter=@medcore/types run build` before the change is visible anywhere.
- A pure-ESM npm package (bullmq, puppeteer, ...) needs a `transformIgnorePatterns` carve-out in `test/jest-e2e.json` or e2e tests fail with `SyntaxError: Unexpected token 'export'`.
- A native/binary-dependent npm package (Puppeteer's bundled Chromium, same class as the Prisma engine binary before it) can work perfectly natively and in every non-Docker check, then silently fail only at actual invocation time inside the Alpine container — verify inside the container explicitly, don't trust a successful `docker compose build` alone. (Not triggered this phase — no new native dependency was added.)
- `prisma migrate dev` refuses to run in this non-interactive shell whenever it would need to show a confirmation prompt — hand-write the migration + `prisma migrate deploy` instead. (Not needed this phase — no schema change.)
- `@aws-sdk/client-s3`'s default checksum behavior breaks every pre-signed upload URL — construct the client with `requestChecksumCalculation: "WHEN_REQUIRED"`.
- EMR/prescription/lab-report e2e tests (and any future S3-touching code) need `docker compose up -d localstack` running first.
- **New this phase:** when a Prisma-generated model field (a real, nominally-typed TS enum under the hood) needs to flow into a helper function, type that function's parameters as plain `string`/`string | null` rather than importing the matching `@medcore/types` as-const union type as the parameter type — *comparing* a Prisma enum value against an `@medcore/types` constant with `===`/`!==` is safe and used throughout this codebase, but *assigning*/passing one type where the other is expected risks a real type-checking mismatch (see `lab-reference-range.util.ts` for the pattern).

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/PHASE-X-REVIEW.md`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md`
- RBAC spec: `docs/07-RBAC-MATRIX.md`
- API index: `docs/08-API-CONTRACT.md`
- Backend source: `apps/backend/src/` — one module directory per domain (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `medicines/`, `prescriptions/`, `lab/`, `queue/`, plus `common/` for cross-cutting concerns including `crypto/`/`storage/`/`infra.module.ts`)
- Prisma schema + migrations + seed: `apps/backend/prisma/`
- e2e tests: `apps/backend/test/*.e2e-spec.ts`
- Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | PASS | Working tree clean except this handoff and the Phase 8 changes about to be committed; stray 0-byte artifact files removed this session |
| Lint | PASS | Zero errors/warnings, backend |
| Typecheck | PASS | Zero errors, backend |
| Unit tests | NOT APPLICABLE | No dedicated unit-test suite exists yet project-wide (unchanged since Phase 4) |
| Integration/e2e tests | PASS | 140/140, 10/10 suites |
| Component tests | NOT APPLICABLE | No frontend work this session |
| Build | PASS | `docker compose build api` succeeded; container brought up and live-smoke-tested against the running instance |
| DB migrations | NOT APPLICABLE | No schema change this phase — all Lab models were already migrated since Phase 2 |
| Docker | PASS | `api`/`postgres`/`redis`/`localstack` all up and healthy, verified via a live authenticated request against the freshly built container and a container-log error check |
| Security review | PASS | RBAC-matrix-vs-code check for every lab-order/result/approval role, cross-tenant isolation, four-eyes negative test, per-item result-visibility gating, file-upload validation, report-file access exclusively via pre-signed URLs — all verified live this session, see `docs/phase-reviews/PHASE-8-REVIEW.md` "Security Review" |

## Current Phase Gate

**Phase 8 — Laboratory: PASS.** Full detail in `docs/phase-reviews/PHASE-8-REVIEW.md`. All `FR-LAB-001..005` verified; three design ambiguities in the pre-existing schema/docs (not code defects) were found and resolved with documented rationale via mandated cross-checking against requirements/docs before implementation; no known critical or high-severity defect remains open.

## Important Decisions / Context

- **`D-018`** (new this session, `docs/11-DECISIONS.md`): `EnterLabResultDto.values` restricted to exactly one entry, since `LabTestReferenceRange` has no `parameter` column and can't safely range-check a multi-analyte panel. A future multi-parameter test panel needs that schema change first.
- **`D-019`** (new this session): lab report files use `LabResult.reportFileUrl` directly (Phase 7's `Prescription.pdfUrl`/`DoctorProfile.signatureImageUrl` direct-storage-key pattern), not the generic `Attachment` model — `AttachmentOwnerType.LAB_RESULT` stays a defined-but-intentionally-unused enum member, documented so it reads as a considered choice, not dead code.
- **`D-020`** (new this session): FR-LAB-005's notification trigger persists a real `Notification` row per recipient (doctor always; patient only if they have a linked portal account) — same "real-but-partial" scoping precedent as Phase 5's `ReminderDeliveryStub`. Full multi-channel dispatch (event bus, `NotificationDispatcher`, email/SMS/push workers) is still entirely Phase 11's job; nothing here should be mistaken for that infrastructure existing yet.
- **`D-021`** (new this session): `GET /lab-orders/:id` gates each item's *result payload* by role/approval-state, not the whole endpoint's `200`/`404` — the literal RBAC-matrix reading would otherwise leave the ordering doctor unable to see that their own order even exists until approval, which nothing in the FR text asks for.
- **No schema changes this phase** — first phase since Phase 3 where the Prisma schema needed zero edits, since Phase 2's original Lab modeling (plus its tenant-scoping/audit-log extension registration) turned out to already be complete and correct for everything FR-LAB-001..005 actually requires.
