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
