# HANDOFF — MedCore HMS

Written at a session boundary so the next Claude Code session can pick up with zero lost context. This file is the project's memory between sessions — read it first, then verify against the actual repository state (the repo is the source of truth for what's implemented; this file is the source of truth for session context only).

## Goal

Building **MedCore HMS**, a multi-tenant Hospital Management SaaS platform, as a production-quality internship deliverable, under a strict phase-gated methodology (`docs/05-DEVELOPMENT-PLAN.md`) with a mandatory quality protocol (`docs/12-QUALITY-PROTOCOL.md`) governing every phase.

**Two standing, non-negotiable rules — read before touching anything:**
1. **`CLAUDE.md`** (project root) — read every session. Points to `docs/05-DEVELOPMENT-PLAN.md` for "what phase are we in," `docs/phase-reviews/PHASE-X-REVIEW.md` files as the authoritative record of what's done, and has a growing "Monorepo conventions" list of hard-won, real-bug-encoding project conventions (13 entries as of this handoff — read all of them).
2. **`docs/12-QUALITY-PROTOCOL.md`** — the implement→verify→root-cause-fix→re-verify cycle, mandatory negative/adversarial testing, continuous security review, "no fake completion," and the required phase-review format (§23). A phase cannot be marked PASS without going through it.

**The single most important rule: NEVER start implementing the next phase without the user explicitly typing "START PHASE N."** Phase 6 is now done and gated PASS (this session). Do not start Phase 7 implementation until the user says so.

Current objective as of this handoff: **wait for "START PHASE 7."** Phase 7 is Prescriptions per `docs/05-DEVELOPMENT-PLAN.md` (medicine search against inventory, prescription creation, PDF generation via Puppeteer, doctor signature overlay — `FR-RX-001..003`) — re-read the actual doc section in full when authorized, don't assume this summary is complete.

## Current State

**Seven phases complete and gated PASS** (Phase 0 through Phase 6), each with a full review at `docs/phase-reviews/PHASE-{0,1,2,3,4,5,6}-REVIEW.md`. Working tree has Phase 6's changes staged for commit as of this handoff (see Changes Made) — not yet committed at the moment this file was written; the session's plan is to commit immediately after this handoff, so by the time you read this, `git log` should show a `feat: Phase 6 — EMR & clinical workflow` commit at HEAD. If it doesn't, treat that as a signal something went wrong between writing this file and committing — check `git status` first.

- Typecheck (`pnpm exec tsc --noEmit -p tsconfig.eslint.json` from `apps/backend`) → **PASS**, clean.
- Lint (`pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` from `apps/backend`) → **PASS**, clean.
- Full e2e suite (`pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json` from `apps/backend`) → **PASS**, 94/94 tests, 8/8 suites (66 pre-existing + 28 new for Phase 6), verified this session.
- `docker compose build api` → **PASS**, verified this session, twice (once after the first implementation pass, once after the final `findByPatient` behavior fix).
- Docker Compose stack is **currently running**: `postgres`, `redis`, `localstack`, `api` all up and healthy (`docker compose ps` from repo root). `frontend`/`nginx` were **not** started this session — `docker compose up -d` (full stack) failed on port 3000 already being bound by an unrelated process on this machine (a different, unrelated Next.js dev server); only `docker compose up -d api` (which pulls in its `postgres`/`redis`/`localstack` dependencies) was actually started. This is a host-machine port conflict, not a project defect.
- Seeded test accounts unchanged from Phase 4 (password `Demo123!`): `superadmin@medcore.test`, `hospitaladmin@medcore-city.medcore.test` / `hospitaladmin@medcore-metro.medcore.test`, `dr.jeremy.keebler@medcore-city.medcore.test`, plus 30 seeded `*.patient.medcore.test` accounts. See `apps/backend/prisma/seed.ts`. **No EMR seed data exists** (see Technical Debt below — carried forward from Phase 5, not new).

### What Phase 6 actually delivered

`FR-EMR-001` through `FR-EMR-007`: encounter creation gated on the appointment being `IN_PROGRESS` and the caller being its own doctor; append-only clinical addenda (no update/delete endpoint exists — enforced by omission); vitals with server-computed BMI (the DTO has no `bmi` field, so whitelist validation rejects a client-supplied one outright); a `diagnosisNotes` free-text field added this phase to close a real gap against `FR-EMR-004`; patient-level allergy/vaccination/family-history records; and EMR file attachments via real pre-signed S3 URLs, tested end-to-end (actual bytes PUT and GET) against a new LocalStack dev/test service in `docker-compose.yml`. AES-256-GCM application-level encryption (`EncryptionService`) now covers `MedicalRecord.notesEncrypted` and `MedicalRecordAddendum.noteEncrypted` per the Phase 2-era `D-008` decision, which had never actually been implemented until this phase needed it. Full detail, all four items found via mandatory adversarial testing, and the three items of documented known-minor/technical-debt are in `docs/phase-reviews/PHASE-6-REVIEW.md` — read it, not just this summary, before touching EMR code.

### Nothing is currently broken

No known open defect blocking the gate. Three items are **documented, accepted limitations**, not bugs (see `docs/phase-reviews/PHASE-6-REVIEW.md` "Known Minor Issues"/"Technical Debt"): Lab Technician's "lab reports only" attachment upload is out of scope until Phase 8 wires up lab orders; Nurse's narrower 🟡 "notes only"/"vitals-adjacent only" RBAC annotations are simplified to full Doctor-equivalent access (same kind of simplification already established in Phase 4); a client declaring `sizeBytes` for a pre-signed upload isn't strictly enforced against the actual uploaded size (a known limitation of the pre-signed-PUT pattern, flagged for Phase 15 hardening). Also carried forward: no EMR/appointment seed data exists yet (pre-existing gap, not introduced this phase), and `apps/frontend` still can't `next build` natively on this Windows machine (verified via Docker instead).

## Active Files

Only what's relevant to picking Phase 7 up, or to understanding Phase 6's surface if touching EMR/attachments/encryption again:

- `docs/05-DEVELOPMENT-PLAN.md` — re-read Phase 7's scope before starting anything.
- `docs/12-QUALITY-PROTOCOL.md` — mandatory re-read every phase, not just once.
- `docs/07-RBAC-MATRIX.md` §3.5, `docs/08-API-CONTRACT.md` §4.6, `docs/11-DECISIONS.md` — check before writing Phase 7 code; Prescription/PrescriptionItem/DispenseRecord schema already exists from Phase 2 (mirrors how MedicalRecord etc. existed pre-built before Phase 6 used them — check `apps/backend/prisma/schema.prisma` for what's already there before assuming a schema change is needed).
- `docs/phase-reviews/PHASE-6-REVIEW.md` — what Phase 6 actually verified, all bugs found/fixed, technical debt.
- `apps/backend/src/emr/` — Phase 6's new module; Prescription likely needs to reference `MedicalRecord` (a prescription is issued from an encounter) the same way Phase 6 referenced `Appointment`.
- `apps/backend/src/common/crypto/encryption.service.ts`, `apps/backend/src/common/storage/s3.service.ts` — reusable infra Phase 7 will likely need again (a prescription PDF is itself a file — check whether it should go through `S3Service` too, or a separate path, before assuming).
- `CLAUDE.md` — "Monorepo conventions" section now has 13 entries; re-skim before writing new code, several are exactly the kind of mistake that's easy to silently reintroduce.

## Changes Made (this session)

1. **Identified and fixed a real requirements-vs-schema gap**: `FR-EMR-004` requires free-text diagnosis *plus* an optional ICD-10 array, but the Phase 2 schema only had the array (`confirmedDiagnosisIcd10`). Added `MedicalRecord.diagnosisNotes String?` in a new migration (`20260923185931_add_medical_record_diagnosis_notes`), documented in `docs/06-DATABASE-DESIGN.md`.
2. **Built `EmrModule`** (`apps/backend/src/emr/`): `MedicalRecordsController`/`Service` (encounter creation/read/addenda/vitals/attachments) and `PatientClinicalController`/`Service` (allergy/vaccination/family-history), plus 7 DTOs, all RBAC-gated per `docs/07-RBAC-MATRIX.md` §3.4.
3. **Built `EncryptionService`** (AES-256-GCM, `common/crypto/`) — the first real implementation of the Phase 2-era `D-008` decision, which had never actually been wired up until Phase 6's `MedicalRecord.notesEncrypted`/`MedicalRecordAddendum.noteEncrypted` needed it.
4. **Built `S3Service`** (`common/storage/`) — pre-signed PUT/GET URLs, MIME+extension+size validation before issuance (`SEC-FILE-001/002`), never proxies file bytes through the API (`03-ARCHITECTURE.md` §10).
5. **Added a `localstack` service to `docker-compose.yml`** and documented the decision as `D-015` in `docs/11-DECISIONS.md` — real AWS SDK calls against a local S3-compatible endpoint, so the attachment e2e tests exercise genuine S3 protocol behavior (upload real bytes, download them back, assert byte-equality) instead of mocking the SDK.
6. **Found and fixed a real AWS SDK compatibility bug**: `@aws-sdk/client-s3`'s default `requestChecksumCalculation` signs a checksum requirement into every pre-signed PUT URL that nothing ever actually sends, breaking every attachment upload (against both LocalStack and, per AWS's own docs, real S3). Fixed with `requestChecksumCalculation: "WHEN_REQUIRED"` on the client; documented in `CLAUDE.md`.
7. **Found and fixed a requirement-interpretation gap**: `docs/10-TESTING-STRATEGY.md` §3 mandatory scenario #2 expects `403`/`404` for a patient viewing another patient's records, but the first implementation returned `200` with an empty list. Fixed to `404`, matching the brief-derived mandatory scenario; documented the distinction in `docs/08-API-CONTRACT.md` so a future phase doesn't revert it.
8. Added `ENCRYPTION_KEY`/`AWS_*`/`S3_ENDPOINT` to `.env`/`.env.example` and to `env.validation.ts`'s class-validator schema.
9. Added `apps/backend/test/medical-records.e2e-spec.ts` (28 tests) covering encounter-creation gating, RBAC for every role on every route, cross-tenant isolation, append-only addenda with encryption-at-rest verified directly against the DB, server-computed BMI (including a whitelist-rejection test for a client-supplied `bmi`), the full pre-signed-URL attachment round-trip against real LocalStack S3, and patient-level clinical data RBAC/tenancy.
10. Cleaned up several stray artifacts found in the working tree before committing: two accidental 0-byte files created by earlier shell commands in this session, and `.claude-flow/` telemetry directories auto-created by MCP tooling in three locations — none of these were ever staged or committed.
11. Wrote `docs/phase-reviews/PHASE-6-REVIEW.md` in full §23 format and gated the phase **PASS**.

## Failed Attempts

**None abandoned** — the four issues found this session (schema gap, SDK checksum bug, test-authoring appointment-overlap bug, requirement-interpretation gap) were all root-caused and fixed, not worked around or left in a broken state. Worth flagging for whoever picks this up next: the SDK checksum issue (#6 above) was **not** a LocalStack-specific quirk — it reproduces against real AWS S3 too, per AWS's own SDK v3 migration documentation, so don't be tempted to "explain it away" as a LocalStack limitation if it resurfaces in a different form (e.g. multipart uploads) in a later phase.

## Next Steps

1. **Wait for the user to say "START PHASE 7."** Do not start Phase 7 implementation on your own initiative.
2. When authorized: read `docs/05-DEVELOPMENT-PLAN.md`'s Phase 7 section in full (Prescriptions — medicine search against inventory, prescription creation, PDF generation via Puppeteer, doctor signature overlay, `FR-RX-001..003` — but re-read the actual doc, don't trust this paraphrase), `docs/12-QUALITY-PROTOCOL.md` again, and `docs/07-RBAC-MATRIX.md` §3.5.
3. Check `docs/11-DECISIONS.md` for anything already decided relevant to prescriptions before writing code (e.g. `D-012`/`D-015` on file storage — a prescription PDF is a file too).
4. Follow the same phase discipline as every prior phase: implement → typecheck → lint → e2e (native, then Docker) → mandatory negative/RBAC/cross-tenant adversarial testing (this is where every real bug across all 6 phases so far has actually been found — never skip it to save time) → root-cause any failure → re-verify → write `docs/phase-reviews/PHASE-7-REVIEW.md` (§23 format) → update `docs/08-API-CONTRACT.md`/`docs/11-DECISIONS.md`/`CLAUDE.md` as needed → commit → **stop and wait for "START PHASE 8."**
5. Before writing Puppeteer PDF-generation code, check whether the Docker image needs a Chromium dependency added (`infrastructure/docker/Dockerfile.backend`) — this is exactly the kind of environment gap that's easy to discover only at `docker compose build` time if not checked up front.

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

# LocalStack (dev/test S3) — new this phase, needed for any EMR attachment work
docker compose up -d localstack    # brings up the local S3-compatible endpoint
# S3Service self-provisions the bucket on boot when S3_ENDPOINT is set — no manual step needed

# Prisma (from apps/backend, needs .env vars — use the dotenv wrapper)
pnpm exec dotenv -e ../../.env -- prisma migrate dev      # new migration
pnpm exec dotenv -e ../../.env -- prisma migrate reset --force --skip-seed && pnpm run db:seed
```

### Gotchas (cumulative — see `CLAUDE.md` "Monorepo conventions" for the canonical, maintained list; highlights only below)

- `dotenv` as a bare CLI command is not on PATH — always `pnpm exec dotenv ...`.
- Backend's dev script is `pnpm run dev`, not `start:dev`.
- Windows file-locking: a running backend process (native `nest start --watch`, or a leftover jest process) can hold the Prisma query engine `.dll.node` locked, causing `EPERM` on `prisma generate`/`migrate`. Find it via `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId,CommandLine` (more reliable than `netstat`/`tasklist` alone when many unrelated node processes are running) and kill it.
- `@medcore/types` is consumed as compiled JS — edit `packages/types/src/*` → `pnpm --filter=@medcore/types run build` before the change is visible anywhere.
- Docker bakes `packages/` in at image build time but bind-mounts `apps/*/src/` for hot reload in dev — on Windows specifically, native fs-watch events from a bind mount don't reliably propagate into the container — rebuild/recreate to be sure.
- Global `ValidationPipe` (`whitelist`/`forbidNonWhitelisted`/`transform`) means: never bind the same query object twice via separate `@Query()` decorators; every new e2e spec booting a real HTTP app must call `configureApp(app)`.
- Postgres `EXCLUDE USING gist` violations under true concurrency can surface as deadlock (`40P01`), not just the exclusion violation (`23P01`) — catch both.
- **New this phase:** `@aws-sdk/client-s3`'s default checksum behavior breaks every pre-signed upload URL — construct the client with `requestChecksumCalculation: "WHEN_REQUIRED"`.
- **New this phase:** EMR e2e tests (and any future attachment-touching code) need `docker compose up -d localstack` running first.

### Key file locations

- Phase/quality process: `CLAUDE.md`, `docs/05-DEVELOPMENT-PLAN.md`, `docs/12-QUALITY-PROTOCOL.md`, `docs/phase-reviews/PHASE-X-REVIEW.md`
- Scope/architecture: `docs/01-PRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/11-DECISIONS.md`
- RBAC spec: `docs/07-RBAC-MATRIX.md`
- API index: `docs/08-API-CONTRACT.md`
- Backend source: `apps/backend/src/` — one module directory per domain (`auth/`, `hospitals/`, `users/`, `doctors/`, `patients/`, `appointments/`, `emr/`, `queue/`, plus `common/` for cross-cutting concerns including the new `crypto/`/`storage/` infra)
- Prisma schema + migrations + seed: `apps/backend/prisma/`
- e2e tests: `apps/backend/test/*.e2e-spec.ts`
- Shared types: `packages/types/src/`

---

## Verification Status

| Check | Status | Notes |
| --- | --- | --- |
| Git | PASS | Working tree clean except this handoff and the Phase 6 changes about to be committed |
| Lint | PASS | Zero errors/warnings, backend |
| Typecheck | PASS | Zero errors, backend |
| Unit tests | NOT APPLICABLE | No dedicated unit-test suite exists yet project-wide (unchanged since Phase 4/5) |
| Integration/e2e tests | PASS | 94/94, 8/8 suites |
| Component tests | NOT APPLICABLE | No frontend work this session |
| Build | PASS | `docker compose build api` succeeded, twice |
| DB migrations | PASS | One new migration (`diagnosisNotes`), applied and verified |
| Docker | PASS | `api`/`postgres`/`redis`/`localstack` all up and healthy, verified via `/health` after rebuild |
| Security review | PASS | RBAC-matrix-vs-code line-by-line check for every EMR role, cross-tenant isolation, encryption-at-rest verified directly against the DB (not just the API response), file-upload validation, all verified live this session — see `docs/phase-reviews/PHASE-6-REVIEW.md` "Security Review" |

## Current Phase Gate

**Phase 6 — EMR & Clinical Workflow: PASS.** Full detail in `docs/phase-reviews/PHASE-6-REVIEW.md`. All `FR-EMR-001..007` verified; one real schema gap (`FR-EMR-004`) and one real AWS SDK bug found via mandated adversarial/integration testing, both root-caused and fixed; three items of documented, non-blocking limitation explicitly recorded (not silently shipped).

## Important Decisions / Context

- **`D-015`** (new this session, `docs/11-DECISIONS.md`): LocalStack is the dev/test S3 endpoint (`docker-compose.yml`'s new `localstack` service), reached via the AWS SDK's standard `endpoint`/`forcePathStyle` override when `S3_ENDPOINT` is set; unset in production so the same code talks to real AWS S3 (`D-012` unchanged). Chosen over mocking the SDK specifically so the pre-signed-URL contract is genuinely exercised, not just asserted-on — this is what surfaced the checksum bug (see below) that a mocked SDK never would have caught.
- **The `@aws-sdk/client-s3` checksum bug (`requestChecksumCalculation`) is a general SDK-v3 pre-signed-URL gotcha, not a LocalStack artifact** — confirmed against AWS's own SDK documentation. Any future pre-signed-URL usage (e.g. a prescription PDF upload in Phase 7, if that goes through S3 too) needs the same `requestChecksumCalculation: "WHEN_REQUIRED"` client setting, or it will hit the identical failure.
- **`D-008`'s encryption scope is deliberately narrow**: only `MedicalRecord.notesEncrypted` and `MedicalRecordAddendum.noteEncrypted` are encrypted at the application layer. `chiefComplaint`, `presentingSymptoms`, `diagnosisNotes` (new this phase), `confirmedDiagnosisIcd10`, and `treatmentPlan` remain plaintext columns — this was already the Phase 2 schema's design, not a new decision made this phase, but worth being explicit about since it would be easy to assume "clinical notes are encrypted" means all of these fields are.
- **Append-only for `MedicalRecord`/addenda is enforced by the absence of an update/delete endpoint, not a database-level trigger.** If a future phase ever needs a bulk-correction/admin-override path for a genuinely erroneous encounter, that needs a deliberate design decision (probably a new addendum type or a superseding-record pattern), not a quiet `PATCH` added to the existing controller.
