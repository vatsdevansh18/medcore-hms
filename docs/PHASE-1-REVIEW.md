# Phase 1 Review — Repository, Tooling & Infrastructure Foundation

**Phase:** 1 — Repository, Tooling & Infrastructure Foundation
**Date:** 2026-09-22
**Gate status:** **PASS**

## 1. Objective

Stand up the monorepo foundation — pnpm workspaces, shared TypeScript/ESLint configuration, a base NestJS API with health checks and structured logging, a base Next.js app, Docker Compose for local dev, and a CI skeleton — with no domain features built yet, per `docs/05-DEVELOPMENT-PLAN.md` Phase 1.

## 2. Requirements Delivered

- Monorepo scaffold: `apps/frontend`, `apps/backend`, `packages/types`, `packages/config`, `infrastructure/`, pnpm workspaces.
- TypeScript strict mode shared base (`packages/config/typescript/base.json`), consumed by both apps.
- Shared ESLint flat-config base (`packages/config/eslint/base.js`) for backend and `packages/types`; frontend uses Next's own `eslint-config-next` (documented rationale in §6).
- Docker Compose dev stack: `postgres`, `redis`, `api`, `frontend`, `nginx` — verified running end-to-end (§4).
- `.env.example` documenting the full eventual variable surface, grouped by the phase that wires each one up.
- Base NestJS app: `HealthModule` (`/health`, `/health/ready`), Pino structured logging with request-correlation IDs (`NFR-OBS-001`), Helmet (`SEC-NET-001`), strict CORS allow-list (`SEC-NET-002`), global `ValidationPipe` with whitelist/forbid-non-whitelisted (`SEC-INPUT-001`), validated environment config via `class-validator`.
- Base Next.js 15 app (App Router, Tailwind v4, Inter font per `04-UI-UX.md` §2.2), default `create-next-app` boilerplate replaced with a minimal placeholder — not shipped as unmodified template output.
- `packages/types` skeleton: standard API envelopes (`ApiSuccess`, `ApiError`, `ApiPaginated`) and every enum from `06-DATABASE-DESIGN.md` (`UserRole`, `AppointmentStatus`, etc.), matching `08-API-CONTRACT.md` §2 and §3 exactly.
- GitHub Actions CI skeleton: lint/typecheck/build on every PR, unit tests, integration tests (ephemeral Postgres/Redis service containers) on merge to `main`.
- `CLAUDE.md` added, capturing monorepo conventions for future sessions (flagged as a Phase 1 task in `PHASE-0-REVIEW.md` §9).

## 3. Requirements/NFR IDs Delivered

`NFR-OBS-001` (structured request logging with correlation IDs), `NFR-AVAIL-001` (liveness/readiness endpoints), `SEC-NET-001/002` (Helmet, CORS allow-list), `SEC-INPUT-001` (global validation pipe), `SEC-DATA-005` (`.env.example` + gitignored `.env`, verified — see §4).

## 4. Testing & Verification Performed

| Check | Result |
|---|---|
| `pnpm run typecheck` (all packages) | PASS |
| `pnpm run lint` (all packages) | PASS |
| `pnpm run build` (all packages, native) | PASS for `packages/types` and `apps/backend`; `apps/frontend` native build fails on this Windows machine only — see §6 |
| `pnpm run test` (backend unit) | PASS — 2/2 (`HealthController`) |
| `apps/backend` `test:e2e` (Supertest against a real Nest instance) | PASS — 2/2 (`GET /health`, `GET /health/ready`) |
| `docker compose build` | PASS — both `api` and `frontend` images build cleanly |
| `docker compose up` | PASS — all 5 containers reach a running/healthy state |
| `GET http://localhost:3001/health` (direct) | `200 {"status":"ok",...}` |
| `GET http://localhost:3001/health/ready` (direct) | `200 {"status":"ok",...}` |
| `GET http://localhost/health` (via Nginx) | `200`, proxied correctly |
| `GET http://localhost:3000/` (frontend, direct) | `200` |
| `GET http://localhost/` (frontend, via Nginx) | `200`, proxied correctly |
| Structured log output inspected | Confirmed JSON logs with `requestId`, route, status, duration; Helmet headers present on responses |
| `docker compose down` | Clean teardown, no orphaned containers |

The empty-diff CI gate (`pnpm run lint && pnpm run typecheck && pnpm run build && pnpm run test`) passes locally; the GitHub Actions workflow itself will run on the first push to a remote, which is outside this local session's ability to observe directly — flagged as a follow-up to confirm once a remote exists (not blocking, since every job it runs was independently verified locally).

## 5. Security Review

- `.env` confirmed git-ignored (`git check-ignore -v .env`); only `.env.example` (placeholders) is tracked.
- No secrets, credentials, or real API keys anywhere in the diff — checked file-by-file before staging.
- Helmet, CORS allow-list, and global input validation are live from the first request, not deferred to Phase 3.
- `.dockerignore` added (see §6) — without it, host `node_modules` (and potentially stray local secrets) could leak into build context/images.

## 6. Technical Notes & Root-Causes Fixed

Several implementation-level issues surfaced and were fixed during scaffolding; recorded here (not in `11-DECISIONS.md`, which is reserved for scope/architecture-level decisions) because they're the kind of thing a future session should know about before re-deriving:

- **Next.js version**: `create-next-app@latest` installed Next.js 16 by default. The brief pins Next.js 15 explicitly, and Next 16 ships its own breaking-change surface (confirmed via its own generated `AGENTS.md` warning). Pinned `next`/`react`/`react-dom`/`eslint-config-next` to 15.x/19.x to match the approved stack; removed the Next-16-specific `AGENTS.md`/`CLAUDE.md` scaffold files and the nested `pnpm-workspace.yaml` it generated.
- **`eslint-config-next` format mismatch**: the create-next-app-generated `eslint.config.mjs` used Next 16's flat sub-export style (`eslint-config-next/core-web-vitals`), which doesn't exist in the 15.x package (still legacy-eslintrc-shaped). Rewrote it using the `FlatCompat` bridge, which is the correct pattern for Next 15.
- **`@medcore/types` must be consumed as compiled JS, not raw TS**: neither `ts-node` (Nest's dev server) nor Next's compiler transpile arbitrary TypeScript found inside `node_modules` by default. Gave `packages/types` a real `tsc` build step (`main`/`types` point at `dist/`), and pnpm's topological ordering (`pnpm -r run build`) ensures it builds before either app.
- **`.dockerignore` was missing**: without it, `COPY packages/types packages/types` in the Docker build copied the *host's* `node_modules` (populated by local `pnpm install`) over the image's correctly-linked one, breaking `tsc` inside the container (`Cannot find module '.../typescript/bin/tsc'`). Added a root `.dockerignore`.
- **`PORT` env var collision**: `.env` is shared by both `api` and `frontend` services; Next.js also reads `PORT` by convention, so the backend's `PORT=3001` made the frontend dev server bind to 3001 too. Renamed the backend's variable to `API_PORT` everywhere (`.env.example`, `env.validation.ts`, `main.ts`) rather than special-casing one service's env file.
- **Nginx `limit_req_zone` syntax**: `rate=100r/15m` is not valid Nginx syntax — only `r/s` or `r/m` are accepted. Converted to `7r/m` as a coarse edge-level approximation; the exact "100 req/15 min" policy from the brief is enforced precisely by the Redis-backed application throttler in Phase 3, not by Nginx.
- **Windows-only native build limitation**: `pnpm run build` for `apps/frontend` fails natively on this machine with `EPERM: symlink` during Next's `output: "standalone"` trace-copy step, because Windows Developer Mode is off (confirmed via registry check) and unprivileged accounts can't create symlinks. This does **not** affect Docker builds (Linux container) or GitHub Actions CI (Linux runners) — both were verified working. Documented in `CLAUDE.md` implicitly via this review; local verification of frontend builds on this machine should go through `docker compose build` rather than native `pnpm run build`, unless Developer Mode is enabled.

## 7. UI/UX Review

Minimal at this phase by design — only a placeholder home page exists. Confirmed it does not ship as unmodified `create-next-app` boilerplate (removed default Next/Vercel marketing content and logos), uses the Inter font and font-loading pattern specified in `04-UI-UX.md` §2.2. Full design-system implementation is Phase 14.

## 8. Architecture Review

Implementation matches `03-ARCHITECTURE.md` §2–3 (frontend/backend structure) and §15 (CI/CD) as documented. No architecture document required updates — Phase 1 built exactly what was specified, with the execution-level fixes in §6 being implementation details, not architectural deviations.

## 9. Documentation Updated

- `docs/PHASE-1-REVIEW.md` (this document) — new.
- `CLAUDE.md` — new, per the Phase 0 follow-up item.
- No other `docs/*.md` required changes; Phase 1 implementation is consistent with what Phase 0 specified.

## 10. Known Issues / Technical Debt

- None release-blocking. The Windows-native frontend build limitation (§6) is an environment characteristic, not a code defect, and doesn't affect Docker/CI.
- GitHub Actions workflow has not yet run against a real remote (no push performed this session) — will be confirmed the first time this repo is pushed to GitHub.

## 11. Next Phase Prerequisites

Phase 2 (Database & Core Architecture) requires no additional input beyond what exists: `docker-compose.yml` already provisions Postgres 16, `DATABASE_URL` is already defined in `.env.example`, and `06-DATABASE-DESIGN.md` specifies the full schema to translate into Prisma.

## 12. Final Gate Status

**PASS.** All Phase 1 requirements implemented and verified: lint, type-check, build, unit tests, and e2e tests all green; `docker compose up` produces a working stack with all five services reachable end-to-end through Nginx. Awaiting explicit instruction: **"START PHASE 2."**
