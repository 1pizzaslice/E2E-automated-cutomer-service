# E2E Automated Customer Service

Backend-first platform for an AI-first customer support BPO. The system will ingest support messages from channels like email and WhatsApp, normalize them into tickets, run durable workflows, use AI for triage and drafting, keep humans in approval loops, and capture audit/eval signals for continuous improvement.

Current status: documentation harness, backend scaffold, database/RLS foundation, and first Milestone 3 API skeleton. No business workflow implementation yet.

## Start Here

1. Read `AGENTS.md`.
2. Read `TODO.md`.
3. Read `docs/README.md`.
4. Read `docs/PROJECT_HISTORY.md`.
5. For implementation details, use only the relevant deep doc under `docs/`.

The docs are intentionally split by purpose so future AI sessions do not need to load thousands of lines at once. Use `docs/README.md` as the routing map.

## Local Requirements

- Node.js 24+ recommended.
- pnpm 11+.
- Python 3.12+.
- Docker with Compose v2.

`uv` is preferred for the future Python workspace, but it is not currently required by this scaffold. The initial Python checks use the standard library `unittest` runner so the repository can validate without installing Python dependencies.

## Commands

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm db:migrate
pnpm dev
pnpm infra:up
pnpm infra:down
pnpm test:py
```

## Repository Layout

```text
.
├── AGENTS.md
├── PLAN.md
├── TODO.md
├── docs/
├── packages/
│   ├── api/
│   ├── db/
│   ├── integrations/
│   ├── shared-schemas/
│   └── workers/
├── ai/
│   ├── evals/
│   └── runtime/
├── infra/
│   ├── docker-compose.yml
│   └── otel/
└── .github/workflows/ci.yml
```

## Local Infrastructure

```bash
pnpm infra:up
```

Live PostgreSQL integration tests require the local PostgreSQL service and cover repository tenant filters plus PostgreSQL RLS:

```bash
DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration
```

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6380`
- NATS: `localhost:4222`
- Temporal: `localhost:7233`
- Temporal UI: `http://localhost:8080`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- OpenTelemetry collector: `localhost:4317` and `localhost:4318`

## Current API Skeleton

Implemented endpoints:

- `GET /health`
- `GET /ready`
- `GET /openapi.json`
- `GET /v1/tenants/{tenant_id}`
- `GET /v1/customers/{customer_id}`
- `GET /v1/tickets/{ticket_id}`

Non-health endpoints require placeholder auth headers. `/v1/*` endpoints also require `x-tenant-id`; tenant-scoped DB work uses the DB package RLS transaction helper.

## Scope

Backend first. Do not build frontend UI until backend contracts, workflows, and AI runtime are implemented and documented.
