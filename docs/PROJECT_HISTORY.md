# Project History And Handoff

## Purpose

This file records what has happened so far so a new human or AI agent can understand the project without relying on chat history.

## Current State

- GitHub repo cloned at `/home/anish/CODE01/STARTUPS/E2E-automated-cutomer-service`.
- Backend scaffold has a local `main` commit.
- No frontend has been implemented.
- No full business workflows have been implemented yet. The first Temporal ticket lifecycle workflow shell exists with first-response SLA timer breach behavior, an AI graph activity placeholder with structured AI failure-to-human routing, and deterministic approval-outcome routing (approved/edited send through an outbound activity placeholder, rejected does not send, escalated routes to manual handling), but DB mutation, real LangGraph calls, the real channel send behind `sendOutboundMessage`, next-response/resolution SLA timers, and API start/signal wiring remain pending.
- Milestone 0 documentation harness is complete.
- Milestone 1 backend scaffold is complete and locally verified.
- Milestone 2 database foundation is implemented and locally verified, including live PostgreSQL repository execution tests and row-level security enforcement tests.
- Milestone 3 API skeleton is complete with request/auth/tenant context middleware placeholders, structured errors, a generated OpenAPI document endpoint, role permission checks, typed tenant/customer/ticket list-create-read-update contracts, typed conversation/message/policy/KB document/approval/audit event read-list contracts, ticket audit event list contracts, and PostgreSQL-backed API integration tests for those endpoint families.
- Milestone 4 event bus foundation is complete with shared v1 domain event envelope and payload schemas, a tenant-aware NATS subject convention, worker-side NATS JetStream publisher/consumer base and connection wiring, explicit domain/error stream config, idempotent consumer handling, structured consumer error records, workflow-ready event emit helpers, and live NATS publish/consume integration coverage. CRUD skeleton endpoints still do not publish events.
- Milestone 5 Temporal workflow foundation is complete with Temporal TypeScript SDK dependencies, worker config/runtime scaffolding, a deterministic ticket lifecycle workflow shell, activity contracts/placeholders, first-response SLA timer behavior, a structured AI graph activity placeholder with success/failure-to-human routing, a `sendOutboundMessage` activity placeholder with deterministic approval-outcome routing, a domain-event activity adapter that reuses the Milestone 4 emit helpers (now including message-sent), explicit activity retry policies, offline unit coverage, and an opt-in live Temporal workflow test with replay coverage. Real DB/AI/channel side effects and API workflow start/signal wiring remain bound behind activity boundaries for later milestones.
- Milestone 6 channel intake is complete. The normalized inbound message contract is defined in `packages/shared-schemas` as `NormalizedInboundMessageSchema` (plus `NormalizedInboundChannelSchema`, `CustomerIdentityTypeSchema`, and customer-identity/body/attachment sub-schemas and inferred types; attachment size is nullable and a message must carry text, html, or an attachment). `packages/integrations/src/channels` adds pure provider adapters — `parseInboundEmailMessage` (email) and `parseInboundWhatsAppMessages` (WhatsApp Cloud, batched) — that map non-strict raw provider payloads into the strict normalized contract with attachment metadata and threading, plus timing-safe HMAC-SHA256 signature verification for WhatsApp (`X-Hub-Signature-256`) and Mailgun. `packages/api` completes intake with the `POST /v1/webhooks/email/{provider}` and `POST /v1/webhooks/whatsapp/{provider}` ingress endpoints (unauthenticated, signature-verified over the raw body, tenant resolved by `channel_id`), raw payload storage by reference (`RawPayloadStore` port; filesystem default), a tenant-scoped `InboundIntakeStore` (PostgreSQL under RLS) that dedups on `external_message_id`/idempotency key and threads conversations on `external_thread_id`, and start/signal wiring to `ticketLifecycleWorkflow` through an `InboundWorkflowLauncher` port (Temporal `signalWithStart`, per-conversation workflow id). An email polling placeholder marks the future scheduled-pull path. Attachment binary storage/oversize rejection, HTML sanitization to `body_html_ref`, and multi-ticket-per-conversation lifecycle remain later slices.
- Milestone 7 KB and retrieval is complete. Ingestion vertical: `packages/shared-schemas` adds `KbDocumentCreateRequestSchema` (content is required and stored by reference), `KbDocumentUpdateRequestSchema` (metadata/status PATCH), `KbChunkResponseSchema` (embeddings intentionally omitted from the contract), and `KbIngestionResultSchema`; `packages/integrations/src/kb` adds the pure, deterministic `chunkDocument` (overlapping paragraph-aware chunks) and an `Embedder` port with `createDeterministicEmbedder` (token-hash L2-normalized `vector(1536)` vectors); `packages/db` adds `0003_kb_vector_index.sql` (a pgvector HNSW `vector_cosine_ops` index over `kb_chunks.embedding`) plus tenant-scoped `createKbDocumentQuery`/`updateKbDocumentByIdQuery`/`deleteKbChunksForDocumentQuery`/`insertKbChunksQuery` helpers; `packages/api` adds a `KbContentStore` port (filesystem default, raw bodies out of PostgreSQL), a tenant-scoped `KbIngestionStore` (writes under RLS; atomic chunk replacement), a `KbIngestionService`, and the endpoints `POST /v1/kb/documents` (create as draft), `PATCH /v1/kb/documents/{id}` (metadata/status), and `POST /v1/kb/documents/{id}/ingest` (chunk, embed, activate) behind a `kb_documents:write` permission. Retrieval vertical: `packages/shared-schemas` adds `KbSearchRequestSchema`, `KbSearchResultSchema` (`KbChunkResponseSchema` plus a relevance `score` and `document_title`/`document_type`/`source_type`/`source_ref` citation fields), and `KbSearchResponseSchema`; `packages/db` adds `searchKbChunksQuery` (tenant-scoped cosine `<=>` nearest-neighbour over the HNSW index, inner-joining `kb_documents` to require `status = 'active'` on both chunk and document — excluding stale/inactive/draft at query time — with optional `document_type`/`source_type` filters and citation columns); `packages/api` adds `kb-retrieval.ts` (a `KbRetrievalStore` port with a DB impl under RLS and an in-memory impl over the ingestion store, and a `KbRetrievalService` that embeds the query with the same `Embedder`) exposed as `POST /v1/kb/search` behind a new `kb:search` permission (granted to the KB-read roles), plus retrieval eval + adversarial prompt-injection fixtures (`kb-eval-fixtures.ts`). Retrieval returns citation IDs and document metadata, never raw embeddings, and treats chunk content as untrusted data (adversarial text is inert evidence, ranking is relevance-only). Verified end to end against a live pgvector database (create → ingest → search: refund query ranks the refunds policy first, cross-tenant search returns nothing, PATCH-to-stale drops the document from answers).
- Milestone 8 tool registry is complete. `packages/shared-schemas` adds the tool contracts (`ToolSideEffectClassSchema`, `ToolPermissionClassSchema`, and the `ToolCallRequestSchema`/`ToolCallResultSchema` envelope with error codes); `packages/integrations` re-exports the enums as the single source of truth and adds `defineSideEffectTool`; `packages/db` adds `tool_calls` repository queries; `packages/api` adds `createToolExecutor` (per-call visibility → permission-class → args validation → timed execution → bounded AI-safe result → `tool_calls` audit, with idempotent replay for side-effect tools) plus the six first-party tools over injectable commerce fixtures and a `kb_search` reusing the Milestone 7 retrieval service.
- Milestone 9 AI runtime is complete. `ai/` holds the v1 support agent graph, implemented (ADR-0016) as a self-contained, dependency-free Python package that mirrors LangGraph's node model behind pluggable ports (`ModelProvider`, `RetrievalPort`, `ToolExecutor`) — because the local harness runs Python via the system interpreter on 3.14 with no `uv`, so LangGraph/LangChain/Pydantic are not installable. The graph is `normalize → classifier → retrieval planner → retrieval → policy → tool planner → tool execution → (conditional) composer → guardrail critic → escalation → finalize`; classification/drafting go through the model port while policy and guardrail are deterministic governance (default human-approval, `human_only` for legal/chargeback/fraud/safety/injection, no auto-send without grounding, tool permissions derived from policy). `RuntimeResult` mirrors the Temporal `RunAiGraphActivityResult` boundary; the tool node speaks the Milestone 8 envelope. `ai/evals/` adds an initial golden dataset + an offline eval runner with hard-fail safety gates. Verified with 49 Python tests and a green eval report (all metrics 1.000, zero unsafe auto-send / cross-tenant leakage).
- The engineering harness now includes explicit branch and handoff guardrails in the active reading path plus `pnpm harness:preflight` and `pnpm harness:handoff` checks.

## Product Direction

The product is an AI-first customer support BPO platform. The first wedge is D2C/e-commerce support automation:

- Email and WhatsApp intake.
- Order status.
- Refund eligibility.
- Cancellation eligibility.
- Basic FAQs.
- AI draft plus human approval by default.
- Narrow auto-send only after eval, QA, and policy gates.

The goal is not to build a generic chatbot. The goal is to build a governed support operations backend with durable workflows, typed tools, auditable AI runs, and human approval.

## Key Pivots And Decisions

### Planning-only docs to backend scaffold

Initial request was to create deep planning docs and a coding-agent harness. After that, the work expanded to setting up the actual GitHub repo and backend scaffold so implementation could start from a clean foundation.

### Backend-only v1

Frontend work was explicitly deferred. The backend should expose contracts that support a future agent console, but no UI should be built yet.

### TypeScript plus Python split

Decision:

- TypeScript for API, workers, schemas, DB package, and integration contracts.
- Python for future LangGraph AI runtime and evals.

Reason:

- TypeScript is strong for backend contracts and service code.
- Python is stronger for LangGraph/AI/eval ecosystem.

### Temporal plus LangGraph

Decision:

- Temporal owns durable workflows, retries, SLA timers, approval waits, and state transitions.
- LangGraph owns bounded AI graph reasoning inside activities.

Reason:

- Keeps business state deterministic and auditable.
- Prevents AI runtime from becoming the source of truth.

### Deep docs plus short routing docs

The project originally got several long docs. That is useful for reference, but wasteful if loaded every session. The pivot is:

- Keep deep docs as reference.
- Use `AGENTS.md`, `TODO.md`, `docs/README.md`, and this file as the short entry path.
- Read task-specific docs only when needed.

## What Was Created

Documentation:

- `AGENTS.md`
- `PLAN.md`
- `TODO.md`
- `docs/README.md`
- `docs/PROJECT_HISTORY.md`
- `docs/BACKEND_SPEC.md`
- `docs/AI_RUNTIME_HARNESS.md`
- `docs/ENGINEERING_HARNESS.md`
- `docs/DEVELOPMENT_RULES.md`
- `docs/TEST_STRATEGY.md`
- `docs/SOPS.md`
- `docs/DECISIONS.md`

Backend scaffold:

- Root `package.json` with `pnpm` workspace scripts.
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `vitest.config.ts`
- `.github/workflows/ci.yml`
- `.env.example`
- `.gitignore`
- `.prettierignore`
- `packages/api`
- `packages/workers`
- `packages/shared-schemas`
- `packages/db`
- `packages/integrations`
- `ai/runtime`
- `ai/evals`
- `infra/docker-compose.yml`
- `infra/otel/otel-collector-config.yaml`

Database foundation:

- Drizzle selected for the TypeScript schema/query layer.
- `packages/db/src/schema.ts`
- `packages/db/migrations/0001_initial_core.sql`
- `packages/db/migrations/0002_tenant_rls.sql`
- `packages/db/src/migrations.ts`
- `packages/db/src/repositories.ts`
- `packages/db/src/rls.ts`
- `packages/db/src/repositories.integration.test.ts`
- `packages/db/src/rls.integration.test.ts`
- `packages/db/drizzle.config.ts`

API skeleton:

- `packages/api/src/request-context.ts`
- `packages/api/src/errors.ts`
- `packages/api/src/openapi.ts`
- `packages/api/src/rbac.ts`
- `packages/api/src/routes.ts`
- `packages/api/src/services.ts`
- `packages/api/src/app.test.ts`
- `packages/api/src/app.integration.test.ts`
- Shared API resource and error schemas in `packages/shared-schemas/src/index.ts`

Latest Milestone 3 API expansion:

- Added tenant-scoped audit event list/read contracts with `limit`, `actor_type`, `entity_type`, `entity_id`, `action`, and `correlation_id` filters.
- Added tenant-scoped ticket audit event list contracts under `GET /v1/tickets/{ticket_id}/audit-events` with parent ticket existence checks.
- Added audit event shared schemas, repository helpers, service adapters, `audit_events:read` RBAC permission, generated OpenAPI paths, API contract tests, repository tests, and PostgreSQL-backed API integration tests for tenant isolation.
- Added tenant-scoped approval list/read contracts with `limit`, `status`, `ticket_id`, and `approval_type` filters.
- Added approval shared schemas, repository helpers, service adapters, `approvals:read` RBAC permission, generated OpenAPI paths, API contract tests, repository tests, and PostgreSQL-backed API integration tests for tenant isolation.
- Added tenant-scoped conversation list/read contracts with `limit`, `status`, `customer_id`, and `channel_id` filters.
- Added tenant-scoped message list/read contracts under conversations with `limit`, `direction`, and `ticket_id` filters.
- Added conversation/message shared schemas, repository helpers, service adapters, RBAC permissions, generated OpenAPI paths, API contract tests, repository tests, and PostgreSQL-backed API integration tests for tenant isolation.
- Added tenant-scoped policy list/read contracts with `limit`, `domain`, and `status` filters.
- Added policy shared schemas, repository helpers, service adapters, `policies:read` RBAC permission, generated OpenAPI paths, API contract tests, repository tests, and PostgreSQL-backed API integration tests for tenant isolation.
- Added tenant-scoped KB document metadata list/read contracts with `limit`, `source_type`, `document_type`, and `status` filters.
- Added KB document shared schemas, repository helpers, service adapters, `kb_documents:read` RBAC permission, generated OpenAPI paths, API contract tests, repository tests, and PostgreSQL-backed API integration tests for tenant isolation.
- Added global platform-admin tenant list/create contracts.
- Added current-tenant tenant patch support for ops admins and global tenant patch support for platform admins.
- Added tenant-scoped customer list/create/update contracts.
- Added tenant-scoped ticket list/create/update contracts for triage and assignment fields only; lifecycle transitions remain future workflow-backed endpoints.
- Adjusted request-context parsing so tenant headers are optional globally but still required by tenant-scoped routes.
- Expanded RBAC permissions for tenant/customer/ticket list, create, and update operations.
- Added repository helpers for tenant/customer/ticket list/create/update operations while preserving explicit tenant scopes on tenant-scoped helpers.
- Expanded shared schema, API contract, repository SQL, and live PostgreSQL-backed API integration tests.

Latest Milestone 4 event bus foundation:

- Added shared v1 domain event names and `DomainEventEnvelopeSchema` in `packages/shared-schemas`.
- Added event-name-specific payload validation for v1 domain events plus `SupportEventErrorRecordSchema` for structured worker error records.
- Added `buildDomainEventSubject`, which maps `support.ticket.created.v1` style event names to tenant-aware subjects such as `support.events.tenant.ten_test.ticket.created.v1`.
- Added subject-safe tenant token validation for event publishing.
- Added `packages/workers/src/domain-events.ts` with schema-validated emit helpers for message received, ticket created, and ticket state transition events.
- Added `packages/workers/src/event-publisher.ts` with `NatsJetStreamDomainEventPublisher`, which validates envelopes, JSON-encodes events, publishes to the derived tenant-aware subject, and uses `event_id` as the JetStream message ID for duplicate detection.
- Added `packages/workers/src/event-errors.ts` with structured error-record publishing to the `support.events.errors.>` subject namespace.
- Added `packages/workers/src/event-bus.ts` with NATS.js v3 connection wiring, `NATS_URL` config loading, `SUPPORT_EVENTS` and `SUPPORT_EVENT_ERRORS` stream setup, and publisher/error-publisher runtime construction.
- Added `packages/workers/src/event-consumer.ts` with durable pull-consumer config/setup helpers, one-message `processNext()` handling, payload/subject validation, ack/nak/term behavior, structured error-record publishing for invalid or failed messages, and an injected idempotency store contract with an in-memory implementation for deterministic tests.
- Added `infra/nats/server.conf` plus a Compose `nats-data` volume so local NATS runs JetStream from explicit config.
- Added shared event payload/error tests, worker event emit helper tests, worker event bus/error publisher unit tests, consumer idempotency/error strategy tests, and a live NATS publish/consume integration test that verifies domain event duplicate detection plus structured event error publish/consume behavior.
- Left current CRUD skeleton endpoints disconnected from event publication; the emit helpers are intended for future workflow/service-owned event side effects.

Latest Milestone 5 Temporal workflow foundation:

- Added Temporal TypeScript SDK dependencies to `@support/workers` and approved the required pnpm build scripts for `@swc/core` and `protobufjs`.
- Added `packages/workers/src/temporal-worker.ts` for Temporal worker config/runtime scaffolding with local defaults for `localhost:7233`, namespace `default`, and task queue `support-ticket-lifecycle`.
- Added `packages/workers/src/workflows/ticket-lifecycle-types.ts` and `packages/workers/src/workflows/ticket-lifecycle-workflow.ts`.
- The workflow shell defines message/customer-reply, approval-completed, manual-escalation, and close-request signals, a state query, ticket create/load and triage activity calls, a structured `runAiGraph` activity placeholder, workflow-owned domain event emission activity calls, first-response SLA timer wait/breach behavior, approval waiting/resume behavior, audit activity calls, and inbound message signal dedupe.
- The `runAiGraph` placeholder returns either structured AI success output for approval metadata or structured AI failure output; the workflow records `ai_graph.failed` audit and routes failures to human approval instead of failing the workflow.
- Added the `sendOutboundMessage` activity placeholder and deterministic approval-outcome routing: approved/edited send an outbound message once (with a deterministic `outbound:{tenant}:{ticket}:{approval_id}` idempotency key), emit `support.message.sent.v1`, and record `message.sent` audit before reaching the `responded` phase; rejected ends in `completed` without sending; escalated records `ticket.manual_escalated` audit and reaches the `manual_escalated` phase.
- Added `packages/workers/src/activities/ticket-lifecycle-activities.ts`, whose `emitDomainEvent` activity adapter reuses `emitTicketCreatedEvent`, `emitTicketStateTransitionEvent`, `emitTicketSlaBreachedEvent`, and `emitMessageSentEvent` through an injected `DomainEventPublisher`.
- Added explicit ticket lifecycle activity retry-policy constants, side-effect activity call-site retry options (including `sendOutboundMessage`), first-response SLA breach event/audit workflow handling, and live workflow history replay coverage.
- Added offline unit coverage for the activity adapter (including message-sent emission) and Temporal worker config.
- Added `pnpm --filter @support/workers test:workflow`, an opt-in live Temporal workflow test that runs against local Compose Temporal and covers approval wait/resume, duplicate inbound message signal handling, first-response SLA timer breach, AI success-to-approval routing, AI failure-to-human routing, approval-outcome routing (approved/edited/rejected/escalated), and workflow replay safety.
- CRUD skeleton endpoints still do not start or signal workflows.

Latest harness hardening:

- Promoted the short-lived branch rule from the deeper harness/ADR docs into `AGENTS.md`, `TODO.md`, and development rules.
- Added `scripts/session-harness-check.mjs` plus `pnpm harness:preflight` and `pnpm harness:handoff`.
- The preflight check fails on direct `main` or `master` work unless `ALLOW_MAIN_BRANCH=true` is explicitly set.
- The handoff check also verifies that the active milestone checklist in `TODO.md` has checked items, reducing the chance that only handoff prose is updated.
- Updated the Milestone 4 checklist to mark completed event foundation items.

## Verification Completed

The following passed locally in the cloned repo:

- `pnpm install`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm infra:up`
- API `/health`
- API `/ready`
- `pnpm infra:down`
- `pnpm --filter @support/db test`
- `pnpm --filter @support/db typecheck`
- `pnpm --filter @support/api test`
- `pnpm --filter @support/api typecheck`
- `pnpm --filter @support/shared-schemas test`
- `pnpm --filter @support/shared-schemas typecheck`
- `DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration`
- `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow`

## Current Architecture Follow-Ups

- Repository tenant filters remain mandatory even with PostgreSQL row-level security.
- API and worker database code must set transaction-local `app.current_tenant_id` before tenant-scoped operations. The DB package now provides `withTenantTransaction`, which also sets `support_app` as the transaction-local role before repository work.
- CI includes live PostgreSQL and NATS integration coverage, but the remote workflow result has not been observed yet.
- Current API auth is still placeholder header-based identity, not a real identity provider. The API now enforces a role-to-permission matrix for the current OpenAPI, tenant, customer, conversation, message, policy, KB document, approval, and ticket endpoint families.

## Errors Encountered And Fixes

### Empty or invalid original `.git`

The original `customer-support-research` directory had an empty `.git` directory, so `git status` failed. Instead of trying to repair that directory, the GitHub repo was cloned cleanly into the parent `STARTUPS` directory.

### `pnpm install` blocked `esbuild`

Pnpm 11 ignored the `esbuild` build script and exited with `ERR_PNPM_IGNORED_BUILDS`.

Fix:

- Approved the `esbuild` build script with `pnpm approve-builds esbuild`.
- Reran `pnpm install`.

### Temporal UI image tag did not exist

The initial compose file used `temporalio/ui:2.41`, which Docker could not pull.

Fix:

- Switched initial scaffold images for Temporal UI, Temporal auto-setup, MinIO, and OTel collector to available `latest` tags.

Future improvement:

- Pin these to verified stable versions after the first commit.

### Redis port conflict

Local machine already had something on port `6379`.

Fix:

- Changed Redis host mapping to `6380:6379`.
- Updated `.env.example` and `README.md`.

### Temporal DB driver was invalid

Temporal auto-setup rejected `DB=postgresql`.

Fix:

- Changed it to `DB=postgres12`.

### TypeScript build output went to root `dist/`

The first package builds wrote output to the repo root because `outDir` came from the root base tsconfig.

Fix:

- Added package-local `outDir: "dist"` to package tsconfigs.
- Removed root `dist/`.

### Vitest discovered compiled tests in `dist/`

After build, tests were discovered twice because compiled test files existed in package `dist/`.

Fix:

- Added root `vitest.config.ts` excluding `**/dist/**`.

### Drizzle needed postgres-js options on transaction-scoped clients

The first `withTenantTransaction` implementation passed the postgres-js transaction scope directly into Drizzle. Live PostgreSQL integration tests failed because the transaction scope did not expose the top-level client `options.parsers` and `options.serializers` object Drizzle mutates during construction.

Fix:

- `withTenantTransaction` now carries the parent postgres-js client options onto the transaction-scoped client before creating the Drizzle database.
- Live repository/RLS integration tests now verify repository work runs under `support_app` with tenant context set.

### Prettier found formatting drift

`pnpm format:check` found unformatted scaffold files.

Fix:

- Added Prettier scripts and `.prettierignore`.
- Ran `pnpm format`.
- Verified `pnpm format:check`.

## Current Risks And Follow-Ups

- GitHub Actions has not run remotely yet.
- Python `uv` is not installed locally; current Python scaffold uses standard library `unittest`.
- Docker image tags use `latest` for some services; pin known-good versions later.
- Database ORM/query builder is Drizzle.
- No real tenant/client data exists.
- No OpenAI/model credentials are configured.

## Next Recommended Task

Milestone 8 Tool Registry (`feat-milestone8-tool-registry`) and Milestone 9 AI Runtime With LangGraph (`feat-milestone9-ai-runtime`) are complete; all their checklist items and acceptance criteria are checked off in `TODO.md`. The AI runtime under `ai/` produces the structured routing + draft + `human_approve`/`human_only` recommendation and human approval package. Begin Milestone 10 - Approval And Outbound Messaging:

1. Define the approval record schema and add approval request creation plus read APIs, and approve/edit/reject/escalate APIs in `packages/api`.
2. Wire the approval signal into the Temporal `ticketLifecycleWorkflow` (it already routes AI failures / human-only to approval and has deterministic approved/edited/rejected/escalated outbound handling).
3. Add the outbound message schema, email + WhatsApp outbound adapters (reuse the Milestone 6 `@support/integrations/channels` boundary), outbound idempotency, and outbound audit events.
4. Add tests for approval resume and the edited-draft audit trail, proving the workflow pauses until approval, approved/edited responses send once, rejected responses do not send, and human edits are stored for eval/QA.

Milestone 9 follow-ups (not blockers): swap a real LLM `ModelProvider` and, if adopted, real LangGraph once `uv` is provisioned (ports are the seams, ADR-0016); call the live TypeScript tool registry and `POST /v1/kb/search` from the tool/retrieval nodes; wire the Python runtime behind the Temporal `RunAiGraphActivity` placeholder; expand the golden dataset to the TEST_STRATEGY §4 counts and add an LLM-graded draft rubric; add versioned prompt files.

Milestone 6 follow-ups to fold into later slices (not blockers): attachment binary storage + oversize-attachment rejection, HTML sanitization to `body_html_ref`, and multiple tickets per conversation (intake currently wires one lifecycle workflow per conversation with a deterministic `tkt_{conversation_id}` ticket id).

Milestone 7 follow-ups (not blockers): a Temporal `KbIngestionWorkflow` driving ingestion as activities; choosing/documenting a production embedding model behind the `Embedder` port and wiring one shared instance into both ingestion and retrieval (re-embed if its dimension != 1536); and an optional similarity-score floor / max-context-tokens cap on retrieval before the AI runtime consumes it.
