# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions — read it first, then verify against the actual repository state (the repo is the source of truth for what's implemented; this file is the source of truth for session context only).

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable, under a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules — read before touching anything:**
1. **`CLAUDE.md`** (project root) — read every session. Points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in," `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done, and has a growing "Monorepo conventions" list of hard-won, real-bug-encoding project conventions (16 entries as of this handoff — read all of them).
2. **`docs/12-QUALITY-PROTOCOL.md`** — the implement→verify→root-cause-fix→re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase cannot be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user explicitly typing "START PHASE N."** Phase 7 is now done and gated PASS (this session). Do not start Phase 8 implementation until the user says so.

Current objective as of this handoff: **wait for "START PHASE 8."** Phase 8 is Laboratory per `docs/05-DEVELOPMENT-PLAN.md` (test catalog + reference ranges, order lifecycle, structured result entry, four-eyes approval, out-of-range flagging, notification triggers — `FR-LAB-001..005`) — re-read the actual doc section in full when authorized, don't assume this summary is complete.

## Current State

**Eight phases complete and gated PASS** (Phase 0 through Phase 7), each with a full review at `docs/phase-reviews/PHASE-{0,1,2,3,4,5,6,7}-REVIEW.md`. Working tree has Phase 7's changes staged for commit as of this handoff — the session's plan is to commit immediately after this handoff, so by the time you read this, `git log` should show a `feat: Phase 7 — prescriptions` commit at HEAD. If it doesn't, check `git status` first — that's a signal something went wrong between writing this file and committing.

- Typecheck (`pnpm exec tsc --noEmit -p tsconfig.eslint.json` from `apps/backend`) → **PASS**, clean.
- Lint (`pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` from `apps/backend`) → **PASS**, clean.
- Full e2e suite (`pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json` from `apps/backend`) → **PASS**, 112/112 tests, 9/9 suites (94 pre-existing + 18 new for Phase 7), verified this session.
- `docker compose build api` → **PASS**, verified this session. **Additionally verified beyond the build succeeding**: ran a direct `docker exec` Puppeteer launch inside the built container and confirmed it renders a real PDF using Alpine's system Chromium — this specific check matters because a Puppeteer/Alpine Chromium mismatch would otherwise pass every other check (native e2e, typecheck, lint, even `docker compose build` itself) and only fail at the first real PDF-generation request in the running container. See `docs/11-DECISIONS.md` D-016.
- Docker Compose stack is **currently running**: `postgres`, `redis`, `localstack`, `api` all up and healthy (`docker compose ps` from repo root). `frontend`/`nginx` were **not** started — same host port-3000 conflict noted in the Phase 6 handoff (an unrelated Next.js dev server on this machine), not a project defect.
- Seeded test accounts unchanged from Phase 4 (password `Demo123!`): `superadmin@medcore.test`, `hospitaladmin@medcore-city.medcore.test` / `hospitaladmin@medcore-metro.medcore.test`, `dr.jeremy.keebler@medcore-city.medcore.test`, plus 30 seeded `*.patient.medcore.test` accounts. See `apps/backend/prisma/seed.ts`. **No Prescription/Medicine seed data exists** (see Technical Debt below — carried forward, not new).

### What Phase 7 actually delivered

`FR-RX-001` through `FR-RX-003`: a read-only `GET /medicines` search endpoint (brought forward from Phase 9's fuller Pharmacy scope, `docs/11-DECISIONS.md` D-017); prescription creation gated on the caller being the medical record's own doctor, with every item's medicine verified against the caller's hospital inventory; a real async PDF-generation pipeline (`pdf-generate` BullMQ queue → Puppeteer → S3 upload → pre-signed-URL download, verified end-to-end including actually downloading a `%PDF`-prefixed file); doctor signature upload (new, small addition — no prior phase had built this even though the schema field existed since Phase 2); and prescription corrections via a new self-referential `supersedesId` field (a real schema gap fixed this phase, `FR-RX-003` requires it but Phase 2's schema didn't have it). Full detail, all four issues found via mandatory adversarial/integration testing, and the known-minor/technical-debt items are in `docs/phase-reviews/PHASE-7-REVIEW.md` — read it, not just this summary, before touching prescriptions/medicines/queue code.

### Nothing is currently broken

No known open defect blocking the gate. Three items are **documented, accepted limitations** (see `docs/phase-reviews/PHASE-7-REVIEW.md` "Known Minor Issues"): `Prescription.status` transitions beyond `ISSUED` aren't driven by anything yet (that's Phase 9's dispensing workflow); the PDF template is deliberately plain (no logo/branding, deferred to Phase 14); there's no way to view/remove a doctor's currently-set signature, only overwrite it. Also carried forward: no Prescription/Medicine seed data (pre-existing gap pattern from Phases 5-6, not introduced this phase), and `apps/frontend` still can't `next build` natively on this Windows machine.

## Active Files

Only what's relevant to picking Phase 8 up, or to understanding Phase 7's surface if touching prescriptions/medicines/PDF-generation again:

- `docs/05-DEVELOPMENT-PLAN.md` — re-read Phase 8's scope before starting anything.
- `docs/12-QUALITY-PROTOCOL.md` — mandatory re-read every phase, not just once.
- `docs/07-RBAC-MATRIX.md` §3.6, `docs/08-API-CONTRACT.md` §4.7, `docs/11-DECISIONS.md` — check before writing Phase 8 code; `LabTest`/`LabTestReferenceRange`/`LabOrder`/`LabOrderItem`/`LabResult` schema already exists from Phase 2 (same pre-built-schema pattern every phase so far has relied on — check `apps/backend/prisma/schema.prisma` for what's already there before assuming a schema change is needed, but also *don't assume it's complete* — Phases 6 and 7 both found genuine gaps against the SRS in schema that looked complete at a glance).
- `docs/phase-reviews/PHASE-7-REVIEW.md` — what Phase 7 actually verified, all bugs found/fixed, technical debt.
- `apps/backend/src/prescriptions/`, `apps/backend/src/queue/prescription-pdf*` — Phase 7's async-job + PDF pattern; Phase 8's "notification triggers" (FR-LAB-005) likely wants the same enqueue-from-service-then-verify-completion-in-tests shape, and lab report attachments will want `AttachmentOwnerType.LAB_RESULT` (deferred from Phase 6, see `docs/phase-reviews/PHASE-6-REVIEW.md` Known Minor Issues).
- `apps/backend/src/common/infra.module.ts` — `EncryptionService`/`S3Service` are now global; Phase 8 can inject either directly without re-declaring them in a new module's `providers`.
- `CLAUDE.md` — "Monorepo conventions" section now has 16 entries; re-skim before writing new code, several are exactly the kind of mistake that's easy to silently reintroduce (the Puppeteer/Alpine one is brand new and easy to miss if Phase 8 needs any other Puppeteer/Chromium-adjacent rendering).

## Changes Made (this session)

1. **Identified and fixed a real requirements-vs-schema gap**: `FR-RX-003` requires prescription corrections to reference the prescription they supersede, but the Phase 2 schema had no such field. Added `Prescription.supersedesId` (unique, self-referential) in a new migration.
2. **Built `MedicinesModule`** (`apps/backend/src/medicines/`) — read-only `GET /medicines`/`GET /medicines/:id`, RBAC-scoped per `docs/07-RBAC-MATRIX.md` §3.7, deliberately scoped to search-only this phase (`docs/11-DECISIONS.md` D-017) with full catalog/batch management left for Phase 9.
3. **Built `PrescriptionsModule`** — creation gated on "own encounter," inventory-backed items, `GET /prescriptions/:id`, `GET /prescriptions/:id/pdf`.
4. **Built the async PDF-generation pipeline**: `PrescriptionPdfProcessor`/`PrescriptionPdfQueueService` (the `pdf-generate` BullMQ queue already named in `docs/03-ARCHITECTURE.md` §12 since Phase 3 but never implemented until now), a plain-HTML prescription template, and `S3Service.putObject` for the processor's server-side PDF upload (new — Phase 6 only had the client-pre-signed-URL upload path).
5. **Built doctor signature upload** (`POST /doctors/:id/signature`, self only) — the `DoctorProfile.signatureImageUrl` schema field has existed since Phase 2 but no prior phase wired up a way to actually set it.
6. **Promoted `EncryptionService`/`S3Service` to a new `@Global()` `InfraModule`** (mirroring the existing `PrismaModule`/`RedisModule` pattern) since Phase 7 needed `S3Service` in three different modules (EMR, Doctors, Prescriptions) — avoids re-declaring the same provider (and paying for a second `S3Client`) repeatedly.
7. **Found and fixed a real Docker/Puppeteer compatibility bug**: the bundled `puppeteer` npm package's Chromium download does not run on `node:20-alpine` (musl libc) — would have shipped Phase 7 silently broken in the containerized environment despite every native check passing. Fixed by installing Alpine's own `chromium` package and pointing Puppeteer at it (`docs/11-DECISIONS.md` D-016); **re-verified by actually launching Chromium inside the built container**, not just trusting a successful `docker compose build`.
8. **Hit and worked around a tooling limitation**: `prisma migrate dev` refuses to run at all in this non-interactive shell once it needs to show a confirmation prompt (here, triggered by a new `@unique` constraint) — even `--create-only` doesn't avoid it. Worked around by hand-writing the migration SQL (matching Prisma's own established naming conventions already present elsewhere in this repo's migration history) and applying it via `prisma migrate deploy`, which never prompts. Documented in `CLAUDE.md` so a future phase doesn't lose time rediscovering this.
9. Added `apps/backend/test/prescriptions.e2e-spec.ts` (18 tests) covering medicine-search RBAC, signature upload (including a real S3 byte round-trip), "own encounter" gating, inventory validation, full RBAC/tenancy for prescription read and PDF-download paths (which have *different* allowed roles — verified both), the supersession/correction flow including its negative paths, and the async PDF job actually completing and producing a downloadable, byte-verified real PDF (not just "job was enqueued").
10. Cleaned up stray artifacts found in the working tree again this session before committing — several more accidental 0-byte files from shell-command mishaps and `.claude-flow/` telemetry directories (same as flagged in the Phase 6 handoff; this MCP tooling appears to regenerate them passively) — none ever staged or committed.
11. Wrote `docs/phase-reviews/PHASE-7-REVIEW.md` in full §23 format and gated the phase **PASS**.

## Failed Attempts

**None abandoned** — all four issues found this session (schema gap, Docker/Puppeteer bug, non-interactive-migrate tooling limitation, a test-authoring bug caught during self-review before it ever ran) were root-caused and fixed, not worked around or left broken. Worth flagging for whoever picks this up next: the Puppeteer/Alpine issue (#7 above) is the second time in this project a dependency has "worked everywhere except the Alpine Docker image" (the first was the Prisma query engine binary, Phase 2). **Any future phase adding a new native/binary-dependent npm package should proactively check Alpine compatibility before assuming a successful `docker compose build` means it actually works** — the build step doesn't exercise the binary at all, only its *presence*.

## Next Steps

1. **Wait for the user to say "START PHASE 8."** Do not start Phase 8 implementation on your own initiative.
2. When authorized: read `docs/05-DEVELOPMENT-PLAN.md`'s Phase 8 section in full (Laboratory — test catalog + reference ranges, order lifecycle, structured result entry, four-eyes approval, out-of-range flagging, notification triggers, `FR-LAB-001..005` — but re-read the actual doc, don't trust this paraphrase), `docs/12-QUALITY-PROTOCOL.md` again, and `docs/07-RBAC-MATRIX.md` §3.6.
3. Check `docs/11-DECISIONS.md` for anything already decided relevant to labs before writing code (e.g. the hybrid structured/PDF lab-result design already decided in `docs/06-DATABASE-DESIGN.md` §4's key design decisions, ahead of the `D-0xx` list).
4. Follow the same phase discipline as every prior phase: implement → typecheck → lint → e2e (native, then Docker) → mandatory negative/RBAC/cross-tenant adversarial testing (this is where every real bug across all 7 phases so far has actually been found — never skip it to save time) → **explicitly verify any new native/binary dependency inside the actual Docker container, not just that the image builds** (see Failed Attempts above) → root-cause any failure → re-verify → write `docs/phase-reviews/PHASE-8-REVIEW.md` (§23 format) → update `docs/08-API-CONTRACT.md`/`docs/11-DECISIONS.md`/`CLAUDE.md` as needed → commit → **stop and wait for "START PHASE 9."**
5. "Four-eyes approval" (`FR-LAB-004`, result approver must differ from the enterer) is exactly the kind of same-tenant-different-actor authorization check that's easy to get subtly wrong — write the negative test (same user tries to approve their own entered result) before considering the feature done, not after.

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
# (not just that the image builds) — e.g. what caught the Puppeteer/Alpine bug:
docker exec medcore-hms-api-1 sh -c "cd /workspace/apps/backend && node -e \"...\""

# LocalStack (dev/test S3) — needed for any EMR attachment or prescription PDF work
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
- **New this phase:** a native/binary-dependent npm package (Puppeteer's bundled Chromium, same class as the Prisma engine binary before it) can work perfectly natively and in every non-Docker check, then silently fail only at actual invocation time inside the Alpine container — verify inside the container explicitly, don't trust a successful `docker compose build` alone.
- **New this phase:** `prisma migrate dev` refuses to run in this non-interactive shell whenever it would need to show a confirmation prompt — hand-write the migration + `prisma migrate deploy` instead.
- `@aws-sdk/client-s3`'s default checksum behavior breaks every pre-signed upload URL — construct the client with `requestChecksumCalculation: "WHEN_REQUIRED"`.
- EMR/prescription e2e tests (and any future S3-touching code) need `docker compose up -d localstack` running first.

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/PHASE-X-REVIEW.md`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md`
- RBAC spec: `docs/07-RBAC-MATRIX.md`
- API index: `docs/08-API-CONTRACT.md`
- Backend source: `apps/backend/src/` — one module directory per domain (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `medicines/`, `prescriptions/`, `queue/`, plus `common/` for cross-cutting concerns including `crypto/`/`storage/`/`infra.module.ts`)
- Prisma schema + migrations + seed: `apps/backend/prisma/`
- e2e tests: `apps/backend/test/*.e2e-spec.ts`
- Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | PASS | Working tree clean except this handoff and the Phase 7 changes about to be committed |
| Lint | PASS | Zero errors/warnings, backend |
| Typecheck | PASS | Zero errors, backend |
| Unit tests | NOT APPLICABLE | No dedicated unit-test suite exists yet project-wide (unchanged since Phase 4) |
| Integration/e2e tests | PASS | 112/112, 9/9 suites |
| Component tests | NOT APPLICABLE | No frontend work this session |
| Build | PASS | `docker compose build api` succeeded; Puppeteer/Chromium additionally verified working inside the running container, not just that the image built |
| DB migrations | PASS | One new migration (`supersedesId`), hand-applied via `migrate deploy` after `migrate dev` refused to run non-interactively; verified in sync via `migrate status` |
| Docker | PASS | `api`/`postgres`/`redis`/`localstack` all up and healthy, verified via `/health` and a direct in-container Puppeteer PDF-render check |
| Security review | PASS | RBAC-matrix-vs-code check for every prescription/medicine/signature role (including the narrower PDF-download role set vs. view), cross-tenant isolation, file-upload validation, PDF access exclusively via pre-signed URLs — all verified live this session, see `docs/phase-reviews/PHASE-7-REVIEW.md` "Security Review" |

## Current Phase Gate

**Phase 7 — Prescriptions: PASS.** Full detail in `docs/phase-reviews/PHASE-7-REVIEW.md`. All `FR-RX-001..003` verified; one real schema gap (`supersedesId`) and one real Docker/Puppeteer compatibility bug found via mandated adversarial/integration testing, both root-caused and fixed; three items of documented, non-blocking limitation explicitly recorded (not silently shipped).

## Important Decisions / Context

- **`D-016`** (new this session, `docs/11-DECISIONS.md`): Puppeteer's bundled Chromium doesn't run on `node:20-alpine` — fixed via Alpine's own `chromium` package + `PUPPETEER_EXECUTABLE_PATH`/`PUPPETEER_SKIP_DOWNLOAD`. **This is the second time** a dependency has silently broken only in the Alpine Docker image while passing every native/build-time check (first was the Prisma query engine binary in Phase 2) — treat "does this native dependency actually run on musl libc" as a standing question for any future binary-touching addition, not a one-off fluke.
- **`D-017`** (new this session, `docs/11-DECISIONS.md`): `GET /medicines` search was deliberately split out of Phase 9's full Pharmacy scope and built now, read-only, because Phase 7's prescription creation genuinely depends on it. Phase 9 extends `medicines/medicines.module.ts` rather than creating it — don't assume that module is new when Phase 9 starts.
- **Tooling limitation, not a project decision:** `prisma migrate dev` cannot run in this non-interactive shell whenever Prisma would show a confirmation prompt (new unique constraints being the trigger found this phase, but likely not the only one). The hand-write-SQL-then-`migrate deploy` workaround is now documented in `CLAUDE.md` — use it directly next time rather than re-discovering the failure.
- **`EncryptionService`/`S3Service` are now global** (`InfraModule`, `docs/phase-reviews/PHASE-7-REVIEW.md`) — a future module needing either should inject it directly, not re-declare it as a local provider the way `EmrModule` originally did in Phase 6.
