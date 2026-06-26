# E2E Automated Customer Service

Backend-first platform for an AI-first customer support BPO. The system will ingest support messages from channels like email and WhatsApp, normalize them into tickets, run durable workflows, use AI for triage and drafting, keep humans in approval loops, and capture audit/eval signals for continuous improvement.

Current status: documentation harness, backend scaffold, database/RLS foundation, Milestone 3 API skeleton with role checks plus PostgreSQL-backed tenant/customer/ticket list-create-read-update contracts, conversation/message/policy/KB document metadata/approval/audit event read-list contracts, ticket audit event list contracts, Milestone 4 event bus foundation with typed v1 domain event payload schemas and live publish/consume integration coverage, and the Milestone 5 Temporal ticket workflow shell with first-response SLA timer behavior. Full business workflow implementation is still pending.

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
pnpm --filter @support/workers test:workflow
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

The live Temporal workflow test is explicit because it requires a running Temporal service:

```bash
TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow
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
- Event-name-specific payload validation for v1 domain events, including message received, ticket created, ticket state transition, ticket priority/assignment/SLA, AI run, tool call, approval, message sent, and QA review events.
- Tenant-aware NATS subject convention: `support.events.tenant.{tenant_id}.{domain}.{fact}.v1`.
- Worker-side `NatsJetStreamDomainEventPublisher` scaffold that validates envelopes, JSON-encodes events, and uses `event_id` as the JetStream message ID.
- Worker-side emit helpers in `packages/workers/src/domain-events.ts` for message received, ticket created, ticket state transition, and ticket SLA breach domain events.
- Worker-side NATS event bus wiring in `packages/workers/src/event-bus.ts`, which loads `NATS_URL`, connects through the official NATS.js v3 Node transport, ensures the `SUPPORT_EVENTS` stream with subjects `support.events.tenant.*.*.*.v1`, ensures the `SUPPORT_EVENT_ERRORS` stream with subjects `support.events.errors.>`, and exposes publisher/error-publisher runtime helpers.
- Worker-side consumer base in `packages/workers/src/event-consumer.ts`, including durable pull-consumer config/setup helpers, payload and subject validation, ack/nak/term handling, structured error-record publishing for invalid or failed messages, and storage-agnostic event idempotency with an in-memory implementation for deterministic tests.
- Local NATS config in `infra/nats/server.conf` enables JetStream with a persisted Compose volume.
- Live worker integration coverage publishes, consumes, and duplicate-detects a tenant-scoped domain event against local NATS, and publishes/consumes a structured event error record.

Current CRUD skeleton endpoints do not publish events. The emit helpers are ready for future Temporal workflow/service-owned side effects.

## Current Temporal Workflow Foundation

Implemented contracts:

- Temporal TypeScript SDK dependencies are installed in `@support/workers`.
- `packages/workers/src/temporal-worker.ts` loads Temporal worker config from `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_TASK_QUEUE`, defaulting to local Compose Temporal and the `support-ticket-lifecycle` task queue.
- `packages/workers/src/workflows/ticket-lifecycle-workflow.ts` defines the deterministic ticket lifecycle shell. It creates or loads ticket state through an activity, captures activity-provided first-response SLA timer data, emits workflow-owned ticket-created and ticket-triaged domain events through activities, runs a triage activity, creates an approval for the human-approval route, waits for approval/manual-escalation/close signals or a first-response SLA breach, and deduplicates repeated inbound message signals.
- `packages/workers/src/activities/ticket-lifecycle-activities.ts` provides an activity adapter that reuses the Milestone 4 domain event emit helpers for ticket-created, ticket-transition, and ticket-SLA-breached events. DB mutation, AI runtime, approval persistence, inbound persistence, audit persistence, next-response/resolution SLA timers, and outbound sends are still explicit activity boundaries for future implementation.
- Default unit coverage stays offline. The opt-in workflow test runs against local Temporal with `RUN_TEMPORAL_WORKFLOW_TESTS=true` via `pnpm --filter @support/workers test:workflow` and covers approval wait/resume, inbound signal dedupe, first-response SLA timer breach, and workflow history replay.

Current CRUD skeleton endpoints still do not start or signal workflows.

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
