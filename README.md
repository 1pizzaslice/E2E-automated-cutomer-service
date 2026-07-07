# E2E Automated Customer Service

Backend-first platform for an AI-first customer support BPO. The system will ingest support messages from channels like email and WhatsApp, normalize them into tickets, run durable workflows, use AI for triage and drafting, keep humans in approval loops, and capture audit/eval signals for continuous improvement.

Current status: documentation harness, backend scaffold, database/RLS foundation, Milestone 3 API skeleton with role checks plus PostgreSQL-backed tenant/customer/ticket list-create-read-update contracts, conversation/message/policy/KB document metadata/approval/audit event read-list contracts, ticket audit event list contracts, Milestone 4 event bus foundation with typed v1 domain event payload schemas and live publish/consume integration coverage, the Milestone 5 Temporal ticket workflow shell with first-response SLA timer behavior plus a structured AI graph activity placeholder, and Milestone 6 channel intake complete with the normalized inbound message schema, email/WhatsApp provider adapters and HMAC signature verification in `packages/integrations`, and the `packages/api` webhook ingress endpoints with raw payload storage by reference, tenant-scoped dedup/idempotency and conversation threading, and start/signal wiring into the ticket lifecycle workflow, and Milestone 7 KB and retrieval complete: document create/update/ingest endpoints backed by deterministic chunking and embedding with content stored by reference and a pgvector HNSW index, plus a `POST /v1/kb/search` endpoint doing tenant-scoped cosine retrieval over active chunks/documents with citation metadata and stale-document exclusion, Milestone 8 tool registry complete (typed tool contracts, a tenant-scoped executor with permission-class checks, schema validation, bounded AI-safe results, `tool_calls` audit + idempotent replay, and the six first-party tools), and Milestone 9 AI runtime complete: a self-contained Python LangGraph-style support agent graph under `ai/` (classification, retrieval, policy, tool planning/execution over the Milestone 8 envelope, drafting, guardrail critic, escalation) with structured outputs, deterministic reproducible traces, and an initial golden dataset + offline eval runner enforcing hard-fail safety gates, and Milestone 10 approval and outbound messaging complete: approve/edit/reject/escalate decision endpoints behind a new `approvals:review` permission that resolve pending approvals under RLS, audit the edited-draft trail (original AI draft preserved alongside the human edit), and signal `approval_completed` to the Temporal workflow, plus the outbound vertical — a `NormalizedOutboundMessageSchema` contract, pure email/WhatsApp outbound adapters and an HTTP `OutboundChannelSender` (Mailgun/WhatsApp Cloud) in `packages/integrations`, and production `createApproval`/`sendOutboundMessage`/`recordAuditEvent` Temporal activity implementations with database-index-enforced send idempotency and deterministic retry-safe audit ids, and Milestone 11 observability and QA complete: a shared `@support/observability` package (OTel tracing/metrics bootstrap to the local collector, a typed `SupportMetrics` port, structured JSON logging with trace ids and secret redaction), per-request API tracing/metrics, instrumented workflow activities with critical-failure metrics, AI-run persistence with trace links (materializing the `approvals.ai_run_id`/`messages.ai_run_id` FK links), AI run read endpoints, the QA review surface (list/read/create/complete plus a composite evidence read), a deterministic QA sampling job, and dashboards/alert definitions under `infra/observability/`, and Milestone 12 security and pilot readiness complete: deny-by-default RBAC verified by a route×role matrix test (no implicit role; new `reports:read` permission), a shared validating integration-secret resolver (env-var references only, never plaintext in config rows), content-level PII redaction in structured logs, an 18-case prompt-injection eval suite with hard-fail gates, inbound attachment size/type validation that rejects before any persistence, a closed audit-action taxonomy with completeness tests, per-tenant data retention hooks (`tenants.retention_policy` + a fail-closed retention job auditing `retention.applied`), an idempotent pilot tenant seed (`pnpm db:seed:pilot`, including the global first-party tool definitions), the weekly pilot report (`GET /v1/reports/pilot-weekly`, SOPS §14 metrics), fail-closed auto-send allowlist controls (an `automation` policy version with a kill switch and a closed low-risk topic set, `GET /v1/policies/automation`, and the workers eligibility gate any future auto-send branch must consult — v1 still requires human approval for every outbound message), and the pilot onboarding + production deployment SOPs (SOPS §1.1, §19). All twelve build milestones are complete, and launch engineering runs as `TODO.md` Milestones 13-22 in four phases with platform decisions in `docs/DECISIONS.md` ADR-0020: Milestones 13-17 are done (production worker entrypoint + ticket persistence with the committed live e2e, the AI sidecar bridge, the provider-agnostic real-model layer live-gated against Claude, real IdP JWT auth + the policy lifecycle endpoints per ADR-0024, and scheduled jobs + retention execution per ADR-0025: per-tenant daily Temporal Schedules bootstrapped from the worker entrypoint, a fail-closed blob sweeper, executed attachment-purge and AI-run-anonymization retention classes, job metrics/alerts, and the committed live schedule suite); Milestones 18-22 (staging deployment, live providers, console-enablement APIs, eval expansion + shadow replay, pilot go-live) remain.

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
pnpm test:e2e
pnpm --filter @support/workers test:e2e:service
pnpm test:jobs
pnpm db:migrate
pnpm db:seed:pilot
pnpm dev
pnpm worker:start
pnpm ai:service
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
│   ├── observability/
│   ├── shared-schemas/
│   └── workers/
├── ai/
│   ├── evals/
│   ├── runtime/
│   └── service/
├── infra/
│   ├── docker-compose.yml
│   ├── observability/
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

The production worker entrypoint (Milestone 13) composes the persistence activities, the deterministic AI graph, outbound sending, domain event emission, and telemetry into one restart-safe process on the `support-ticket-lifecycle` task queue:

```bash
DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://127.0.0.1:4222 pnpm worker:start
```

Configuration is validated fail-fast on boot. `APPROVAL_EXPIRY_MS` sets the reviewer-decision window before pending approvals expire (default 24h; `0` disables expiry); `TEMPORAL_ADDRESS`/`TEMPORAL_NAMESPACE`/`TEMPORAL_TASK_QUEUE` override the Temporal connection.

On every start the worker also bootstraps the per-tenant scheduled jobs (Milestone 17, ADR-0025): one daily QA sampling and one daily retention Temporal Schedule per active tenant, create-if-missing (existing schedules and operator edits survive restarts; a new tenant gets schedules on the next worker start). Fire times are `SUPPORT_QA_SAMPLING_SCHEDULE_UTC`/`SUPPORT_RETENTION_SCHEDULE_UTC` (defaults 02:00/02:30 UTC); `SUPPORT_JOB_SCHEDULES=disabled` skips the bootstrap. The retention run executes every configured class fail-closed — raw-payload blobs are deleted through the blob sweeper (`RAW_PAYLOAD_STORE_DIR`) before their refs clear, expired attachment metadata is purged, and expired AI runs are anonymized in place (`anonymized_at`, migration `0007`) — and audits `retention.applied`. The opt-in live suite proves the whole loop against local Temporal:

```bash
DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://127.0.0.1:4222 pnpm test:jobs
```

The committed live end-to-end test drives a signed webhook through the API intake, the running worker entrypoint, an API approval decision, and the outbound send (stubbed provider fetch), asserting the persisted ticket, triage fields, deterministic AI run, ticket events, audit trail, JetStream domain events, and send-once behavior across a worker restart:

```bash
DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://127.0.0.1:4222 pnpm test:e2e
```

The AI runtime sidecar (Milestone 14, ADR-0020) serves the Python support
graph over HTTP. Run it locally with `pnpm ai:service` (uvicorn on
`127.0.0.1:8090`; requires `SUPPORT_AI_SERVICE_TOKEN`) or as the Compose
`ai-service` container (built from `ai/Dockerfile`, service mode pointed back
at the host API for tool execution and KB retrieval). Setting
`AI_RUNTIME_SERVICE_URL` (plus `SUPPORT_AI_SERVICE_TOKEN`) on the worker moves
the AI decision into the sidecar; unset, the worker keeps the in-process
deterministic stand-in. The API's internal tool endpoint authenticates the
sidecar with `SUPPORT_INTERNAL_API_TOKEN`.

Real model providers (Milestone 15, ADR-0023) are config-only swaps behind
the same sidecar: set `SUPPORT_LLM_PROVIDER`/`SUPPORT_LLM_MODEL` plus the
provider key (pilot default: `anthropic` + Claude with `ANTHROPIC_API_KEY`);
unset keeps the deterministic offline model, and `scripted` runs the offline
provider-agnosticism stand-in. Embeddings are likewise env-selected
(`SUPPORT_EMBEDDING_PROVIDER=openai`, pilot default `text-embedding-3-small`
with `OPENAI_API_KEY`); one shared embedder serves KB ingestion and
retrieval, chunk rows record their embedding model, and retrieval fails
closed (HTTP 409) on a mismatch — an embedding swap means re-ingesting the KB
(SOPS §11.2). Any provider/model/prompt change must pass the live eval gate:

```bash
SUPPORT_LLM_PROVIDER=anthropic SUPPORT_LLM_MODEL=claude-sonnet-5 \
  PYTHONPATH=ai uv run --frozen --project ai --extra llm \
  python -m evals.live_runner
```

The sidecar live end-to-end test
spawns the sidecar via uv, listens the API on a real port, and drives the
happy path plus sidecar-down/sidecar-500 degradation:

```bash
DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://127.0.0.1:4222 pnpm --filter @support/workers test:e2e:service
```

User authentication (Milestone 16, ADR-0024) defaults to production JWT
mode: set `SUPPORT_AUTH_ISSUER` + `SUPPORT_AUTH_AUDIENCE` (pilot IdP: Clerk;
the dashboard session-token customization must add the `aud` and `email`
claims) and link operators via `users.idp_subject` (`PILOT_SEED_*_IDP_SUBJECT`
or an ops UPDATE — SOPS §1.1). For header-driven local tooling and the
business-logic test suites, opt in explicitly with
`SUPPORT_AUTH_MODE=insecure-headers`; a JWT-mode boot missing issuer or
audience fails fast instead of trusting headers.

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6380`
- NATS: `localhost:4222`
- Temporal: `localhost:7233`
- Temporal UI: `http://localhost:8080`
- AI runtime sidecar: `http://localhost:8090`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- OpenTelemetry collector: `localhost:4317` and `localhost:4318` (OTLP), `http://localhost:8889/metrics` (Prometheus scrape)

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
- `packages/workers/src/workflows/ticket-lifecycle-workflow.ts` defines the deterministic ticket lifecycle shell. It creates or loads ticket state through an activity, captures activity-provided first-response SLA timer data, emits workflow-owned ticket-created and ticket-triaged domain events through activities, runs triage and AI graph placeholder activities, creates approval metadata from successful AI output, audits structured AI failures before routing to human approval, waits for approval/manual-escalation/close signals or a first-response SLA breach, routes approval outcomes (approved/edited send an outbound response through an activity, rejected closes without sending, escalated routes to manual handling), and deduplicates repeated inbound message signals.
- `packages/workers/src/activities/ticket-lifecycle-activities.ts` provides an activity adapter that reuses the Milestone 4 domain event emit helpers for ticket-created, ticket-transition, ticket-SLA-breached, and message-sent events. `packages/workers/src/activities/ticket-lifecycle-persistence.ts` (Milestone 10) provides the production `createApproval`, `sendOutboundMessage`, and `recordAuditEvent` implementations over a `TicketLifecyclePersistenceStore` port (PostgreSQL under RLS + in-memory test double): deterministic approval/audit ids make Temporal retries replay instead of duplicate, and outbound sends dedupe on the `(tenant, idempotency_key)` unique index, replaying an already-`sent` key without re-contacting the provider and auditing `message.send_failed` on provider failure. Ticket DB mutation, the real AI runtime behind `runAiGraph`, inbound-message recording, next-response/resolution SLA timers, and a production worker entrypoint composing these activities are still future work.
- Default unit coverage stays offline. The opt-in workflow test runs against local Temporal with `RUN_TEMPORAL_WORKFLOW_TESTS=true` via `pnpm --filter @support/workers test:workflow` and covers approval wait/resume, inbound signal dedupe, first-response SLA timer breach, AI success-to-approval routing, AI failure-to-human routing, approval-outcome routing (approved/edited send once, rejected does not send, escalated routes to manual handling), and workflow history replay.

Current CRUD skeleton endpoints still do not start or signal workflows.

## Current Channel Intake Foundation

Implemented contracts:

- `packages/shared-schemas` exports `NormalizedInboundMessageSchema`, the canonical email/WhatsApp inbound message contract, with `NormalizedInboundChannelSchema` (`email | whatsapp`), `CustomerIdentityTypeSchema`, and customer-identity/body/attachment sub-schemas plus inferred types. `external_message_id`, `raw_payload_ref`, and `idempotency_key` are required (raw payload stored by reference); a message must carry body text, body html, or an attachment; attachment `size_bytes` is nullable for providers that report size only on download.
- `packages/integrations/src/channels` provides pure provider adapters: `parseInboundEmailMessage` maps a provider-neutral inbound email payload into one normalized message, and `parseInboundWhatsAppMessages` maps a WhatsApp Cloud webhook into one normalized message per batched message (with attachment metadata and threading). Raw provider schemas ignore unknown fields; normalized output is validated with the strict contract. Adapters do no network/storage I/O — a webhook handler passes an `InboundAdapterContext` (`tenant_id`, `channel_id`, `provider`, `raw_payload_ref`).
- `packages/integrations/src/channels/signature.ts` provides timing-safe HMAC-SHA256 signature verification for WhatsApp (`X-Hub-Signature-256`) and Mailgun; malformed or mismatched signatures are rejected.
- `packages/api` exposes the webhook ingress endpoints `POST /v1/webhooks/email/{provider}` and `POST /v1/webhooks/whatsapp/{provider}`. They are unauthenticated (signature-authenticated over the raw request body), resolve the tenant/channel from a required `channel_id`, store the raw payload by reference (`RawPayloadStore` port, filesystem default), run the pure adapter, and ingest each normalized message; a `202` response reports accepted/deduplicated counts.
- Inbound intake persists under tenant RLS: it deduplicates on `external_message_id`/idempotency key, resolves the customer via `customer_identities`, threads the conversation on `external_thread_id`, and starts or signals `ticketLifecycleWorkflow` through an `InboundWorkflowLauncher` (Temporal `signalWithStart`, per-conversation workflow id). Duplicate provider events create no duplicate messages and no second signal.

Attachment binary storage/oversize rejection, HTML sanitization to `body_html_ref`, and multiple tickets per conversation are later slices; real provider send/download calls stay behind adapter boundaries.

`packages/api` also implements the Milestone 7 KB vertical. Ingestion: `POST /v1/kb/documents` creates a draft document (raw content stored by reference in the `KbContentStore`, `content_hash` derived server-side), `PATCH /v1/kb/documents/{id}` updates metadata/status, and `POST /v1/kb/documents/{id}/ingest` chunks the content (`chunkDocument`), embeds each chunk through the deterministic `Embedder` port (`vector(1536)`), atomically replaces the document's active chunk set, and marks it active. Chunking and embedding are pure/deterministic (`@support/integrations/kb`); `kb_chunks.embedding` has a pgvector HNSW cosine index (`0003_kb_vector_index.sql`). These write endpoints require the `kb_documents:write` permission. Retrieval: `POST /v1/kb/search` embeds the query with the same `Embedder` and runs a tenant-scoped cosine (`<=>`) nearest-neighbour search over active chunks, joining `kb_documents` to exclude stale/inactive documents at query time; each result carries chunk citation IDs, document title/type/source metadata, and a relevance score (never raw embeddings), and retrieval treats chunk content as untrusted data (adversarial text is inert evidence). It requires the `kb:search` permission (granted to the KB-read roles).

## Current AI Runtime

`ai/` holds the Milestone 9 Python AI runtime: the v1 support agent graph. Per ADR-0016 it is a self-contained, dependency-free package that mirrors LangGraph's node model behind pluggable ports (`ModelProvider`, `RetrievalPort`, `ToolExecutor`), so it runs offline and reproducibly under the stdlib-only local harness; the real LangGraph library and a model/provider SDK plug in behind those ports later. The graph is `normalize → classifier → retrieval planner → retrieval → policy → tool planner → tool execution → (conditional) composer → guardrail critic → escalation → finalize`. Classification and drafting go through the model port; policy and guardrail logic is deterministic governance that defaults to human approval, forces `human_only` for legal/chargeback/fraud/safety/prompt-injection, never auto-sends without grounding, and derives the runtime's tool permissions from policy. The tool-execution node speaks the Milestone 8 `ToolCallRequest`/`ToolCallResult` envelope; `RuntimeResult` mirrors the Temporal `RunAiGraphActivityResult` boundary. `ai/evals/` holds an initial golden dataset and an offline eval runner that enforces hard-fail safety gates (zero unsafe auto-send, zero cross-tenant leakage, prompt-injection fully neutralized). Run the tests with `pnpm test:py` and the eval report with `PYTHONPATH=ai python3 -m evals.runner`. See `docs/AI_RUNTIME_HARNESS.md` §19. Since Milestone 14 the runtime also ships as an HTTP sidecar under `ai/service/` (FastAPI via the uv `service` extra): `POST /internal/ai/run` runs the same graph behind bearer-token auth, with HTTP port adapters calling the API's governed tool registry and KB search in service mode; `python -m service.eval_parity` proves service-path runs byte-identical to in-process runs. See `docs/AI_RUNTIME_HARNESS.md` §20. Since Milestone 15 the real model is a config-selected LangChain adapter behind the same `ModelProvider` port (`runtime/llm.py`, versioned prompt files under `runtime/prompts/`, structured outputs, usage/cost capture onto `ai_runs`); `python -m evals.live_runner` is the opt-in live gate against a configured provider. See `docs/AI_RUNTIME_HARNESS.md` §21.

## Current Observability

`packages/observability` (Milestone 11) is the shared telemetry seam: `startTelemetry` boots OTel tracing + metrics with OTLP/HTTP exporters pointed at the local collector (disable with `OTEL_SDK_DISABLED=true`), `createInMemoryTelemetry` captures spans/metrics for tests, `SupportMetrics` is the typed domain-metrics port (OTel-backed, no-op, and recording implementations; instrument names in `SUPPORT_METRIC_NAMES`), and `createStructuredLogger` emits redacted JSON logs that pick up the active span's `trace_id`. The API traces every request (`http.request` spans with `support.request_id`/`support.correlation_id`/`support.tenant_id` attributes, pino logs rebound with the same ids) and records request/approval/tool-call metrics; workers instrument every ticket lifecycle activity (`instrumentTicketLifecycleActivities`) and map domain outcomes onto the `support.critical_failures` counter (`ai_graph_failed`, `outbound_send_failed`, `approval_signal_failed`, `event_dead_letter`, `sla_breached`). `createPersistedRunAiGraph` persists every AI run (structured output, guardrails, latency, `trace_id`) so a ticket is traceable end to end by one correlation id across spans, logs, `ai_runs.trace_id`, and `audit_events.correlation_id` (ADR-0018). The QA sampling job (`packages/workers/src/qa-sampling.ts`) deterministically queues completed AI runs for review per SOPS §10. Dashboards and Prometheus alert rules live in `infra/observability/`; the collector re-exposes metrics for scraping at `http://localhost:8889/metrics`.

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
- `POST /v1/policies`
- `GET /v1/policies/{policy_id}`
- `GET /v1/policies/{policy_id}/versions`
- `POST /v1/policies/{policy_id}/versions`
- `POST /v1/policy-versions/{policy_version_id}/activate`
- `POST /v1/policies/{policy_id}/archive`
- `GET /v1/kb/documents`
- `POST /v1/kb/documents`
- `GET /v1/kb/documents/{kb_document_id}`
- `PATCH /v1/kb/documents/{kb_document_id}`
- `POST /v1/kb/documents/{kb_document_id}/ingest`
- `POST /v1/kb/search`
- `GET /v1/approvals`
- `GET /v1/approvals/{approval_id}`
- `POST /v1/approvals/{approval_id}/approve`
- `POST /v1/approvals/{approval_id}/edit`
- `POST /v1/approvals/{approval_id}/reject`
- `POST /v1/approvals/{approval_id}/escalate`
- `GET /v1/ai-runs`
- `GET /v1/ai-runs/{ai_run_id}`
- `GET /v1/qa-reviews`
- `POST /v1/qa-reviews`
- `GET /v1/qa-reviews/{qa_review_id}`
- `POST /v1/qa-reviews/{qa_review_id}/complete`
- `GET /v1/qa-reviews/{qa_review_id}/evidence`
- `GET /v1/audit-events`
- `GET /v1/audit-events/{audit_event_id}`
- `GET /v1/tickets`
- `POST /v1/tickets`
- `GET /v1/tickets/{ticket_id}`
- `GET /v1/tickets/{ticket_id}/audit-events`
- `PATCH /v1/tickets/{ticket_id}`

Non-health endpoints require IdP-issued JWTs by default (Milestone 16, ADR-0024): the API verifies issuer/audience/expiry against the IdP's JWKS (pilot IdP: Clerk; `SUPPORT_AUTH_ISSUER`/`SUPPORT_AUTH_AUDIENCE` required in JWT mode), maps the verified subject to `users.idp_subject`, loads roles from `user_roles` (the DB is the role source of truth — tokens never carry authority), and enforces tenant membership server-side (a tenant-bound user selecting another tenant is `403`). The Milestone 1-15 trusted-header mode (`x-user-id`/`x-user-roles`) survives only behind the explicit `SUPPORT_AUTH_MODE=insecure-headers` opt-in for tests/local tooling. Tenant-scoped endpoints require `x-tenant-id`; global tenant administration endpoints such as `GET /v1/tenants` and `POST /v1/tenants` do not. Tenant-scoped DB work uses the DB package RLS transaction helper. Role permissions: tenant creation/listing is platform-admin only, tenant read/update is admin-only, customer/conversation/message/policy/KB document/approval/audit event/ticket reads allow read-focused tenant roles, customer/ticket writes are limited to platform, ops, and support-agent roles, and policy lifecycle writes (`policies:write`: create/version/activate/archive with `policy.created|activated|archived` audits, activation immutability, one active policy per domain, fail-closed automation-content validation) are admin-only. Ticket `PATCH` updates triage and assignment fields only. Approval decision endpoints (`approvals:review`: platform, ops, support-agent roles) resolve a pending approval in one RLS transaction (approve mirrors the AI draft into `approved_payload`; edit stores the human edit while `requested_payload` preserves the original draft), append an `approval.{status}` audit event carrying both payloads, and then signal `approval_completed` to the ticket lifecycle workflow through an injectable Temporal signaler (missing workflows are reported in the `workflow_signal` response block; deciding a non-pending approval returns `409 CONFLICT`). AI run reads (`ai_runs:read`) are internal-only (no `client_viewer`); QA reviews are readable by internal roles (`qa_reviews:read`) and writable by QA/ops/platform roles (`qa_reviews:write`), with `GET /v1/qa-reviews/{id}/evidence` returning the composite package a reviewer needs (conversation, messages, AI run with trace link, tool calls, approvals with the original draft and human edit). Other audit writes and ticket lifecycle transitions remain future workflow endpoints.

## Scope

Backend first. Do not build frontend UI until backend contracts, workflows, and AI runtime are implemented and documented.
