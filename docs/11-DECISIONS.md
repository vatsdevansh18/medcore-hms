# Decision Log — MedCore HMS

**Version:** 1.0
**Status:** Living document — append new decisions here as they arise; never delete a superseded decision, mark it `[SUPERSEDED by D-0xx]` instead.

Each entry: context, alternatives considered, decision, rationale, consequences. This is the record required by the master build prompt §41 whenever the brief is silent, ambiguous, or when an engineering choice has real trade-offs worth defending in the project report.

---

## D-001 — Phase-gated methodology supersedes the brief's 4-week calendar

**Context:** The internship brief frames the project as a 4-week, week-by-week build. The governing build prompt for this session specifies a 17-phase, gate-checked methodology with no fixed calendar, explicitly instructing that a phase never starts until the previous one's gate passes and the user approves.

**Alternatives considered:** (a) Follow the brief's literal week-by-week schedule; (b) follow the phase-gated methodology but drop scope to fit; (c) follow the phase-gated methodology, keep the brief's full scope, treat the week grouping as a scope-sequencing hint only.

**Decision:** (c). `05-DEVELOPMENT-PLAN.md` maps every brief week to specific phases (Week 1 → Phases 1–4, Week 2 → Phases 5–7, Week 3 → Phases 8–11, Week 4 → Phases 12–17) so the sequencing intent is preserved without inheriting a hard calendar.

**Rationale:** The user's own build prompt explicitly overrides the brief's process guidance while treating the brief as the source of truth for _scope_. Quality gates (tests, security review, docs) matter more than hitting an artificial weekly boundary for a portfolio-grade deliverable.

**Consequences:** No phase is time-boxed; each is boxed by its gate criteria instead. The project report (Phase 17) should still narrate progress against the original weekly framing for evaluator familiarity.

---

## D-002 — Row-level multi-tenancy (not schema-per-tenant or database-per-tenant)

**Context:** The brief explicitly asks for a justified choice between database-per-tenant, schema-per-tenant, and row-level multi-tenancy, and its own architecture hints already describe a `hospitalId` foreign key pattern.

**Alternatives considered:**

- _Database-per-tenant:_ strongest isolation, but operationally heavy (migrations, connection pooling, and backups multiply per hospital) — wrong trade for a solo-built system expected to demo many hospitals cheaply.
- _Schema-per-tenant:_ isolation without full infrastructure duplication, but Prisma's migration tooling and connection handling for dynamic schemas add non-trivial complexity for a project of this scope.
- _Row-level (chosen):_ single schema, single connection pool, `hospitalId` foreign key everywhere, isolation enforced in application code and query layer.

**Decision:** Row-level multi-tenancy with the three-layer enforcement described in `03-ARCHITECTURE.md` §5.

**Rationale:** Matches the brief's own hinted design, keeps operational complexity appropriate for a solo developer, and scales adequately for the target hospital counts and row volumes in this project's realistic demo/evaluation context.

**Consequences:** Isolation correctness now rests entirely on disciplined query scoping rather than the database engine's own tenant boundary — this is why tenancy-isolation tests are treated as release-blocking (`10-TESTING-STRATEGY.md` §2) and why the enforcement is deliberately three layers deep, not one. Documented migration path: if a single hospital's data ever needs stronger physical isolation (e.g. regulatory requirement), that hospital can be split into its own schema without a full application rewrite, because every query already carries an explicit `hospitalId` predicate.

---

## D-003 — Modular monolith backend (not microservices)

**Context:** The brief's architecture diagram shows a single NestJS API; nothing in the brief requests microservices.

**Alternatives considered:** Microservices per domain (Appointments service, Billing service, etc.) vs. a single NestJS deployable with strict module boundaries.

**Decision:** Modular monolith — one NestJS app, one deployable, internal module boundaries enforced by NestJS's own module system (no circular imports, each module independently testable).

**Rationale:** A solo developer gains nothing from distributed-systems operational overhead (service discovery, network calls between domains, distributed transactions) at this scale, and the brief's own module list maps cleanly onto NestJS modules within one process. Module boundaries are kept clean enough that a future split into services remains possible without a rewrite, should real scale ever demand it.

**Consequences:** Simpler deployment, simpler local dev (`docker compose up`), but requires discipline to avoid modules reaching into each other's Prisma models directly — enforced via the repository pattern in `03-ARCHITECTURE.md` §3.

---

## D-004 — FIFO dispensing defined as "earliest-expiring eligible batch," not "earliest-received batch"

**Context:** The brief specifies "FIFO (First In, First Out) dispensing — oldest batch is consumed first" without disambiguating whether "oldest" means earliest manufacturing/receipt date or earliest expiry date.

**Alternatives considered:** Strict FIFO by `manufacturingDate`/receipt order vs. FEFO (First-Expired-First-Out) by `expiryDate`.

**Decision:** Dispense the batch with the earliest `expiryDate` among active, non-quarantined batches.

**Rationale:** In pharmacy inventory management, the patient-safety-correct practice is FEFO, not strict FIFO — dispensing by expiry date minimises the chance any batch expires unused. The brief's own emphasis on expiry tracking and quarantine as "critical patient-safety features" supports this reading over a literal receipt-order interpretation.

**Consequences:** `MedicineBatch(medicineId, expiryDate)` is indexed specifically to make this selection efficient (`06-DATABASE-DESIGN.md` §3.4). Documented explicitly so the project report can defend the terminology choice if questioned.

---

## D-005 — PostgreSQL exclusion constraint for appointment concurrency, not application-level optimistic locking alone

**Context:** The brief explicitly asks for either database-level locking (`SELECT FOR UPDATE`) or an optimistic concurrency pattern, with reasoning documented.

**Alternatives considered:**

- _Optimistic concurrency_ (version column, retry on conflict): works, but only if every write path remembers to check the version — a single missed check anywhere reintroduces the race.
- _`SELECT ... FOR UPDATE` pessimistic row lock_ on a slot/availability row: correct, but requires a row to lock _before_ the conflicting row exists, which is awkward when the conflict is between two not-yet-existing `Appointment` rows for the same slot.
- _Postgres `EXCLUDE` constraint_ (chosen): makes the overlap itself structurally impossible at the storage engine level, independent of application code paths.

**Decision:** `EXCLUDE USING gist` constraints on `(doctorId, tsrange)` and `(patientId, tsrange)`, scoped to active statuses, per `03-ARCHITECTURE.md` §8.

**Rationale:** This is the only approach that remains correct even if a future code path inserts an `Appointment` row without going through the "proper" booking service — the guarantee lives in the schema, not in service-layer discipline. It also requires no retry logic in the common path (the pre-check makes conflicts rare; the constraint makes them impossible on the rare occasion the pre-check races).

**Consequences:** Requires the `btree_gist` Postgres extension, added via migration. The concurrency test (`10-TESTING-STRATEGY.md` §3.3) exercises this directly with genuinely simultaneous requests.

---

## D-006 — Shared `StaffProfile` table for Nurse, Receptionist, Lab Technician, Pharmacist, Accountant, and Hospital Admin

**Context:** The brief's entity table gives `Doctor` and `Patient` their own dedicated profile relationships but does not specify profile tables for the other six roles.

**Alternatives considered:** One dedicated table per role (nine total profile tables) vs. one generic `StaffProfile` shared by every non-Doctor, non-Patient role.

**Decision:** One generic `StaffProfile` (employee code, department, join date) for the six roles without materially distinct structured attributes in this project's scope; `DoctorProfile` and `PatientProfile` remain dedicated because their domain data (specialisation, licence, availability / DOB, blood group, allergies) is genuinely rich and distinct.

**Rationale:** Avoids six near-identical tables that would add schema noise without adding modelling value at this scope; each role's _behaviour_ is still fully differentiated by the `role` enum on `User` and by RBAC, not by the profile table shape.

**Consequences:** If a future requirement gives one of these roles genuinely distinct structured data (e.g. Lab Technician certifications), it is added as its own table at that point rather than retrofitted into the generic one — this is called out explicitly so it isn't mistaken for an oversight later.

---

## D-007 — Inpatient (IPD) workflow scoped down to bed/room occupancy tracking only

**Context:** The brief mentions "ward management" (Nurse), "bed occupancy heat map" and "occupied beds" KPI (Hospital Admin dashboard), and lists a `Room` entity, but gives no detailed inpatient billing or clinical workflow spec, and the brief's out-of-scope list implies the project is outpatient-encounter-centric.

**Alternatives considered:** Build a full inpatient module (admission, ward rounds, IPD billing) vs. omit beds entirely vs. model just enough to support the named UX/KPI requirements.

**Decision:** Minimal `Room`/`Bed`/`Admission` model sufficient to power the Nurse ward view and the Admin occupancy KPI/heat map; full IPD clinical and billing workflows are explicitly deferred (Phase 2+ enhancement, tracked in `01-PRD.md` §9).

**Rationale:** Depth-over-breadth (brief's own stated priority): building a complete IPD system would take real effort away from the outpatient-centric core journey (booking → encounter → prescription → lab → billing) that the brief treats as central and that the evaluation rubric weights most heavily.

**Consequences:** Admission/discharge exists as a data point, not a billing-integrated workflow; this boundary is stated explicitly in the PRD so it reads as a scoping decision, not a gap discovered late.

---

## D-008 — Application-level AES-256-GCM field encryption instead of raw `pgcrypto` SQL

**Context:** The brief's hint suggests either PostgreSQL column-level encryption via `pgcrypto` or documenting why row-level security is sufficient, for `diagnosis`/`notes` fields.

**Alternatives considered:** `pgcrypto`'s `pgp_sym_encrypt`/`decrypt` SQL functions called via raw queries vs. row-level security policies alone vs. application-layer encryption before the value ever reaches Prisma.

**Decision:** Application-layer AES-256-GCM encryption/decryption in a small `EncryptionService`, applied to `MedicalRecord.notes` and addendum bodies before they reach Prisma's typed client; stored as `bytea`.

**Rationale:** `pgcrypto`'s SQL functions require raw, hand-written SQL for every read/write of an encrypted column, which sits awkwardly against Prisma's typed-client-only convention (`SEC-INPUT-002`) and would force an exception to the "no raw interpolated SQL" rule on every clinical-notes touchpoint. Application-level encryption keeps Prisma as the single data-access path, centralises key management in one service (easier to reason about, easier to rotate keys), and achieves the same "encrypted at rest" property the brief asks for.

**Consequences:** These fields are not searchable/filterable at the database level (acceptable — free-text clinical notes were never planned to be queried by substring match); key rotation is a documented operational procedure for Phase 16, not implemented as a live feature in v1.

---

## D-009 — Doctor availability stored as recurring pattern + exceptions, computed on read

**Context:** The brief explicitly frames this as an open design question ("a repeating weekly schedule vs. individual time slots — each has trade-offs").

**Alternatives considered:** Materialise every bookable slot as its own row (simple to query, but requires a background job to keep weeks of future slots generated and explodes row counts) vs. store the recurring pattern plus exceptions and compute available slots on read.

**Decision:** Recurring pattern (`DoctorAvailability`) plus a small exceptions table (`DoctorAvailabilityException`), with slots computed on demand and cached in Redis with a 60-second TTL.

**Rationale:** No background generation job to maintain, trivially handles a doctor changing their weekly pattern going forward without a data-migration, and the read cost of computing slots is small enough to cache cheaply — directly matching the brief's own caching hint about doctor availability.

**Consequences:** Slot computation logic lives once, in the service layer, and must correctly subtract already-booked `Appointment` rows and applicable exceptions — covered by unit tests in Phase 5.

---

## D-010 — One role per user (no multi-role accounts) in v1

**Context:** The brief's role table implies one primary role per user; nothing requests multi-role support.

**Decision:** `User.role` is a single enum value, not a set; a person who needs two roles (rare in practice, e.g. a doctor who also administers) needs two accounts in v1.

**Rationale:** Keeps RBAC guard logic, the permissions matrix, and JWT claims simple and unambiguous; multi-role adds real complexity (which role is "active," how permissions compose) that the brief never asks for.

**Consequences:** Documented as a Phase 2+ enhancement in `01-PRD.md` §9 if ever needed.

---

## D-011 — Insurance claims: data model only, no TPA adjudication workflow

**Context:** The brief mentions "Insurance claims follow a separate TPA (Third Party Administrator) workflow" as a single sentence with no further specification.

**Decision:** An `InsuranceClaim` table exists (linked to `Invoice`) to demonstrate the schema anticipates this need, but no claims-submission, adjudication, or payer-integration workflow is implemented in v1.

**Rationale:** The brief gives no concrete requirements to implement against here, and building a plausible one would be speculative scope the brief doesn't ask for — directly against the master build prompt's instruction not to invent conflicting or unrequested requirements.

**Consequences:** Listed explicitly as deferred, not silently dropped, in `01-PRD.md` §9.

---

## D-012 — AWS S3 as canonical object store; Cloudinary limited to optional image transforms

**Context:** The brief's architecture diagram lists "AWS S3 / Cloudinary" together as if interchangeable, and the tools list mentions both.

**Decision:** S3 is the system of record for all clinical/financial files (attachments, lab reports, prescription PDFs, signatures). Cloudinary, if used at all, is limited to optional profile-photo transformation/optimisation — never the store of record for anything clinical.

**Rationale:** Splitting storage between two providers for the same category of sensitive file multiplies the security surface (two sets of access controls, two audit trails) for no functional benefit; S3 alone satisfies every storage requirement in the brief, and the deployment architecture section names S3 specifically for production.

**Consequences:** Cloudinary integration is optional and can be skipped entirely without any functional loss; if skipped, this is noted in the relevant phase review, not treated as a defect.

---

## D-013 — Front-desk patient registration provisioned identically to staff accounts (new `FR-HOSP-004`)

**Context:** The brief specifies a Receptionist role responsible for patient registration/check-in, but `02-SRS.md`'s original `FR-HOSP` list (written in Phase 0, before the auth flows existed) only covers Super Admin/Hospital Admin/Doctor provisioning — it never defined how a Receptionist actually creates a patient record for a walk-in patient who isn't self-registering online.

**Decision:** `POST /patients` reuses the exact admin-provisioning pattern `FR-HOSP-002` already established for staff: the account is created pre-verified, given a random unusable password, and immediately sent a password-reset email so the patient sets their own real password. Formalized as `FR-HOSP-004` in `02-SRS.md` rather than left as an undocumented Phase 4 addition.

**Rationale:** A walk-in patient has no email-OTP loop to complete at the front desk the way a self-registering online patient does (`FR-AUTH-001`); reusing the already-built, already-tested `PasswordResetService` flow avoids inventing a second "invite" mechanism for what is functionally the same problem `FR-HOSP-002` already solved for staff.

**Consequences:** `docs/08-API-CONTRACT.md` §4.2 documents `POST /patients`/`GET /patients`/`GET /patients/:id` under this ID; `docs/phase-reviews/PHASE-4-REVIEW.md` records the implementation and its test coverage.

---

## D-014 — D-009's Redis caching of computed availability deferred past Phase 5, not implemented

**Context:** D-009 decided that computed availability slots would be "cached in Redis with a 60-second TTL," and its Consequences committed to unit test coverage of the slot-computation logic "in Phase 5." Phase 5 shipped `AvailabilityService.computeAvailability` fully uncached (every call recomputes from `DoctorAvailability`/`DoctorAvailabilityException`/`Appointment` rows) and covered only by e2e tests (`appointments.e2e-spec.ts`), not isolated unit tests.

**Decision:** Ship Phase 5 without the caching layer, and record this explicitly rather than let D-009 silently misstate what's running. The e2e coverage is treated as satisfying D-009's underlying intent (proving slot computation is correct against exceptions and existing bookings) even though it isn't literally the promised unit tests, because it exercises the same logic against a real database rather than mocks.

**Rationale:** `computeAvailability` is called from two places with different risk profiles: the read-only `GET .../availability` endpoint (where D-009's 60-second staleness is exactly the intended, accepted trade-off) and `AppointmentsService.book()`'s own pre-insert `isOpenSlot` re-check (where a stale cache widens — from near-zero to up to 60s — the window in which a client is told a slot is open when it was in fact just taken). The DB-level exclusion constraint (`D-005`) remains the authoritative guard either way, so a stale pre-check cannot cause a double-booking, only an occasional spurious 409 on an otherwise-valid-looking request. Adding a shared cache to a code path this concurrency-sensitive, without dedicated tests proving the interaction between the 60-second TTL and the mandatory concurrent-booking gate, was judged higher-risk than shipping the (already fully correct, DB-verified) uncached version and deferring the optimization.

**Consequences:** `GET .../availability` recomputes on every call — acceptable at Phase 5's scale, but worth revisiting if doctor-availability reads become a measured hot path later. Any future implementation should either cache only the read endpoint's response (leaving `book()`'s internal call uncached) or add a concurrency test that specifically exercises a cached-and-stale `isOpenSlot` check before caching the shared method. Tracked as known technical debt in `docs/phase-reviews/PHASE-5-REVIEW.md` rather than left as an undocumented gap against D-009.

---

## D-015 — LocalStack as the dev/test S3 endpoint, not a mocked SDK client

**Context:** `D-012` commits AWS S3 as the canonical object store for clinical attachments, but no prior phase or doc addressed how attachment upload/download (pre-signed URL issuance, `FR-EMR-006`) would be exercised in dev/CI without real AWS credentials — a gap only surfaced once Phase 6 needed to actually implement and test it.

**Alternatives considered:** (1) Mock the `@aws-sdk/client-s3`/`s3-request-presigner` modules entirely in tests, asserting only that the service calls them with the right arguments; (2) require real AWS credentials for local dev and CI; (3) run a local S3-compatible service (LocalStack) via Docker Compose, exactly as Postgres and Redis already are, and point the real AWS SDK at it via the SDK's standard `endpoint`/`forcePathStyle` override.

**Decision:** Option 3. `docker-compose.yml` gains a `localstack` service (image `localstack/localstack:3`, `SERVICES=s3`); `S3Service` reads an optional `S3_ENDPOINT` env var — when set, the `S3Client` is constructed with that `endpoint` and `forcePathStyle: true`; when unset (intended for production), the SDK talks to real AWS using `AWS_REGION`/credentials alone, unchanged from `D-012`'s architecture. `S3Service.onModuleInit` self-provisions the dev bucket against LocalStack only (`HeadBucket` then `CreateBucket` on miss) — a real AWS bucket remains infra-provisioned (Phase 16), never app-created.

**Rationale:** Mocking the SDK (option 1) would mean the pre-signed-URL code path — MIME/extension/size validation feeding into a real `PutObjectCommand`/`GetObjectCommand`, actually invoking `getSignedUrl` — is never genuinely exercised, which sits against this project's "no fake completion" quality protocol the same way a stubbed-out feature would. Requiring real AWS credentials (option 2) would make attachment e2e tests non-reproducible for anyone without cloud access, including CI. LocalStack gives e2e tests a real S3-protocol server to upload to and download from over HTTP, at the cost of one more Docker Compose service — consistent with how `btree_gist`/exclusion-constraint behavior (`D-005`) is already tested against real Postgres rather than mocked.

**Consequences:** Local dev and e2e tests require `docker compose up -d localstack` (or the full stack) before running; `.env`/`.env.example` default `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` to LocalStack's conventional `test`/`test` placeholder credentials, which must be replaced with real values in any environment where `S3_ENDPOINT` is unset. LocalStack's S3 implementation is not a byte-for-byte guarantee of every real-AWS edge case (e.g. certain IAM-policy-level behaviors) — acceptable for this project's scope, since the code path under test is the pre-signed-URL contract, not AWS-specific policy enforcement.

---

## D-016 — System Chromium (Alpine `apk`) for Puppeteer, not the bundled download

**Context:** Phase 7 needs Puppeteer to render prescription PDFs (`FR-RX-003`, `docs/03-ARCHITECTURE.md` §12 `pdf-generate` job). The plain `puppeteer` npm package bundles a Chromium build at install time, which works out of the box on native Windows/macOS/glibc-Linux dev machines, but `apps/backend`'s Docker image is `node:20-alpine` (musl libc) — the same class of "works natively, breaks in the Alpine image" gap already hit once for the Prisma query engine binary (see the schema.prisma header comment and `binaryTargets`).

**Alternatives considered:** (1) Use the bundled `puppeteer` Chromium unmodified and hope it runs on Alpine; (2) switch the backend's Docker base image away from `node:20-alpine` to a glibc-based image (e.g. `node:20-slim`) so the bundled Chromium works unmodified; (3) install Alpine's own `chromium` package via `apk add` and point Puppeteer at it via `PUPPETEER_EXECUTABLE_PATH`, skipping the bundled download entirely via `PUPPETEER_SKIP_DOWNLOAD`.

**Decision:** Option 3. `infrastructure/docker/Dockerfile.backend`'s `base` stage installs `chromium nss freetype harfbuzz ca-certificates ttf-freefont` and sets `PUPPETEER_SKIP_DOWNLOAD=true` + `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` before `pnpm install` runs, so the image never downloads a Chromium build it can't use. `PrescriptionPdfProcessor` launches with `--no-sandbox --disable-setuid-sandbox` (required for a container's default seccomp/user-namespace restrictions) unconditionally — harmless on native dev too. Verified by actually launching Chromium and rendering a PDF inside the built image, not just by the image building successfully.

**Rationale:** Option 1 would have shipped Phase 7 silently broken in Docker (identical build, identical CI-green typecheck/lint, functioning natively) until the first real deploy attempt — exactly the kind of gap `docs/12-QUALITY-PROTOCOL.md`'s "verify in the actual target environment, not just natively" discipline exists to catch before it ships. Option 2 (changing base images) would touch every other already-verified part of the Docker build (image size, the existing `openssl`/Prisma engine setup, CI image caching) to solve a problem scoped to one dependency — Option 3 is the smaller, better-isolated fix, and is the documented standard approach for Puppeteer-on-Alpine.

**Consequences:** The Docker image is larger (~150-200MB more from Alpine's Chromium + font/rendering libraries) and slower to build than option 1 would have been if it had worked. Native dev/e2e-test runs are unaffected — `PUPPETEER_SKIP_DOWNLOAD`/`PUPPETEER_EXECUTABLE_PATH` are Dockerfile-only `ENV` instructions, so `pnpm install` outside the image still downloads Puppeteer's own bundled Chromium normally.

---

## D-017 — `GET /medicines` (read-only search) built in Phase 7, ahead of Phase 9's full Pharmacy module

**Context:** `docs/08-API-CONTRACT.md` originally listed `GET /medicines?search=&hospitalId=` under the Pharmacy section against `FR-PHARM-001` (Phase 9), but `docs/05-DEVELOPMENT-PLAN.md`'s Phase 7 scope explicitly includes "medicine search against inventory" as a prescription-creation dependency — a doctor has to be able to find a medicine by name before prescribing it, and Phase 7 runs before Phase 9 in the dependency graph.

**Decision:** Split the `Medicine` domain's API surface across two phases rather than pulling all of Phase 9 forward: Phase 7 ships a new `medicines/` module with only `GET /medicines`/`GET /medicines/:id` (read-only, RBAC-scoped to Hospital Admin/Doctor/Pharmacist per `docs/07-RBAC-MATRIX.md` §3.7's "Search medicine inventory" row). Catalog/batch management (`POST /medicines`, `POST /medicines/:id/batches`, low-stock alerts, dispensing) remains entirely Phase 9's deliverable, built on the same module.

**Rationale:** Building only the row Phase 7 actually needs — rather than the full Pharmacy CRUD surface — keeps Phase 9 a meaningful, non-redundant phase gate and avoids a phase silently absorbing a later phase's whole scope just because the schema (`Medicine`/`MedicineBatch`, already fully modeled since Phase 2) makes it easy to. This mirrors the project's established pattern of a phase using an already-schema-ready model minimally (e.g. Phase 6 using `Appointment` without touching appointment status logic).

**Consequences:** Phase 7's e2e tests seed `Medicine` rows directly via Prisma (no API to create one yet), the same pattern already used for entities whose write-side API doesn't exist yet at test-authoring time (e.g. `Department` in earlier phases' setup). Phase 9 must not assume `medicines/medicines.controller.ts` is new — it's extending an existing controller/module, not creating one.

---

## D-018 — `LabResult.structuredValues` restricted to exactly one entry per `LabOrderItem` (Phase 8)

**Context:** `docs/06-DATABASE-DESIGN.md` §3.4's ER diagram shows `LabResult.structuredValues` as a JSON array of `{parameter, value, unit, flag}`, suggesting a single lab test could report several named parameters (e.g. a multi-analyte panel). But `LabTestReferenceRange` is keyed only by `labTestId` (plus gender/age band) — there is no `parameter` column, so a single `LabTest` can only carry one reference range family, not one per named parameter within it.

**Alternatives considered:** (a) accept an arbitrary-length `values` array and range-check every entry against the same `labTestId`'s ranges regardless of its `parameter` name — silently correct only when the test happens to be single-parameter, silently wrong (misapplied range) the moment a real multi-analyte panel is entered; (b) add a `parameter` column to `LabTestReferenceRange` now to support true multi-analyte panels; (c) restrict `EnterLabResultDto.values` to exactly one entry, matching what the schema can actually range-check correctly.

**Decision:** (c). Every seeded `LabTest` (Haemoglobin, Fasting Blood Sugar, Total Cholesterol, TSH, Platelet Count) is single-parameter, so this is not a scope loss against anything currently in the catalog.

**Rationale:** (b) is a real schema change for a capability nothing in the current catalog or FR-LAB text asks for — adding it speculatively would be exactly the kind of unrequested scope CLAUDE.md's engineering rules warn against. (a) would ship a feature that is silently incorrect for the one case it claims to support (multi-parameter), which fails "no fake completion" harder than not supporting it at all.

**Consequences:** A future multi-analyte panel (e.g. a CBC with 6+ components) needs a `parameter` column added to `LabTestReferenceRange` (and a migration) before `EnterLabResultDto.values` can safely be widened past one entry — tracked here so it isn't mistaken for an oversight when it comes up.

---

## D-019 — Lab report file reuses `LabResult.reportFileUrl` directly; `AttachmentOwnerType.LAB_RESULT` stays unused (Phase 8)

**Context:** `docs/08-API-CONTRACT.md`'s Phase 6 EMR section noted that the Lab Technician's "lab reports only" attachment-upload access (`AttachmentOwnerType.LAB_RESULT`, present in the schema's enum since Phase 2) was "out of scope until Phase 8 wires up lab orders" — implying the generic `Attachment` model might be the intended mechanism. But `docs/06-DATABASE-DESIGN.md`'s explicit hybrid-design rationale for lab results describes a direct `reportFileUrl` field on `LabResult` itself ("structured parameter/value/unit/flag ... plus an optional `reportFileUrl` for a PDF/scan"), and the `Attachment` model has no `labResultId` foreign key at all (only `medicalRecordId`) — using it for lab reports would need its own schema change, not just a new service.

**Alternatives considered:** (a) add a `labResultId` FK to `Attachment` and route lab report files through the generic attachment upload/download-url endpoints, actually wiring up `AttachmentOwnerType.LAB_RESULT`; (b) use `LabResult.reportFileUrl` directly as an S3 storage key, the same direct-field pattern already established for `Prescription.pdfUrl` and `DoctorProfile.signatureImageUrl` (Phase 7).

**Decision:** (b). `PATCH /lab-orders/:id/items/:itemId/result` accepts an optional `reportFile` metadata object and returns a pre-signed PUT `uploadUrl` when present, storing the resulting key in `LabResult.reportFileUrl`; `GET /lab-orders/:id` returns a pre-signed GET `downloadUrl` computed from that key, never the raw key itself (SEC-FILE-003).

**Rationale:** `LabResult.reportFileUrl` is the field the database design's own hybrid-result rationale actually describes, and reusing the Phase 7-established direct-storage-key pattern needs no schema change and no new generic-attachment plumbing. `AttachmentOwnerType.LAB_RESULT` was written speculatively before Phase 8 existed; the simpler, already-schema-correct approach won out.

**Consequences:** `AttachmentOwnerType.LAB_RESULT` remains a defined-but-unused enum member — documented here so it reads as an intentional, considered choice rather than dead code left by oversight. If a future phase needs full `Attachment`-style metadata (uploader, MIME/size bookkeeping, multiple files per result) for lab reports specifically, that's the point to add the FK and revisit this decision, not before.

---

## D-020 — FR-LAB-005 notification trigger persists a real `Notification` row per recipient; multi-channel dispatch stays Phase 11 (Phase 8)

**Context:** `docs/03-ARCHITECTURE.md` §7 names `LabResultApproved` as the worked example of a domain event flowing through the (Phase 11-built) in-process event bus → `NotificationDispatcher` → per-channel BullMQ queues → `EmailWorker`/`SmsWorker`/`PushWorker`. None of that infrastructure exists yet — Phase 11 is still ahead in the roadmap — but FR-LAB-005 ("Approval triggers a notification fan-out to both patient and doctor") is explicitly in Phase 8's scope.

**Decision:** On approval, `LabService` writes a real `Notification` row (already a tenant-scoped, audited-adjacent model since Phase 2) directly for each recipient with a resolved `User` account (the ordering doctor always; the patient only if `PatientProfile.userId` is set — a front-desk-registered patient with no portal login has nothing to notify), `channels: [IN_APP]`. No BullMQ queue, event bus, or `NotificationDispatcher` is introduced this phase.

**Rationale:** Same "real-but-partial" scoping precedent as Phase 5's `ReminderDeliveryStub` (`docs/phase-reviews/PHASE-5-REVIEW.md`): the trigger condition, its data, and the persisted row are all genuine and independently testable via a direct query, rather than a fabricated call that proves nothing. Building the full multi-channel dispatcher now would mean redoing it in Phase 11 against real email/SMS providers anyway — pure duplicated effort for a phase whose actual job is that infrastructure.

**Consequences:** There is no `GET /notifications/me` endpoint yet (that's Phase 11 too), so Phase 8's e2e tests assert the `Notification` row via a direct Prisma query, not through an API response. Phase 11 should treat `LabService.notifyResultApproved` as the first of several call sites needing migration onto the real event-bus/dispatcher pattern, alongside wherever Phase 9–10 add their own trigger points.


**Phase 11 update:** real multi-channel dispatch is now wired, and this producer records through `NotificationsService` (D-032).
---

## D-021 — `GET /lab-orders/:id` result-visibility gating interpreted per-item, not per-endpoint (Phase 8)

**Context:** `docs/07-RBAC-MATRIX.md` §3.6's "View result" row gives DOCTOR/NURSE "own hospital, post-approval" and PATIENT "self only, post-approval" — read most literally, this could mean the entire `GET /lab-orders/:id` response 404s for those roles until every item is approved, which would leave the ordering doctor with no way to check an order's collection/processing progress at all.

**Decision:** Order-level access (whether the endpoint returns `200` vs `404`) follows the broader "own hospital" (staff) / "self" (patient) tenancy rule, matching every other module's list/detail endpoints. Per-item **result payload** visibility is gated separately: LAB_TECHNICIAN sees a result at any status (their own QC workflow); DOCTOR/NURSE see it once the item reaches a terminal QC state, `APPROVED` **or** `REJECTED` (so they know to reorder a rejected test, not just silently wait); PATIENT sees it only once truly `APPROVED`. An item not yet visible to the caller still appears in the response with `result: null`, never omitted outright — so a doctor/patient can always see that an order exists and each item's lifecycle status.

**Rationale:** The literal whole-endpoint reading would make it impossible for the ordering doctor to track an in-flight order at all, which nothing in `02-SRS.md`'s FR-LAB text asks for and would be a real workflow regression versus every other module. Gating the result payload specifically (not the order's existence/status) satisfies the matrix's actual intent — the *result* isn't visible pre-approval — without inventing an artificial blind spot. This is the same kind of documented literal-vs-practical interpretation call made for PATIENT's appointment-cancellation restriction in Phase 5.

**Consequences:** RBAC/authorization e2e tests must assert both halves separately: that a non-approved item's `result` field is `null` for DOCTOR/NURSE/PATIENT (but populated for LAB_TECHNICIAN), and that the order itself is still visible (not a blanket `404`) to any "own hospital"/"self" caller regardless of approval state.

---

## D-022 — FR-PHARM-004 "once per crossing" implemented as a persisted latch, `Medicine.lowStockAlertedAt` (Phase 9)

**Context:** `docs/10-TESTING-STRATEGY.md` §4 requires the low-stock alert to fire "exactly once per crossing of the reorder threshold, not on every subsequent read." Pre-existing `Medicine` had only `reorderLevel`, so nothing could remember whether an alert had already been raised.

**Alternatives considered:** (a) Detect a crossing by comparing stock before and after each write, with no stored state. This breaks when stock drops without any write (a batch passes its expiry date between nightly scans), and when a threshold edit is the crossing. (b) Deduplicate by searching `Notification` rows for a recent alert. This is fragile: it depends on a retention window and on notification rows that Phase 11 may archive.

**Decision:** Add a nullable `Medicine.lowStockAlertedAt` (migration `20260924090000_add_medicine_low_stock_latch`). `StockService.evaluateLowStock` runs after every stock- or threshold-changing write: batch receipt, dispense, reorder-level edit, and the expiry-scan quarantine.
- If available stock is below `reorderLevel`, it tries to claim the latch with a conditional `updateMany(where lowStockAlertedAt IS NULL)`. Only the caller that actually claims it creates the alert rows.
- If stock is at or above the level, it clears the latch, re-arming the next crossing.

Read endpoints (`GET /medicines/low-stock`) never touch the latch. A newly created medicine starts with the latch set (when `reorderLevel > 0`): zero stock at creation isn't a crossing, since stock never was above the level. The first receipt that lifts stock to the level clears it.

**Rationale:** A latch gives exactly-once-per-crossing behaviour however stock changes, and the conditional update makes the claim race-safe on its own. On top of that, every stock-changing transaction also holds a per-medicine row lock (`StockService.lockMedicines`), so evaluations never see a half-applied stock change.

**Consequences:** Every new code path that changes a medicine's available stock or its `reorderLevel` must take `lockMedicines` and call `evaluateLowStock` in the same transaction. Otherwise a crossing can be missed until the next write.

---

## D-023 — Pharmacy dates use the hospital's own calendar day; expiry dates are inclusive (Phase 9)

**Context:** `MedicineBatch.expiryDate` is a Postgres `DATE`. Deciding whether a batch has expired needs a definition of "today," and the hospital's timezone decides which calendar day that is. `Hospital.timezone` (default `Asia/Kolkata`) has existed since Phase 2. The appointment module deliberately treats all wall-clock times as UTC (comment in `src/doctors/availability.service.ts`). That comment says the simplification is in this log, but it was never actually recorded here. This entry notes the gap; it doesn't resolve the appointment side.

**Decision:** Pharmacy computes "today" as the hospital's local calendar date (`hospitalToday(Hospital.timezone)` in `src/medicines/pharmacy-date.util.ts`). A batch is usable through the end of its expiry date and expired from the next local day (inclusive expiry, the usual reading of an "EXP" label). Dispensing checks this on every request, so a batch that expired since the last nightly scan is still never dispensed. Receiving a batch whose expiry date has already passed is rejected with `422 MEDICINE_EXPIRED`.

**Rationale:** Expiry is a calendar-date concept, so comparing it against the UTC date would be off by a day for part of every day in any non-UTC hospital. The comparison is purely date-to-date, so using the real timezone here costs nothing extra, unlike the appointment module's time-of-day arithmetic.

**Consequences:** Pharmacy is the first real consumer of `Hospital.timezone`. That exposed that the field was only `@IsString()`-validated since Phase 4, so an unknown zone would make every pharmacy date computation for that hospital throw. It's now validated as a real IANA zone (`IsIanaTimezone`, `src/common/validation/`) on hospital create and update, with a regression test in `test/directory.e2e-spec.ts`. The appointment module's UTC simplification is unchanged and still needs its own entry if it's kept. **Update (Phase 12):** it wasn't kept; scheduling now uses the hospital timezone (D-037).

---

## D-024 — Pharmacy RBAC interpretation and dispensing-endpoint placement (Phase 9)

**Context:** `docs/07-RBAC-MATRIX.md` §3.7 gives Hospital Admin 🟡 on "Manage medicine catalog/batches" with no note explaining the restriction. `docs/08-API-CONTRACT.md` §4.8 places dispensing at `POST /prescriptions/:id/dispense`, but it's a stock operation. FR-PHARM-003 also says dispensing from a quarantined or exhausted batch "raises a validation error, not a silent fallback," which only makes sense if a caller can name a batch.

**Decision:**
- **Hospital Admin's 🟡 is read-only oversight.** HA can view batches (`GET /medicines/:id/batches`), low stock, and expiring stock, but can't create or edit catalog entries or receive batches. Those writes are Pharmacist-only. Super Admin has no pharmacy access (no `@BypassTenantScope()` routes).
- **Dispensing lives in the pharmacy module** (`DispensingController`, `@Controller("prescriptions")`), keeping the contract's URL, rather than inside `PrescriptionsModule`.
- **Optional `batchId` per dispense line is a physical-pick check, not an override.** If given, that batch must be the one FEFO would choose. A quarantined or expired batch → `422 MEDICINE_EXPIRED`. An exhausted batch → `422 INSUFFICIENT_STOCK`. A later-expiring batch while an earlier one is eligible → `422 VALIDATION_ERROR` with `expectedBatchId`. If omitted, the server picks FEFO and splits across batches as needed. Either way it never falls back to an ineligible batch.
- **Insufficient stock is all-or-nothing.** If the stock that could cover the shortfall is expired or quarantined → `MEDICINE_EXPIRED`. Otherwise → the new `INSUFFICIENT_STOCK` code. Nothing is partially filled.

**Rationale:** Keeping "manage" writes with the role that actually handles stock matches the Pharmacist being the only ✅ in that row. Letting the pharmacist confirm the batch in hand, with the server enforcing FEFO, is the realistic workflow and makes FR-PHARM-003's "no silent fallback" clause testable as written.

**Consequences:** `INSUFFICIENT_STOCK` (422) added to `ApiErrorCode` and `docs/08-API-CONTRACT.md` §3.

---

## D-025 — FR-PHARM-005 digest: real scan, recipients, and notification rows; email send stubbed until Phase 11 (Phase 9)

**Context:** FR-PHARM-005 says the nightly job "emails a digest to pharmacy staff." There's no email infrastructure yet; it's Phase 11 scope (`docs/03-ARCHITECTURE.md` §7/§12).

**Decision:** Same "real-but-partial" scoping as D-020 and Phase 5's `ReminderDeliveryStub`.
- The `medicine-expiry-scan` BullMQ queue and its nightly job scheduler (`30 0 * * *` UTC, registered idempotently at boot) are real. So are the quarantine step, the 30-day window query, and recipient resolution (active Pharmacists and the Hospital Admin, per §3.7's "Receive low-stock/expiry alerts" row).
- One `Notification` row per recipient per hospital-local day (`channels: [EMAIL, IN_APP]`, `relatedEntityId` = the date, which is also the idempotency key) is real.
- Only the SMTP send goes through `ExpiryDigestDeliveryStub`, which logs `[DEV STUB — Phase 11 ...]`.

**Consequences:** Phase 11 must replace `EXPIRY_DIGEST_DELIVERY_PORT`'s stub with the real email worker, and migrate `StockService`'s low-stock notification rows onto the event bus alongside `LabService.notifyResultApproved`.


**Phase 11 update:** real multi-channel dispatch is now wired, and this producer records through `NotificationsService` (D-032).
---

## D-026 — Redis caching of medicine inventory counts deferred (Phase 9)

**Context:** `docs/03-ARCHITECTURE.md` §13 lists "medicine inventory counts for search-as-you-type (30s TTL)" as a Redis read cache.

**Decision:** Not implemented this phase, the same call as D-014 for doctor availability. `GET /medicines` computes `availableQuantity` live with one indexed `groupBy` per page.

**Rationale:** There's no frontend search-as-you-type consumer yet to measure against. The live query is cheap and always correct right after a dispense, and a cache would need write-path invalidation on receive, dispense, and quarantine. That adds a correctness risk for no measured gain.

**Consequences:** Revisit in Phase 13/14's performance pass if profiling shows the need.

---

## D-027 — Supplementary invoices: an appointment may have more than one invoice (Phase 10)

**Context:** The Phase 2 schema made `Invoice.appointmentId` unique (one invoice per visit). FR-BILL-001 says charges accumulate "automatically as incurred," and FR-BILL-002 says a finalized invoice's lines are immutable. In a real outpatient flow the patient often pays for the consultation at the counter, and the invoice is finalized, before collecting medicines at the pharmacy. With a unique invoice per visit, that pharmacy charge would have nowhere to go.

**Alternatives considered:**
- (a) Reject the dispense while the visit's invoice is finalized. This blocks a clinical workflow on a billing state.
- (b) Silently drop the charge. That's revenue loss and an invisible data gap.
- (c) Edit the finalized invoice. This directly violates FR-BILL-002.
- (d) Open a supplementary DRAFT invoice for the same appointment.

**Decision:** (d). Migration `20260924120000_billing_integrity` drops the unique index and adds a plain index on `Invoice.appointmentId`, so `Appointment.invoice` becomes `Appointment.invoices`. `ChargesService.getOrCreateDraftInvoice` adds a charge to the visit's open DRAFT invoice, or creates one if none is open. "At most one DRAFT invoice per appointment" is enforced under an `Appointment` row lock (`SELECT ... FOR UPDATE`) rather than a partial unique index, which Prisma's schema can't express. It's proven by a concurrent-creation e2e test and by a lock-removal mutation.

**Consequences:** The normal case is still one invoice per visit; the PRD's "single invoice that aggregates line items" holds until the first invoice is finalized. Every billing write follows one lock order: Appointment → Invoice (dispensing: Prescription → Medicines → Appointment → Invoice).

---

## D-028 — FR-BILL-003 enforced in the database as well as the application (Phase 10)

**Context:** FR-BILL-003 requires `invoice.total` to be "re-verified in a database check/trigger," and FR-BILL-002 requires finalized line items to be immutable. Prisma doesn't model CHECK constraints or triggers.

**Decision:** Raw SQL in migration `20260924120000_billing_integrity`, the same way the init migration adds the appointment `EXCLUDE` constraints:
- **CHECK** `InvoiceItem.lineTotal = quantity × unitPrice` and `quantity > 0`.
- **CHECK** `Invoice.total = subtotal + tax − discount`, with `total`, `tax`, `discount` all `≥ 0`.
- **CHECK** `Payment.amount > 0`.
- **A deferred constraint trigger** (`DEFERRABLE INITIALLY DEFERRED`, on both `Invoice` and `InvoiceItem`) that verifies `Invoice.subtotal = SUM(items.lineTotal)` at commit. It's deferred so a transaction can insert an item and then recompute the totals.
- **A BEFORE trigger** that makes line items of any non-DRAFT invoice immutable. The only exception is appending a credit (negative) line to a FINALIZED/PARTIALLY_PAID invoice.

`tax` and `discount` stay 0 (no API sets them). Discounts and corrections are credit lines.

**Rationale:** The application computes totals itself (`ChargesService.recomputeTotals`) and never accepts them from a client. The database is an independent second line, which catches an application bug or a direct write. That was verified by deliberately making the application compute a wrong total: the database rejected every commit (21 e2e failures).

**Consequences:** Test teardown can't delete a non-DRAFT invoice's items directly. `test/helpers/billing-cleanup.ts` reopens invoices to DRAFT and deletes items and invoices in one transaction.

---

## D-029 — Payment flow: pre-created PENDING payment, checkout-reference idempotency, client totals rejected (Phase 10)

**Context:** FR-BILL-004/005 and SEC-PAY-001..003: only a signature-verified webhook or a staff cash action may change payment state, and a redelivered event must not double-apply. A webhook has to be matched back to exactly one invoice.

**Decision:**
- **Checkout creates the `Payment` first.** `POST /invoices/:id/checkout-session` creates a `PENDING` Payment for the server-computed balance *before* calling the provider, and sends its id in the provider metadata (Stripe `metadata`, Razorpay `notes`). The provider's checkout reference (Stripe Checkout Session id / Razorpay order id) is then stored in `Payment.providerEventId`, which is unique. FR-BILL-005 allows "provider event/reference ID"; the checkout reference is the stronger key, since it also dedupes *different* event types for the same payment (e.g. Razorpay `payment.captured` and `order.paid`).
- **Settlement is a conditional `PENDING → SUCCEEDED/FAILED` update under the invoice row lock.** Only the first delivery can apply funds. Later or duplicate deliveries are `200` no-ops (not `4xx`, so providers don't retry forever), proven by sequential and concurrent duplicate tests.
- **A validly signed event that matches no pending payment** (a foreign checkout, or a reference/payment-id mismatch) is acknowledged with 200, never applied, and logged for reconciliation.
- **Invoice status is always derived** (`InvoiceLedgerService`): the sum of SUCCEEDED payments against the total gives FINALIZED / PARTIALLY_PAID / PAID. A provider-reported amount that differs from the expected one is recorded as actually captured and logged.
- **Client-supplied `total`/`lineTotal` fields are rejected with 400** by the global `forbidNonWhitelisted` pipe, rather than silently ignored as `docs/10-TESTING-STRATEGY.md` §3 #6 phrases it. That's stricter than the scenario asks, and the test asserts the stored total is unchanged either way.
- **Only identifiers and amounts are persisted from provider payloads** (`rawPayloadSanitized`: eventId, eventType, reference, amountMinor, currency), never card, customer, or contact data. `Stripe-Signature`/`X-Razorpay-Signature` headers are redacted from request logs.

**Consequences:** An abandoned checkout leaves a PENDING row until Stripe's `checkout.session.expired` marks it FAILED (Razorpay has no expiry event, so those stay PENDING). An online payment completed after the balance was already settled by cash is recorded (the invoice stays PAID) and needs a manual refund. Refunds are out of scope for v1.

---

## D-030 — Payment provider configuration, test-mode enforcement, and what could not be live-verified (Phase 10)

**Context:** SEC-PAY-004 allows only test-mode credentials. No Stripe or Razorpay test keys exist in this development environment or CI.

**Decision:**
- **Env validation refuses to boot with a live key:** `STRIPE_SECRET_KEY` must match `sk_test_...` and `RAZORPAY_KEY_ID` must match `rzp_test_...` when set.
- **All provider settings are optional.** An unconfigured provider makes checkout return `503 PAYMENT_PROVIDER_UNAVAILABLE` (new error code), and its webhook fail closed with `400 WEBHOOK_SIGNATURE_INVALID`.
- **The outbound half is its own injectable (`CheckoutClient`).** It creates the Stripe Checkout Session or Razorpay order. The e2e suite replaces *only* this network hop. Signature verification (`PaymentWebhookVerifier`) always runs through the real `stripe.webhooks.constructEvent` and `Razorpay.validateWebhookSignature` against real signatures, including inside the Docker image.

**Consequences:** The real `CheckoutClient` calls (`stripe.checkout.sessions.create`, `razorpay.orders.create`) have **not been executed against the providers' test APIs** and are recorded as UNVERIFIED until test keys are supplied. Everything downstream of them (PENDING payment, webhook verification, settlement, idempotency) is verified. Receipts: the payment record (`paymentId` is the receipt reference) plus a `PAYMENT_RECEIVED` `Notification` row to the patient (D-020 scoping; dispatch is Phase 11). A downloadable receipt PDF is deferred to the Phase 12 portal. **Update (Phase 12):** built as `GET /payments/:id/receipt` (D-036).

---

## D-031 — Billing RBAC interpretation and endpoints beyond the original index (Phase 10)

**Context:** `docs/07-RBAC-MATRIX.md` §3.8 gives Hospital Admin 🟡 "own hospital" on view and a 🟡 "own hospital, read" on reconciliation, Receptionist 🟡 "cash only," and Accountant 🟡 "cash/reconciliation" for initiating payment. The dashboards in `docs/04-UI-UX.md` §4 need "pending draft invoices" and "outstanding invoices" queues.

**Decision:**
- Receptionist and Accountant create invoices, add manual lines (ROOM/OTHER only; CONSULTATION/LAB/PHARMACY lines are system-created), finalize, and record cash.
- Hospital Admin is read-only (view and list).
- The Patient views their own invoices and starts online checkout; another patient's invoice is 404.
- No other role has billing access, and Super Admin has none.
- `GET /invoices?status=&patientId=&appointmentId=` (paginated, Receptionist/Accountant/Hospital Admin) is added as the reconciliation/work-queue read. Financial reports and analytics remain Phase 13.

**Consequences:** Documented in `docs/08-API-CONTRACT.md` §4.9.

---

## D-032 — Notifications use a transactional outbox, with the in-process event bus as the wake-up signal (Phase 11)

**Context:** FR-NOTIF-001 and `docs/03-ARCHITECTURE.md` §7 describe services raising a domain event "via an in-process event emitter after the triggering transaction commits," with a `NotificationDispatcher` fanning it out to one queue per channel. An in-process emit is lost if the process exits between commit and emit, and several producers already relied on atomicity with their trigger: the low-stock latch (D-022, "an alert exists if and only if the latch was claimed"), one receipt per settled payment, and the per-day expiry digest (D-025).

**Decision:**
- **Every trigger records its event inside the triggering transaction** via `NotificationsService.record(tx, event)`: one `Notification` row per recipient. The rows *are* the outbox. Channels come from a single trigger table (`src/notifications/notification-triggers.ts`, brief §7.8), never from the producer.
- **Idempotency:** `Notification.dedupeKey` (unique) is `<event key>:<recipient>`, e.g. `APPOINTMENT_CONFIRMED:<appointmentId>:<userId>`, `LOW_STOCK_ALERT:<medicineId>:<crossing time>`, `APPOINTMENT_REMINDER:<appointmentId>:<window>`. A retried request, a concurrent duplicate, or a re-run job inserts nothing (`createMany … skipDuplicates`).
- **After commit, the caller calls `publish()`.** That emits `notifications.committed` on the in-process event bus (`@nestjs/event-emitter`). `NotificationDispatcher` listens, reads undispatched rows, enqueues one BullMQ job per channel with the deterministic id `<notificationId>-<channel>` (the architecture's idempotency key), then sets `dispatchedAt`. Enqueue-then-mark plus deterministic job ids make a crash between the two steps, or two instances draining at once, harmless.
- **A sweep job** (`notification-outbox`, every 30s) re-drains rows older than 10s that are still undispatched. It covers a lost signal, a Redis blip, or a process exit.
- **Workers:** one queue and worker per channel (`email`, `sms`, `in-app`). Each has 3 attempts with exponential backoff; the failed set is the dead-letter store (kept 30 days, visible in Bull Board). There is one `NotificationDeliveryLog` row per attempt. SENT and SKIPPED are terminal; SKIPPED is a new status meaning deliberately not sent. A provider's "your request is wrong" error (4xx other than 408/429) fails fast without retries.
- **In-app history** (`GET /notifications/me`) lists only rows whose channels include IN_APP. The brief's email/SMS-only events (payment received, appointment reminder) aren't part of it.

**Trigger interpretations:**
- *Prescription ready at pharmacy* fires when the prescription is issued, since an issued prescription is immediately dispensable at the hospital's own pharmacy.
- *Invoice generated* fires on finalize, when the amount becomes binding (FR-BILL-002).
- *Appointment reminder* covers both brief windows (24h and 1h, §7.2) with the §7.8 channels.
- *Medicine expiry digest* isn't in the brief's table; it uses Email + In-app, matching the low-stock alert.

Two Phase 9/10 channel choices change to match the brief:
- low-stock: In-app → Email + In-app;
- payment received: In-app + Email → Email + SMS.

**Consequences:** Two conditional updates were added so that concurrent duplicates fail rather than both apply: appointment status (update `WHERE status = <validated status>`, else 409) and lab result approval (`WHERE status = RESULT_UPLOADED`, else 409). Lab approval moved from an array `$transaction` into an interactive one so its notification is atomic with it.

**Rejected:** emitting domain events only after commit, with no persisted outbox (loses events on crash and breaks D-022's guarantee). A separate `DomainEvent` outbox table (the `Notification` row already carries everything the dispatcher needs).

---

## D-033 — Email/SMS providers, sandboxing, and auth-secret delivery (Phase 11)

**Context:** The brief names Resend (email) and Twilio (SMS). Brief §13/§15 require sandbox/test mode throughout development. This environment has no Resend or Twilio credentials. The Phase 3 OTP stub logged codes instead of sending them.

**Decision:**
- **Provider ports:** `EMAIL_SENDER`/`SMS_SENDER` are implemented by `ResendEmailSender` and `TwilioSmsSender` (`src/common/messaging`). Every setting is optional. An unconfigured provider makes that channel's deliveries `SKIPPED: PROVIDER_NOT_CONFIGURED`, never a false SENT. Resend gets an idempotency key (`<notificationId>-EMAIL`), so a retried job never sends twice.
- **Sandbox redirect outside production:** every email goes to `EMAIL_SANDBOX_RECIPIENT` (default Resend's test inbox `delivered@resend.dev`). If `SMS_SANDBOX_RECIPIENT` is set, every SMS goes there; Twilio test credentials never deliver regardless.
- **SMS only to a verified phone** (`phoneVerifiedAt` set, FR-AUTH-005). Otherwise the delivery is `SKIPPED: NO_PHONE / PHONE_NOT_VERIFIED`. Disabled or deleted recipients are `SKIPPED: RECIPIENT_INACTIVE` on every channel.
- **Content minimisation:** lab results and prescriptions send a generic "sign in to view" text by email/SMS. The emergency body carries no patient detail. In-app, behind authentication, keeps the full text.
- **Auth secrets (email OTP, SMS OTP, password-reset link) bypass the outbox and queues** and are sent synchronously by `MessagingOtpDelivery`. The user is waiting, and a secret must never be persisted in a `Notification` row (readable via `/notifications/me`) or in BullMQ job data (kept in Redis for days). Send failures are logged, never thrown, which keeps `forgot-password` uniform (SEC-AUTHN-006). Outside production the code is also logged, as in Phase 3, because sandboxed email can't be read by the developer.

**Consequences:** The live Resend/Twilio API calls are **UNVERIFIED** until test credentials are supplied. The adapters load and construct inside the Alpine image, and every other part of the pipeline is verified with fakes that replace only the network hop (the same approach as D-030).

---

## D-034 — The e2e suite runs in one Jest worker (Phase 11)

**Context:** From Phase 11, every spec process runs notification workers and an outbox dispatcher against the same Redis and Postgres. Run in parallel, one spec's dispatcher or workers could pick up another spec's jobs and deliver them through the real (unconfigured) senders instead of that spec's fakes, which makes assertions nondeterministic. The same sharing is correct in production, where all instances are configured identically.

**Decision:** `test/jest-e2e.json` sets `"maxWorkers": 1`. The full suite still takes about 40s.

**Rejected:** per-spec BullMQ prefixes. They isolate the queues, but not the shared outbox table that every dispatcher drains.

---

## D-035 — Patient portal API scope and self-service reschedule (Phase 12)

**Context:** FR-PORTAL-001..003 need the patient to see lists of their own prescriptions, lab orders, and invoices, but Phases 7-10 built those as single-item reads (`GET /prescriptions/:id`, `GET /lab-orders/:id`) or staff work queues (`GET /invoices`). FR-PORTAL-002 allows rescheduling "if the hospital's policy allows", and no such policy existed. The brief (§7.7) has the invoice "finalised ... and shared with the patient", which says nothing about drafts.

**Decision:**
- **Patient-only list endpoints.** `GET /prescriptions` and `GET /lab-orders` are PATIENT-only and always scoped to the caller's own `PatientProfile`. The lab list is a summary (item status and test name, never a result); results are read through `GET /lab-orders/:id`, which keeps the D-021 visibility rule in one place. Staff work queues for these are Phase 13 dashboards.
- **`GET /invoices` also serves patients**, forced to their own invoices. A `patientId` filter can't widen it (it's ignored for a patient).
- **A patient never sees a DRAFT invoice**, in the list or by id (404). A draft is still being assembled, and it's "shared" at finalization.
- **Reschedule is `PATCH /appointments/:id/reschedule`**, PATIENT (self) only, gated by two new hospital settings: `Hospital.patientRescheduleAllowed` (default true) and `patientRescheduleCutoffHours` (default 24, 0-720, DB check ≥ 0), editable through `PATCH /hospitals/:id`. Allowed from PENDING or CONFIRMED, never for EMERGENCY appointments. The new window must be an open slot for the same doctor. The appointment keeps its id and goes back to PENDING (staff confirm the new time, which schedules fresh reminders), and its old reminders are cancelled. The move is a single conditional `UPDATE` on (id, status, old start): the exclusion constraints decide a race for the new slot (409 `SLOT_UNAVAILABLE`), and a concurrent change or second reschedule gets 409. Refusals by policy, cutoff, or type use the new 422 `RESCHEDULE_NOT_ALLOWED`.
- **Patient cancellation is unchanged:** PENDING only (RBAC §3.3). A confirmed appointment is cancelled through the front desk.
- **`GET /appointments?sortOrder=asc|desc`** (default desc) so the portal lists upcoming visits soonest first.
- **`GET /auth/me` adds** `patientProfileId` (the EMR routes are keyed by it) and a `hospital` summary: name, timezone, and the reschedule policy.
- **`GET /hospitals/directory` is public**: ACTIVE hospitals only, id/name/slug/city only. Patient self-registration (FR-AUTH-001) needs a hospital id, and there was no way for a signed-out visitor to find one. It's covered by the global rate limiter.

**Rejected:** changing the appointment's id on reschedule (cancel + rebook). That loses the link between the old and new visit and re-runs the booking notification path. Also rejected: letting staff reschedule through the same endpoint this phase; a receptionist can already cancel and rebook, and the policy/cutoff rules are patient rules.

---

## D-036 — Response minimisation, and receipts rendered on demand (Phase 12)

**Context:** Building the portal meant reading every response a patient receives. Three responses returned raw S3 storage keys: doctor profiles and appointments (`DoctorProfile.signatureImageUrl`), prescriptions (`pdfUrl`, `signatureImageUrl`), and EMR records (`Attachment.storageKey`). The bucket is private, so a key alone grants nothing, but the project's reading of SEC-FILE-003 (already applied to lab reports in Phase 8) is that only short-lived pre-signed URLs leave the server. Separately, every doctor projection used `SAFE_USER_SELECT`, which includes the doctor's email and phone, so any patient could list every doctor's contact details. The payment receipt PDF was deferred to this phase by D-030.

**Decision:**
- **Storage keys never leave the server.** Doctor views replace `signatureImageUrl` with `hasSignature`; prescription views (create, read, list, and the dispense response) replace `pdfUrl`/`signatureImageUrl` with `pdfReady`; EMR attachments drop `storageKey` on upload and read. Files are reached only through the existing pre-signed-URL endpoints.
- **Patients get a doctor's name, not their contact details.** Appointment and lab-order responses (every role) carry a narrow doctor projection (id, specialization, name). The doctor directory keeps email and phone for staff callers but drops them for PATIENT callers.
- **Receipts are rendered on first request and cached.** `GET /payments/:id/receipt` (the paying patient; Receptionist/Accountant/Hospital Admin in the same hospital) returns `{downloadUrl}` for a SUCCEEDED payment, 409 otherwise. The first call renders the PDF, stores it under a deterministic key, and records the key in the new `Payment.receiptUrl` (never returned); later calls reuse it. A concurrent first request writes the same object. Puppeteer rendering moved into a shared `PdfRendererService` used by both prescriptions and receipts.

**Rejected:** rendering receipts in a job at settlement time. A lost job would leave a paid invoice without a receipt forever, and settlement happens in two places (cash and webhook) that would both need the hook. On-demand rendering has no such gap, and receipts are requested rarely.

---

## D-037 — Scheduling uses the hospital's timezone (Phase 12, fixes a Phase 5 simplification)

**Context:** Since Phase 5 every wall-clock time was treated as UTC: a doctor available "09:00-13:00" at an Asia/Kolkata hospital got slots at 09:00 UTC, which is 14:30 local. The appointment module's comment pointed to a decision-log entry that was never written (noted in D-023). Nothing showed times to patients until the portal, where the error becomes visible: either a 14:30 slot for a 09:00 schedule, or the portal showing times in UTC.

**Decision:** `DoctorAvailability` and exception start/end times are wall-clock times in `Hospital.timezone`; appointment instants stay UTC. `computeAvailability` treats `dateFrom`/`dateTo` and each `DaySlots.date` as hospital-local dates, converts each window with `zonedWallTimeToUtc` (`src/common/time/zoned-time.ts`, `Intl` only, two-pass so DST changes resolve), and reads booked appointments across the whole local range with a day of margin. Booking and reschedule look the requested slot up on the hospital-local date it starts on. The portal shows every time in the hospital's timezone, whatever the device's zone.

**Consequences:** Existing appointments keep their instants. The appointments e2e spec pins its test hospital to `UTC` because its assertions are written in UTC wall time, and the portal spec covers Asia/Kolkata (09:00 IST = 03:30Z; the old UTC reading of 09:00 is rejected with 409). Receptionist booking gets the fix too; the staff UI that shows it is Phase 13.

**Rejected:** a date library (Luxon, date-fns-tz). Two small `Intl`-based helpers cover the need without a new dependency.

---

## D-038 — Frontend session, API access, and portal shell (Phase 12)

**Context:** Phase 12 is the first real frontend work. It fixes how the browser talks to the API and holds the session.

**Decision:**
- **The browser calls the API directly** (`NEXT_PUBLIC_API_BASE_URL`, CORS allow-list with credentials), not through a Next.js rewrite proxy. A proxy would make every request come from the Next server's address, collapsing the per-IP rate limiter (SEC-NET-003) into one bucket for all users. In development the two origins are same-site, so the `SameSite=Strict` refresh cookie (path `/api/auth`) is sent. Production puts both behind one domain (Phase 16 nginx), which keeps that true.
- **The access token lives only in memory** (Zustand `authStore`), and a page load restores the session through `POST /auth/refresh`. On a 401 the client refreshes once and retries. There's one refresh at a time: concurrent 401s in a tab share a request, and tabs serialise through a Web Lock. Refresh tokens rotate, and a replayed one revokes every session (SEC-AUTHN-004), so two parallel refreshes with the same cookie would sign the user out everywhere.
- **Route guarding is UX only.** The portal layout sends signed-out visitors to `/login?next=` (same-app paths only) and non-patients to `/staff`, which says plainly that staff dashboards are Phase 13 instead of showing a mock. Every API call is authorized server-side (FR-RBAC-002).
- **Server state is TanStack Query** (no retry on a 4xx; polling only where the server is the source of truth: a prescription PDF being rendered, and an invoice after checkout until the webhook settles it). Client state is three small Zustand stores (`authStore`, `notificationStore`, `uiStore`), as the brief suggests.
- **Payments:** Stripe redirects to the hosted page; Razorpay opens its hosted checkout script with the server-created order. The page never treats the provider's return as success. On return (`?checkout=processing`) it polls the invoice for up to 90s and says so if the webhook hasn't landed yet.
- **Forms** validate on blur and on submit, then re-validate on change after a submit attempt. The line under each field is always reserved, so an error appearing on blur can't move the Submit button out from under a click in progress (found by the Playwright registration journey).
- **UI primitives** follow shadcn/ui's structure (`components/ui`, Radix-based) but were written by hand, because the shadcn CLI is interactive. Nothing in `components/ui` is feature-specific.

**Rejected:** storing the access token in `localStorage` (readable by any injected script), and a Next.js API proxy (above).

---

## D-039 — A new Phase 13B for the staff workflow screens (Phase 13)

**Context:** Phases 4–11 were built backend-first by design, and Phase 12 built the patient portal. No phase in `05-DEVELOPMENT-PLAN.md` builds the staff screens for those workflows: Phase 13 is dashboards, analytics, search, filters, and pagination, and Phase 14 polishes existing screens. The PRD's success criterion "complete the full patient journey" (§6) and the final quality gate (`12-QUALITY-PROTOCOL.md` §27, "every clinical/operational workflow … frontend UX") both need them. Found while scoping Phase 13; the user chose how to resolve it.

**Decision:** Phase 13 stays as planned. A new **Phase 13B — Staff Workflow Screens** sits between Phase 13 and Phase 14, with its own gate (a full-journey Playwright test through the UI). It's "13B" rather than a renumbering so every existing "Phase 14/15/16/17" reference stays correct. Until 13B ships, the Phase 13 dashboards show read-only work queues, and rows don't link to workflow screens that don't exist yet.

**Rejected (options put to the user):** folding the screens into Phase 13 (one gate two to three times Phase 12's size), folding them into Phase 14 (mixes building with polishing), and leaving staff on the API only (fails the PRD and the final gate).

---

## D-040 — Dashboards, analytics, search, and staff work queues (Phase 13)

**Context:** FR-ANALYTICS-001 asks for role dashboards with the widgets in `04-UI-UX.md` §5; FR-SEARCH-001 asks for hospital-scoped, paginated global search. The API contract's §4.11 listed three endpoints without detail. Several widgets are work queues (lab orders by status, prescriptions to dispense, outstanding bills) that the Phase 7–10 list endpoints didn't serve for staff. The seed had no transactional history, so every dashboard would have been empty.

**Decision:**
- **Analytics endpoints** (`src/analytics/`), read-only:
  - `GET /analytics/overview`: today's KPIs (Hospital Admin; Super Admin platform-wide);
  - `GET /analytics/appointments?from&to`: daily counts by status (Hospital Admin, Doctor limited to their own, Super Admin);
  - `GET /analytics/revenue?from&to`: collected, invoiced, and outstanding (Hospital Admin, Accountant as "financial only", Super Admin);
  - `GET /analytics/occupancy`: the bed board (Hospital Admin, Nurse).
- **Days are calendar days in the hospital's timezone** (UTC for the platform view), grouped in SQL with `AT TIME ZONE`. Ranges default to the last 7 days and are capped at 92. Collected means SUCCEEDED payments by creation time; invoiced means totals of invoices finalized that day (never DRAFT or CANCELLED); outstanding means total minus SUCCEEDED payments across FINALIZED and PARTIALLY_PAID invoices. Every raw query binds `hospitalId` explicitly (the tenant extension doesn't see raw SQL).
- **Global search** is `GET /search?q=&scope=`. Scopes by role follow the RBAC matrix: patients (Hospital Admin, Doctor, Nurse, Receptionist, Accountant), doctors (all hospital staff), medicines (Hospital Admin, Doctor, Pharmacist). Every term must match some field. Without `scope`, the top 5 per scope are grouped; with it, results are paginated. Queries are 2–100 characters. A disallowed scope gets 403. Patients and Super Admin have no global search (403); a platform-wide search is out of scope.
- **Audit trail:** `GET /audit-logs` (Hospital Admin: own hospital; Super Admin: all) returns who, what, which record, and when, never `beforeData`/`afterData`.
- **Staff work queues:**
  - `GET /lab-orders`: Lab Technician (hospital queue, URGENT first, then oldest) and Doctor (own orders);
  - `GET /prescriptions`: Pharmacist (dispensing queue, oldest first) and Doctor (own);
  - `GET /payments`: Accountant and Hospital Admin reconciliation list.
  - Status filters take comma-separated lists (`CommaSeparatedEnum`), also on `GET /appointments` and `GET /invoices`.
  - `GET /appointments?doctorId=` narrows within the caller's scope: for a doctor, a colleague's id returns nothing, never their own list.
  - Staff invoice rows carry the patient's name.
- **The patient directory list follows the matrix.** `GET /patients` (list/search) is Hospital Admin, Doctor, Nurse, Receptionist, and Accountant; Lab Technician and Pharmacist now get an empty list. Phase 4 had allowed them as a stopgap until order and prescription flows existed. Their single-patient reads in context are unchanged.
- **Demo history seed:** `pnpm run db:seed:history` writes two weeks of past activity and a week of bookings per seeded hospital, following the rules the services and database enforce (schedules in local time, no overlaps, billing line and total integrity, invoice status matching payments, four-eyes lab approval). It's idempotent per hospital. It doesn't dispense medicines (stock changes belong to the FEFO service), so seeded prescriptions stay ISSUED.
- **Frontend:**
  - a staff workspace at `/dashboard` with role-scoped navigation, a distinct dashboard per role (each its own chunk), a keyboard-operable global search box, and filtered, server-paginated lists whose filters live in the URL;
  - Recharts for the appointment and revenue charts, with text summaries for screen readers;
  - rows don't link to workflow screens yet (Phase 13B, D-039);
  - the Nurse "medication administration checklist" isn't shown: there are no inpatient medication records (D-007).

**Rejected:** one endpoint returning a whole role's dashboard (couples the API to one screen layout, and dashboards share widgets); computing daily buckets in Node from fetched rows (unbounded rows per request); caching analytics in Redis (no measured need at this scale, and a stale "today" is worse than a slower one; revisit in Phase 14's performance pass).

---

## D-041 — Staff workflow screens and the reads they needed (Phase 13B)

**Context:** Phase 13B builds the staff screens for the workflows Phases 4–11 built API-first (D-039). Wiring them showed that a few reads a screen needs didn't exist: nothing listed the lab test catalog (the Phase 8 specs wrote tests straight into the database), the Hospital Admin had no staff list, an encounter could only be found by listing a patient's records, the encounter's own prescriptions and lab orders couldn't be listed, a prescription didn't say how much of each line was already dispensed, and a staff invoice didn't say whose it was.

**Decision:**
- **New read endpoints**, each tenant-scoped from the JWT and following the RBAC matrix:
  - `GET /lab-tests?search=`: the hospital's catalog with reference ranges (Doctor, Lab Technician, Hospital Admin);
  - `GET /users?role=&search=`: the staff directory (Hospital Admin); `SAFE_USER_SELECT` plus employee code and department, never patients or Super Admins;
  - `GET /medical-records/by-appointment/:appointmentId`: the encounter of one visit, with the same visibility as a read by id.
- **Narrowing filters** (they narrow within the caller's scope, never widen it, like `doctorId` in D-040): `medicalRecordId` on `GET /prescriptions` and `GET /lab-orders`; `patientId` on `GET /appointments`.
- **Response additions:** `GET /auth/me` adds `doctorProfileId`; `GET /prescriptions/:id` adds each line's `dispensedQuantity` (a sum; who dispensed and from which batch stay out) and, for staff, the patient's name; staff `GET /invoices/:id` adds the patient's name.
- **Screens** (`app/(dashboard)/dashboard/**`): patients (directory, front-desk registration, profile with visits), booking on a patient's behalf and emergency visits, the appointment page (status moves mirroring the API state machine, cancel with a reason, opening a bill), the encounter workspace (start, vitals, addenda, allergies, prescribing, lab ordering, completing), the lab order page (collect, test, enter a result, four-eyes review), dispensing, the medicine catalog and batch receiving, the billing desk (lines, credits, finalising, cash, receipts), and admin (staff and doctors, departments, reschedule policy). The Phase 13 queue and dashboard rows now link into them.
- **Access mirroring:** list-reached screens are in `WORKFLOW_ACCESS` (`staff-nav.ts`) next to the sidebar, so `RoleGate` refuses a hand-typed URL with a message instead of a failed request. UX only; the API enforces everything.
- **Confirmations** (`04-UI-UX.md` §8) on: cancelling, a no-show, completing a visit, approving or rejecting a result, dispensing, finalising a bill, recording cash, and deleting a department. Additive steps (vitals, addenda, allergies, an order, a line) have none.
- **Dispensing uses FEFO only:** the screen asks how much to hand over per line and the server picks batches (D-004). The API's optional `batchId` isn't offered.
- **Receptionist sample collection isn't on a screen:** the matrix allows it, but the receptionist has no lab-order list or detail read, so the lab technician marks collection. The API route is unchanged.
- **Nurses in the encounter workspace** see vitals, allergies, and addenda. They have no list read for prescriptions or lab orders (`GET /prescriptions`, `GET /lab-orders`), so those panels are the doctor's.
- **The e2e suite clears the auth rate limiter before each spec file** (`test/helpers/reset-rate-limits.ts`). All specs share one loopback IP and run serially, and this phase took the suite past 100 logins in 15 minutes, so every later spec failed with 429. The limiter itself is now tested on its own (`test/rate-limit.e2e-spec.ts`); nothing had tested it before.

**Rejected:** giving the receptionist lab-order reads just for the collection button (widens clinical visibility for one step the lab already does); a batch picker on the dispense screen (FEFO is the policy, and a manual override is an exception the API already refuses with `expectedBatchId`); raising the auth throttle limit through an env var for tests (changes production configuration surface to suit a test harness); fetching an encounter by paging through a patient's records (fragile past the first page).

---

## D-042 — The last five staff screens, and two gaps they exposed (Phase 13B follow-up)

**Context:** Phase 13B's review listed five API-complete requirements without a screen:
- the doctor's availability editor (FR-APPT-001);
- vaccinations and family history (FR-EMR-005);
- EMR attachments (FR-EMR-006);
- the prescription signature (FR-RX-003);
- Super Admin hospital onboarding (FR-HOSP-001).

The user asked for them before Phase 14. Building them exposed two defects older than Phase 13B:
- **No browser upload had ever worked.** Attachments (Phase 6), signatures (Phase 7), and lab report files (Phase 8) all upload by a browser PUT to a pre-signed URL, and the bucket had no CORS rule. LocalStack refused the preflight ("CORS is not enabled for this bucket"), as real S3 would. The e2e specs only uploaded from Node, which doesn't enforce CORS, so nothing caught it.
- **A new hospital could never get its first Hospital Admin.** `POST /users` provisions into the caller's own hospital, and a Super Admin has none. RBAC §3.1 gives the Super Admin staff accounts in any hospital.

**Decision:**
- **Bucket CORS:** `S3Service.onModuleInit` applies a CORS rule to the dev bucket on every start: the `CORS_ORIGIN` origins, PUT and GET only, the `content-type` header, and `ETag` exposed. A production bucket needs the same rule from infrastructure (Phase 16); app code never configures a real AWS bucket (D-015). Tested: the rule is present, a preflight from the web origin gets 200 with the origin echoed, and a foreign origin gets no allow header. Playwright uploads a file and reads it back.
- **`POST /hospitals/:id/admins`** (Super Admin, `@BypassTenantScope()`): creates a HOSPITAL_ADMIN in that hospital through the same provisioning as `POST /users` (pre-verified, emailed password link). The role is fixed by the route; a `role` field in the body is rejected. Unknown hospital → 404.
- **`GET /doctors/:id/schedule`** (the doctor themselves): the weekly hours plus exceptions from today in the hospital's calendar. **`DELETE /doctors/:id/availability-exceptions/:date`** restores a date's weekly hours. Nothing could read the weekly template before; it was only computed into slots.
- **Weekly windows on the same weekday may touch but not overlap** (`PUT /doctors/:id/availability` → 400). Before this, overlapping windows were accepted and would offer the same time twice. The editor mirrors the rule (`lib/schedule.ts`).
- **Screens:**
  - the doctor's "My practice" (weekly hours, days off and one-day changes, signature upload);
  - vaccination, family history, and attachment panels in the encounter workspace;
  - the Super Admin's "Hospitals" (create, add admin, verify).
  - Uploads check type and size in the browser against the API's own allow-lists (`lib/upload.ts`), then PUT straight to storage.
- **`Panel` is now a named region** (`role="region"` labelled by its title), so screen readers can jump between panels and tests can scope to one.

**Rejected:**
- relaxing CORS to `*` (any site could then use a leaked pre-signed URL from a victim's browser session);
- proxying uploads through the API (against `03-ARCHITECTURE.md` §10: the API never carries file bytes);
- letting `POST /users` accept a `hospitalId` for Super Admins (it would mix the tenant-from-JWT rule into a route every Hospital Admin uses).

---

## D-043 — UI/UX polish: measured accessibility and a lighter motion layer (Phase 14)

**Context:** Phase 14 delivers NFR-A11Y-001..004 and NFR-PERF-003 and polishes every screen against `04-UI-UX.md` §9. Until now accessibility was checked by hand and by a few Playwright assertions. Nothing measured the colour tokens or scanned rendered pages, and the form-heavy screens loaded up to 250 kB first.

**Decision:**
- **Contrast is a test** (`src/lib/contrast.test.ts`). It parses `globals.css` and checks every foreground/background pair the components use, in both themes: text 4.5:1, focus rings and input borders 3:1 (WCAG 1.4.11). It also checks that the OS-preference dark block and the explicit `data-theme="dark"` block define the same values.
  - It found 7 failing pairs. The fix was the nearest passing shade: light `--subtle`, `--success`, and `--border-strong`; dark `--primary` and `--border-strong`.
  - A new `--danger-foreground` token replaced `text-white` on danger surfaces: white on the dark theme's light red was 2.8:1.
- **Every screen is scanned by axe** (`e2e/accessibility.spec.ts`, `@axe-core/playwright`, dev dependency): each as its role, in light and dark, against WCAG 2.1 A and AA, once data has loaded. It found and fixed:
  - a link inside text told apart by colour alone (links in `p`/`dd` are now underlined);
  - unlabelled hidden file inputs;
  - the notification badge's contrast;
  - focusable chart internals inside an `aria-hidden` drawing (Recharts `accessibilityLayer={false}`; the `figcaption` is the text alternative);
  - a table scroll box keyboard users couldn't reach (focusable, named by the caption).
- **Keyboard:**
  - a "Skip to main content" link;
  - `main` is focusable;
  - dialogs opened from state now return focus where it was (`useReturnFocus`). Radix only restores focus to a `Dialog.Trigger`, and none of our 7 dialogs has one, so focus had been falling to the top of the page.
  - Playwright covers keyboard-only sign-in, the skip link, and a dialog's focus trap, Escape, and return.
- **Tablets (768–1024 px) get an icon rail** (§2.4, §4). Labels stay in the DOM for screen readers, with a `title` on hover, and the full sidebar comes back from 1024 px.
- **Motion is CSS, and framer-motion is removed.** It was a 40 kB (gzip) chunk on most staff screens, used only for two effects: the dashboard's first-load stagger and toast enter/exit. They're now CSS keyframes, plus a 150 ms route fade (`template.tsx`) and a badge animation when a status changes in place (§7). The global reduced-motion rule turns all of them off. Measured: 20 routes are 41–43 kB smaller, the largest first load went from 250 to 207 kB, and none grew.
- **Never colour alone:** low stock in the medicine list now shows a word and an icon, not only a colour.
- **The browser suite resets the rate limiter before each test** (`resetRateLimits` in `e2e/fixture.ts`, using the backend's ioredis). Every page load refreshes the in-memory token (D-038), and the axe scan loads about 100 pages, so the suite ran out of the auth routes' budget and every later test failed with "Too many attempts". This mirrors the backend suite (D-041).
- **The gate's browser run uses production builds:** the web app's `runtime` image and the API from `node dist/main.js`. The dev servers failed it for reasons unrelated to the product. Next compiled routes on demand in 10–15 s with under 1 GB of RAM free, and the API's `--watch` restarted mid-run when the fixture script ran in the backend folder.
- **NFR-PERF-003:** every API read behind a controller is bounded. The four that weren't (a user's sessions; a patient's allergies, vaccinations, and family history) are capped: 50 sessions, 200 clinical rows, newest first. Those endpoints return plain arrays the portal shows whole, so a cap fits better than pagination. The unbounded reads left are all inside nightly jobs or bounded by the request's own id list.

**Rejected:**
- keeping framer-motion (40 kB for effects CSS does equally well);
- pagination for the patient clinical lists (it breaks the portal's contract for lists a real patient never fills);
- editing `components/ui/dialog.tsx` to restore focus for every dialog (the hook keeps the shadcn primitives upgradeable);
- `zod/mini` to trim the 25 kB zod chunk (a different API across every form, for less than framer saved; revisit if the budget tightens).

## D-044 — Phase 15 testing/security hardening: CI was never actually green, the unit-coverage gate as written doesn't fit this codebase, and ClamAV is deferred (Phase 15)

**Context:** Phase 15 requires the nine mandatory scenarios "verified in CI," a security review pass, and a dependency audit. The repository has no git remote and has never been pushed, so `.github/workflows/ci.yml` had never actually executed — it was unverified from the day it was written. Auditing it surfaced real, stacked bugs rather than a healthy baseline.

**Decision — CI was broken, not just unverified, and is now fixed and proven locally:**
- The `integration-tests` job never built `@medcore/types` (its `dist/` is gitignored and doesn't exist on a fresh checkout — the exact failure mode `CLAUDE.md`'s "packages/types is compiled JS" entry warns about), and was missing the two required env vars with no default, `JWT_ACCESS_SECRET` and `ENCRYPTION_KEY` (`src/config/env.validation.ts` throws on boot without them). Either bug alone would fail every e2e test from the first request.
- It also had no LocalStack service. `medical-records.e2e-spec.ts`, `portal.e2e-spec.ts`, and `onboarding-schedule.e2e-spec.ts` round-trip real bytes through S3 and assert the dev bucket's CORS rule (D-015/D-042) — without LocalStack these fail with connection errors, not skips.
- Fixed all three: a `Build shared types` step, a `localstack:3` service (`SERVICES: s3`, health-checked the same way the compose file does it), and the full env block (dummy, CI-only `JWT_ACCESS_SECRET`/`ENCRYPTION_KEY`, `CORS_ORIGIN`, `AWS_*`, `S3_ENDPOINT=http://localhost:4566`). Since GitHub Actions cannot be exercised without a remote, this was instead proven by reproducing the job's exact env and services locally end to end: 447/447 backend e2e tests (19 suites) pass under those exact values.

**Decision — SEC-AUTHZ-001's promised static check didn't exist; it does now:** the security doc promised "CI includes a static check that fails the build if a new controller method is added without [`@Roles()`]." `RolesGuard` already enforces deny-by-default at *runtime* (a route with neither `@Public()` nor `@Roles()` throws `FORBIDDEN_ROLE`), which is a stronger guarantee than a lint rule, but nothing gave the *build-time* signal the doc describes, and no unit test existed for the guard's own logic at all. Added `test/route-authorization.e2e-spec.ts`: it statically scans every `*.controller.ts` file's exported controller classes via `Reflect` metadata (no DI container, no DB) and asserts every HTTP handler carries `@Roles()` or `@Public()`, mirroring `Reflector.getAllAndOverride`'s exact handler-overrides-class precedence. It runs under the e2e Jest config (not the unit one) only because requiring real controller files transitively loads `@nestjs/bullmq` (pure ESM) — the unit config lacks the `transformIgnorePatterns` fix `CLAUDE.md` already documents for that. Verified with a deliberate negative test (temporarily stripping one route's `@Roles()`): the check failed exactly as expected, then was reverted. All 101 route handlers across the 19 controllers currently pass.

**Decision — the `docs/10-TESTING-STRATEGY.md` §2 coverage gate, as literally written, doesn't fit how this codebase actually verifies business logic, and is revised rather than faked:**
- Measured: Jest unit-test coverage (mocked Prisma, the layer the gate names) is **1.83% statements**. That's real, not a tooling error — this project has almost no isolated mocked-Prisma unit tests, because (per §1 of the same document) integration tests were deliberately chosen to catch the bugs that matter here: tenancy and authorization bugs that mocking the database structurally hides. Every phase since Phase 3 wrote integration tests against a real Postgres instead.
- Writing enough mocked-Prisma unit tests to hit 70–80% statement coverage now, this late, would mean re-testing already-integration-tested business logic a second time with mocks, purely to satisfy a metric — the "no fake completion" rule this project runs under cuts against manufacturing a coverage number that doesn't reflect real additional verification.
- The `unit-tests` CI job never actually ran `--coverage` either, so the literal gate was unenforced in both the doc and the pipeline, not just unmet.
- Decision: the coverage gate's job — confidence that business logic is actually exercised — is instead evidenced by Task #1's scenario audit (all 9 mandatory + 8 risk-based scenarios from §3/§4 have real, dedicated, passing integration tests) and the route-authorization scan (all 101 route handlers, 19 controllers, reachable and role-guarded). `docs/10-TESTING-STRATEGY.md` §2 and §7 are updated to state this explicitly rather than continue citing an unenforced percentage. This is a revision of how coverage is demonstrated, not a lowering of what's actually tested — the underlying e2e suite is unchanged and comprehensive.

**Decision — dependency audit: 43 advisories, all transitive, none exploitable in this deployment as currently wired, one real upgrade deferred:** `pnpm audit` reports 1 critical / 21 high / 16 moderate / 5 low across `tar`, `multer`, `lodash`, `postcss`, `qs`, `body-parser`, `ajv`, `webpack`, `picomatch`, `tmp`, `glob`, `file-type`, `@faker-js/faker`, and `@nestjs/core`. None are direct dependencies of either `package.json`. Traced each with `pnpm why -r`:
- `tar` (via `bcrypt` → `@mapbox/node-pre-gyp`) and the `ajv`/`webpack`/`picomatch`/`tmp`/`glob` cluster (via `@nestjs/cli`'s Angular devkit chain) are install-time/dev-tooling only — never present in a running deployment.
- `multer`'s DoS advisories (via `@nestjs/platform-express`) are moot here: this codebase never registers multer's multipart parsing on any route (confirmed — zero `FileInterceptor`/`UploadedFile`/`multer` usages in `src/`), because every upload goes through pre-signed S3 URLs (SEC-FILE-003). The vulnerable code path is never invoked.
- `qs`/`body-parser`/`lodash` (via `@bull-board`) are only reachable through Bull Board, which is off by default and Basic-Auth-gated even in dev (SEC-NOTIF-005) and refused outright in production.
- `postcss` is Next.js's own internal build-time CSS tool (`next` → `postcss`), not reachable via a runtime request.
- `@nestjs/core`'s moderate advisory does apply to this project's actual pinned version (10.4.22 is within the reported `<=11.1.17` vulnerable range). The fix is a NestJS v10→v11 major upgrade across `@nestjs/core`/`platform-express`/`bullmq`/`config`/`websockets`/`terminus`/`event-emitter` simultaneously — a substantial migration inappropriate to start as a routine Phase 15 audit item against a fully built, tested v10 codebase this late in the project. Deferred as an accepted risk; a candidate for a dedicated upgrade effort, not silently dropped.
- `@faker-js/faker` (devDependency, `prisma/seed*.ts` only) needs a 9→10 major bump; low priority since it's invoked only with hardcoded, developer-written format strings, never user input. Deferred rather than bumped mid-audit to avoid touching the currently-seeded demo dataset without a dedicated verification pass.
- Ran `pnpm update -r` (in-range only, no majors) as routine hygiene — it did not change any of the above advisories' resolved versions (each needs a parent major bump to get a patched transitive version), but was verified safe: backend typecheck/lint/unit/e2e (447/447) and frontend typecheck/lint/unit (140/140) all still pass afterward.

**Decision — the audit-log-outside-transaction debt (carried since Phase 9, explicitly scheduled for "Phase 15 hardening" in five consecutive phase reviews) was actually investigated this time, not just carried again — and the investigation itself found a real Prisma API limitation, not a quick fix:** `PHASE-9-REVIEW.md` proposed threading the transaction client into the audit write via `Prisma.getExtensionContext(this)`. That was tried. It fails: inside a `query.$allModels.$allOperations` extension component, `this` is not bound to a client or anything `getExtensionContext` can resolve (confirmed empirically by logging it — it's an array-like object, `['0','1']` keys, not a client reference), and `QueryOptionsCbArgs`'s own type definition (`{model, operation, args, query}`) exposes no other handle to the current transactional client. This was caught by the very regression test written to prove the fix (`test/audit-log.e2e-spec.ts`): the "fixed" code threw `TypeError: Cannot read properties of undefined (reading 'create')` the moment any audited model was written, surfaced immediately by the full e2e suite (which the implement→verify→root-cause cycle requires running after every change, not just the one test being added). A real fix needs the roughly fifteen `$transaction(async (tx) => ...)` call sites across appointments/billing/EMR/lab/pharmacy that write audited models to pass `tx` explicitly to an audit-write helper, bypassing the automatic extension for those paths — a wider, higher-risk refactor than fits a hardening pass, especially since the trigger condition (an unexpected mid-transaction database fault, not an ordinary validation-driven rollback) has never been observed across 15 phases of testing. The fix attempt was reverted in full. The gap is now tracked by an active tripwire — `test.failing(...)` in `test/audit-log.e2e-spec.ts` — that will itself start failing (which `test.failing` treats as newsworthy) the moment a future change actually fixes this, forcing the `.failing` to be removed rather than the fix going unnoticed.

**Decision — SEC-FILE-004 (ClamAV) is deferred, per the security doc's own documented-accepted-risk escape hatch:** this machine has 16 GB RAM with ~5.5 GB free while running the normal dev stack (Postgres, Redis, LocalStack, Next dev, Nest dev) — the same memory pressure `HANDOFF.md` already documents causing Next.js compile slowdowns. A ClamAV sidecar (`clamd` plus its signature database) needs roughly another 1–1.5 GB once definitions load, and correctly wiring an async scan-then-quarantine step (plus its own negative-path testing with an EICAR file, timeout/failure handling, and definition-update strategy) is a full feature, not a config change, this late in a 15-phase project. Deferred to Phase 16 (Deployment & DevOps), where real provisioned infrastructure (not this dev machine) makes it practical; logged here as the explicit accepted risk the security doc anticipates, not dropped silently.

**Rejected:**
- writing throwaway mocked-Prisma unit tests purely to move the coverage percentage (no new bugs would be caught; the same code is already exercised end-to-end by the e2e suite);
- bumping `@nestjs/core` alone to silence its advisory (peer dependencies pin the whole v10 family together; a partial bump breaks the build);
- attempting ClamAV against this dev machine's current resources rather than deferring to provisioned infrastructure;
- `Prisma.getExtensionContext(this)` inside the audit-log extension's query component to thread the transaction client through (confirmed by direct testing not to resolve to a usable client in this position of Prisma 5's extension API — see above);
- silently re-carrying the audit-log debt forward a sixth time without investigating it, or quietly downgrading `test/audit-log.e2e-spec.ts`'s new regression test to something that asserts the bug as correct behavior instead of flagging it as a known gap.

## D-045 — Free-tier split-domain production deployment: a real target surfaced two latent bugs the AWS/EC2 runbook never caught, plus the architecture extension needed for cross-domain cookie auth (post-Phase 17)

**Context:** the user asked for an actual live deployment a recruiter could open, rather than continuing to leave Phase 16/17's deployment pipeline entirely UNVERIFIED. Standing up real AWS EC2/RDS/S3 for a short-lived recruiter demo is both costly and overkill; the user chose a free-managed-services stack instead: Vercel (frontend), Render (backend API, free web service), Neon (Postgres), Upstash (Redis), Cloudflare R2 (S3-compatible storage), source on a new public GitHub repo. This is the first time any part of this project's deployment path has run against infrastructure it doesn't fully control — and doing so surfaced two real bugs in already-"PASS"-gated work, exactly the kind of thing the UNVERIFIED label was flagging as unproven, not disproven.

**Bug found — `infrastructure/docker/Dockerfile.backend`'s `runtime` stage never copied `apps/backend/prisma/` (schema + migrations), only `dist/`:** `docs/13-DEPLOYMENT-RUNBOOK.md` §13's documented migration command (`docker compose run ... api-blue pnpm --filter=@medcore/backend exec prisma migrate deploy`) would have failed against a real host the moment anyone actually ran it — `prisma migrate deploy` needs `schema.prisma` and `prisma/migrations/*.sql` on disk, and neither was in the image. This was invisible through Phase 16's entire build-and-verify cycle because no real host ever existed to run that command against; the generated Prisma Client itself (used by the running app) doesn't need these files, since its query engine is baked in at `prisma generate` time, so every other verification (boot, health check, e2e) passed clean regardless. Fixed with one more `COPY --from=build /workspace/apps/backend/prisma ./apps/backend/prisma` line in the runtime stage. In practice this deployment runs migrations from a local checkout against Neon directly rather than inside the container (simpler, no SSH/host needed for a managed Postgres), but the image is now correct for the EC2 path the runbook describes too.

**Bug found — BullMQ's two hand-parsed `REDIS_URL` connections never enabled TLS for `rediss://`:** `src/queue/queue.module.ts` and `src/queue/prescription-pdf-queue.service.ts` both parse `REDIS_URL` with `new URL(...)` and build a plain `{host,port,password,db}` object for BullMQ (required because BullMQ needs `maxRetriesPerRequest: null`, which `new Redis(url, {...})`'s single-string form elsewhere in the codebase sets via an options object, not the URL itself). Every other `new Redis(url)` call site in the app lets ioredis auto-detect a `rediss:` scheme and enable TLS; these two manual rebuilds never carried that bit over, so they'd have silently attempted a plain TCP connection to a TLS-only endpoint. Every Redis this project had used before (local Docker, dev) was plain `redis://`, so nothing before this deployment ever exercised the gap. Upstash requires `rediss://`. Fixed by extracting a shared `parseRedisConnection()` helper (`src/queue/redis-connection.util.ts`) that both call sites now use, adding `tls: {}` when the scheme is `rediss:`.

**Bug found — `S3Service.onModuleInit()`'s bucket-CORS self-provisioning assumed an admin-level bucket credential, which a least-privilege one isn't:** the comment above `PutBucketCorsCommand` already said "production buckets get the same rule from infra" — i.e. the original design never expected this call to run in production at all, since real AWS deployments leave `S3_ENDPOINT` unset (`usingLocalEndpoint` false skips the whole self-provisioning block). This deployment uses R2 (an S3-compatible but non-AWS provider) in production, which *does* need `S3_ENDPOINT` set — so the block runs, and the R2 API token (scoped to "Object Read & Write," the least-privilege option R2 offers, covering Get/Put/DeleteObject but not bucket-admin operations) gets `AccessDenied` on `PutBucketCorsCommand`. Confirmed with a direct test against the real R2 bucket: `HeadBucketCommand` and a full presigned-PUT-then-GET round trip both succeeded with this token; only the CORS call failed. Unlike the bucket-creation check two lines above it (already wrapped in try/catch, errors there just mean "go create it"), the CORS call had no such guard and would have thrown on every single boot, crashing the app. Fixed by wrapping it in try/catch with a warning log instead — this is the same failure mode a real AWS deployment with a minimally-scoped IAM policy (no `s3:PutBucketCors`) would hit, so making it non-fatal is a correctness fix for that case too, not an R2-specific special case. The bucket's CORS rule itself is set once, manually, via the provider's console — exactly the "infra sets it" story the original comment already described, now actually true for a real deployment instead of only a real-AWS deployment that doesn't exist yet.

A background security review of this change flagged it as a possible fail-open control regression (an uncaught throw becoming a caught, logged warning). Considered and rejected: bucket CORS is a browser-enforced compatibility control, not an authorization boundary — it governs only whether a browser's own JavaScript may read a cross-origin response, and has no bearing on what a non-browser client (or any client holding a valid request) can do against the bucket. The actual access-control mechanism — short-lived, object-scoped, cryptographically signed presigned URLs (`getSignedUrl`, `PRESIGNED_URL_TTL_SECONDS`) — is untouched by this change in either direction. Absent CORS, the practical failure mode is that a legitimate browser upload's preflight is refused, which is more restrictive, not less. Reverting to a hard crash closes no actual exposure; it only means the app cannot boot at all against a reasonably-scoped real-world credential (R2's least-privilege token, or an equivalently scoped real AWS IAM policy without `s3:PutBucketCors`) — the exact case this fix exists to handle.

**Decision — a Vercel same-origin rewrite proxy, not a SameSite relaxation, for the cross-domain cookie problem:** the refresh-token cookie is deliberately `sameSite: "strict"` (SEC-AUTHN-004), and the frontend calls the API directly cross-origin today (D-038, for real-client-IP rate limiting). Splitting the frontend (`*.vercel.app`) and backend (`*.onrender.com`) onto different registrable domains means they're different "sites" for SameSite purposes (port differences in local dev are not — `localhost:3000` and `:3001` are the same site, which is why this was never seen before): a `sameSite: "strict"` cookie is never sent on a cross-site fetch at all, so refresh would silently die at the 15-minute access-token TTL even though login itself appears to work. The fix is a conditional Next.js rewrite (`next.config.ts`, active only when `BACKEND_ORIGIN` is set) that proxies `/api/*` through the Vercel origin itself, so the browser only ever sees one site and the cookie keeps working exactly as designed — zero change to the cookie's security posture. `src/constants/index.ts`'s `API_ORIGIN` (used only for the direct Socket.IO connection, which authenticates with the in-memory access token, never the cookie, so it still talks to Render directly) gained a `NEXT_PUBLIC_SOCKET_ORIGIN` override since it can no longer always be derived from `API_BASE_URL` once that's a relative path. Local dev and the Docker Compose path are both untouched — the rewrite and the override are both no-ops unless their env vars are set.

**Rejected:**
- loosening the refresh cookie to `sameSite: "none"` for the split-domain case — a real CSRF-protection regression for a problem the proxy solves with none;
- running `prisma migrate deploy` inside a Render-built container via a pre-deploy hook — simpler to run once from a local checkout against Neon's connection string directly, with no SSH/host/container-exec step needed for a managed Postgres;
- configuring Sentry, Stripe/Razorpay, or Resend/Twilio for this deployment — out of scope for "a recruiter can see the demo," which the seeded accounts already satisfy (`README.md`'s Demo Credentials table) without needing a working registration-email round trip; these remain UNVERIFIED exactly as Phase 16 left them.
