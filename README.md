# MedCore HMS

A multi-tenant Hospital Management Platform: patient records, appointments, EMR, prescriptions, lab orders, pharmacy inventory, billing/payments, staff RBAC across nine roles, real-time notifications, and role-specific analytics dashboards — for multiple hospitals on one shared deployment, with tenant data fully isolated at the database, service, and test layers.

Built across 17 phases under a strict phase-gated methodology. Full product/architecture documentation lives in [`docs/`](./docs) — start with [`docs/01-PRD.md`](./docs/01-PRD.md) and [`docs/05-DEVELOPMENT-PLAN.md`](./docs/05-DEVELOPMENT-PLAN.md) for the phase roadmap, or [`docs/11-DECISIONS.md`](./docs/11-DECISIONS.md) for why every non-obvious engineering choice was made the way it was. [`docs/PROJECT-REPORT.docx`](./docs/PROJECT-REPORT.docx) is the narrative version — key technical decisions, real bugs found and root-caused, and lessons learned — and [`docs/14-VIDEO-WALKTHROUGH-SCRIPT.md`](./docs/14-VIDEO-WALKTHROUGH-SCRIPT.md) is a timed script for a 5–8 minute product walkthrough.

## Live Demo

**Not currently deployed.** `docs/13-DEPLOYMENT-RUNBOOK.md` is a complete, ready-to-execute checklist (AWS EC2/RDS/S3, Upstash Redis, Vercel, Let's Encrypt) for standing up a live instance — Phase 16 built and locally verified every piece of that pipeline (including a health-check-gated blue-green deploy script, proven zero-downtime end to end) without provisioning real, billable cloud infrastructure. See `docs/phase-reviews/PHASE-16-REVIEW.md` for exactly what's built-and-verified versus pending real credentials.

Once deployed, this section names the live frontend (Vercel) and API (`https://api.<domain>/api`, with Swagger UI at `https://api.<domain>/api/docs`) URLs.

## Demo Credentials

Every account uses the password **`Demo123!`**. Seeded by `pnpm run db:seed` (master data) and `pnpm run db:seed:history` (two weeks of visit/billing/lab history) — see `apps/backend/prisma/seed.ts`.

Two hospitals, each with a full staff roster:

| Role | Email pattern | Example |
| --- | --- | --- |
| Hospital Admin | `hospitaladmin@<hospital-slug>.medcore.test` | `hospitaladmin@medcore-city.medcore.test` |
| Doctor (×4 per hospital) | `dr.<firstname>.<lastname>@<hospital-slug>.medcore.test` | `dr.wade.weimann@medcore-city.medcore.test` |
| Nurse | `nurse@<hospital-slug>.medcore.test` | |
| Receptionist | `receptionist@<hospital-slug>.medcore.test` | |
| Lab Technician | `lab_technician@<hospital-slug>.medcore.test` | |
| Pharmacist | `pharmacist@<hospital-slug>.medcore.test` | |
| Accountant | `accountant@<hospital-slug>.medcore.test` | |

Hospital slugs: `medcore-city` (Bengaluru), `medcore-metro` (Pune).

| Role | Email |
| --- | --- |
| Super Admin (platform-wide, all hospitals) | `superadmin@medcore.test` |
| Patient (×30, across both hospitals) | any `*@patient.medcore.test` address — see `apps/backend/prisma/seed.ts` for the generated list, or sign in as staff and look up a patient by name |

The history seed also adds a second Lab Technician per hospital (`lab_reviewer@<hospital-slug>.medcore.test`) so the four-eyes lab-result approval workflow (`FR-LAB-004`) has two distinct testable accounts.

## Architecture Overview

A layered modular monolith: NestJS API behind Nginx, a Next.js 15 frontend, PostgreSQL as the system of record, Redis for sessions/cache/queues, S3 for files, Socket.IO for real-time push, and BullMQ workers sharing the Redis instance for background jobs (email, SMS, PDF generation, reminders, nightly stock-expiry scans). One deployable monolith by design, not microservices — see `docs/11-DECISIONS.md` D-003 for why.

**Diagrams** (both generated from source, not hand-drawn-then-abandoned):
- [`docs/diagrams/architecture-diagram.excalidraw`](./docs/diagrams/architecture-diagram.excalidraw) — system components and data flow, matching `docs/03-ARCHITECTURE.md` §1. Open at [excalidraw.com](https://excalidraw.com) (File → Open) or in the Excalidraw VS Code extension; a static [`architecture-diagram.png`](./docs/diagrams/architecture-diagram.png) render sits alongside it for a quick look without opening Excalidraw.
- [`docs/diagrams/er-diagram.svg`](./docs/diagrams/er-diagram.svg) — the full database ER diagram, generated directly from `apps/backend/prisma/schema.prisma` on every `prisma generate` (via the `erd` generator block in that file) — it cannot drift from the actual schema. Regenerate with `pnpm --filter=@medcore/backend exec prisma generate`.

Tenancy isolation is enforced in three independent layers (a Prisma extension that auto-scopes every query, service-layer re-verification, and CI-blocking regression tests) — see `docs/03-ARCHITECTURE.md` §5 and `docs/09-SECURITY.md` SEC-TENANT-*. RBAC is a global NestJS guard with deny-by-default (a route with no `@Roles()`/`@Public()` decorator is refused, not silently allowed), checked in CI by `apps/backend/test/route-authorization.e2e-spec.ts`.

## API Documentation

**Swagger UI:** `http://localhost:3001/api/docs` once the backend is running (see Local Development below) — auto-generated from the same DTOs and `class-validator` decorators the API actually validates against, via the `@nestjs/swagger` Nest CLI plugin (`nest-cli.json`), so it can't silently drift from the real request/response shapes. `docs/08-API-CONTRACT.md` is the human-curated endpoint index and the source of truth for *why* an endpoint behaves the way it does; Swagger is its generated mirror.

## Test Coverage Report

Business logic here is verified almost entirely by integration tests against a real, ephemeral Postgres instance — not mocked-Prisma unit tests — because that's the layer that actually catches tenancy/authorization bugs (`docs/10-TESTING-STRATEGY.md` §1, `docs/11-DECISIONS.md` D-044). The coverage report reflects that:

```bash
cd apps/backend
pnpm run test:e2e:coverage   # needs Postgres/Redis/LocalStack up — see below
open coverage-e2e/index.html
```

Current numbers (Phase 17): **92% statements, 93% functions, 93% lines, 71% branches** — all above the brief's 70% target.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable` will pick up the pinned version from `package.json`)
- Docker + Docker Compose

## Local Development

```bash
cp .env.example .env      # fill in values as integrations are wired up per-phase
pnpm install
docker compose up --build
```

- Frontend: http://localhost:3000 (direct) or http://localhost/ (via Nginx)
- Backend API: http://localhost:3001/api (direct) or http://localhost/api (via Nginx)
- Swagger UI: http://localhost:3001/api/docs
- Health checks: http://localhost:3001/health, http://localhost:3001/health/ready

To run the apps without Docker (useful for fast iteration):

```bash
pnpm run dev   # runs both apps' dev servers in parallel
```

Seed demo data once the database is up:

```bash
cd apps/backend
pnpm run db:seed            # master data: 2 hospitals, staff, doctors, patients, catalogs
pnpm run db:seed:history    # two weeks of visits/bills/labs — idempotent, safe to re-run
```

## Monorepo Layout

```
apps/frontend    Next.js 15 app
apps/backend     NestJS API
packages/types   Shared TypeScript types/DTOs/enums — imported by both apps
packages/config  Shared TypeScript/ESLint base configuration
infrastructure/  Dockerfiles, Nginx config (dev and production/TLS)
scripts/deploy/  Health-check-gated blue-green deploy script
docs/            Full documentation set (PRD, SRS, architecture, diagrams, RBAC, API contract, security, testing, decisions, deployment runbook)
```

## Common Commands

| Command | Effect |
| --- | --- |
| `pnpm run lint` | Lint every workspace package |
| `pnpm run typecheck` | Type-check every workspace package |
| `pnpm run test` | Run unit tests |
| `pnpm run build` | Build every workspace package (topological order) |
| `pnpm --filter=@medcore/backend run test:e2e` | Backend integration/e2e suite (needs Postgres/Redis/LocalStack) |
| `pnpm --filter=@medcore/backend run test:e2e:coverage` | Same suite, with the HTML coverage report |
| `pnpm --filter=@medcore/frontend exec playwright test` | Browser E2E suite (needs the full stack running) |

## Testing

Nine mandatory scenarios and eight risk-based scenarios from the original brief are each covered by a dedicated integration test — audited and confirmed in Phase 15 (`docs/phase-reviews/PHASE-15-REVIEW.md`), traced in `docs/10-TESTING-STRATEGY.md` §3/§4. A tenancy-isolation or authorization test failure is treated as release-blocking, not a normal test failure.

## Deployment & CI/CD

`.github/workflows/ci.yml`: lint/typecheck/build and unit tests on every PR; integration tests plus a Docker image build on every push to `main`; a health-check-gated blue-green production deploy on a version tag. The repository has no GitHub remote yet, so this pipeline has been verified by exact local reproduction of its services and environment, not a real Actions run — see `docs/phase-reviews/PHASE-15-REVIEW.md` and `PHASE-16-REVIEW.md`, and `docs/13-DEPLOYMENT-RUNBOOK.md` for the steps to make it real.

## Documentation Index

See [`docs/`](./docs) for the PRD, SRS, architecture, UI/UX system, database/ER design, RBAC matrix, API contract, security threat model, testing strategy, the deployment runbook, and the decision log explaining every non-obvious engineering choice. `docs/phase-reviews/` has a full PASS/FAIL record for every one of the 17 phases.
