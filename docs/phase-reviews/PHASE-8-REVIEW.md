# Phase 8 Review — Laboratory

## Phase

Phase 8 of 17 — `docs/05-DEVELOPMENT-PLAN.md`. Depends on Phase 6 (EMR), gated PASS.

## Objective

Deliver `FR-LAB-001..005`: lab order creation against the hospital's test catalog tied to one `MedicalRecord` and issued by that encounter's own doctor; a collection/processing status lifecycle (`ORDERED → SAMPLE_COLLECTED → IN_PROGRESS → RESULT_UPLOADED → APPROVED/REJECTED`) attributed per transition; structured result entry compared against gender/age-banded reference ranges to compute an automatic out-of-range flag; four-eyes approval (approver must differ from the enterer) gating result visibility from patient/doctor until approved; and a notification fan-out to both patient and doctor on approval.

## Implemented

- `LabModule` (`apps/backend/src/lab/`): `POST /lab-orders`, `PATCH /lab-orders/:id/items/:itemId/status`, `PATCH /lab-orders/:id/items/:itemId/result`, `PATCH /lab-orders/:id/items/:itemId/approve`, `GET /lab-orders/:id`.
- Order creation gated on "own encounter" (caller must be `medicalRecord.doctor`), every `labTestId` verified against the caller's hospital catalog before creation — same shape as Phase 6/7's medical-record/prescription creation checks.
- Status-transition state machine (`lab-reference-range.util.ts`'s sibling table in `lab.service.ts`) restricted per `docs/07-RBAC-MATRIX.md` §3.6: Receptionist can only collect a sample (`ORDERED→SAMPLE_COLLECTED`); Lab Technician can additionally advance `SAMPLE_COLLECTED→IN_PROGRESS`. `RESULT_UPLOADED`/`APPROVED`/`REJECTED` are never accepted through this endpoint — only through `/result` and `/approve`.
- Structured result entry: a `LabOrderItem` must be `IN_PROGRESS`; the entered value is compared against the best-matching `LabTestReferenceRange` (preferring a gender-specific, age-banded match over `ANY`/unbounded) via `selectReferenceRange`/`computeFlag` in `lab-reference-range.util.ts`, producing a `NORMAL`/`LOW`/`HIGH`/`NO_REFERENCE_RANGE` flag per value and an overall `isOutOfRange` boolean. An optional `reportFile` metadata object returns a pre-signed S3 `uploadUrl`, storing the key on `LabResult.reportFileUrl` (never returned raw — always via a fresh pre-signed `downloadUrl`, `SEC-FILE-003`).
- Four-eyes approval/rejection: `PATCH .../approve` requires the item be `RESULT_UPLOADED`, rejects the enterer approving their own result (`403`), and accepts `{decision: "APPROVED"|"REJECTED", notes?}`. `APPROVED` triggers `LabService.notifyResultApproved`, persisting a `Notification` row for the ordering doctor and, when the patient has a linked portal account, the patient too.
- `GET /lab-orders/:id` result-visibility gating (`docs/11-DECISIONS.md` D-021): the order/item statuses are always visible to any authorized "own hospital"/"self" caller; each item's `result` payload is `null` until visible to that specific role (Lab Technician: always; Doctor/Nurse: once `APPROVED` or `REJECTED`; Patient: once `APPROVED` only).
- `packages/types/src/enums.ts`: added `LabResultFlag`, `LabResultDecision` (as-const object + derived union pattern, per CLAUDE.md's real-enum ban).

## Requirements Verified

| ID | Status | Notes |
| --- | --- | --- |
| `FR-LAB-001` | PASS | Order requires an existing `MedicalRecord`; caller must be that record's own doctor (404 for a same-hospital different doctor and for a cross-tenant doctor); every `labTestId` verified against the hospital catalog |
| `FR-LAB-002` | PASS | Status lifecycle enforced server-side per role; invalid/out-of-order transitions (e.g. skipping straight to `IN_PROGRESS`, or Receptionist attempting `SAMPLE_COLLECTED→IN_PROGRESS`) rejected `400` |
| `FR-LAB-003` | PASS | Structured value stored with a computed flag; verified for an in-range value (`NORMAL`), a below-range value (`LOW`, `isOutOfRange: true`), and a test with no reference range (`NO_REFERENCE_RANGE`, never flagged out-of-range) |
| `FR-LAB-004` | PASS | Approval requires `RESULT_UPLOADED`; same-user four-eyes violation rejected `403`; a different Lab Technician can approve or reject |
| `FR-LAB-005` | PASS (scoped, D-020) | Approval persists a real `Notification` row per resolvable recipient (doctor + patient-with-portal-account), verified via direct DB query; full multi-channel dispatch (email/SMS/push workers, event bus) is Phase 11 scope per `docs/03-ARCHITECTURE.md` §7/§12 and was never claimed as built |

## Files/Modules Changed

- `packages/types/src/enums.ts` — added `LabResultFlag`, `LabResultDecision`.
- `apps/backend/src/lab/` — new module: `lab.module.ts`, `lab.controller.ts`, `lab.service.ts`, `lab-reference-range.util.ts`, `dto/create-lab-order.dto.ts`, `dto/create-lab-order-item.dto.ts`, `dto/update-lab-order-item-status.dto.ts`, `dto/enter-lab-result.dto.ts`, `dto/lab-result-value.dto.ts`, `dto/report-file-meta.dto.ts`, `dto/approve-lab-result.dto.ts`.
- `apps/backend/src/app.module.ts` — registered `LabModule`.
- `apps/backend/test/lab.e2e-spec.ts` — new, 28 tests.
- `docs/08-API-CONTRACT.md` §4.5/§4.7 — Phase 8 endpoint table filled in with the actual implemented request/response shape; the Phase 6 EMR note about `AttachmentOwnerType.LAB_RESULT` updated to point at the resolution (D-019).
- `docs/11-DECISIONS.md` — `D-018` (single structured value per item), `D-019` (`reportFileUrl` direct field vs. unused `AttachmentOwnerType.LAB_RESULT`), `D-020` (notification-row-only FR-LAB-005 scope), `D-021` (per-item result-visibility interpretation).

No `schema.prisma` changes were needed — `LabTest`/`LabTestReferenceRange`/`LabOrder`/`LabOrderItem`/`LabResult`/`Notification` were all already modeled since Phase 2 and already registered correctly in the tenant-scoping and audit-log Prisma extensions (`LabOrder`/`LabTest`/`Notification` in `TENANT_SCOPED_MODELS`; `LabTest`/`LabOrder`/`LabOrderItem`/`LabResult` in `AUDITED_MODELS`) — verified rather than assumed, per the "check the schema before assuming a gap" discipline from prior phases.

## Tests Executed

- `pnpm exec tsc --noEmit -p tsconfig.eslint.json` (backend)
- `pnpm exec eslint "{src,test,prisma}/**/*.ts" --max-warnings=0` (backend)
- `pnpm exec dotenv -e ../../.env -o -- jest --config ./test/jest-e2e.json` — full suite, all 10 specs
- `docker compose build api` + `docker compose up -d api`, then a live smoke request (login as a seeded Hospital Admin, `POST /lab-orders`) against the running container to confirm the route is actually registered and RBAC-enforced inside the built image, not just natively; container logs checked for unexpected errors

## Test Results

- Typecheck: **PASS**, clean.
- Lint: **PASS**, zero errors/warnings.
- Full e2e suite: **PASS**, 140/140 tests, 10/10 suites (112 pre-existing + 28 new `lab.e2e-spec.ts`), no regressions.
- Docker: **PASS** — image builds; container boots healthy; live smoke request against the running container returned the expected `403 FORBIDDEN_ROLE` for a Hospital Admin calling `POST /lab-orders` (Doctor-only), confirming the module is wired up correctly inside the built image. No new native/binary dependency was introduced this phase, so the deeper in-container functional check from Phase 7's Puppeteer bug (D-016) doesn't apply here.

## Security Review

- **RBAC (`07-RBAC-MATRIX.md` §3.6):** every lab route tested against every non-permitted role at least once (order creation: Doctor-only; status update: Receptionist/Lab Technician only; result entry/approval: Lab Technician only; view: Doctor/Nurse/Lab Technician/Patient only, Receptionist/Pharmacist/Accountant/Hospital Admin denied `403`).
- **Tenancy isolation:** a cross-tenant doctor gets `404` creating an order against another hospital's medical record or viewing another hospital's order; a same-hospital Lab Technician acting on a random (standing in for cross-tenant) order id gets `404` on status update — the tenant-scoping extension makes a foreign-hospital id indistinguishable from a nonexistent one, verified directly.
- **Four-eyes (`FR-LAB-004`):** explicitly negative-tested — the same Lab Technician who entered a result is rejected (`403`) attempting to approve or reject it; a different technician succeeds. This was called out in the Phase 7 handoff as "easy to get subtly wrong" and was written test-first.
- **Result confidentiality pre-approval:** explicitly verified that Doctor/Nurse/Patient all receive `result: null` for a non-approved item (not merely "the whole order 404s," which would have been a weaker, easier-to-get-right check) — and that a `REJECTED` item is visible to Doctor/Nurse (operationally necessary) but stays hidden from Patient (D-021).
- **File handling (`SEC-FILE-001/002/003`):** the optional lab-report file reuses `validateAttachment` (MIME+extension allow-list, size cap) and the same pre-signed-upload/pre-signed-download pattern as EMR attachments and prescription PDFs — the raw `reportFileUrl` storage key is never present in any API response, only a freshly-issued `downloadUrl`.
- **Input validation:** `EnterLabResultDto.values` is enforced server-side (via class-validator) to be exactly one entry — both zero-length and two-length arrays verified rejected `400` — closing off the silent-mis-range-application risk described in D-018 before it could ever reach the service layer.

## UI/UX Review

Not applicable — Phase 8 is backend-only, consistent with every phase so far (frontend work has not started).

## Bugs Found

No defects were found in already-existing code this phase (unlike Phases 4–7, which each found a real pre-existing gap). The schema, tenant-scoping extension, and audit-log extension were all already correctly set up for the Lab domain since Phase 2 — verified explicitly rather than assumed, but nothing needed fixing. Three genuine design ambiguities were identified and resolved (not "bugs," since nothing was implemented incorrectly against a spec — the spec itself was underspecified in these three places):

1. **`LabTestReferenceRange` has no `parameter` column**, so a multi-value `structuredValues` array (as the ER diagram's shape suggests) could not be range-checked correctly per-parameter. Resolved via D-018: restrict to exactly one structured value per item, matching every seeded `LabTest`.
2. **`AttachmentOwnerType.LAB_RESULT` has no matching FK on `Attachment`** (only `medicalRecordId` exists), so the Phase 6 breadcrumb suggesting Phase 8 "wires up" that enum member would have required its own schema change. Resolved via D-019: use `LabResult.reportFileUrl` directly, the field the database design's own hybrid-result rationale actually describes.
3. **`docs/07-RBAC-MATRIX.md` §3.6's "View result" row, read literally, would 404 the entire `GET /lab-orders/:id` endpoint for Doctor/Nurse/Patient until every item is approved** — leaving the ordering doctor with no way to track an in-flight order. Resolved via D-021: gate the result payload per-item, not the endpoint as a whole.

## Fixes Applied

Not applicable in the "bug fix" sense — see Bugs Found above; all three items were design-ambiguity resolutions, documented in `docs/11-DECISIONS.md` D-018/D-019/D-021, not corrections to broken code.

## Regression Checks

Full e2e suite re-run after implementation — 140/140 passing (112 pre-existing across Phases 3–7 + 28 new), no regressions in auth/tenancy/directory/appointments/EMR/prescriptions coverage. Docker containerized build and boot re-verified with a live smoke request against the running container.

## Known Minor Issues

- `EnterLabResultDto.values` accepts exactly one structured value (D-018) — a genuine multi-analyte panel (e.g. a CBC with several components) is out of scope until `LabTestReferenceRange` gains a `parameter` column. Nothing in the current catalog or `FR-LAB` text needs this yet.
- There is no `GET /notifications/me` endpoint yet — Phase 8's `Notification` rows (FR-LAB-005) are real and queryable in the database but not yet retrievable through any API; that endpoint is Phase 11 scope alongside the rest of the notification-delivery infrastructure (D-020).
- A patient with no linked portal account (`PatientProfile.userId` null — a front-desk-registered patient, per Phase 4's design) receives no lab-approval `Notification` row, since there is no `User` to attach one to. This is an inherent consequence of that Phase 4 design choice, not a Phase 8 defect, and only ever silently skips the patient side — the doctor is still always notified.

## Technical Debt

- No seed data for `LabOrder`/`LabOrderItem`/`LabResult` was added to `prisma/seed.ts` — consistent with the same pre-existing gap pattern already carried forward from Phases 5–7 for `Appointment`/`Prescription` write-side seed data.
- `lab.service.ts`'s `findOne` computes a pre-signed S3 `downloadUrl` per visible item inside a `Promise.all` — fine at the per-order item counts this project's scope implies, but would need batching if a future phase ever needs a paginated list of many orders each with report files (no such endpoint exists yet, so this is speculative, not an active problem).

## Documentation Updated

- `docs/08-API-CONTRACT.md` §4.5 (EMR attachment note) and §4.7 (full Phase 8 endpoint table with actual implemented shape).
- `docs/11-DECISIONS.md` — `D-018` (single structured value per item), `D-019` (`reportFileUrl` vs. unused `AttachmentOwnerType.LAB_RESULT`), `D-020` (notification scope), `D-021` (result-visibility interpretation).

## Final Gate

**Phase 8 — Laboratory: PASS.** All `FR-LAB-001..005` implemented and verified, including the four-eyes negative path and the reference-range out-of-range computation across in-range/out-of-range/no-range cases; no known critical or high-severity defect remains open. Three design ambiguities in the pre-existing schema/docs were identified and resolved with documented rationale (Decisions D-018/D-019/D-021) rather than silently guessed at or left inconsistent. FR-LAB-005's notification scope is deliberately partial (row-persistence only, full dispatch deferred to Phase 11) and explicitly documented as such, not silently under-delivered.
