# Phase 6 Review — EMR & Clinical Workflow

## Phase

Phase 6 of 17 — `docs/05-DEVELOPMENT-PLAN.md`. Depends on Phase 5 (Appointments), gated PASS.

## Objective

Deliver `FR-EMR-001..007`: encounter creation tied to an appointment's start, vitals capture with server-computed BMI, free-text-plus-ICD-10 diagnosis, append-only clinical addenda, patient-level allergy/vaccination/family-history records that persist across encounters, and clinical file attachments mediated by short-lived pre-signed S3 URLs — all under the RBAC restriction that only a Doctor/Nurse (own hospital) or the Patient themself has any access to clinical notes at all.

## Implemented

- `MedicalRecordsService`/`MedicalRecordsController` (`apps/backend/src/emr/`): `POST /medical-records` (encounter creation, gated on the appointment being `IN_PROGRESS` and the caller being that appointment's own doctor), `GET /medical-records/:patientId` (paginated list), `GET /medical-records/by-id/:id` (single encounter with vitals/addenda/attachments), `POST /medical-records/:id/addenda`, `POST /medical-records/:id/vitals`, `POST /medical-records/:id/attachments`, `GET /medical-records/:id/attachments/:attachmentId/download-url`.
- `PatientClinicalService`/`PatientClinicalController`: `POST`/`GET /patients/:patientId/{allergies,vaccinations,family-history}` — patient-level, not encounter-level, per `FR-EMR-005`.
- `EncryptionService` (`common/crypto/`): AES-256-GCM, applied to `MedicalRecord.notesEncrypted` and `MedicalRecordAddendum.noteEncrypted` per `D-008`. Every API response decrypts these for an already-authorized caller; raw ciphertext bytes never leave the service layer.
- `S3Service` (`common/storage/`): builds a per-attachment object key, issues pre-signed `PutObject`/`GetObject` URLs (5 min TTL), self-provisions the dev/test bucket against LocalStack only.
- `attachment-validation.ts`: MIME-type-and-extension allow-list (JPEG/PNG/PDF/DOC/DOCX) plus a 20 MB cap, enforced server-side before any pre-signed URL is issued (`SEC-FILE-001/002`).
- Server-computed BMI in `recordVitals` — the DTO has no `bmi` field at all, so the global `ValidationPipe({forbidNonWhitelisted: true})` rejects a client-supplied `bmi` outright (`FR-EMR-003`).
- `docker-compose.yml` gains a `localstack` service; `.env`/`.env.example` gain `ENCRYPTION_KEY`, `S3_ENDPOINT`, and LocalStack-ready default AWS credentials (`D-015`).

## Requirements Verified

| ID | Status | Notes |
| --- | --- | --- |
| `FR-EMR-001` | PASS | Encounter creation requires the appointment to be `IN_PROGRESS` and the caller to be its own doctor; unique on `appointmentId` (pre-check + DB unique constraint) |
| `FR-EMR-002` | PASS | No update/delete endpoint exists for `MedicalRecord`'s core fields or for an addendum — append-only by omission, not by a DB trigger; addenda accumulate and are attributed to `authorUserId` + `createdAt` |
| `FR-EMR-003` | PASS | BMI computed server-side from `heightCm`/`weightKg`; `bmi` is not a DTO field, so whitelist validation rejects a client-supplied value |
| `FR-EMR-004` | PASS (gap-fixed this phase) | `MedicalRecord.diagnosisNotes` (free text) added alongside the existing `confirmedDiagnosisIcd10` array — see Bugs Found #1 |
| `FR-EMR-005` | PASS | `Allergy`/`VaccinationRecord`/`FamilyHistoryFlag` keyed off `PatientProfile.id`, independent of any specific encounter |
| `FR-EMR-006` | PASS | 20 MB cap, MIME+extension allow-list, private S3 bucket, pre-signed PUT/GET URLs only — verified end-to-end against real S3 protocol semantics via LocalStack (actual bytes uploaded and downloaded round-trip correctly) |
| `FR-EMR-007` | PASS | Doctor/Nurse (own hospital) and Patient (self only) are the only roles with any read access; Receptionist/Lab/Pharmacist/Accountant get `403 FORBIDDEN_ROLE` on every EMR route |

## Files/Modules Changed

- `apps/backend/prisma/schema.prisma` — added `MedicalRecord.diagnosisNotes`; migration `20260923185931_add_medical_record_diagnosis_notes`.
- `apps/backend/src/emr/` — new module: `emr.module.ts`, `medical-records.{controller,service}.ts`, `patient-clinical.{controller,service}.ts`, `attachment-validation.ts`, `dto/*` (7 DTOs).
- `apps/backend/src/common/crypto/encryption.service.ts`, `apps/backend/src/common/storage/s3.service.ts` — new.
- `apps/backend/src/app.module.ts` — registered `EmrModule`.
- `apps/backend/src/config/env.validation.ts` — added `ENCRYPTION_KEY`, `AWS_*`, `S3_ENDPOINT`.
- `apps/backend/package.json` — added `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- `apps/backend/test/medical-records.e2e-spec.ts` — new, 28 tests.
- `docker-compose.yml` — new `localstack` service; `api` depends on it and gets a container-network `S3_ENDPOINT`.
- `.env`, `.env.example` — new Phase 6 variables.
- `docs/06-DATABASE-DESIGN.md`, `docs/08-API-CONTRACT.md`, `docs/11-DECISIONS.md` (`D-015`), `CLAUDE.md` — updated (see Documentation Updated).

## Tests Executed

- `pnpm exec tsc --noEmit -p tsconfig.eslint.json` (backend)
- `pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` (backend)
- `pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json` — full suite, all 8 specs
- `docker compose build api` + `docker compose up -d api` + `GET /health`

## Test Results

- Typecheck: **PASS**, clean.
- Lint: **PASS**, zero errors/warnings.
- Full e2e suite: **PASS**, 94/94 tests, 8/8 suites (66 pre-existing + 28 new `medical-records.e2e-spec.ts`), rerun clean after clearing the auth rate-limiter's Redis throttle keys between repeated local runs (documented gotcha, not a regression).
- Docker: **PASS** — `docker compose build api` succeeds; container boots healthy (`{"status":"ok"}` from `/health`) with `EmrModule` registered and the env-validated `ENCRYPTION_KEY`/S3 config in place.

## Security Review

- **Encryption at rest (`SEC-DATA-*`, `D-008`):** verified directly against the database, not just the API response — `MedicalRecord.notesEncrypted` and `MedicalRecordAddendum.noteEncrypted` are confirmed to be `Buffer`s whose UTF-8 decoding does **not** contain the original plaintext substring, while the API response correctly decrypts them for an authorized caller.
- **RBAC (`FR-EMR-007`, `09-SECURITY.md`):** every EMR route tested against all 9 roles at least once; Receptionist/Lab Technician/Pharmacist/Accountant get `403` on every clinical-notes route, matching the matrix's explicit "no direct read access" callout.
- **Tenancy isolation (`03-ARCHITECTURE.md` §5):** cross-tenant doctor reads get `404` (not `403`, per the Information Disclosure Rule) for a medical record, an attachment download URL, and a patient's allergy list/creation attempt — verified for all three.
- **File upload (`SEC-FILE-001/002/003`):** a MIME-type-vs-extension mismatch (`image/png` claimed for `malware.exe`) is rejected; an over-cap file is rejected; the bucket is private and every access is a short-lived (5 min) pre-signed URL generated per request — verified by actually PUTting and GETting real bytes through LocalStack's S3 API, not by asserting on mocked SDK calls.
- **Append-only enforcement (`FR-EMR-002`):** no endpoint exists to mutate a `MedicalRecord`'s core fields or an existing addendum; verified indirectly by confirming addenda accumulate (two addenda from two different authorized callers both persist) rather than any one of them overwriting the record.

## UI/UX Review

Not applicable — Phase 6 is backend-only (no frontend screens exist yet for any module as of this phase; frontend work begins in a later phase per the development plan's phase grouping).

## Bugs Found

1. **Schema/requirement gap: `FR-EMR-004` ("Diagnosis fields support free text plus an optional ICD-10 code array") was only half-satisfied by the Phase 2 schema** — `MedicalRecord.confirmedDiagnosisIcd10` (the code array) existed, but no free-text diagnosis field did. Identified during the requirements-vs-schema cross-check mandated by the source-of-truth hierarchy (brief → docs → repo) before writing service code. **Fixed** by adding `MedicalRecord.diagnosisNotes String?` (plaintext, consistent with the already-plaintext `chiefComplaint`/`presentingSymptoms`/`treatmentPlan` — `D-008`'s encryption scope is `notesEncrypted`/addendum bodies specifically, not every clinical field) in the same migration.
2. **`@aws-sdk/client-s3`'s default `requestChecksumCalculation` breaks every pre-signed upload URL it issues** — the SDK signs an `x-amz-checksum-crc32` requirement into the URL, but nothing ever computes/sends that checksum for a body uploaded later by a client the SDK never sees, so LocalStack (and real AWS S3, per AWS's own documented behavior) rejects the upload with `400 InvalidRequest`. Found while debugging the first failing attachment-upload e2e run. **Fixed** by setting `requestChecksumCalculation: "WHEN_REQUIRED"` on the `S3Client`; re-verified with a direct Node script against LocalStack before re-running the full e2e suite.
3. **Test-authoring bug, not a service bug:** the first e2e spec draft created every test appointment for the same doctor at an identical fixed time offset, tripping the Phase 5 `no_doctor_overlap` exclusion constraint on the second and subsequent `beforeAll`-adjacent appointment creations. **Fixed** by staggering each test appointment's time window.
4. **Requirement-vs-doc mismatch found while writing the e2e spec:** `docs/10-TESTING-STRATEGY.md` §3 mandatory scenario #2 ("a patient cannot view another patient's medical records") expects `403`/`404`, but the first implementation of `GET /medical-records/:patientId` for a mismatched Patient caller returned `200` with an empty list (mirroring `PatientsService.findAll`'s whole-directory-listing precedent). Since this route is parameterized by one specific `patientId` rather than being a role-scoped directory, the brief-derived mandatory scenario's literal expectation takes precedence. **Fixed** by changing the mismatch case to throw `404 NOT_FOUND`; `08-API-CONTRACT.md` documents the distinction explicitly so a future phase doesn't "fix" it back the other way.

## Fixes Applied

All four items above were root-caused and fixed in this session, not worked around; re-verified via a full e2e re-run (94/94) after each fix, not just the directly affected test.

## Regression Checks

- Full e2e suite re-run after every fix in this phase (not just the EMR spec) — 94/94 passing, no regressions in auth/tenancy/directory/appointments/audit-log coverage from Phases 1–5.
- Docker containerized build re-verified after the final code change (the `findByPatient` 404-vs-empty-list fix), not just the native path.

## Known Minor Issues

- Lab Technician's 🟡 "lab reports only" attachment-upload access (`AttachmentOwnerType.LAB_RESULT`) is out of scope this phase — there is no lab order/result to attach to yet. `POST /medical-records/:id/attachments` is `MEDICAL_RECORD`-owned only; Phase 8 will need its own attachment route (or an owner-type parameter) when `LabOrder`/`LabResult` are wired up.
- Nurse's narrower "notes only" (addenda) and "vitals-adjacent only" (allergy/vaccination/family-history) restrictions from the RBAC matrix's 🟡 annotations are simplified to full Doctor-equivalent access for these actions, matching the same kind of documented simplification already established in Phase 4 (`PatientsService`'s `DIRECTORY_ROLES` comment) — there is no structured sub-field to restrict a Nurse's addendum content to "notes only" versus a Doctor's, since both write the same free-text field.
- `POST /medical-records/:id/attachments` requires the caller to declare `sizeBytes` up front (pre-signed-URL upload never streams through the API to be measured server-side) — a client could under-report size and upload a larger file than declared; real AWS S3 supports a `content-length-range` POST-policy condition for this, which pre-signed `PutObjectCommand` URLs (the approach used here) do not enforce as strictly. Accepted as a known limitation of the pre-signed-PUT pattern the architecture doc specifies, not fixed this phase — flagged for the Phase 15 security hardening pass.

## Technical Debt

- Seed data for `MedicalRecord`/`Vitals`/`Allergy`/etc. was not added to `prisma/seed.ts` — consistent with Phase 5, which also left appointment seed data unimplemented (`docs/06-DATABASE-DESIGN.md` §5's "two weeks of realistic ... history" goal remains unimplemented project-wide, not newly deferred by this phase).
- `SEC-FILE-004` (ClamAV malware scanning of uploads) remains explicitly deferred to Phase 15/16 per its own documented risk acceptance — unaffected by this phase.

## Documentation Updated

- `docs/06-DATABASE-DESIGN.md` — `diagnosisNotes` added to the `MEDICAL_RECORD` entity table.
- `docs/08-API-CONTRACT.md` §4.5 — full Phase 6 endpoint list (previously only a partial sketch), including the two endpoints not in the original index (`GET /medical-records/by-id/:id`, `GET .../attachments/:attachmentId/download-url`) and the patient-level allergy/vaccination/family-history routes.
- `docs/11-DECISIONS.md` — `D-015` (LocalStack as the dev/test S3 endpoint).
- `CLAUDE.md` — two new "Monorepo conventions" entries (the AWS SDK checksum gotcha, the LocalStack dependency for EMR e2e tests).

## Final Gate

**Phase 6 — EMR & Clinical Workflow: PASS.** All `FR-EMR-001..007` implemented and verified; the one Phase 2 schema gap found against the SRS was root-caused and fixed in the same change, not worked around; RBAC/tenancy/encryption/file-upload security reviewed and verified live (not just claimed); no known critical or high-severity defect remains open. Two items are documented, accepted, non-blocking limitations (Known Minor Issues above), and one item of pre-existing technical debt (seed data) is carried forward, not newly introduced.
