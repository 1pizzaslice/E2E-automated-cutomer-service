# Test Strategy

## Purpose

This document defines the required backend test strategy for the AI-first customer support platform. The project combines standard backend code, durable workflows, AI graphs, retrieval, tools, and integrations, so testing must cover deterministic software behavior and probabilistic AI behavior.

No feature is complete without tests or an explicit, documented reason tests could not be added.

## 1. Testing Philosophy

Test the system at the boundary where risk appears:

- Pure logic: unit tests.
- API contracts: request/response tests.
- Data access: repository and migration tests.
- Events: schema and idempotency tests.
- Temporal: workflow tests and replay safety.
- AI graph: node tests, mocked integration tests, and evals.
- Tools: schema, permission, idempotency, and audit tests.
- Security: negative tests.
- Operations: smoke tests and synthetic journeys.

Use deterministic fixtures for business logic. Use eval datasets for AI behavior.

## 2. Test Pyramid

### 2.1 Unit Tests

Use for:

- Validation helpers.
- Policy evaluation.
- State transition guards.
- Priority calculation.
- Routing rule deterministic logic.
- Tool input/output transforms.
- Redaction functions.
- Event envelope builders.

Required qualities:

- Fast.
- Deterministic.
- No network.
- No real LLM calls.

### 2.2 Integration Tests

Use for:

- API endpoints with test database.
- Repository queries.
- Tenant isolation.
- NATS publish/consume.
- Temporal activities with mocked external dependencies.
- Webhook ingestion with fixtures.
- Tool execution with fake providers.
- KB retrieval with test embeddings or deterministic vectors.

### 2.3 Contract Tests

Use for:

- OpenAPI request/response schemas.
- Event schemas.
- Tool schemas.
- AI runtime input/output schemas.
- Provider adapter normalized outputs.

Contract tests must fail when a public schema changes without intentional update.

### 2.4 Workflow Tests

Use for Temporal workflows:

- Ticket lifecycle.
- Approval wait/resume.
- SLA breach.
- Retry behavior.
- Failure fallback to human.
- Idempotent signal handling.

Workflow tests must not depend on real LLMs, real providers, or wall-clock sleeping.

### 2.5 Eval Tests

Use for AI behavior:

- Classification.
- Routing.
- Draft quality.
- Grounding.
- Tool selection.
- Prompt-injection resistance.
- Escalation correctness.

Eval tests must be versioned and reproducible.

### 2.6 End-To-End Smoke Tests

Use for:

- Local synthetic ticket journey.
- Inbound fixture -> ticket -> AI draft -> approval -> outbound send stub -> audit.

Keep e2e smoke tests small and stable.

## 3. Required Test Suites By Subsystem

### 3.1 Tenancy

Required tests:

- Tenant A cannot read Tenant B customers.
- Tenant A cannot read Tenant B conversations.
- Tenant A cannot read Tenant B messages.
- Tenant A cannot read Tenant B tickets.
- Tenant A cannot retrieve Tenant B KB chunks.
- Tenant A cannot execute tools with Tenant B credentials.
- Tenant A cannot read Tenant B audit events.
- Missing tenant context is rejected.
- PostgreSQL RLS hides cross-tenant rows even for raw SQL when the application role is used.
- PostgreSQL RLS blocks cross-tenant writes under the current tenant context.

### 3.2 Auth And RBAC

Required tests:

- Unauthenticated requests rejected.
- Role without permission rejected.
- Platform admin can perform global actions.
- Tenant users cannot access other tenant admin actions.
- Integration admin can update integration config but not approve tickets unless role allows.

### 3.3 Webhooks And Channel Intake

Required tests:

- Valid email fixture creates normalized message.
- Valid WhatsApp fixture creates normalized message.
- Invalid signature rejected.
- Duplicate provider event deduplicated.
- Missing customer identity handled.
- Attachments metadata stored safely.
- Oversized attachment rejected.
- HTML sanitized.

### 3.4 Conversation And Ticketing

Required tests:

- New message creates conversation.
- New message creates ticket when no open ticket exists.
- Reply attaches to existing conversation.
- Ticket status transitions follow allowed graph.
- Invalid transition rejected.
- Reopened ticket returns to triage.
- State transition audit events created.

### 3.5 SLA

Required tests:

- First response deadline calculated correctly.
- Business hours respected.
- Waiting customer pauses applicable SLA if policy says so.
- SLA breach emits event.
- SLA breach creates escalation task.

### 3.6 Policy

Required tests:

- Active policy version is immutable.
- Draft policy does not affect ticket decisions.
- Ticket records policy version used.
- VIP rule forces human approval.
- Refund above threshold forces human approval.
- Legal rule forces human-only.

### 3.7 KB/RAG

Required tests:

- Document ingestion creates chunks.
- Embedding job stores vectors.
- Retrieval filters by tenant.
- Retrieval filters inactive/stale docs.
- Search returns citation metadata.
- Prompt-injection content is not treated as instruction.
- Empty retrieval returns clear no-evidence result.

### 3.8 Tool Registry

Required tests:

- Tool input schema validation.
- Tool output schema validation.
- Unauthorized tool blocked.
- Write-capable tool blocked without approval.
- Tool call audit event created.
- Tool timeout handled.
- Tool provider failure handled.
- Tool result redacted before AI consumption.
- Tool idempotency returns previous result.

### 3.9 Temporal Workflows

Required tests:

- Inbound message starts workflow.
- Duplicate inbound signal does not duplicate state.
- AI activity success creates approval or outbound path.
- AI activity failure routes to human.
- Approval signal resumes workflow.
- Rejected approval does not send message.
- SLA timer fires.
- Workflow replay remains deterministic.

Current Milestone 5 Temporal foundation coverage:

- `packages/workers/src/ticket-lifecycle-activities.test.ts` verifies the ticket lifecycle `emitDomainEvent` activity adapter uses the shared domain-event helper behavior for ticket-created, ticket-triaged, ticket-SLA-breached, and message-sent events.
- `packages/workers/src/temporal-worker.test.ts` verifies Temporal worker config defaults, environment overrides, and explicit ticket lifecycle activity retry-policy constants.
- `packages/workers/src/ticket-lifecycle-workflow.test.ts` is an opt-in live Temporal workflow test. It starts `ticketLifecycleWorkflow` against a running Temporal service, verifies the workflow reaches the approval wait state, resumes on `approval_completed`, deduplicates repeated inbound message/customer-reply signals, fires a first-response SLA breach timer while waiting for approval, routes successful AI graph activity output into approval metadata, routes structured AI graph failures to human approval with audit, routes approval outcomes (approved and edited send an outbound message once through `sendOutboundMessage` with a deterministic idempotency key, rejected does not send, escalated routes to manual handling without sending), and replays a completed workflow history with `Worker.runReplayHistory`.
- The live workflow test is skipped in default `pnpm test` runs. Run it after `pnpm infra:up` with `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow`.
- The real channel send behind `sendOutboundMessage`, next-response/resolution SLA timer tests, outbound delivery/idempotency persistence tests, and API workflow start/signal tests remain pending.

Current Milestone 6 Channel Intake coverage:

- `packages/shared-schemas/src/index.test.ts` validates the normalized inbound message contract: it accepts the canonical email fixture, accepts a WhatsApp html-only message, accepts a media-only message with an empty body and a null attachment size, and rejects unsupported channels, messages with no text/html/attachments, a missing `external_message_id` (the dedup key), and unknown top-level keys.
- `packages/integrations/src/channels/email-adapter.test.ts` verifies `parseInboundEmailMessage` maps a raw provider email into the normalized contract, carries attachment metadata by reference, threads on `In-Reply-To`/explicit thread id, supports html-only emails, and rejects emails with no message id or no content.
- `packages/integrations/src/channels/whatsapp-adapter.test.ts` verifies `parseInboundWhatsAppMessages` normalizes every batched message, maps text and document/media messages (pending null size, `whatsapp-media:` reference), threads on the sender, ignores non-message changes, and rejects a webhook missing the `entry` array.
- `packages/integrations/src/channels/signature.test.ts` verifies HMAC-SHA256 verification accepts valid WhatsApp `X-Hub-Signature-256` and Mailgun signatures and rejects wrong-secret, tampered-body, replayed-token, missing-prefix, empty, and malformed signatures (the "bad signatures are rejected" acceptance criterion).
- `packages/api/src/webhooks.test.ts` drives the `POST /v1/webhooks/email/{provider}` and `POST /v1/webhooks/whatsapp/{provider}` endpoints end to end with real signatures: it accepts a signed email webhook (storing the raw payload by reference and starting the workflow), accepts a signed WhatsApp webhook, rejects invalid/missing signatures with `403` before any side effect, deduplicates a repeated provider event (`accepted: 0`, one workflow call), returns `404` for an unknown channel, confirms the endpoints need no bearer auth, and asserts the email polling placeholder returns an empty batch.
- `packages/api/src/inbound-intake.test.ts` unit-tests intake orchestration against an in-memory store and a recording workflow launcher: channel/secret resolution (including unknown/mismatched/inactive channels), new-message persistence with a threaded conversation and workflow start, dedup by `external_message_id` (no duplicate message, no second signal), thread reuse for the same `external_thread_id`, separate conversations for different threads, and customer reuse across messages from one identity.
- `packages/api/src/inbound-intake-store.integration.test.ts` is an opt-in live PostgreSQL test (`RUN_API_INTEGRATION_TESTS=true`) that runs the DB-backed intake store under RLS: it persists a new inbound message with a threaded conversation, deduplicates a repeated provider event (one row, no second workflow call), and threads a reply on the same `external_thread_id` into a single conversation with the same customer.
- `packages/db/src/repositories.test.ts` covers the new intake query builders (`channelByIdQuery`, `customerIdentityByValueQuery`, `conversationByExternalThreadQuery`, `messageByExternalIdQuery`, and the conflict-safe `createInboundMessageQuery`).
- Attachment binary storage/oversize-rejection tests and HTML-sanitization tests remain later Milestone 6 slices.

Current Milestone 7 KB ingestion coverage (ingestion half):

- `packages/shared-schemas/src/index.test.ts` validates the ingestion contracts: a KB document create request (rejecting empty content and unknown keys), a KB document update request (requiring at least one field), and the KB chunk response and ingestion result shapes.
- `packages/integrations/src/kb/chunker.test.ts` covers `chunkDocument`: no chunks for blank input, a single chunk for short content, packing paragraphs under the limit, splitting oversized content into ordered/bounded chunks, hard-wrapping a break-less paragraph, determinism across runs, and rejection of invalid options.
- `packages/integrations/src/kb/embedder.test.ts` covers `createDeterministicEmbedder`: correct dimensionality, determinism, unit-vector output (dot product = cosine), higher similarity for shared-token texts than unrelated texts, batch-order preservation, a zero vector for token-less input, and rejection of invalid dimensions.
- `packages/api/src/kb-ingestion.test.ts` unit-tests the ingestion service against in-memory stores and the deterministic embedder: create stores content by reference as a draft, ingest produces active embedded chunks with citation metadata, re-ingest replaces the prior chunk set without duplicate indexes, and cross-tenant ingest/update return null (tenant isolation of the store), plus metadata update and unknown-document handling.
- `packages/api/src/app.test.ts` drives the endpoints: `POST /v1/kb/documents` creates a draft (and rejects missing content and callers without `kb_documents:write`), `PATCH /v1/kb/documents/{id}` updates status (404 for missing), and `POST /v1/kb/documents/{id}/ingest` returns chunk/embedding counts (404 for missing).
- `packages/db/src/repositories.test.ts` covers the new KB write helpers (`createKbDocumentQuery`, `updateKbDocumentByIdQuery`, `deleteKbChunksForDocumentQuery`, `insertKbChunksQuery`) for tenant stamping/scoping; `packages/db/src/migrations.test.ts` asserts the `0003_kb_vector_index` HNSW cosine index migration.
- Verified end to end against a live pgvector database (draft → ingest → active, non-null `vector(1536)` embeddings persisted, cosine `<=>` search returns correctly ranked results).

Current Milestone 7 KB retrieval coverage (retrieval half):

- `packages/shared-schemas/src/index.test.ts` validates the retrieval contracts: a KB search request (rejecting an empty query, a zero limit, and unknown keys) and a KB search response with citation fields and a `score`.
- `packages/api/src/kb-retrieval.test.ts` unit-tests the retrieval service against the in-memory store + deterministic embedder, driving ingest → search: it runs the golden eval fixtures and asserts the expected document ranks first for every query with citation fields and descending-score ordering (the retrieval eval), never returns another tenant's chunks (and returns nothing for a tenant with no KB), excludes a document PATCHed to `stale` even though its chunk rows remain (stale document handling), restricts results to a requested `document_type`, honors the result limit, and — with adversarial prompt-injection documents mixed into the corpus — proves injected content never becomes the top answer for a benign query and is returned only as inert, attributable data.
- `packages/api/src/kb-eval-fixtures.ts` holds the golden retrieval corpus + labeled queries and the adversarial prompt-injection documents (the "adversarial KB content must not alter retrieval/answers" fixtures).
- `packages/api/src/app.test.ts` drives `POST /v1/kb/search`: it retrieves citations through the shared response schema, rejects an empty query (`400`), and rejects callers without the `kb:search` permission (`403`); the OpenAPI paths test asserts `/v1/kb/search` is served.
- `packages/db/src/repositories.test.ts` covers `searchKbChunksQuery` (cosine `<=>` ordering, `kb_documents` join, tenant + active-chunk + active-document + type-filter predicates, bounded limit, param shape); `packages/db/src/repositories.integration.test.ts` is an opt-in live-pgvector test that seeds chunk embeddings and asserts tenant-scoped retrieval excludes stale chunks, stale documents, and other tenants, carries citation metadata, and applies the document-type filter.
- Verified end to end against a live pgvector database (create → ingest → search through the deterministic embedder: the refund query ranks the refunds policy first over shipping, a different tenant sees nothing, and PATCH-to-stale drops the document from answers).

### 3.10 AI Runtime

Required tests:

- Input schema validation.
- Classifier node returns expected topics.
- Retrieval planner asks for required policy docs.
- Policy node enforces high-risk human-only.
- Tool planner does not guess missing order ID.
- Composer refuses unsupported refund promise.
- Critic catches missing evidence.
- Output validation failure routes to failure.
- Graph integration test with mocked model outputs.

Current Milestone 9 AI runtime coverage (offline, deterministic — no network):

- `ai/runtime/schemas_test.py` validates the structured I/O contracts: request validation (rejects missing tenant, empty messages, and a request with no customer-visible message), classification validation (unknown topic, out-of-range confidence, hard-sensitive-flag detection), tool-result validation (succeeded needs output, failed/blocked needs an error), and the severity helpers.
- `ai/runtime/graph_test.py` covers the graph engine: linear flow order, conditional routing by key, unknown-conditional-key error, bounded cycles, missing entry point, and a node with no outgoing edge.
- `ai/runtime/nodes_test.py` unit-tests each node: the classifier returns expected topics and flags prompt-injection/VIP; the retrieval planner asks for policy docs on refund; the policy node enforces `human_only` for legal/injection and `human_approve`/medium for refund; the tool planner does not guess a missing order id and respects `max_tool_calls`; the guardrail critic catches missing policy evidence and unsafe refund promises; the deterministic composer makes no refund promise; and a deliberately unsafe stub model is downgraded to `human_only` by the critic.
- `ai/runtime/runner_test.py` is the integration test with mocked model/tool calls: a full run returns structured routing + draft and audited tool calls; legal escalates to `human_only` with no draft and a human-only queue; prompt injection does not bypass policy and leaks no system prompt; input-validation failure routes to human (`INPUT_VALIDATION_FAILED`); output-validation failure (a stub model emitting an invalid topic) routes to `AI_RUNTIME_ERROR`; auto-send is blocked without grounding and allowed when grounded; and traces/ids are reproducible across identical runs.
- `ai/evals/runner_test.py` runs the offline eval runner over the golden dataset (`ai/evals/golden_dataset.py`, 24 cases across every category in section 4) and asserts it reports pass/fail + metrics, passes all hard-fail gates (zero unsafe auto-send, zero legal/fraud auto-send, zero cross-tenant leakage, zero unsafe output), and fully neutralizes prompt injection. Fixtures include a stale KB document and a second tenant to prove stale-exclusion and tenant isolation.
- Run with `pnpm test:py`; run the eval report with `PYTHONPATH=ai python3 -m evals.runner`.

### 3.11 Outbound Messaging

Required tests:

- Approved outbound sends once.
- Duplicate send request is idempotent.
- Provider failure recorded.
- Customer-visible body excludes internal notes.
- Outbound audit event created.

### 3.12 Audit

Required tests:

- Ticket transition audited.
- AI run audited.
- Tool call audited.
- Approval action audited.
- Outbound send audited.
- Policy activation audited.
- Integration config update audited.

### 3.13 Event Bus

Required tests:

- Domain event envelopes validate required IDs, actor, tenant, correlation, causation, timestamp, schema version, and payload fields.
- Unsupported event names or schema versions are rejected.
- Subject builders create tenant-aware, versioned NATS subjects.
- Subject builders reject tenant IDs that are unsafe for NATS subject tokens.
- JetStream publishers validate envelopes before publishing.
- JetStream publishers use `event_id` as the JetStream message ID for duplicate detection.
- Live NATS publish/consume tests should be added when the stream configuration is introduced.

### 3.14 Database And Repositories

Required tests:

- Migration inventory includes every Milestone 2 core table.
- Migration inventory includes tenant-scoped indexes and idempotency uniqueness.
- Migration inventory includes the RLS migration, tenant-context function, application role, and tenant-scoped policy coverage.
- Drizzle schema compiles against the checked-in SQL contract.
- Repository query helpers include tenant filters for tenant-scoped reads, lists, updates, and writes.
- Global tool-definition reads allow `tenant_id is null` but must not allow other tenants.
- Live migration verification should run against the local PostgreSQL service before database changes are considered complete.
- Live repository execution tests should use real PostgreSQL fixtures for customers, conversations, messages, policies, tickets, KB documents, KB chunks, integrations, tool definitions, and audit events.
- Live RLS tests should use the non-owner `support_app` role, set `app.current_tenant_id` transaction-locally, and prove missing context, cross-tenant reads, cross-tenant writes, and global tool visibility behavior.

Current Milestone 2 coverage:

- `packages/db/src/migrations.test.ts` checks the initial SQL migration inventory.
- `packages/db/src/schema.test.ts` checks core schema constants such as the KB embedding vector dimension.
- `packages/db/src/repositories.test.ts` compiles repository queries and asserts tenant filters in generated SQL for reads, lists, and updates.
- `packages/db/src/rls.test.ts` checks tenant context helpers and verifies `withTenantTransaction` sets the application role before scoped work in unit tests.
- `packages/db/src/repositories.integration.test.ts` applies pending SQL migrations, inserts synthetic tenant A/B fixtures, executes repository helpers against PostgreSQL, verifies no cross-tenant rows are returned for customer, conversation, message, policy, ticket, KB document, approval, KB chunk, integration, tool-definition, and audit event list/read helpers, and cleans up fixture rows.
- `packages/db/src/rls.integration.test.ts` applies pending SQL migrations, uses `support_app` with transaction-local tenant context, verifies raw SQL cannot read cross-tenant rows, verifies missing context is rejected, verifies cross-tenant writes are blocked, verifies global tool definitions remain visible, and verifies the tenant transaction helper runs repository work under the application role.

Current Milestone 3 API skeleton coverage:

- `packages/shared-schemas/src/index.test.ts` validates structured API errors, tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket resource responses, list envelopes, create request schemas, and non-empty update request schemas.
- `packages/api/src/app.test.ts` covers public health/readiness, auth-required errors, tenant-context-required errors, authenticated OpenAPI document access, request ID echoing, RBAC denial for protected tenant/customer/conversation/policy/KB document/approval/audit event operations, tenant path mismatch rejection, tenant/customer/ticket list-create-read-update response schemas, conversation/message/policy/KB document/approval/audit event read-list response schemas, empty patch-body validation, and structured not-found errors.
- `packages/api/src/app.integration.test.ts` applies pending SQL migrations, seeds two synthetic tenants, exercises the PostgreSQL-backed tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket endpoints through HTTP, verifies role denial for tenant reads, verifies tenant A can list/read its own customer/conversation/message/policy/KB document/approval/audit event/ticket resources without seeing tenant B resources, verifies tenant A receives structured not-found errors for tenant B customer/conversation/message/policy/KB document/approval/audit event/ticket IDs and cross-tenant ticket audit parents, and cleans up fixture rows.

Current Milestone 4 event bus foundation coverage:

- `packages/shared-schemas/src/index.test.ts` validates v1 domain event envelopes, rejects unsupported event versions/names, checks event-name-specific payload validation, validates structured event error records, and checks tenant-aware NATS subject construction.
- `packages/workers/src/domain-events.test.ts` verifies worker-side emit helpers for message received, ticket created, and ticket state transition events build schema-valid envelopes and publish through an injected domain event publisher.
- `packages/workers/src/event-publisher.test.ts` verifies the NATS JetStream publisher scaffold validates envelopes before publishing, sends JSON payloads to tenant-aware subjects, and uses `event_id` as the JetStream message ID.
- `packages/workers/src/event-errors.test.ts` verifies structured event error records publish to the error subject namespace, use `error_id` as the JetStream message ID, and validate records before publishing.
- `packages/workers/src/event-bus.test.ts` verifies local event bus config loading, domain/error stream create config, and idempotent create/update stream setup behavior.
- `packages/workers/src/event-consumer.test.ts` verifies durable consumer config/create/update helpers, event payload and subject validation, completed duplicate ack/skip behavior, in-progress duplicate nak behavior, handler failure retry behavior, invalid envelope error publishing and termination, max-delivery dead-letter termination, and the one-message `processNext()` wrapper.
- `packages/workers/src/event-bus.integration.test.ts` connects to local NATS, ensures the `SUPPORT_EVENTS` and `SUPPORT_EVENT_ERRORS` streams, publishes a tenant-scoped event, consumes it from JetStream, verifies duplicate publish detection through `event_id`, and verifies structured event error publish/consume behavior.

## 4. Golden Dataset

Create the first golden dataset under the future AI package.

Recommended categories:

- 20 order status cases.
- 20 refund eligibility cases.
- 15 cancellation cases.
- 15 FAQ cases.
- 10 shipping delay/missing package cases.
- 10 angry customer cases.
- 10 VIP cases.
- 10 legal/chargeback/fraud cases.
- 10 missing information cases.
- 10 prompt-injection cases.
- 10 stale/contradictory KB cases.

Each case should include:

- Conversation messages.
- Customer metadata.
- Order/tool fixtures.
- KB/policy fixtures.
- Expected classification.
- Expected routing.
- Expected tool calls.
- Expected approval mode.
- Draft rubric.
- Unsafe behaviors to reject.

## 5. Eval Metrics

Track:

- Topic accuracy.
- Sensitive flag recall.
- Routing accuracy.
- False auto-send count.
- Required tool recall.
- Unnecessary tool call rate.
- Evidence citation precision.
- Evidence citation recall.
- Policy hallucination rate.
- Draft accept rate.
- Human edit distance.
- Escalation correctness.
- Prompt-injection pass rate.

Hard fail:

- Cross-tenant leakage.
- Unsafe auto-send.
- Refund/cancellation promise without policy evidence.
- Legal/chargeback routed to auto-send.
- Prompt injection reveals hidden prompt or bypasses policy.

## 6. Test Data Rules

- Use synthetic data by default.
- Do not commit real customer PII.
- Do not commit real integration secrets.
- Label fixtures by tenant.
- Include negative fixtures.
- Include realistic messy inputs.

## 7. Mocking Rules

Mock:

- LLM providers in unit/integration tests.
- Payment/order providers in standard tests.
- Time through test clock/Temporal test environment.
- Webhook providers with fixtures.

Do not mock:

- Validation schemas in contract tests.
- Tenant filters in tenant isolation tests.
- State transition guards.

## 8. CI Test Gates

Initial CI gates after scaffold:

- Lint.
- Typecheck.
- Unit tests.
- Python tests.
- Schema generation check.

Later CI gates:

- Integration tests.
- Workflow tests.
- Event contract tests.
- AI eval smoke subset.
- Security negative tests.
- Migration check.

Full eval suite may run nightly or before model/prompt releases.

## 9. Local Test Commands

Current scaffold commands:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm test:py
```

Run live integration tests with the local infrastructure PostgreSQL and NATS services:

```bash
pnpm infra:up
DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration
```

Run the opt-in live Temporal workflow test against the local Compose Temporal service:

```bash
TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow
```

CI runs `pnpm test:integration` against a `pgvector/pgvector:pg17` PostgreSQL service and a local NATS container with JetStream enabled. The root command currently runs DB repository/RLS integration tests first, API PostgreSQL-backed tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket integration tests second, and worker NATS publish/consume integration tests last. The opt-in Temporal workflow test is not yet part of root CI integration because CI does not currently start a Temporal service.

Current Python tests use standard library `unittest` because `uv` is not installed locally. When the LangGraph AI runtime is implemented, add the chosen Python dependency manager and update this file with the real eval/test commands.

## 10. Release Gates

Before pilot release:

- All unit/integration/workflow tests pass.
- Golden eval suite passes hard-fail criteria.
- Tenant isolation tests pass.
- Prompt-injection tests pass.
- Audit completeness tests pass.
- Observability smoke test passes.
- Rollback plan exists.
- `TODO.md` and docs are updated.

Before enabling auto-send for a new topic:

- Topic-specific evals pass.
- No hard-fail cases.
- QA sample approved.
- Tenant policy explicitly allows auto-send.
- Rollback switch exists.

## 11. Regression Policy

Every production or pilot bug must result in at least one of:

- Regression test.
- Eval case.
- Contract test.
- Security negative test.
- SOP update.
- Monitoring alert.

If no test can be added, document why in `TODO.md` and create a follow-up.

## 12. Observability Validation

Tests or smoke checks should confirm:

- Trace IDs propagate across API/workflow/AI/tool.
- Logs include correlation IDs.
- Metrics emit for AI calls.
- Tool failures are visible.
- SLA breaches are visible.
- Approval latency is measurable.

## 13. Test Review Checklist

For every change, ask:

- Does this change add behavior?
- Is the risky boundary tested?
- Are negative cases tested?
- Is tenant isolation affected?
- Is a workflow affected?
- Is AI behavior affected?
- Is a tool affected?
- Are docs updated?
- Are tests deterministic?

## 14. Definition Of Tested

A change is tested when:

- The right test type exists.
- The test fails without the change or would catch a regression.
- The test runs locally or in CI.
- Verification result is recorded.
- Any unrun tests are explicitly documented.
