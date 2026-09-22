# MedCore HMS

Multi-tenant Hospital Management Platform. Full product/architecture documentation lives in [`docs/`](./docs) — start with [`docs/01-PRD.md`](./docs/01-PRD.md) and [`docs/05-DEVELOPMENT-PLAN.md`](./docs/05-DEVELOPMENT-PLAN.md) for the phase roadmap.

> This README covers local setup only. The full deliverable version (demo credentials, deployed URLs, architecture summary, video walkthrough) is written in Phase 17 once there's a running product to describe.

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
- Health checks: http://localhost:3001/health, http://localhost:3001/health/ready

To run the apps without Docker (useful for fast iteration):

```bash
pnpm run dev   # runs both apps' dev servers in parallel
```

## Monorepo Layout

```
apps/frontend    Next.js 15 app
apps/backend     NestJS API
packages/types   Shared TypeScript types/DTOs/enums — imported by both apps
packages/config  Shared TypeScript/ESLint base configuration
infrastructure/  Dockerfiles, Nginx config
docs/            Full documentation set (PRD, SRS, architecture, ER diagrams, RBAC, API contract, security, testing, decisions)
```

## Common Commands

| Command              | Effect                                            |
| -------------------- | ------------------------------------------------- |
| `pnpm run lint`      | Lint every workspace package                      |
| `pnpm run typecheck` | Type-check every workspace package                |
| `pnpm run test`      | Run unit tests                                    |
| `pnpm run build`     | Build every workspace package (topological order) |

## Documentation Index

See [`docs/`](./docs) for the PRD, SRS, architecture, UI/UX system, database/ER design, RBAC matrix, API contract, security threat model, testing strategy, and the decision log explaining every non-obvious engineering choice.
