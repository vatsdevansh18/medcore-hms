# CLAUDE.md

Guidance for Claude Code sessions working on MedCore HMS.

## What this project is

A multi-tenant Hospital Management Platform, built under a strict phase-gated methodology. **Read `docs/05-DEVELOPMENT-PLAN.md` first** to find the current phase, then the specific `docs/*.md` files relevant to the work at hand. `docs/phase-reviews/PHASE-X-REVIEW.md` files record what's actually been completed and gated — treat them as more current than this file for "where are we."

**`docs/12-QUALITY-PROTOCOL.md` is mandatory reading before doing any implementation work in this repo.** It's a user-mandated, standing rule (not a suggestion) covering the implement→verify→root-cause-fix→re-verify cycle, mandatory negative/edge-case testing, continuous security review, multi-tenancy/RBAC verification requirements, "no fake completion," and the full phase-review format. A phase cannot reach PASS without going through it.

## Non-negotiable rules

- **Never start a phase's implementation without the user's explicit "START PHASE N."** Finishing a phase means writing `docs/phase-reviews/PHASE-X-REVIEW.md` (format: `docs/12-QUALITY-PROTOCOL.md` §23) and stopping — not silently continuing to the next phase.
- **The brief (`docs/source/InternMo_HMS_Brief.docx`) is the source of truth for scope.** `docs/01-PRD.md` refines it; `docs/11-DECISIONS.md` records every place scope, architecture, or the brief's own suggestions were interpreted, extended, or deviated from, with rationale. Check that file before assuming a gap is an oversight — it's probably a documented decision.
- **Tenancy isolation and RBAC are release-blocking, not "nice to have."** Any change touching a tenant-scoped model must go through the three-layer enforcement in `docs/03-ARCHITECTURE.md` §5. A cross-tenant data leak is a Critical defect that blocks the phase gate outright.
- **All requirement/security/test IDs are stable.** `FR-*`, `NFR-*`, `SEC-*` IDs defined in `docs/02-SRS.md` and `docs/09-SECURITY.md` are never renumbered — a superseded one is marked `[SUPERSEDED by ...]`, never deleted or silently reused.
- **`packages/types` is the single source of truth for API shapes.** DTOs/enums are added there first, then consumed by both apps — never duplicated ad hoc in one app.

## Monorepo conventions

- Package manager is **pnpm** (workspaces); do not introduce npm/yarn lockfiles.
- `@medcore/types` is consumed as compiled JS (`dist/`), not raw TS — it has a real `build` step because neither `ts-node` (backend dev) nor Next's compiler transpile arbitrary TypeScript found inside `node_modules` by default. **Any edit to `packages/types/src/*` requires `pnpm --filter=@medcore/types run build` (or a root `pnpm run build`) before the change is visible to either app** — its `dist/` is stale otherwise, and the failure mode is a confusing runtime error (e.g. `Cannot read properties of undefined (reading 'SOME_ENUM_MEMBER')`) rather than a type error, since `ts-node --transpile-only` skips type-checking.
- `packages/config` holds the shared ESLint flat-config base and TS base `tsconfig`; app-specific configs extend it rather than redefining rules. The frontend is the one exception — it uses Next's own `eslint-config-next` directly (documented in `docs/phase-reviews/PHASE-1-REVIEW.md`) since it already bundles the React/Next-specific rules our generic base doesn't cover.
- Node/pnpm versions: `package.json` `engines` states minimums (`node >=20`, `pnpm >=9`), not exact pins — the local dev machine may run newer versions. Docker images and CI pin exact versions (`node:20-alpine`, pnpm `9.15.4`) for reproducibility. Don't "fix" the `engines` field to match local `node --version`.
- Docker Compose (dev) bind-mounts each app's `src/` for hot reload but **bakes `packages/` in at image build time** — after editing `packages/types`, run `docker compose build api frontend` before `docker compose up` picks up the change.

## Where things live

- Architecture decisions with rejected alternatives: `docs/11-DECISIONS.md` — append here, never overwrite.
- RBAC enforcement spec (what every guard should allow/deny): `docs/07-RBAC-MATRIX.md` — this is what authorization tests are generated from.
- Endpoint index: `docs/08-API-CONTRACT.md` — Swagger (once wired, Phase 3+) is the generated mirror of this, not a separate source of truth.
- The 9 mandatory test scenarios from the brief, traced to requirements: `docs/10-TESTING-STRATEGY.md` §3.
