# E2E Automated Customer Service

Backend-first platform for an AI-first customer support BPO. The system will ingest support messages from channels like email and WhatsApp, normalize them into tickets, run durable workflows, use AI for triage and drafting, keep humans in approval loops, and capture audit/eval signals for continuous improvement.

Current status: documentation harness, backend scaffold, database/RLS foundation, Milestone 3 API skeleton with role checks plus PostgreSQL-backed tenant/customer/ticket list-create-read-update contracts, conversation/message/policy/KB document metadata/approval/audit event read-list contracts, ticket audit event list contracts, and the first Milestone 4 event bus foundation with shared v1 domain event envelope schemas, explicit NATS JetStream stream setup, worker-side publisher wiring, worker-side consumer base/idempotency handling, and live publish/consume integration coverage. No business workflow implementation yet.

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
pnpm harness:preflight
pnpm harness:handoff
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

Live integration tests require the local PostgreSQL and NATS services. They cover repository tenant filters, PostgreSQL RLS, PostgreSQL-backed API tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket endpoints, and NATS JetStream event publish/consume behavior:

```bash
DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration
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

## Current Event Bus Foundation

Implemented contracts:

- Shared `DomainEventEnvelopeSchema` and allowed `support.*.v1` event names in `@support/shared-schemas`.
- Tenant-aware NATS subject convention: `support.events.tenant.{tenant_id}.{domain}.{fact}.v1`.
- Worker-side `NatsJetStreamDomainEventPublisher` scaffold that validates envelopes, JSON-encodes events, and uses `event_id` as the JetStream message ID.
- Worker-side NATS event bus wiring in `packages/workers/src/event-bus.ts`, which loads `NATS_URL`, connects through the official NATS.js v3 Node transport, ensures the `SUPPORT_EVENTS` stream with subjects `support.events.tenant.*.*.*.v1`, and exposes a publisher runtime.
- Worker-side consumer base in `packages/workers/src/event-consumer.ts`, including durable pull-consumer config/setup helpers, payload and subject validation, ack/nak/term handling, and storage-agnostic event idempotency with an in-memory implementation for deterministic tests.
- Local NATS config in `infra/nats/server.conf` enables JetStream with a persisted Compose volume.
- Live worker integration coverage publishes, consumes, and duplicate-detects a tenant-scoped domain event against local NATS.

Current CRUD skeleton endpoints do not publish events. Event publication remains future workflow/service-owned behavior.

## Current API Skeleton

Implemented endpoints:

- `GET /health`
- `GET /ready`
- `GET /openapi.json`
- `GET /v1/tenants`
- `POST /v1/tenants`
- `GET /v1/tenants/{tenant_id}`
- `PATCH /v1/tenants/{tenant_id}`
- `GET /v1/customers`
- `POST /v1/customers`
- `GET /v1/customers/{customer_id}`
- `PATCH /v1/customers/{customer_id}`
- `GET /v1/conversations`
- `GET /v1/conversations/{conversation_id}`
- `GET /v1/conversations/{conversation_id}/messages`
- `GET /v1/conversations/{conversation_id}/messages/{message_id}`
- `GET /v1/policies`
- `GET /v1/policies/{policy_id}`
- `GET /v1/kb/documents`
- `GET /v1/kb/documents/{kb_document_id}`
- `GET /v1/approvals`
- `GET /v1/approvals/{approval_id}`
- `GET /v1/audit-events`
- `GET /v1/audit-events/{audit_event_id}`
- `GET /v1/tickets`
- `POST /v1/tickets`
- `GET /v1/tickets/{ticket_id}`
- `GET /v1/tickets/{ticket_id}/audit-events`
- `PATCH /v1/tickets/{ticket_id}`

Non-health endpoints require placeholder auth headers. Tenant-scoped endpoints require `x-tenant-id`; global tenant administration endpoints such as `GET /v1/tenants` and `POST /v1/tenants` do not. Tenant-scoped DB work uses the DB package RLS transaction helper. The current skeleton enforces role permissions from `x-user-roles`: tenant creation/listing is platform-admin only, tenant read/update is admin-only, customer/conversation/message/policy/KB document/approval/audit event/ticket reads allow read-focused tenant roles, and customer/ticket writes are limited to platform, ops, and support-agent roles. Ticket `PATCH` updates triage and assignment fields only; approval actions, audit writes, and ticket lifecycle transitions remain future workflow endpoints.

## Scope

Backend first. Do not build frontend UI until backend contracts, workflows, and AI runtime are implemented and documented.
