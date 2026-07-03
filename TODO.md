# TODO.md

## Purpose

This file is the cross-session source of truth for what has been done, what is next, what is blocked, and what must be verified. Every coding session must update this file before ending.

## Current Status

- Project phase: Milestone 3 API skeleton is complete with tenant/customer/ticket list-create-read-update contracts plus conversation/message/policy/KB document metadata/approval/audit event read-list contracts, ticket audit event list contracts, RBAC checks, and PostgreSQL-backed API integration coverage. Milestone 4 event bus foundation is complete with typed event payload schemas, subject naming, publisher wiring, workflow-ready emit helpers, explicit local NATS JetStream domain/error stream config, worker-side consumer base/idempotency/error handling, and live publish/consume integration coverage. Milestone 5 Temporal workflow foundation is complete with the deterministic ticket workflow shell, activity boundaries, first-response SLA timer breach behavior, an AI graph activity placeholder with success/failure-to-human routing, a `sendOutboundMessage` activity placeholder with deterministic approval-outcome routing (approved/edited send once, rejected does not send, escalated routes to manual handling), explicit activity retry policies, and replay coverage. Milestone 6 channel intake is complete (normalized inbound schema, provider adapters, signature verification, webhook ingress, tenant-scoped persistence, and workflow start/signal wiring). Milestone 7 KB and retrieval is complete: the ingestion vertical (KB document/chunk ingestion contracts, deterministic chunking + embedding pipelines, a pgvector HNSW cosine index, content stored by reference, and tenant-scoped document create/update/ingest endpoints) plus the retrieval vertical (`POST /v1/kb/search` tenant-scoped cosine nearest-neighbour retrieval over active chunks/documents with citation metadata, stale-document exclusion, a `kb:search` permission, retrieval eval + prompt-injection fixtures, and tenant-isolation tests) are both done. Milestone 8 tool registry is complete: shared tool contracts (side-effect + permission classes, tool-call request/result envelope), a tenant-scoped tool executor with schema validation, permission-class checks, timeout + size-bounded AI-safe results, `tool_calls` audit logging, and idempotent replay for side-effect tools, plus the six first-party tools (order/shipment/refund/cancellation/customer lookups and calculators + a `kb_search` tool reusing the Milestone 7 retrieval service). Milestone 9 AI runtime is complete: a dependency-free Python LangGraph-style support agent graph under `ai/` (normalize → classifier → retrieval planner → retrieval → policy → tool planner → tool execution → conditional composer → guardrail critic → escalation → finalize) with structured Pydantic-equivalent I/O contracts, a `ModelProvider` port + deterministic offline model, `RetrievalPort` and `ToolExecutor` ports (the latter mirroring the Milestone 8 tool-call envelope + permission classes), deterministic trace capture, and an initial golden dataset with an offline eval runner enforcing hard-fail safety gates.
- Current milestone: Milestone 9 - AI Runtime With LangGraph is complete (`feat-milestone9-ai-runtime`). Next: Milestone 10 - Approval And Outbound Messaging. Done this session: a self-contained Python AI runtime under `ai/` implementing the v1 support agent graph as a dependency-free LangGraph-style state machine (ADR-0016, because LangGraph/LangChain/Pydantic are not installable in the local Python 3.14 / no-uv harness). Delivered: structured Pydantic-equivalent I/O contracts (`ai/runtime/schemas.py`) aligned with the Temporal `RunAiGraphActivityResult` boundary; a tiny graph engine mirroring LangGraph's `add_node`/`add_edge`/`add_conditional_edges`/`compile().invoke()` (`ai/runtime/graph.py`); the 11-node graph (`ai/runtime/nodes.py` + `support_graph.py`); a `ModelProvider` port with a deterministic offline support model (classification + safe drafting) (`providers.py`); a `RetrievalPort` (tenant-scoped, stale-excluding, lexical) (`retrieval.py`); a `ToolExecutor` port mirroring the Milestone 8 `ToolCallRequest`/`ToolCallResult` envelope + permission classes over commerce fixtures (`tools.py`), with the AI runtime's granted permissions derived from the policy's allowed tools (Milestone 8 follow-up); deterministic reproducible trace capture (`tracing.py`); an initial golden dataset covering every eval category + an offline eval runner with hard-fail safety gates (`ai/evals/`); and 49 Python unit/integration tests. Verified: full graph returns structured routing + draft; risky (legal/chargeback/fraud) and prompt-injection cases escalate to `human_only` with no auto-draft; no auto-send without grounding; golden dataset passes all gates (topic/routing/tool/escalation/injection metrics = 1.000, zero unsafe auto-send / cross-tenant leakage).
- Current scope: Core PostgreSQL schema, migration runner, Drizzle schema, tenant-scoped repository query helpers, PostgreSQL RLS, live PostgreSQL repository/RLS execution tests, API request/auth/tenant context middleware placeholders, structured errors, OpenAPI skeleton, role permission checks for current endpoint families, PostgreSQL-backed API integration tests, tenant/customer/ticket list-create-read-update skeleton contracts, conversation/message/policy/KB document metadata/approval/audit event read-list skeleton contracts, ticket audit event list contracts, shared v1 domain event envelope/payload schemas, tenant-aware NATS subject naming, worker-side NATS JetStream publisher plus connection/domain/error stream setup wiring, worker-side NATS JetStream event emit helpers including ticket SLA breach emission, worker-side NATS JetStream consumer base with storage-agnostic idempotency/error handling, local NATS JetStream config, live NATS publish/consume integration coverage, Temporal worker config/runtime scaffold, deterministic ticket lifecycle workflow shell, workflow activity contracts/placeholders including a structured AI graph placeholder, first-response SLA timer breach handling, structured AI failure-to-human routing, workflow-owned domain event emission activity adapter, explicit Temporal activity retry policies, opt-in live Temporal workflow/replay coverage, and session harness preflight/handoff checks. Full business workflow implementation is still pending.
- Default stack: TypeScript API/workers, Python AI runtime, Temporal, LangGraph, PostgreSQL, pgvector, Redis, NATS JetStream, OpenTelemetry.

## Active Harness Guardrails

- Start non-trivial work from a short-lived feature/fix branch. Do not work directly on `main` unless the user explicitly approves direct-main work.
- Run `pnpm harness:preflight` after branching.
- Before ending a coding session, update the active milestone checklist below as well as the session handoff text.
- Run `pnpm harness:handoff` before final response or push.
- Push feature/fix branches by default. Push `main` only when explicitly requested.

## Next Recommended Task

The next implementation task is:

> Begin Milestone 10 - Approval And Outbound Messaging. Define the approval record schema and approval request creation/read/approve-edit-reject-escalate APIs; wire the approval signal into the Temporal `ticketLifecycleWorkflow` (which already routes AI failures/human-only to approval); add the outbound message schema, email + WhatsApp outbound adapters, outbound idempotency, and outbound audit events; add tests for approval resume and the edited-draft audit trail. Acceptance: the workflow pauses until approval, approved/edited responses are sent once, rejected responses do not send, and human edits are stored for eval and QA. The Milestone 9 AI runtime produces the `human_approve`/`human_only` recommendation + human approval package that this milestone consumes.

Milestone 9 follow-ups to fold into later work (not blockers): Python dependency management is now provisioned — `uv` is installed, `ai/.python-version` pins uv-managed CPython 3.12, `ai/uv.lock` is committed, the harness runs via `uv run --frozen --project ai`, and the real AI stack installs with `uv sync --project ai --extra llm` (ADR-0016 follow-up). Swap a real LLM `ModelProvider` (LangChain/provider SDK) and, if adopted, the real LangGraph library behind the ports (`ModelProvider`, `RetrievalPort`, `ToolExecutor`) and the graph engine — the seams (ADR-0016); call the live TypeScript tool registry (`packages/api` `POST`-style executor) from the tool-execution node over the network boundary instead of the in-memory Python executor, and call `POST /v1/kb/search` from the retrieval node; wire the Python runtime behind the Temporal `RunAiGraphActivity` placeholder in `packages/workers` (the Python `RuntimeResult` already mirrors `RunAiGraphActivityResult`); expand the golden dataset to the recommended per-category counts in `docs/TEST_STRATEGY.md` §4 and add an LLM-graded draft-quality rubric; and add prompt files with stable IDs/versions (harness §8) once a real model is wired.

Milestone 8 follow-ups to fold into later work (not blockers): a live-PostgreSQL tool registry integration test exercising `createDatabaseToolRegistryStore` audit + idempotency end to end (needs seeded `tool_definitions`, plus `tickets`/`ai_runs` rows for the `tool_calls` FKs); seeding first-party `tool_definitions` rows (global visibility) via a migration/seed so `createDatabaseToolExecutor` resolves them; and, once Milestone 9 exists, wiring the executor's `ToolExecutionContext.grantedPermissions` to the AI runtime policy / RBAC roles instead of a caller-supplied set.

Milestone 6 follow-ups to fold into later slices (not blockers): attachment binary storage + oversize-attachment rejection, HTML sanitization to `body_html_ref`, and supporting multiple tickets per conversation (Milestone 6 wires one lifecycle workflow per conversation with a deterministic `tkt_{conversation_id}` ticket id).

Milestone 7 follow-ups to fold into later work (not blockers): a live-PostgreSQL KB ingestion integration test through the ingestion service (needs a seeded user for `created_by_user_id` FK, or keep it null); a Temporal `KbIngestionWorkflow` driving `load_document`/`chunk_document`/`embed_chunks`/`write_chunks`/`mark_document_active` as activities instead of the synchronous API path; choosing/documenting a production embedding model behind the `Embedder` port and wiring the same instance into both ingestion and retrieval (re-embed if its dimension != 1536); and optionally a similarity-score threshold / max-context-tokens cap on retrieval before the AI runtime consumes it.

## Session Handoff

### Last Session Summary

- Created feature branch `feat-milestone9-ai-runtime` from `main` and ran `pnpm harness:preflight`.
- Completed Milestone 9 - AI Runtime With LangGraph in one coherent branch (all 17 checklist items + 4 acceptance criteria).
- Architecture decision ADR-0016: the local harness runs Python via the system `python3` (`pnpm test:py`, `pnpm lint` → `compileall`) on Python 3.14 with no `uv` and no installed packages, so LangGraph/LangChain/Pydantic are not installable. The v1 support graph is implemented as a self-contained, dependency-free Python state machine that mirrors LangGraph's node model behind ports where the real LangGraph/LLM/registry adapters plug in later. Keeps `pnpm test`/`pnpm lint` green and reproducible for future sessions.
- `ai/runtime/schemas.py`: stdlib structured I/O contracts (`RuntimeRequest`/`RuntimeResult`, `Classification`, `PolicyDecision`, `Draft`, `GuardrailResult`, `FinalRecommendation`, `HumanApprovalPackage`, and a Python mirror of the `ToolCallRequest`/`ToolCallResult` envelope) with explicit validation; `RuntimeResult` mirrors the Temporal `RunAiGraphActivityResult` shape. `ai/runtime/state.py`: the mutable `AgentState` (harness §5).
- `ai/runtime/graph.py`: a tiny graph engine reproducing LangGraph's `add_node`/`set_entry_point`/`add_edge`/`add_conditional_edges`/`compile().invoke()` with cycle bounding. `ai/runtime/support_graph.py` wires the 11-node graph: normalize → classifier → retrieval_planner → retrieval → policy → tool_planner → tool_execution → (conditional) composer|guardrail → guardrail → escalation → finalize. The conditional edge skips drafting for hard human-only cases (legal/chargeback/fraud/safety/injection).
- `ai/runtime/nodes.py`: all nodes. Classification + drafting go through the `ModelProvider` port; policy and guardrail are deterministic governance. Policy defaults to `human_approve`, forces `human_only` for hard-sensitive flags, allows opt-in low-risk allowlisted auto-send; escalation combines policy + critic + confidence + grounding (auto-send always requires evidence or a successful tool). The AI runtime's granted permission set is derived from the policy's allowed tools (Milestone 8 follow-up). Order numbers are extracted, never guessed.
- `ai/runtime/providers.py`: `ModelProvider` protocol + `DeterministicSupportModel` (rule-based, reproducible, safe-by-construction — never promises a refund without eligibility+policy evidence) + an `UnconfiguredLlmModel` marking the real-provider seam. `ai/runtime/retrieval.py` (`RetrievalPort` + `InMemoryRetrieval`, tenant-scoped, stale-excluding lexical scorer) and `ai/runtime/tools.py` (`ToolExecutor` + `InMemoryToolExecutor` over `CommerceDataset`, mirroring Milestone 8 governance: permission class, arg validation, bounded results, stable `tool_call_id`). `ai/runtime/tracing.py`: deterministic, redacted trace capture. `ai/runtime/runner.py`: `run_support_graph()` — validates input, runs the graph, assembles `RuntimeResult`, and converts any input/output validation failure into a structured `failed` result that routes to human (harness §16).
- `ai/evals/`: `fixtures.py` (KB/policy + commerce fixtures, incl. a stale doc and a second tenant for isolation), `golden_dataset.py` (24 labeled cases across every category), `runner.py` (offline eval runner computing topic/routing/tool/escalation/injection metrics + hard-fail gates for unsafe auto-send, cross-tenant leakage, unsafe output, prompt injection). Run: `PYTHONPATH=ai python3 -m evals.runner`.
- Tests: 49 Python tests (`schemas_test`, `graph_test`, `nodes_test`, `runner_test`, `evals/runner_test`) covering input/output validation, the engine, each node, full runs, escalation, injection resistance, failure routing, trace reproducibility, and the golden-dataset gates. Kept the Milestone 0-8 `build_initial_decision` scaffold for back-compat.
- Created feature branch `feat-milestone8-tool-registry` from `main`.
- Completed Milestone 8 - Tool Registry in one coherent branch (all 15 checklist items + 4 acceptance criteria).
- Added the tool contracts to `packages/shared-schemas/src/index.ts`: `ToolSideEffectClassSchema` (now the canonical source) and `ToolPermissionClassSchema` (permission classes), plus the tool-call envelope `ToolCallRequestSchema`, `ToolCallResultSchema` (a `.strict()` discriminated union on `succeeded`/`failed`/`blocked` where the failure branch allows an empty `tool_call_id` for pre-audit gate blocks), `ToolCallErrorCodeSchema`, and `ToolCallErrorSchema`, with inferred type exports and unit tests.
- Refactored `packages/integrations/src/tool-contract.ts` to import the side-effect + permission enums from `@support/shared-schemas` (single source of truth) and re-export them; typed `ToolDefinitionSchema.permission` to `ToolPermissionClassSchema`; kept `defineReadOnlyTool` and added `defineSideEffectTool` (defaults `requiresHumanApproval` true). Updated `tool-contract.test.ts`.
- Added to `packages/db`: `ToolCall`/`NewToolCall` type exports and the `tool_calls` repository queries `insertToolCallQuery`, `updateToolCallByIdQuery`, `toolCallByIdempotencyKeyQuery` (reusing the existing `tool_calls` table + its `(tenant, tool_definition, idempotency_key)` unique index).
- Added the executor `packages/api/src/tool-registry.ts` (`createToolExecutor`): per call it resolves tenant-scoped visibility via `visibleToolDefinitionByNameQuery`, checks the tool's permission class against `ToolExecutionContext.grantedPermissions`, validates arguments against the tool's zod `argsSchema`, runs the handler under its `timeoutMs`, validates + size-bounds the result (default 16 KiB, rejected not truncated), and writes a `tool_calls` audit row for every outcome. Idempotency (side-effect tools only) de-duplicates by key and replays the first outcome. Ships a `ToolRegistryStore` port with a DB impl under `withTenantTransaction`/RLS and an in-memory impl (with `listCalls()`) for unit tests. `ToolExecutionContext` carries `tenantId`/`ticketId`/`aiRunId` because `tool_calls.ticket_id`/`ai_run_id` are notNull FKs.
- Added the six first-party tools in `packages/api/src/tools/` (`index.ts` + `commerce-fixtures.ts`): order lookup, shipment tracking lookup, refund + cancellation eligibility calculators, and customer profile lookup over injectable tenant-scoped mock commerce fixtures (eligibility uses an injectable clock for deterministic windows), plus `kb_search`, which reuses the Milestone 7 `KbRetrievalService` and returns bounded, citation-focused results. `createDatabaseToolExecutor()` wires the production executor (DB store + first-party tools + DB KB retrieval).
- Added `packages/api/src/tool-registry.test.ts` (22 tests): success + audit, invalid-arguments rejection, permission-blocked (spy proves the handler never runs), not-visible + disabled definitions, out-of-contract result, oversized-result bound, timeout, idempotent replay (executed once), read-only tools not de-duplicated, tenant isolation, and per-tool behavior for all six tools.
- Unrun/notes: no live-PostgreSQL integration test for `createDatabaseToolRegistryStore` yet (would need seeded `tool_definitions` + `tickets`/`ai_runs` for the `tool_calls` FKs); first-party `tool_definitions` rows are not seeded, so `createDatabaseToolExecutor` won't resolve them until a seed/migration adds them (in-memory store used for tests); `grantedPermissions` is caller-supplied and should be wired to RBAC/AI-runtime policy in Milestone 9. Captured as Milestone 8 follow-ups above.
- Created feature branch `feat-milestone7-kb-retrieval` from `main` and ran `pnpm harness:preflight`.
- Completed the retrieval half of Milestone 7 - KB And Retrieval (the remaining six checklist items: tenant-scoped retrieval, citation metadata, stale document handling, retrieval eval fixtures, prompt-injection test content, tenant-isolation retrieval tests), finishing the milestone in one coherent branch.
- Added the retrieval contracts to `packages/shared-schemas/src/index.ts`: `KbSearchRequestSchema` (`.strict()`; `query` required, optional `limit`/`document_type`/`source_type`), `KbSearchResultSchema` (extends `KbChunkResponseSchema` with a relevance `score` and the `document_title`/`document_type`/`source_type`/`source_ref` citation fields), and `KbSearchResponseSchema` (`results` + `page`), with inferred type exports and unit tests.
- Added `searchKbChunksQuery` to `packages/db/src/repositories.ts`: a tenant-scoped cosine (`<=>`, `drizzle-orm` `cosineDistance`) nearest-neighbour query over `kb_chunks.embedding` (HNSW index) that inner-joins `kb_documents`, filters to `active` chunks of `active` documents (stale-document exclusion), applies optional `document_type`/`source_type` filters, orders by ascending distance, and returns citation fields. Added a builder test (SQL/param shape) and a live-DB integration test (tenant isolation, stale-chunk + stale-document exclusion, type filter) with seeded chunk embeddings.
- Added the `packages/api` retrieval vertical in `kb-retrieval.ts`: a `KbRetrievalStore` port (DB impl under `withTenantTransaction`/RLS mapping cosine distance → similarity `score`; in-memory impl computing cosine over the ingestion store's chunks, mirroring the same active-chunk/active-document/type filters), and a `KbRetrievalService` that embeds the query with the same `Embedder` used at ingestion and maps hits to `KbSearchResult`. Made the in-memory ingestion store stamp `createdAt` on chunks so retrieval surfaces a faithful timestamp.
- Added `POST /v1/kb/search` in `routes.ts` behind a new `kb:search` permission (`rbac.ts`, granted to the KB-read roles: platform_admin, ops_admin, support_agent, qa_reviewer, client_viewer), wired `search` onto `services.kbDocuments` with an injectable `KbRetrievalService` (`createDatabaseApiServices({ kbRetrieval })`), and added the OpenAPI path + `KbSearchRequest`/`KbSearchResult`/`KbSearchResponse` schemas.
- Added retrieval eval + prompt-injection fixtures (`packages/api/src/kb-eval-fixtures.ts`): a small deterministic golden corpus + labeled queries, plus adversarial "prompt injection" documents. `kb-retrieval.test.ts` asserts per-query top-1 ranking, citation fields, descending-score ordering, tenant isolation, stale-document exclusion, document-type filtering, limit handling, and that adversarial content never hijacks ranking and is returned only as inert, attributable data.
- Verification: `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` all pass; `pnpm test` green (shared-schemas 29, integrations 38, workers 37, db 47, api 80, plus the Python step). Ran the live DB path against `pgvector/pgvector:pg17`: `@support/db` (19) + `@support/api` (25) integration suites green, and drove the full `create → ingest → search` vertical end to end with the deterministic embedder (refund query ranks the refunds policy first, cross-tenant search returns nothing, PATCH-to-stale drops the document from answers). Stopped the container afterward (it was not running before this session). Added `.data/` to `.gitignore` (the KB content store's default dir).
- Unrun/notes: retrieval and ingestion each default to their own `createDeterministicEmbedder()` instance — identical for the deterministic default, but a production hosted model must be wired into both behind the `Embedder` port. Retrieval currently returns all matches above the top-K with no similarity-score floor or context-token cap (fine for the deterministic embedder; revisit for a production model). See `docs/DECISIONS.md` ADR-0015.
- Created feature branch `feat-milestone7-kb-ingestion` from `main` and ran `pnpm harness:preflight`.
- Started Milestone 7 - KB And Retrieval and completed its ingestion half (six checklist items: KB document schema, KB chunk schema, document upload/ingestion API, chunking pipeline, embedding pipeline, pgvector index) in one coherent branch.
- Added the ingestion contracts to `packages/shared-schemas/src/index.ts`: `KbDocumentCreateRequestSchema` (`.strict()`, `content` required and stored by reference), `KbDocumentUpdateRequestSchema` (metadata/status PATCH, at least one field), `KbChunkResponseSchema` (embeddings intentionally omitted from the API contract), and `KbIngestionResultSchema`, with inferred type exports and unit tests.
- Added the pure, deterministic KB pipelines in `packages/integrations/src/kb`: `chunkDocument` (paragraph-aware overlapping chunks, hard-wrap fallback, deterministic) and an `Embedder` port with `createDeterministicEmbedder` (FNV-1a token-hash, signed buckets, L2-normalized `vector(1536)` so dot product = cosine). Both are network-free and unit-tested; exported from the package barrel.
- Added `packages/db/migrations/0003_kb_vector_index.sql` (a pgvector HNSW `vector_cosine_ops` index over `kb_chunks.embedding`) plus tenant-scoped write helpers `createKbDocumentQuery`, `updateKbDocumentByIdQuery`, `deleteKbChunksForDocumentQuery`, and `insertKbChunksQuery`. Updated `migrations.test.ts` (expects `0003_kb_vector_index` and asserts the HNSW index) and added repository write-helper tests.
- Added the `packages/api` ingestion vertical: `KbContentStore` (filesystem default + in-memory double; keeps raw bodies out of PostgreSQL, keyed by tenant + document id), `KbIngestionStore` (DB impl under `withTenantTransaction`/RLS with atomic chunk replacement + in-memory impl), and `KbIngestionService` (create → store content + insert draft; ingest → read content, chunk, embed, replace active chunks, mark active; update → metadata/status). Wired create/update/ingest onto `services.kbDocuments` and injectable via `createDatabaseApiServices({ kbIngestion })`.
- Added the endpoints `POST /v1/kb/documents` (201, draft), `PATCH /v1/kb/documents/{id}`, and `POST /v1/kb/documents/{id}/ingest` in `routes.ts`, gated behind a new `kb_documents:write` permission (platform_admin, ops_admin, support_agent) in `rbac.ts`, plus the three OpenAPI paths and request/result schemas.
- Verification: `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` all pass; `pnpm -r test` green (shared-schemas 27, integrations 38, db 46, api 70, workers 37). Ran the live DB path: started the `pgvector/pgvector:pg17` container, applied migrations (`0003_kb_vector_index` applied, HNSW index confirmed on `kb_chunks`), and ran `@support/db` (17) + `@support/api` (25) integration suites green. Drove the full ingestion vertical end to end against live pgvector (draft → ingest → active, non-null embeddings persisted, cosine `<=>` search ranked correctly self=0 / related=0.83 / unrelated=1.0), then stopped the container (it was not running before this session).
- Unrun/notes: no live-PostgreSQL KB ingestion integration test was added (would need a seeded user for the `created_by_user_id` FK, or keep it null); the API ingest path is synchronous (no Temporal `KbIngestionWorkflow` yet); the deterministic embedder produces lexical, not semantic, similarity (a production model must be chosen behind the `Embedder` port before pilot). See `docs/DECISIONS.md` ADR-0014.
- Created feature branch `feat-milestone6-inbound-ingress` from `main` and ran `pnpm harness:preflight`.
- Completed the remaining Milestone 6 Channel Intake slices in one coherent ingress+persistence+wiring change, finishing the milestone.
- Added the webhook ingress endpoints `POST /v1/webhooks/email/{provider}` and `POST /v1/webhooks/whatsapp/{provider}` in `packages/api` (`webhooks.ts`): a raw-JSON body parser preserves `request.rawBody`; the handler resolves the channel by required `channel_id`, verifies the provider signature over the raw body (WhatsApp `X-Hub-Signature-256`, Mailgun `timestamp`+`token`, generic `X-Webhook-Signature-256` HMAC), stores the raw payload, runs the pure adapter, and ingests each normalized message. Endpoints are exempt from bearer/tenant middleware (`WEBHOOK_PATH_PREFIX` skip in `request-context.ts`).
- Added a `RawPayloadStore` port (`raw-payload-store.ts`) with a filesystem default (`file://` refs) and an in-memory test double; raw bytes are stored by reference, never inline in PostgreSQL.
- Added the `InboundIntakeStore` persistence boundary (`inbound-intake-store.ts`) with a lazily-connected PostgreSQL implementation (channel resolution on the owner connection; all writes under `withTenantTransaction`/RLS) and an in-memory implementation mirroring dedup + threading semantics. Added DB query helpers (`channelByIdQuery`, `customerIdentityByValueQuery`, `createCustomerIdentityQuery`, `conversationByExternalThreadQuery`, `createConversationQuery`, `updateConversationLastMessageAtQuery`, `messageByExternalIdQuery`, conflict-safe `createInboundMessageQuery`) plus `Channel`/`CustomerIdentity` schema type exports.
- Added the intake orchestration service (`inbound-intake.ts`): resolve channel + signing secret (`WebhookSecretResolver`, env default), dedup on `external_message_id`, resolve/create customer via `customer_identities`, thread the conversation on `external_thread_id`, insert the message, touch `last_message_at`, then start/signal the workflow. Duplicate events never create duplicate messages or re-signal.
- Wired intake to the ready `ticketLifecycleWorkflow` start/`message_received` boundary via an `InboundWorkflowLauncher` port (`inbound-workflow-launcher.ts`): the Temporal default uses `signalWithStart` with a per-conversation workflow id `ticket-lifecycle:{tenant}:{conversation}` and a deterministic `tkt_{conversation_id}` ticket id; tests use a recording launcher. Added `@support/integrations` and `@temporalio/client` to `@support/api`.
- Added an email polling placeholder (`pollInboundEmailPlaceholder`) for the future scheduled IMAP/pull-API path.
- Added the `InboundWebhookAccepted`/`InboundWebhookMessageResult` response contract to `@support/shared-schemas`, the two webhook paths + schemas to the served OpenAPI document, and injectable `webhooks` deps to `buildApp` (default = lazy DB store + Temporal launcher + filesystem raw store).
- Updated `docs/BACKEND_SPEC.md` (§4.2 and §17.4), `docs/TEST_STRATEGY.md` (Milestone 6 coverage), `docs/PROJECT_HISTORY.md`, `README.md`, and `TODO.md` (checklist + acceptance criteria all checked; Milestone 7 recorded as next).
- Prior Milestone 6 slices (unchanged this session): the normalized inbound message schema (`feat-milestone6-inbound-message-schema`) and the pure email/WhatsApp adapters + signature verifiers (`feat-milestone6-inbound-adapters`).
- Created feature branch `feat-milestone6-inbound-adapters` from `main` and ran `pnpm harness:preflight`.
- Clubbed five related Milestone 6 checklist items into one coherent `packages/integrations/src/channels` slice: email adapter fixture parser, WhatsApp adapter fixture parser, attachment metadata handling, signature verification for a supported provider, and inbound adapter tests.
- Added `@support/shared-schemas` as a workspace dependency of `@support/integrations` and gave the package an `exports` map plus a `src/index.ts` barrel.
- Added `parseInboundEmailMessage` (with a provider-neutral `RawInboundEmailSchema`) mapping a raw email payload into `NormalizedInboundMessage`, including attachment metadata by reference and threading via explicit thread id / `In-Reply-To` / `References`.
- Added `parseInboundWhatsAppMessages` (with `RawInboundWhatsAppSchema`) mapping a batched WhatsApp Cloud webhook into one normalized message per inbound message, converting unix timestamps to ISO, threading on the sender `wa_id`, and mapping media to attachment metadata (`whatsapp-media:{id}` reference, null pending size). Raw provider schemas are non-strict; normalized output is validated with the strict contract.
- Added `verifyHmacSha256Signature`, `verifyWhatsAppCloudSignature` (`X-Hub-Signature-256`), and `verifyMailgunSignature` with timing-safe comparison; malformed/empty/wrong-length/mismatched signatures return false.
- Refined the shared contract while implementing the consumers: attachment `size_bytes` is now nullable (providers like WhatsApp report size only on download), and the non-empty-content rule moved from the body to a message-level refinement (text, html, or at least one attachment). Updated the shared-schema tests accordingly.
- Added adapter and signature unit tests in `packages/integrations`; kept adapters pure (no network/storage side effects) behind an `InboundAdapterContext` a future webhook handler supplies.
- Updated `docs/BACKEND_SPEC.md` (§4.2), `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, `README.md`, and `TODO.md`; left webhook ingress, raw payload/attachment storage, dedup persistence, conversation threading persistence, and workflow wiring as later Milestone 6 slices.
- Created feature branch `feat-milestone6-inbound-message-schema` from `main` and ran `pnpm harness:preflight`.
- Started Milestone 6 Channel Intake by completing its first checklist item: defined the normalized inbound message contract in `packages/shared-schemas/src/index.ts`.
- Added `NormalizedInboundMessageSchema` (`.strict()`) plus `ChannelTypeSchema`, `NormalizedInboundChannelSchema` (`email | whatsapp`), `CustomerIdentityTypeSchema`, `NormalizedInboundCustomerIdentitySchema`, `NormalizedInboundBodySchema` (refined to require `text` or `html`), and `NormalizedInboundAttachmentSchema`, with inferred type exports. `external_message_id`, `raw_payload_ref`, and `idempotency_key` are required so raw payloads are stored by reference and inbound dedup has a stable key.
- Added shared-schema unit tests covering the canonical email fixture, a WhatsApp html-only/no-attachment message, and rejections of unsupported channels, empty bodies, missing `external_message_id`, and unknown top-level keys.
- Updated `docs/BACKEND_SPEC.md` (section 4.2 implementation note), `docs/TEST_STRATEGY.md` (Milestone 6 coverage), `docs/PROJECT_HISTORY.md`, `README.md`, and `TODO.md` for the new contract; kept provider adapters, webhook/polling ingress, signature verification, storage, dedup persistence, and conversation threading as later Milestone 6 slices behind adapter boundaries.
- Created feature branch `feat-milestone5-outbound-send` from `main` and ran `pnpm harness:preflight`.
- Completed the final Milestone 5 checklist item by adding the `sendOutboundMessage` activity placeholder contract (`SendOutboundMessageActivityInput`/`SendOutboundMessageActivityResult`) plus the `responded` and `sending_response` workflow phases and an `outbound_message_id` result field.
- Made `ticketLifecycleWorkflow` approval routing outcome-aware: it records `approval.completed` audit for every outcome, then approved/edited send an outbound response through `sendOutboundMessage` (with a deterministic `outbound:{tenant}:{ticket}:{approval_id}` idempotency key), emit `support.message.sent.v1`, and record `message.sent` audit before the `responded` phase; rejected ends in `completed` without sending; escalated records `ticket.manual_escalated` audit and ends in `manual_escalated`.
- Added the `support.message.sent.v1` emit helper (`buildMessageSentEvent`/`emitMessageSentEvent`) and `MessageSentEventPayload` type, and wired the `emitDomainEvent` activity adapter to emit message-sent events; `sendOutboundMessage` runs with the explicit side-effect retry policy.
- Updated existing workflow tests for the approved/AI-failure paths (now send) and added deterministic edited/rejected/escalated approval-outcome routing tests plus a message-sent activity-adapter assertion; verified all 7 live Temporal workflow tests pass against local Compose Temporal.
- Kept real LangGraph calls, DB mutation/persistence, approval persistence, the real channel send behind `sendOutboundMessage`, API workflow start/signal wiring, and next-response/resolution SLA timers behind activity boundaries.
- Created feature branch `feat-milestone5-ai-routing` from `main` and ran `pnpm harness:preflight`.
- Added the `runAiGraph` activity placeholder contract to the ticket lifecycle workflow surface with structured success and failure result shapes that mirror the planned AI runtime output.
- Updated `ticketLifecycleWorkflow` to run the AI graph activity after triage for the human-approval path, include AI routing state in workflow query/results, create approval metadata from successful AI output, and convert structured AI runtime failures into an audited human approval path.
- Extended opt-in live Temporal workflow coverage for AI success-to-approval and AI failure-to-human routing; existing approval wait/resume, inbound signal dedupe, first-response SLA timer breach, and replay coverage remains.
- Kept real LangGraph calls, DB mutation/persistence, approval persistence, outbound sends, API workflow start/signal wiring, next-response/resolution SLA timers, and real audit persistence behind activity boundaries.
- Created feature branch `feat-milestone5-sla-timers` from `main` and ran `pnpm harness:preflight`.
- Added ticket lifecycle SLA timer contracts: ticket snapshots now include SLA due timestamps, `createOrUpdateTicket` returns recorded SLA timer durations, and workflow query/results expose first-response due and breach status.
- Added deterministic first-response SLA breach behavior to `ticketLifecycleWorkflow`: while waiting for approval/manual escalation/close, the workflow races the first-response SLA timer and emits `support.ticket.sla_breached.v1` plus `ticket.sla_breached` audit through activities if the timer fires.
- Added worker-side `buildTicketSlaBreachedEvent`/`emitTicketSlaBreachedEvent` helpers and wired the ticket lifecycle `emitDomainEvent` activity adapter to the SLA breach helper.
- Added explicit ticket lifecycle activity retry-policy constants and call-site side-effect retry options for workflow-owned event/audit activities.
- Extended offline worker coverage for SLA breach event helpers, activity adapter behavior, and retry-policy constants.
- Extended opt-in live Temporal workflow coverage for first-response SLA breach and workflow history replay with `Worker.runReplayHistory`; existing approval wait/resume and inbound signal dedupe coverage remains.
- Kept API CRUD endpoints disconnected from workflow starts/signals and kept real DB, AI runtime, approval persistence, audit persistence, outbound sends, and next-response/resolution SLA timers behind activity boundaries.
- Created feature branch `feat-milestone5-temporal-foundation` from `main` and ran `pnpm harness:preflight`.
- Added Temporal TypeScript SDK dependencies to `@support/workers`, plus `@temporalio/testing` for opt-in workflow execution tests.
- Approved the new pnpm build scripts for `@swc/core` and `protobufjs` in `pnpm-workspace.yaml`.
- Added `packages/workers/src/temporal-worker.ts` for Temporal worker config/runtime scaffolding with local defaults for `localhost:7233`, namespace `default`, and task queue `support-ticket-lifecycle`.
- Added `packages/workers/src/workflows/ticket-lifecycle-types.ts` and `packages/workers/src/workflows/ticket-lifecycle-workflow.ts` for the first deterministic ticket lifecycle workflow shell.
- The workflow shell defines `message_received`, `customer_replied`, `approval_completed`, `manual_escalation_requested`, and `close_requested` signals plus the `ticket_lifecycle_state` query.
- The workflow creates/loads ticket state through an activity, emits ticket-created and ticket-triaged domain events through an activity, runs triage through an activity, creates approval through an activity, waits for approval/manual-escalation/close signals, records audit through an activity, and deduplicates repeated inbound message/customer-reply signals by `message_id`.
- Added `packages/workers/src/activities/ticket-lifecycle-activities.ts`; its `emitDomainEvent` activity adapter reuses the Milestone 4 `emitTicketCreatedEvent` and `emitTicketStateTransitionEvent` helpers through an injected `DomainEventPublisher`.
- Added offline unit tests for the activity adapter and Temporal worker config.
- Added `pnpm --filter @support/workers test:workflow`, an opt-in live Temporal workflow test that runs against local Compose Temporal and covers approval wait/resume plus duplicate inbound message signal handling.
- Kept API CRUD endpoints disconnected from workflow starts/signals and direct event side effects.
- Created feature branch `feat-milestone4-domain-events` from updated `main` after the prior consumer branch was merged, then ran `pnpm harness:preflight`.
- Completed Milestone 4 event bus foundation by adding event-name-specific domain payload validation in `packages/shared-schemas/src/index.ts`, including message received, ticket created, ticket transition, ticket priority/assignment/SLA, AI run, tool call, approval, message sent, and QA review payload schemas.
- Added `SupportEventErrorRecordSchema` plus worker-side `packages/workers/src/event-errors.ts` for structured error-record publishing under `support.events.errors.>`.
- Extended `packages/workers/src/event-bus.ts` to ensure both `SUPPORT_EVENTS` and `SUPPORT_EVENT_ERRORS` streams and expose both domain event and error publishers.
- Extended `packages/workers/src/event-consumer.ts` so invalid envelopes publish error records before terming, handler failures publish retryable error records before nacking, and handler failures at max delivery publish non-retryable error records before terming.
- Added `packages/workers/src/domain-events.ts` with schema-validated emit helpers for message received, ticket created, and ticket state transition events. These helpers are intended for future Temporal workflow activities; CRUD skeleton endpoints remain disconnected from event side effects.
- Added shared-schema tests, worker emit helper tests, error publisher tests, expanded consumer error-strategy tests, and live NATS integration coverage for structured event error publish/consume behavior.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for Milestone 4 completion.
- Created feature branch `feat-milestone4-event-consumers` from `main` and ran `pnpm harness:preflight` before editing.
- Added `packages/workers/src/event-consumer.ts` with durable pull-consumer config/setup helpers, one-message `processNext()` handling, payload/schema validation, subject/envelope mismatch rejection, ack/nak/term behavior, and handler context propagation.
- Added `DomainEventConsumerIdempotencyStore` plus `InMemoryDomainEventConsumerIdempotencyStore` for deterministic idempotency tests. Completed duplicate events are acked without handler reruns, in-progress duplicates are nacked, failed handler attempts are marked failed and can retry, and invalid envelopes are termed.
- Added `packages/workers/src/event-consumer.test.ts` for durable consumer create/update helpers, idempotent processing paths, invalid payload handling, handler failure retry behavior, and `processNext()`.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the worker consumer base and idempotency handling.
- Kept CRUD skeleton endpoints disconnected from event publication; workflow/service-owned side effects remain future work.
- Created feature branch `feat-milestone4-nats-stream` from `main` and ran `pnpm harness:preflight` before editing.
- Replaced the deprecated legacy `nats` package attempt with the current official NATS.js v3 modules: `@nats-io/transport-node` and `@nats-io/jetstream`.
- Added `packages/workers/src/event-bus.ts` with `NATS_URL` config loading, NATS connection wiring, `SUPPORT_EVENTS` stream setup, and a runtime that exposes `NatsJetStreamDomainEventPublisher`.
- Added the explicit local NATS config at `infra/nats/server.conf`; Compose now mounts it, enables JetStream with a persisted `nats-data` volume, and health-checks JetStream readiness.
- Added worker event bus unit tests for config parsing, stream create config, and idempotent stream create/update setup.
- Added `packages/workers/src/event-bus.integration.test.ts`, which connects to local NATS, ensures the `SUPPORT_EVENTS` stream, publishes and consumes a tenant-scoped event, and verifies duplicate detection through the `event_id` JetStream message ID.
- Added `pnpm --filter @support/workers test:integration` and expanded root `pnpm test:integration` to run DB/RLS, API PostgreSQL-backed integration tests, and worker NATS integration tests.
- Updated CI to start a local NATS container with JetStream before the integration step and pass `NATS_URL`.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/DEVELOPMENT_RULES.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the NATS stream wiring and live integration coverage.
- Left CRUD skeleton endpoints disconnected from event publication; workflow/service-owned side effects remain future work.
- Added session harness guardrails to `AGENTS.md`, `docs/ENGINEERING_HARNESS.md`, and `docs/DEVELOPMENT_RULES.md` so branch creation, milestone checklist updates, and pre-push checks are in the active reading path.
- Added `pnpm harness:preflight` and `pnpm harness:handoff` backed by `scripts/session-harness-check.mjs`; the checks fail on direct `main` work unless `ALLOW_MAIN_BRANCH=true` is explicitly set, and handoff also verifies the current milestone checklist has checked items.
- Updated `README.md` and command docs for the new harness commands.
- Corrected the Milestone 4 checklist to mark the completed event envelope, subject convention, publisher scaffold, and event schema test work.
- Started Milestone 4 event bus foundation.
- Added shared v1 domain event names and `DomainEventEnvelopeSchema` in `packages/shared-schemas`.
- Added `buildDomainEventSubject` with the tenant-aware NATS subject convention `support.events.tenant.{tenant_id}.{domain}.{fact}.v1`.
- Added subject-safe tenant token validation for event publishing.
- Added `packages/workers/src/event-publisher.ts` with `NatsJetStreamDomainEventPublisher`, which validates envelopes, JSON-encodes events, publishes to the derived subject, and uses `event_id` as the JetStream message ID for duplicate detection.
- Added shared schema and worker publisher contract tests.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the event bus foundation.
- Left CRUD skeleton endpoints disconnected from event publication; workflow/service-owned side effects remain future work.
- Added shared audit event response schemas plus list/resource envelopes for audit contracts.
- Added tenant-scoped audit event list/read repository helpers with `actor_type`, `entity_type`, `entity_id`, `action`, and `correlation_id` filters.
- Added repository SQL-generation tests and live repository integration coverage for audit event read/list tenant isolation.
- Added `GET /v1/audit-events`, `GET /v1/audit-events/{audit_event_id}`, and `GET /v1/tickets/{ticket_id}/audit-events`.
- Added audit event service adapters that use `withTenantTransaction`; ticket audit lists return structured not-found errors for missing or cross-tenant parent tickets.
- Expanded `packages/api/src/rbac.ts` with `audit_events:read` for platform admin, ops admin, support agent, QA reviewer, and client viewer roles.
- Expanded generated OpenAPI paths and component schemas for audit event read/list contracts.
- Expanded shared-schema tests, repository tests, API contract tests, and live PostgreSQL-backed API integration tests for audit event tenant isolation.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the audit API expansion.
- Created feature branch `feat-api-approval-read-list` from `main` for the current Milestone 3 continuation after the sandbox could not write `.git` refs without elevated Git access and nested `feat/...` refs remained unavailable.
- Added shared approval response schemas plus list/resource envelopes for approval contracts.
- Added tenant-scoped approval list/read repository helpers with `status`, `ticket_id`, and `approval_type` filters.
- Added repository SQL-generation tests and live repository integration coverage for approval tenant isolation.
- Added `GET /v1/approvals` and `GET /v1/approvals/{approval_id}`.
- Added approval service adapters that use `withTenantTransaction`.
- Expanded `packages/api/src/rbac.ts` with `approvals:read` for platform admin, ops admin, support agent, QA reviewer, and client viewer roles.
- Expanded generated OpenAPI paths and component schemas for approval read-list contracts.
- Expanded shared-schema tests, repository tests, API contract tests, and live PostgreSQL-backed API integration tests for approval tenant isolation.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the current API expansion.
- Created feature branch `feat-api-kb-document-read-list` from `main` for the current Milestone 3 continuation because the sandbox could not create nested `feat/...` refs without elevated Git access.
- Added shared KB document metadata response schemas plus list/resource envelopes for KB document contracts.
- Added tenant-scoped KB document list/read repository helpers with `source_type`, `document_type`, and `status` filters.
- Added repository SQL-generation tests and live repository integration coverage for KB document tenant isolation.
- Added `GET /v1/kb/documents` and `GET /v1/kb/documents/{kb_document_id}`.
- Added KB document service adapters that use `withTenantTransaction`.
- Expanded `packages/api/src/rbac.ts` with `kb_documents:read` for platform admin, ops admin, support agent, QA reviewer, and client viewer roles.
- Expanded generated OpenAPI paths and component schemas for KB document metadata read-list contracts.
- Expanded shared-schema tests, repository tests, API contract tests, and live PostgreSQL-backed API integration tests for KB document tenant isolation.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the current API expansion.
- Created feature branch `feat/api-policy-read-list` from `main` for the current Milestone 3 continuation.
- Added shared policy response schemas plus list/resource envelopes for tenant policy contracts.
- Added tenant-scoped policy list/read repository helpers with `domain` and `status` filters.
- Added repository SQL-generation tests and live repository integration coverage for policy tenant isolation.
- Added `GET /v1/policies` and `GET /v1/policies/{policy_id}`.
- Added policy service adapters that use `withTenantTransaction`.
- Expanded `packages/api/src/rbac.ts` with `policies:read` for platform admin, ops admin, support agent, QA reviewer, and client viewer roles.
- Expanded generated OpenAPI paths and component schemas for policy read-list contracts.
- Expanded shared-schema tests, repository tests, API contract tests, and live PostgreSQL-backed API integration tests for policy tenant isolation.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the current API expansion.
- Added shared conversation and message response schemas plus list/resource envelopes.
- Added tenant-scoped conversation list/read repository helpers and message list/read helpers scoped by tenant and parent conversation.
- Added repository SQL-generation tests and live repository integration coverage for conversation/message tenant isolation.
- Added `GET /v1/conversations`, `GET /v1/conversations/{conversation_id}`, `GET /v1/conversations/{conversation_id}/messages`, and `GET /v1/conversations/{conversation_id}/messages/{message_id}`.
- Added conversation/message service adapters that use `withTenantTransaction`; nested message lists return structured not-found errors for missing or cross-tenant parent conversations.
- Expanded `packages/api/src/rbac.ts` with `conversations:read` and `messages:read` for platform admin, ops admin, support agent, QA reviewer, and client viewer roles.
- Expanded generated OpenAPI paths and component schemas for conversation/message read-list contracts.
- Expanded shared-schema tests, repository tests, API contract tests, and live PostgreSQL-backed API integration tests for conversation/message tenant isolation.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the current API expansion.
- Created feature branch `feat/api-crud-contracts` from `main` for the current Milestone 3 continuation.
- Added shared list response envelopes and create/update request schemas for tenants, customers, and tickets.
- Added repository helpers for tenant list/create/update plus tenant-scoped customer and ticket list/create/update operations; customer/ticket helpers keep explicit tenant scopes for RLS-backed data access.
- Adjusted request context handling so tenant headers are optional globally but still required by tenant-scoped routes through `requireTenantRequestContext`.
- Added `GET /v1/tenants`, `POST /v1/tenants`, and `PATCH /v1/tenants/{tenant_id}`. Tenant list/create is platform-admin only; tenant patch is platform-admin global or ops-admin current-tenant only.
- Added tenant-scoped `GET /v1/customers`, `POST /v1/customers`, and `PATCH /v1/customers/{customer_id}`.
- Added tenant-scoped `GET /v1/tickets`, `POST /v1/tickets`, and `PATCH /v1/tickets/{ticket_id}` for triage, assignment, policy/SLA references, and due timestamps only. Ticket lifecycle transitions remain future workflow-backed endpoints.
- Expanded `packages/api/src/rbac.ts` with separate list/create/update permissions for tenant, customer, and ticket endpoint families.
- Expanded generated OpenAPI paths and component schemas for the new contracts.
- Expanded shared-schema tests, repository SQL generation tests, API contract tests, and live PostgreSQL-backed API integration tests for tenant/customer/ticket list-create-read-update behavior and tenant isolation.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, and `TODO.md` for the current API expansion.
- Created feature branch `feat/api-rbac-integration-tests` from `main` for the current Milestone 3 continuation.
- Added `packages/api/src/rbac.ts` with a current role-to-permission matrix for `openapi:read`, `tenants:read`, `customers:read`, and `tickets:read`.
- Added authenticated-context access for non-tenant global endpoints and enforced RBAC on `GET /openapi.json`, `GET /v1/tenants/{tenant_id}`, `GET /v1/customers/{customer_id}`, and `GET /v1/tickets/{ticket_id}` before service/data access.
- Updated API contract tests to require `ops_admin` for tenant reads and to reject `support_agent` tenant reads with structured `FORBIDDEN`.
- Added `packages/api/src/app.integration.test.ts`, which applies migrations, seeds tenant A/B PostgreSQL fixtures, exercises tenant/customer/ticket read endpoints over HTTP, verifies tenant isolation for customer/ticket IDs, verifies tenant-read RBAC denial, and cleans up fixtures.
- Added `pnpm --filter @support/api test:integration` and expanded root `pnpm test:integration` to run DB/RLS integration tests plus API PostgreSQL-backed read integration tests.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/DEVELOPMENT_RULES.md`, and `docs/PROJECT_HISTORY.md` for the current RBAC and API integration test behavior.
- Created feature branch `feat/api-skeleton`.
- Added shared API schemas for structured errors plus tenant, customer, and ticket resource responses.
- Added API request context middleware for request ID, correlation ID, placeholder bearer auth, placeholder actor headers, role parsing, and tenant context headers for `/v1/*`.
- Added structured API error handling and `TENANT_CONTEXT_REQUIRED`.
- Added `GET /openapi.json` from a generated OpenAPI document builder.
- Preserved public `GET /health` and `GET /ready`.
- Added read-only `GET /v1/tenants/{tenant_id}`, `GET /v1/customers/{customer_id}`, and `GET /v1/tickets/{ticket_id}` skeleton handlers with shared-schema response validation.
- Added DB-backed API service adapters that lazily open PostgreSQL and run tenant-scoped reads through `withTenantTransaction`.
- Added `tenantByIdQuery` and `withTenantTransaction`; the helper sets local role `support_app`, then transaction-local `app.current_tenant_id`, then exposes a transaction-bound Drizzle database.
- Fixed `withTenantTransaction` to carry the parent postgres-js parser/serializer options into the transaction-scoped client before constructing Drizzle.
- Updated API, shared-schema, DB helper, and RLS integration tests for the new contracts and transaction helper.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, and `docs/PROJECT_HISTORY.md` for the API skeleton and helper behavior.
- Created feature branch `feat/db-rls-policies` from updated `main` after the repository integration branch was merged.
- Added `packages/db/migrations/0002_tenant_rls.sql`, which defines `support_current_tenant_id()`, creates/grants the non-owner `support_app` role for application access, enables RLS on tenant-scoped tables, rejects missing tenant context, and keeps global tool definitions visible.
- Added `packages/db/src/rls.ts` with a transaction-local tenant-context helper for `app.current_tenant_id`.
- Added `packages/db/src/rls.integration.test.ts`, which proves raw SQL under `support_app` rejects missing tenant context, hides cross-tenant customers, tickets, KB chunks, integrations, audit events, and tenant rows, preserves global tool-definition visibility, and blocks cross-tenant writes.
- Added a PostgreSQL advisory lock to the migration runner so parallel live integration suites do not race migration application.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/DECISIONS.md`, and `docs/PROJECT_HISTORY.md` for the RLS contract and verification.
- Created feature branch `feat/db-repository-integration-tests`.
- Replaced the root integration-test placeholder with `pnpm test:integration`.
- Added `packages/db/src/repositories.integration.test.ts`, which applies pending migrations, seeds two synthetic tenants, executes repository helpers against PostgreSQL, verifies tenant isolation for customers, tickets, KB chunks, integrations, tool definitions, and audit events, then cleans up fixture rows.
- Added a CI PostgreSQL service and `pnpm test:integration` workflow step.
- Recorded ADR-0013: PostgreSQL row-level security should be added before tenant-scoped API endpoints are exposed.
- Updated `README.md`, `docs/BACKEND_SPEC.md`, `docs/DEVELOPMENT_RULES.md`, `docs/TEST_STRATEGY.md`, `docs/DECISIONS.md`, and `docs/PROJECT_HISTORY.md` for live repository tests and the RLS decision.
- Selected Drizzle for the TypeScript PostgreSQL schema/query layer.
- Added `@support/db` Drizzle schema for the Milestone 2 core tables.
- Added reviewed SQL migration `packages/db/migrations/0001_initial_core.sql`.
- Added migration runner and root command `pnpm db:migrate`.
- Added tenant-scoped repository query helpers for customers, tickets, KB chunks, integrations, audit events, and tool definitions.
- Added migration/schema/repository tests.
- Applied the initial migration to the local Compose PostgreSQL database and reran it to verify idempotency.
- Updated `docs/BACKEND_SPEC.md`, `docs/DECISIONS.md`, `docs/DEVELOPMENT_RULES.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, `AGENTS.md`, and `README.md`.
- Accepted a branching workflow: keep `main` stable, then use short-lived feature branches for separate concerns after the baseline checkpoint is pushed.
- Created the initial documentation harness plan.
- Added backend scaffold files for TypeScript packages, Python AI runtime placeholder, Docker Compose infra, and CI.
- Moved scaffold into cloned GitHub repo at `/home/anish/CODE01/STARTUPS/E2E-automated-cutomer-service`.
- Installed dependencies and generated `pnpm-lock.yaml`.
- Verified scaffold checks locally.
- Chose backend-only v1 scope.
- Chose TypeScript API/workers plus Python AI runtime.
- Chose Temporal plus LangGraph.
- Chose deep v1 docs over exhaustive or lean docs.

### Verification Status

- Milestone 9 (`feat-milestone9-ai-runtime`): `pnpm harness:preflight` passed on the branch.
- `python3 -m compileall ai` succeeds (all AI runtime + eval modules compile on Python 3.14).
- `pnpm test:py` (`python3 -m unittest discover -s ai -p '*_test.py'`) passes: 49 tests across `runtime/schemas_test.py`, `runtime/graph_test.py`, `runtime/nodes_test.py`, `runtime/runner_test.py`, `evals/runner_test.py`, plus the pre-existing `runtime/harness_test.py`.
- Offline eval runner (`PYTHONPATH=ai python3 -m evals.runner`) reports PASS on the 24-case golden dataset: topic_accuracy, routing_accuracy, escalation_correctness, required_tool_recall, and prompt_injection_pass_rate all 1.000; zero unsafe auto-send, zero legal/fraud auto-send, zero cross-tenant leakage, zero unsafe output.
- `pnpm lint` passes (all packages `tsc --noEmit` + Python `compileall`).
- `pnpm test` passes end to end: TypeScript packages unchanged (api 102 passed / 25 skipped, plus shared-schemas/integrations/workers/db) and the Python suite (49). No TypeScript source changed this milestone.
- Not run: `pnpm test:integration` and opt-in live Temporal/NATS tests — Milestone 9 adds a self-contained Python package with no live PostgreSQL/NATS/Temporal behavior change. Wiring the runtime behind the `RunAiGraphActivity` Temporal placeholder and calling the live TS tool registry / `POST /v1/kb/search` are captured Milestone 9 follow-ups.
- Milestone 8 (`feat-milestone8-tool-registry`): `pnpm -r typecheck` passes across all packages.
- `pnpm -r test` passes: shared-schemas (34), integrations (40), workers (37, 9 skipped), db (47, 19 skipped), api (102, 25 skipped). New always-run file: `packages/api/src/tool-registry.test.ts` (22 tests), plus new tool-contract and shared-schemas tool cases.
- `pnpm exec prettier --check` passes for all new/changed files (tool-registry, tools/, shared-schemas, tool-contract, db repositories/schema, TODO.md).
- Not rerun this slice: `pnpm test:integration` and the opt-in live Temporal/NATS tests — Milestone 8 adds pure library code (executor + tools + schemas + repository query builders) with no live PostgreSQL/NATS/Temporal behavior change. The `createDatabaseToolRegistryStore` DB path is unit-covered via the in-memory store that mirrors its semantics; a live-DB integration test is a captured follow-up.
- `pnpm harness:preflight` passed on branch `feat-milestone6-inbound-ingress`.
- `pnpm install` linked the new `@support/integrations` and `@temporalio/client` dependencies into `@support/api`.
- `pnpm -r typecheck` passes across all packages after the ingress/persistence/wiring additions.
- `pnpm lint` passes across all packages (per-package `tsc --noEmit`).
- `pnpm format` + `pnpm format:check` pass (all matched files use Prettier code style).
- `pnpm -r test` passes: shared-schemas (24), integrations (24), workers (37, 9 skipped), db (41, 17 skipped), api (56, 25 skipped). New always-run tests: `packages/api/src/webhooks.test.ts`, `packages/api/src/inbound-intake.test.ts`, and the new intake query-builder cases in `packages/db/src/repositories.test.ts`.
- Live verification with local Compose infra (`pnpm infra:up`, PostgreSQL healthy) and `DATABASE_URL=postgres://support:support@localhost:5432/support`: `pnpm --filter @support/api test:integration` passes 25 tests including the new `inbound-intake-store.integration.test.ts` (dedup, threading, and persistence under RLS); `pnpm --filter @support/db test:integration` passes 17 tests (no regressions).
- The opt-in live Temporal workflow test (`pnpm --filter @support/workers test:workflow`) was not rerun: this slice adds the API-side start/signal launcher (unit-tested with a recording launcher) and does not change workflow/activity code.
- `pnpm harness:preflight` passed on branch `feat-milestone6-inbound-adapters`.
- `pnpm install` linked the new `@support/shared-schemas` workspace dependency into `@support/integrations`.
- `pnpm --filter @support/integrations test` passes with 24 tests (email adapter, WhatsApp adapter, signature verification, existing tool contract).
- `pnpm --filter @support/shared-schemas test` passes with 24 tests after the size-nullable and message-level content-rule updates.
- `pnpm typecheck` passes across all packages after the new channel adapters and schema refinements.
- `pnpm format` + `pnpm format:check` pass (all matched files use Prettier code style).
- `pnpm lint` passes across all packages plus the Python scaffold compile step.
- `pnpm test` passes: shared-schemas (24), integrations (24), workers (37, 9 skipped), db (36, 17 skipped), api (41, 22 skipped), plus Python scaffold.
- `pnpm build` passes across all packages; `dist/` output is gitignored.
- `pnpm test:integration` and `pnpm --filter @support/workers test:workflow` were not rerun: this slice adds pure adapter/signature functions and shared schema changes with no live PostgreSQL, NATS, or Temporal behavior change.
- `pnpm harness:handoff` passes on branch `feat-milestone6-inbound-adapters`.
- `pnpm harness:preflight` passed on branch `feat-milestone6-inbound-message-schema`.
- `pnpm --filter @support/shared-schemas test` passes with 23 tests after adding the normalized inbound message schema coverage.
- `pnpm format:check` passes (all matched files use Prettier code style).
- `pnpm typecheck` passes across all packages after the new schema and type exports.
- `pnpm lint` passes across all packages plus the Python scaffold compile step.
- `pnpm test` passes (shared-schemas, db, workers, api, and Python scaffold), with the opt-in live Temporal workflow test still skipped by default.
- `pnpm build` passes across all packages.
- `pnpm test:integration` and `pnpm --filter @support/workers test:workflow` were not rerun because this slice only adds shared Zod schemas/types with no live PostgreSQL, NATS, or Temporal behavior changes.
- `pnpm harness:handoff` passes on branch `feat-milestone6-inbound-message-schema`.
- `pnpm harness:preflight` passed on branch `feat-milestone5-outbound-send`.
- `pnpm --filter @support/shared-schemas typecheck` and `pnpm --filter @support/shared-schemas test` (17 tests) pass after adding the `MessageSentEventPayload` type export.
- `pnpm --filter @support/workers typecheck` passes after the outbound send activity placeholder and approval-outcome routing updates.
- `pnpm --filter @support/workers test` passes with 37 tests and 9 skipped opt-in/live tests after the outbound send slice (the 3 new approval-outcome routing tests are opt-in live Temporal tests).
- `docker compose -f infra/docker-compose.yml up -d postgres temporal` reports the local Compose Temporal stack running and PostgreSQL healthy; the `default` namespace was confirmed ready before live workflow verification.
- `RUN_TEMPORAL_WORKFLOW_TESTS=true pnpm --filter @support/workers test:workflow` passes all 7 live Temporal workflow tests against local Compose Temporal, covering approval wait/resume, duplicate inbound message signal handling, first-response SLA timer breach, AI success-to-approval routing, AI failure-to-human routing, approved-response send, edited-response send, rejected no-send, escalated manual handling, and workflow history replay. The heaviest happy-path+replay test received an explicit 30s timeout because the added outbound activity round-trips pushed it past the 5s default.
- Changed files pass `./node_modules/.bin/prettier --check`. `pnpm format:check` still reports one pre-existing warning for the gitignored `.claude/settings.local.json`, which is unrelated to this slice and untracked.
- `pnpm lint` passes after the outbound send workflow slice.
- `pnpm typecheck` passes after the outbound send workflow slice.
- `pnpm test` passes after the outbound send workflow slice, including Python scaffold tests; the live Temporal workflow test remains opt-in and was run separately above.
- `pnpm build` passes after the outbound send workflow slice.
- `pnpm test:integration` was not rerun because this slice does not change live PostgreSQL or NATS integration behavior; the live Temporal behavior is covered by `pnpm --filter @support/workers test:workflow`.
- `pnpm harness:handoff` passes on branch `feat-milestone5-outbound-send`.
- `pnpm harness:preflight` passed on branch `feat-milestone5-ai-routing`.
- `pnpm --filter @support/workers typecheck` passes after the AI graph activity placeholder and workflow routing updates.
- `pnpm --filter @support/workers test` passes with 37 tests and 6 skipped opt-in/live tests after the AI graph placeholder contract update.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy before live Temporal workflow verification.
- `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow` initially failed inside the managed sandbox with localhost `EPERM`, then passed with approved localhost access against local Compose Temporal. The passing run covered approval wait/resume, duplicate inbound message signal handling, first-response SLA timer breach, AI success-to-approval routing, AI failure-to-human routing, and workflow history replay.
- `pnpm format` applied formatting to the workflow implementation after the AI graph placeholder updates.
- `pnpm format:check` passes after the AI graph placeholder workflow slice.
- `pnpm lint` passes after the AI graph placeholder workflow slice.
- `pnpm typecheck` passes after the AI graph placeholder workflow slice.
- `pnpm test` passes after the AI graph placeholder workflow slice, including Python scaffold tests; the live Temporal workflow test remains opt-in and was run separately above.
- `pnpm build` passes after the AI graph placeholder workflow slice.
- `pnpm test:integration` was not rerun because this slice does not change live PostgreSQL or NATS integration behavior; the live Temporal behavior is covered by `pnpm --filter @support/workers test:workflow`.
- `pnpm harness:handoff` passes on branch `feat-milestone5-ai-routing`.
- `pnpm harness:preflight` initially failed inside the managed sandbox with a pnpm store SQLite access error, then passed with approved pnpm store access on branch `feat-milestone5-sla-timers`.
- `pnpm --filter @support/workers test` passes with 37 tests and 5 skipped opt-in/live tests after first-response SLA timer, SLA breach event helper, activity adapter, and retry-policy coverage.
- `pnpm --filter @support/workers typecheck` passes after the first-response SLA timer workflow contract updates.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy before live Temporal workflow verification.
- `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow` initially failed inside the managed sandbox with localhost `EPERM`, then passed with approved localhost access against local Compose Temporal. The passing run covered approval wait/resume, duplicate inbound message signal handling, first-response SLA timer breach, and workflow history replay.
- `pnpm format` applied formatting to the workflow test after the first-response SLA timer changes.
- `pnpm format:check` passes after the first-response SLA timer workflow slice.
- `pnpm lint` passes after the first-response SLA timer workflow slice.
- `pnpm typecheck` passes after the first-response SLA timer workflow slice.
- `pnpm test` passes after the first-response SLA timer workflow slice, including Python scaffold tests; the live Temporal workflow test remains opt-in and was run separately above.
- `pnpm build` passes after the first-response SLA timer workflow slice.
- `pnpm test:integration` was not rerun because this slice does not change live PostgreSQL or NATS integration behavior; the live Temporal behavior is covered by `pnpm --filter @support/workers test:workflow`.
- `pnpm harness:handoff` passes on branch `feat-milestone5-sla-timers`.
- `pnpm harness:preflight` passed on branch `feat-milestone5-temporal-foundation`.
- `pnpm --filter @support/workers test` passes with 35 tests and 4 skipped opt-in/live tests after the Temporal worker scaffold, activity adapter, and default-off workflow test coverage.
- `pnpm --filter @support/workers typecheck` passes after the Temporal workflow scaffold.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy before live Temporal workflow verification.
- `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow` initially failed inside the managed sandbox with localhost `EPERM`, then passed with approved localhost access against local Compose Temporal. The passing run covered approval wait/resume and duplicate inbound message signal handling.
- `pnpm format` applied formatting to the new Temporal workflow, activity, test, package metadata, and docs files.
- `pnpm format:check` passes after the Temporal workflow foundation slice.
- `pnpm lint` passes after the Temporal workflow foundation slice.
- `pnpm typecheck` passes after the Temporal workflow foundation slice.
- `pnpm test` passes after the Temporal workflow foundation slice, including Python scaffold tests; the live Temporal workflow test remains opt-in and skipped by default.
- `pnpm build` passes after the Temporal workflow foundation slice.
- `pnpm test:integration` was not rerun because this slice does not change live PostgreSQL or NATS integration behavior; the new live Temporal verification is covered by `pnpm --filter @support/workers test:workflow`.
- `pnpm harness:preflight` passed on branch `feat-milestone4-domain-events`.
- `pnpm --filter @support/shared-schemas test` passes with 17 tests after event payload/error schema coverage.
- `pnpm --filter @support/shared-schemas typecheck` passes after event payload/error schema coverage.
- `pnpm --filter @support/workers test` passes with 31 tests and 2 skipped live integration tests after event emit helper, error publisher, and consumer dead-letter/error strategy coverage.
- `pnpm --filter @support/workers typecheck` passes after event emit helper, error publisher, and consumer dead-letter/error strategy coverage.
- `pnpm format` applied formatting to the changed event contract and worker files.
- `pnpm format:check` passes after Milestone 4 event payload/error stream completion.
- `pnpm lint` passes after Milestone 4 event payload/error stream completion.
- `pnpm typecheck` passes after Milestone 4 event payload/error stream completion.
- `pnpm test` passes after Milestone 4 event payload/error stream completion, including Python scaffold tests.
- `pnpm build` passes after Milestone 4 event payload/error stream completion.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy before live integration verification.
- `DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration` initially failed inside the managed sandbox with localhost PostgreSQL `EPERM`, then passed with approved localhost access. The passing run covered 17 DB/RLS integration tests, 22 PostgreSQL-backed API integration tests, and 2 worker NATS integration tests, including structured event error publish/consume behavior.
- `pnpm harness:handoff` initially failed after `Current milestone` was advanced to Milestone 5 before any Milestone 5 checklist work existed, then passed after keeping Milestone 4 as the active completed milestone and recording Milestone 5 as the next task.
- `pnpm harness:preflight` initially failed inside the managed sandbox with a pnpm store SQLite access error and registry fetch restriction, then passed with approved pnpm store/network access on branch `feat-milestone4-event-consumers`.
- `pnpm --filter @support/workers test` passes with 18 unit tests and 1 skipped live integration test after the event consumer base/idempotency coverage.
- `pnpm --filter @support/workers typecheck` passes after the event consumer base/idempotency coverage.
- `pnpm format` applied formatting to `packages/workers/src/event-consumer.ts` and `packages/workers/src/event-consumer.test.ts`.
- `pnpm format:check` passes after the event consumer base/idempotency coverage and docs updates.
- `pnpm lint` passes after the event consumer base/idempotency coverage and docs updates.
- `pnpm typecheck` passes after the event consumer base/idempotency coverage and docs updates.
- `pnpm test` passes after the event consumer base/idempotency coverage and docs updates.
- `pnpm build` passes after the event consumer base/idempotency coverage and docs updates.
- `pnpm test:integration` was not rerun because this change adds deterministic consumer base/idempotency unit coverage only and does not change live NATS stream configuration or publish/consume behavior.
- `pnpm harness:preflight` passes on branch `feat-milestone4-nats-stream`.
- `pnpm --filter @support/workers typecheck` passes after event bus connection/stream wiring.
- `pnpm --filter @support/workers test` passes with 8 unit tests and 1 skipped live integration test after event bus unit coverage.
- `pnpm --filter @support/workers test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed with approved localhost access against local NATS.
- `DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration` initially failed inside the managed sandbox with localhost PostgreSQL `EPERM`, then passed with approved localhost access. The passing run covered 17 DB/RLS integration tests, 22 PostgreSQL-backed API integration tests, and 1 worker NATS publish/consume integration test.
- `pnpm format` applied formatting to `packages/workers/src/event-bus.ts`.
- `pnpm format:check` passes after the NATS stream wiring and docs updates.
- `pnpm lint` passes after the NATS stream wiring and docs updates.
- `pnpm typecheck` passes after the NATS stream wiring and docs updates.
- `pnpm test` passes after the NATS stream wiring and docs updates.
- `pnpm build` passes after the NATS stream wiring and docs updates.
- `DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration` was rerun after the final docs/checks state and passes with 17 DB/RLS integration tests, 22 PostgreSQL-backed API integration tests, and 1 worker NATS publish/consume integration test.
- `pnpm harness:handoff` passes on branch `feat-milestone4-nats-stream`.
- `node scripts/session-harness-check.mjs --preflight` passes on branch `fix-harness-preflight-checklist`.
- `node scripts/session-harness-check.mjs --handoff` passes on branch `fix-harness-preflight-checklist`.
- `pnpm harness:preflight` passes on branch `fix-harness-preflight-checklist`.
- `pnpm harness:handoff` passes on branch `fix-harness-preflight-checklist`.
- `pnpm format` applied formatting to `scripts/session-harness-check.mjs`.
- `pnpm format:check` passes after the harness guardrail updates.
- `pnpm lint` passes after the harness guardrail updates.
- `pnpm typecheck` passes after the harness guardrail updates.
- `pnpm test` passes after the harness guardrail updates.
- `pnpm build` passes after the harness guardrail updates.
- `pnpm --filter @support/shared-schemas test` initially failed inside the managed sandbox with a pnpm store SQLite access error, then passed with 14 tests when rerun with approved pnpm store access after the event envelope schema expansion.
- `pnpm --filter @support/shared-schemas typecheck` passed after the event envelope schema expansion.
- `pnpm --filter @support/workers test` initially failed inside the managed sandbox with a pnpm store SQLite access error, then passed with 3 tests when rerun with approved pnpm store access after the NATS JetStream publisher scaffold.
- `pnpm --filter @support/workers typecheck` passed after fixing the negative test fixture cast for the NATS JetStream publisher scaffold.
- `pnpm format` applied formatting to the new event schema/publisher files.
- `pnpm format:check` passes after the event bus foundation.
- `pnpm lint` passes after the event bus foundation.
- `pnpm typecheck` passes after the event bus foundation.
- `pnpm test` passes after the event bus foundation.
- `pnpm build` passes after the event bus foundation.
- `pnpm test:integration` was not run in this session because the change added deterministic event contract and publisher unit coverage only; live NATS stream configuration and publish/consume integration coverage is the next Milestone 4 task.
- `pnpm --filter @support/shared-schemas test` passes with 12 tests after the audit event contract schema expansion.
- `pnpm --filter @support/db test` passes with 36 normal tests and 17 live integration tests skipped unless explicitly enabled after audit event repository helper coverage.
- `pnpm --filter @support/api test` passes with 41 API contract tests and 22 live integration tests skipped unless explicitly enabled after audit event route/service expansion.
- `pnpm format` applied formatting after the audit event API expansion.
- `pnpm format:check` passes after the audit event API expansion.
- `pnpm lint` passes after the audit event API expansion.
- `pnpm typecheck` passes after the audit event API expansion.
- `pnpm test` passes after the audit event API expansion.
- `pnpm build` passes after the audit event API expansion.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy after the audit event API expansion.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed when rerun with approved localhost access. The passing run covered 17 DB/RLS integration tests and 22 PostgreSQL-backed API integration tests.
- `pnpm --filter @support/shared-schemas test` passes with 11 tests after the approval contract schema expansion.
- `pnpm --filter @support/shared-schemas typecheck` passes after the approval contract schema expansion.
- `pnpm --filter @support/db test` passes with 34 normal tests and 16 live integration tests skipped unless explicitly enabled after approval repository helper coverage.
- `pnpm --filter @support/db typecheck` passes after approval repository helpers.
- `pnpm --filter @support/api test` passes with 36 API contract tests and 19 live integration tests skipped unless explicitly enabled after approval route/service expansion.
- `pnpm --filter @support/api typecheck` passes after approval route/service expansion.
- `pnpm format` applied formatting after the approval API expansion.
- `pnpm format:check` passes after the approval API expansion.
- `pnpm lint` passes after the approval API expansion.
- `pnpm typecheck` passes after the approval API expansion.
- `pnpm test` passes after the approval API expansion.
- `pnpm build` passes after the approval API expansion.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy after the approval API expansion.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed when rerun with approved localhost access. The passing run covered 16 DB/RLS integration tests and 19 PostgreSQL-backed API integration tests.
- `pnpm --filter @support/shared-schemas test` passes with 10 tests after the KB document metadata contract schema expansion.
- `pnpm --filter @support/shared-schemas typecheck` passes after the KB document metadata contract schema expansion.
- `pnpm --filter @support/db test` passes with 32 normal tests and 15 live integration tests skipped unless explicitly enabled after KB document repository helper coverage.
- `pnpm --filter @support/db typecheck` passes after KB document repository helpers.
- `pnpm --filter @support/api test` passes with 33 API contract tests and 17 live integration tests skipped unless explicitly enabled after KB document route/service expansion.
- `pnpm --filter @support/api typecheck` passes after KB document route/service expansion.
- `pnpm format` applied formatting after the KB document API expansion.
- `pnpm format:check` passes after the KB document API expansion.
- `pnpm lint` passes after the KB document API expansion.
- `pnpm typecheck` passes after the KB document API expansion.
- `pnpm test` passes after the KB document API expansion.
- `pnpm build` passes after the KB document API expansion.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy after the KB document API expansion.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed when rerun with approved localhost access. The passing run covered 15 DB/RLS integration tests and 17 PostgreSQL-backed API integration tests.
- Documentation harness created.
- Cross-links checked with `rg`.
- File inventory checked with `find`.
- Line counts checked with `wc -l`.
- `pnpm install` completed after approving `esbuild` build scripts.
- `pnpm format:check` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- `pnpm install` completed for the API workspace dependency updates.
- `pnpm --filter @support/shared-schemas test` passes with 5 tests.
- `pnpm --filter @support/shared-schemas typecheck` passes.
- `pnpm --filter @support/api test` passes with 11 API contract tests and the live API integration suite skipped by default.
- `pnpm --filter @support/api typecheck` passes.
- `pnpm --filter @support/db test` passes with 19 normal tests and 11 live integration tests skipped unless explicitly enabled.
- `pnpm --filter @support/db typecheck` passes after the tenant transaction helper fix.
- `pnpm format:check` passes after the RBAC/API integration changes.
- `pnpm lint` passes after the RBAC/API integration changes.
- `pnpm typecheck` passes after the RBAC/API integration changes.
- `pnpm test` passes after the RBAC/API integration changes.
- `pnpm build` passes after the API skeleton changes.
- `pnpm --filter @support/shared-schemas test` passes with 7 tests after the tenant/customer/ticket CRUD contract schema expansion.
- `pnpm --filter @support/shared-schemas typecheck` passes after the tenant/customer/ticket CRUD contract schema expansion.
- `pnpm --filter @support/db test` passes with 24 normal tests and 11 live integration tests skipped unless explicitly enabled after repository list/update helper coverage.
- `pnpm --filter @support/db typecheck` passes after repository list/create/update helpers.
- `pnpm --filter @support/api test` passes with 22 API contract tests and 9 live integration tests skipped unless explicitly enabled after tenant/customer/ticket CRUD contract expansion.
- `pnpm --filter @support/api typecheck` passes after tenant/customer/ticket CRUD route/service expansion.
- `pnpm format` applied formatting after the tenant/customer/ticket CRUD API expansion.
- `pnpm format:check` passes after the tenant/customer/ticket CRUD API expansion.
- `pnpm lint` passes after the tenant/customer/ticket CRUD API expansion.
- `pnpm typecheck` passes after the tenant/customer/ticket CRUD API expansion.
- `pnpm test` passes after the tenant/customer/ticket CRUD API expansion.
- `pnpm build` passes after the tenant/customer/ticket CRUD API expansion.
- `pnpm --filter @support/shared-schemas test` passes with 8 tests after the conversation/message read-list contract schema expansion.
- `pnpm --filter @support/db test` passes with 28 normal tests and 13 live integration tests skipped unless explicitly enabled after conversation/message repository helper coverage.
- `pnpm --filter @support/api test` passes with 27 API contract tests and 13 live integration tests skipped unless explicitly enabled after conversation/message route/service expansion.
- `pnpm --filter @support/shared-schemas test` passes with 9 tests after the policy read-list contract schema expansion.
- `pnpm --filter @support/db test` passes with 30 normal tests and 14 live integration tests skipped unless explicitly enabled after policy repository helper coverage.
- `pnpm --filter @support/api test` passes with 30 API contract tests and 15 live integration tests skipped unless explicitly enabled after policy route/service expansion.
- `pnpm format` applied formatting after the policy API expansion.
- `pnpm format:check` passes after the policy API expansion.
- `pnpm lint` passes after the policy API expansion.
- `pnpm typecheck` passes after the policy API expansion.
- `pnpm test` passes after the policy API expansion.
- `pnpm build` passes after the policy API expansion.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy after the policy API expansion.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed when rerun with approved localhost access. The passing run covered 14 DB/RLS integration tests and 15 PostgreSQL-backed API integration tests.
- `pnpm format` applied formatting after the conversation/message API expansion.
- `pnpm format:check` passes after the conversation/message API expansion.
- `pnpm lint` passes after the conversation/message API expansion.
- `pnpm typecheck` passes after the conversation/message API expansion.
- `pnpm test` passes after the conversation/message API expansion.
- `pnpm build` passes after the conversation/message API expansion.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy after the conversation/message API expansion.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed when rerun with approved localhost access. The passing run covered 13 DB/RLS integration tests and 13 PostgreSQL-backed API integration tests.
- `pnpm infra:up` reports the local Compose stack running and PostgreSQL healthy.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` initially failed inside the managed sandbox with localhost `EPERM`, then passed when rerun with approved localhost access. The passing run covered 11 DB/RLS integration tests and 9 PostgreSQL-backed API integration tests.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` passes against the local Compose PostgreSQL database with 11 live repository and RLS execution tests.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm --filter @support/api test:integration` passes with 4 live PostgreSQL-backed API read tests after `pnpm infra:up`.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` passes with DB/RLS integration tests plus API PostgreSQL-backed read integration tests after `pnpm infra:up`.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` applied and verified `0002_tenant_rls` locally.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm db:migrate` returns no pending migrations after RLS migration application.
- `pnpm infra:up` starts the Docker Compose stack successfully.
- API `/health` and `/ready` respond correctly under `pnpm dev`.
- `docs/PROJECT_HISTORY.md` documents what has happened so far, pivots, errors, and fixes.
- `docs/README.md` documents how to use the docs without loading the whole repo context.
- No business logic exists yet.

### Active Blockers

- GitHub Actions includes the live PostgreSQL integration test step, but the latest workflow with DB/RLS plus API integration coverage has not run remotely yet.
- API auth is still a placeholder header contract; no real identity provider exists yet.
- RBAC exists only for the current skeleton OpenAPI, tenant/customer/ticket list-create-read-update endpoints, conversation/message/policy/KB document/approval/audit event read-list endpoints, and ticket audit event list endpoint; it must be extended as new endpoint families are added.
- Tenant/customer/ticket create/update endpoints do not yet create idempotency records, audit events, or workflow side effects.
- API endpoints do not yet start or signal Temporal workflows.
- The ticket lifecycle workflow shell implements first-response SLA timer breach behavior, but next-response/resolution SLA timers, AI graph activities, outbound send activities, API start/signal wiring, and real DB/audit/approval persistence remain pending.
- Conversation/message endpoints are read-list only; message ingestion, internal-note creation, outbound sends, attachment validation, and HTML sanitization enforcement remain future workflow/channel tasks.
- KB document endpoints are metadata read-list only; creation, update, ingestion, chunking, embedding, retrieval search, audit events, and workflow side effects remain future KB/RAG tasks.
- Approval endpoints are read-list only; approve/edit/reject/escalate actions, Temporal signals, audit events, outbound side effects, and workflow resume behavior remain future human-approval-loop tasks.
- Python `uv` is not installed locally; scaffold uses stdlib `unittest` until Python dependency management is finalized.
- No real client/pilot data exists yet.
- No OpenAI/model provider credentials configured yet.

### Open Questions

- Which Python package manager to use for the full AI runtime: recommended default remains `uv`, but local machine currently lacks `uv`.
- Which embedding model/dimension to standardize before production KB ingestion; current initial column is `vector(1536)`.

## Global Completion Checklist

Every task must satisfy:

- [ ] Relevant docs updated.
- [ ] Relevant tests added or updated.
- [ ] Relevant checks run and results recorded.
- [ ] `TODO.md` updated with status, next task, blockers, and verification.
- [ ] Architecture decisions recorded in `docs/DECISIONS.md` when defaults change.
- [ ] Security or privacy implications reviewed.
- [ ] Observability implications reviewed.

## Milestone 0: Documentation Harness

Goal: Create the repo-local knowledge base future AI coding agents will use.

- [x] Define architecture defaults.
- [x] Define backend-only v1 scope.
- [x] Decide TypeScript API/workers plus Python AI runtime.
- [x] Decide Temporal plus LangGraph.
- [x] Create `AGENTS.md`.
- [x] Create `PLAN.md`.
- [x] Create `TODO.md`.
- [x] Create `docs/DEVELOPMENT_RULES.md`.
- [x] Create `docs/BACKEND_SPEC.md`.
- [x] Create `docs/AI_RUNTIME_HARNESS.md`.
- [x] Create `docs/ENGINEERING_HARNESS.md`.
- [x] Create `docs/TEST_STRATEGY.md`.
- [x] Create `docs/SOPS.md`.
- [x] Create `docs/DECISIONS.md`.
- [x] Verify cross-links between docs.
- [x] Verify every major subsystem in `PLAN.md` appears in this checklist.

Acceptance criteria:

- [x] A new AI agent can read `AGENTS.md` and know where to find current work.
- [x] `TODO.md` has a next task and handoff.
- [x] Architecture choices are recorded in `docs/DECISIONS.md`.
- [x] Test and doc update rules are explicit.

## Milestone 1: Repo And Tooling Foundation

Goal: Create a backend monorepo with reproducible local development.

Checklist:

- [x] Initialize git repository by cloning GitHub repo target.
- [x] Choose and document package managers.
- [x] Create monorepo structure.
- [x] Add TypeScript workspace.
- [x] Add Python workspace.
- [x] Add shared schema package.
- [x] Add Docker Compose for local infra.
- [x] Add PostgreSQL service.
- [x] Add Redis service.
- [x] Add NATS JetStream service.
- [x] Add Temporal service and UI.
- [x] Add local object storage service.
- [x] Add OpenTelemetry collector.
- [x] Add lint commands.
- [x] Add format commands.
- [x] Add typecheck commands.
- [x] Add unit test commands.
- [x] Add integration test command placeholder.
- [x] Add CI workflow.
- [x] Add `.env.example`.
- [x] Add root README with setup commands.
- [x] Update `AGENTS.md` with actual commands.
- [x] Update `docs/DEVELOPMENT_RULES.md` with actual commands.

Acceptance criteria:

- [x] Fresh checkout can install dependencies.
- [x] Local infra can start.
- [x] Health checks pass.
- [x] Lint/type/test scripts run.
- [ ] CI runs the same checks.

## Milestone 2: Database And Core Models

Goal: Implement source-of-truth schema and migrations.

Checklist:

- [x] Create tenants table.
- [x] Create users and roles tables.
- [x] Create customers table.
- [x] Create customer identities table.
- [x] Create channels table.
- [x] Create conversations table.
- [x] Create messages table.
- [x] Create tickets table.
- [x] Create ticket events/state transition table.
- [x] Create assignments table.
- [x] Create SLA policies table.
- [x] Create tenant policies table with versions.
- [x] Create KB document table.
- [x] Create KB chunk table with vector column.
- [x] Create integrations table.
- [x] Create tool definitions table.
- [x] Create tool calls table.
- [x] Create AI runs table.
- [x] Create approvals table.
- [x] Create audit events table.
- [x] Create QA review table.
- [x] Add tenant-scoped indexes.
- [x] Add idempotency key support.
- [x] Add migration test.
- [x] Add tenant isolation tests.
- [x] Add live PostgreSQL repository execution tests.
- [x] Decide whether PostgreSQL RLS is required before tenant-scoped API endpoints.
- [x] Add PostgreSQL RLS policies and live RLS negative tests.

Acceptance criteria:

- [x] Migrations apply cleanly to empty DB.
- [x] Migrations can be rolled back or compatibility path is documented.
- [x] Core repository tests pass.
- [x] Tenant-scoped query tests prove no cross-tenant reads.
- [x] PostgreSQL RLS blocks cross-tenant reads before tenant-scoped API endpoints are exposed.

## Milestone 3: Backend API Skeleton

Goal: Expose typed backend APIs without full business automation.

Checklist:

- [x] Create API service.
- [x] Add auth placeholder/middleware.
- [x] Add tenant context middleware.
- [x] Add request ID/correlation ID middleware.
- [x] Add structured error format.
- [x] Add OpenAPI generation.
- [x] Add health endpoint.
- [x] Add readiness endpoint.
- [x] Add tenant endpoints. Current: list/create/read/update skeleton only.
- [x] Add customer endpoints. Current: list/create/read/update skeleton only.
- [x] Add conversation endpoints. Current: read/list skeleton only.
- [x] Add ticket endpoints. Current: list/create/read/update skeleton only; lifecycle transition endpoints are pending.
- [x] Add message endpoints. Current: read/list under conversations skeleton only.
- [x] Add policy endpoints. Current: read/list skeleton only; create/version/approval/activation endpoints are pending.
- [x] Add KB metadata endpoints. Current: document metadata read/list skeleton only; create/update/ingest/search endpoints are pending.
- [x] Add approval endpoints. Current: read/list skeleton only; approve/edit/reject/escalate action endpoints are pending.
- [x] Add audit read endpoints. Current: audit event read/list and ticket audit event list skeleton only; audit writes remain future workflow/service behavior.
- [x] Add contract tests for current API skeleton.
- [x] Add RBAC checks for current API skeleton endpoints.
- [x] Add PostgreSQL-backed API integration tests for current tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket endpoints.

Acceptance criteria:

- [x] All request/response schemas are validated.
- [x] OpenAPI spec is generated.
- [x] Contract tests cover happy and unhappy paths.
- [x] Auth and tenant context are required except health endpoints.

## Milestone 4: Event Bus Foundation

Goal: Add versioned domain events and NATS JetStream.

Checklist:

- [x] Define event envelope schema.
- [x] Define event subject naming convention.
- [x] Implement event publisher. Current: worker-side publisher plus live NATS connection/domain/error stream wiring and workflow-ready emit helpers are complete.
- [x] Implement event consumer base. Current: durable pull-consumer setup helpers and one-message `processNext()` base are implemented in workers.
- [x] Add idempotent consumer handling. Current: storage-agnostic idempotency store contract plus in-memory implementation are covered by unit tests; a PostgreSQL-backed adapter remains future side-effecting consumer work.
- [x] Add dead-letter/error stream strategy. Current: invalid envelopes and handler failures publish structured records to `SUPPORT_EVENT_ERRORS`; max-delivery handler failures are termed after error publication.
- [x] Add local NATS config.
- [x] Add live NATS publish/consume integration test.
- [x] Emit message received event. Current: schema-validated worker emit helper exists for future workflow activity use; CRUD endpoints do not publish events directly.
- [x] Emit ticket created event. Current: schema-validated worker emit helper exists for future workflow activity use; CRUD endpoints do not publish events directly.
- [x] Emit ticket state transition events. Current: schema-validated worker emit helper supports triaged/resolved/closed transition events for future workflow activity use.
- [x] Add event schema tests.
- [x] Add consumer idempotency tests.

Acceptance criteria:

- [x] Events are versioned.
- [x] Consumers are idempotent. Current: the worker consumer base deduplicates completed events per consumer/tenant/event through the injected idempotency store and nacks in-progress duplicates instead of running concurrent handler work.
- [x] Event publication includes correlation and causation IDs. Current: enforced by the shared envelope and publisher validation; real workflow-owned emission remains pending.

## Milestone 5: Temporal Workflow Foundation

Goal: Implement durable ticket workflow shell.

Checklist:

- [x] Add Temporal worker package. Current: Temporal SDK dependencies and worker config/runtime scaffold exist in `@support/workers`.
- [x] Define ticket workflow. Current: deterministic `ticketLifecycleWorkflow` shell exists; full DB/AI/outbound behavior remains activity-bound future work.
- [x] Define message ingest signal. Current: `message_received` and `customer_replied` signals dedupe by `message_id`.
- [x] Define approval signal. Current: `approval_completed` resumes the workflow from the approval wait state.
- [x] Define SLA timer activity. Current: `createOrUpdateTicket` returns recorded SLA timer data and the workflow handles first-response SLA breach through a Temporal timer; next-response/resolution timers remain future work.
- [x] Define AI activity placeholder. Current: `runAiGraph` activity contract returns structured success/failure results and the workflow routes successful AI output to approval metadata while auditing structured AI failures before human approval.
- [x] Define outbound send activity placeholder. Current: `sendOutboundMessage` activity contract exists; the workflow routes approved/edited approvals to it (with a deterministic idempotency key), emits `support.message.sent.v1`, and records `message.sent` audit. The real channel send remains future work.
- [x] Define audit activity. Current: `recordAuditEvent` activity contract exists; persistence implementation remains future work.
- [x] Add deterministic workflow tests. Current: default-off live Temporal test covers approval wait/resume, inbound signal dedupe, first-response SLA timer breach, AI success-to-approval routing, AI failure-to-human routing, approval-outcome routing (approved/edited send once, rejected does not send, escalated routes to manual handling), and replay.
- [x] Add retry policy tests. Current: worker unit coverage locks the explicit ticket lifecycle default and side-effect activity retry policies.
- [x] Add workflow replay safety check. Current: opt-in live Temporal workflow coverage fetches completed history and replays it with `Worker.runReplayHistory`.

Acceptance criteria:

- [x] Inbound message starts or signals a workflow. Current: `ticketLifecycleWorkflow` starts from an initial inbound message and processes `message_received`/`customer_replied` signals with `message_id` dedupe, proven by the live workflow test. Real API/channel intake start/signal wiring lands in Milestones 6 and 10.
- [x] Workflow updates ticket state through allowed transitions. Current: the workflow drives lifecycle phases (creating_ticket → triaging → running_ai → waiting_for_approval → responded/manual_escalated/sla_breached/completed) and emits `support.ticket.triaged.v1` transition events with from/to status; real ticket-record persistence remains behind the `createOrUpdateTicket` activity boundary.
- [x] Workflow can wait for human approval.
- [x] Workflow tests pass without real LLM calls.

## Milestone 6: Channel Intake

Goal: Normalize email and WhatsApp inbound messages.

Checklist:

- [x] Define normalized inbound message schema.
- [x] Add email adapter fixture parser.
- [x] Add email webhook/polling placeholder.
- [x] Add WhatsApp adapter fixture parser.
- [x] Add WhatsApp webhook handler.
- [x] Add signature verification for supported provider.
- [x] Add raw payload storage.
- [x] Add attachment metadata handling.
- [x] Add dedup/idempotency.
- [x] Add conversation threading.
- [x] Add inbound adapter tests.

Acceptance criteria:

- [x] Duplicate inbound events do not create duplicate messages.
- [x] Raw payloads are stored by reference.
- [x] Conversation threading works for fixtures.
- [x] Bad signatures are rejected.

Deferred to later slices (not blocking Milestone 6 completion): attachment
binary storage + oversize-attachment rejection, HTML sanitization to
`body_html_ref`, and multi-ticket-per-conversation lifecycle (Milestone 6
models one lifecycle workflow per conversation).

## Milestone 7: KB And Retrieval

Goal: Ingest tenant knowledge and retrieve evidence.

Checklist:

- [x] Define KB document schema.
- [x] Define KB chunk schema.
- [x] Add document upload/ingestion API.
- [x] Add chunking pipeline.
- [x] Add embedding pipeline.
- [x] Add pgvector index.
- [x] Add tenant-scoped retrieval.
- [x] Add citation metadata.
- [x] Add stale document handling.
- [x] Add retrieval evaluation fixtures.
- [x] Add prompt-injection test content.
- [x] Add tenant isolation retrieval tests.

Ingestion half done in `feat-milestone7-kb-ingestion` (schemas, upload/ingest API,
chunking, embedding, pgvector index). Retrieval half done in
`feat-milestone7-kb-retrieval`: `POST /v1/kb/search` embeds the query with the same
`Embedder` and runs a tenant-scoped cosine (`<=>`) nearest-neighbour search over
active chunks; stale/inactive documents are excluded via a join on
`kb_documents.status = 'active'` (so a document PATCHed to `stale` drops out of
answers even though its chunk rows remain), and each hit carries citation IDs plus
document title/type/source. Milestone 7 is complete.

Acceptance criteria:

- [x] Retrieval never crosses tenant boundary. (`searchKbChunksQuery` filters `kb_chunks.tenant_id`/`kb_documents.tenant_id` and runs under `withTenantTransaction`/RLS; proven by unit tenant-isolation tests and a live pgvector integration test.)
- [x] Results include citation IDs and source metadata. (`KbSearchResult` returns `kb_chunk_id`/`kb_document_id` plus `document_title`, `document_type`, `source_type`, `source_ref`, and a relevance `score`.)
- [x] Stale/inactive policy docs are excluded from active answers. (Retrieval joins `kb_documents` and requires `status = 'active'` for both chunk and document; unit- and live-DB-tested.)

## Milestone 8: Tool Registry

Goal: Expose safe, typed tools for AI and workflows.

Checklist:

- [x] Define tool definition schema.
- [x] Define tool call input/output schema.
- [x] Define side-effect classes.
- [x] Define permission classes.
- [x] Implement tool execution interface.
- [x] Add mock order lookup tool.
- [x] Add shipment tracking lookup tool.
- [x] Add refund eligibility calculator.
- [x] Add cancellation eligibility calculator.
- [x] Add customer profile lookup tool.
- [x] Add KB search tool.
- [x] Add tool audit logging.
- [x] Add idempotency handling for side-effect-capable tools.
- [x] Add permission tests.
- [x] Add schema validation tests.

Done in `feat-milestone8-tool-registry`. Contracts live in `packages/shared-schemas`:
canonical `ToolSideEffectClassSchema` (read_only/draft_side_effect/reversible_write/
irreversible_write) and `ToolPermissionClassSchema` (customer_read/order_read/kb_read/
eligibility_evaluate/reply_draft/action_execute), plus the tool-call envelope
(`ToolCallRequestSchema`, `ToolCallResultSchema` — a discriminated union on
succeeded/failed/blocked, `ToolCallErrorCodeSchema`). `@support/integrations/tool-contract`
was refactored to source those enums from shared-schemas and typed
`ToolDefinitionSchema.permission` to the permission-class enum (`defineReadOnlyTool`
kept; `defineSideEffectTool` added, defaults to requiring approval). `packages/db`
exposes `ToolCall`/`NewToolCall` and the `tool_calls` repository queries
(`insertToolCallQuery`, `updateToolCallByIdQuery`, `toolCallByIdempotencyKeyQuery`).
The executor is `packages/api/src/tool-registry.ts` (`createToolExecutor`): per call it
resolves tenant-scoped visibility via `visibleToolDefinitionByNameQuery`, checks the
tool's permission class against the caller's granted set, validates arguments against the
tool's zod schema, runs the handler under its `timeoutMs`, validates + size-bounds the
result (default 16 KiB, rejected not truncated), and writes a `tool_calls` audit row for
every outcome. Idempotency (side-effect tools only; reads are naturally idempotent)
de-duplicates by `(tenant, tool_definition, idempotency_key)` — a repeated key replays the
first outcome. Two stores mirror the same semantics: `createDatabaseToolRegistryStore`
(under `withTenantTransaction`/RLS) and `createInMemoryToolRegistryStore` (unit tests).
The six first-party tools are in `packages/api/src/tools/` over injectable mock commerce
fixtures (order lookup, shipment tracking, refund + cancellation eligibility calculators,
customer profile) plus `kb_search`, which reuses the Milestone 7 `KbRetrievalService`.
`createDatabaseToolExecutor()` wires the production executor. 22 unit tests in
`tool-registry.test.ts` cover the acceptance criteria and the tools; whole suite green.

Acceptance criteria:

- [x] Invalid tool arguments are rejected. (`argsSchema.safeParse` fails → `invalid_arguments`, status `failed`, audited; handler never runs. Tested for `order_lookup`, `shipment_tracking_lookup`, `kb_search`.)
- [x] Unauthorized tools cannot execute. (Missing permission class → `blocked`/`unauthorized`, handler not invoked; a tool not visible to the tenant → `blocked`/`not_visible` with no audit row; disabled definitions blocked. Tested with a spy proving no execution.)
- [x] Tool results are bounded and AI-safe. (Result validated against the tool's schema — out-of-contract → `output_invalid`; serialized size capped, oversized → `result_too_large`, rejected not truncated; KB content returned as cited data, documented as never-instructions.)
- [x] Every tool call is audited. (Visibility→permission→args→execute→bound each writes/updates a `tool_calls` row via the store; asserted through the in-memory store's `listCalls()`.)

## Milestone 9: AI Runtime With LangGraph

Goal: Implement the first support agent graph.

Checklist:

- [x] Create Python AI runtime package. (`ai/runtime/` package; `ai/pyproject.toml`; stdlib-only, ADR-0016.)
- [x] Define agent state model. (`ai/runtime/state.py` `AgentState`, harness §5.)
- [x] Define structured outputs. (`ai/runtime/schemas.py` — validated I/O contracts mirroring `RunAiGraphActivityResult` + the Milestone 8 tool envelope.)
- [x] Add classifier node. (`nodes.classifier_node` via the `ModelProvider` port; topic/sentiment/urgency/priority/sensitive flags.)
- [x] Add retrieval node. (`nodes.retrieval_planner_node` + `nodes.retrieval_node` over the tenant-scoped, stale-excluding `RetrievalPort`.)
- [x] Add policy decision node. (`nodes.policy_node` — deterministic governance; human_only for hard-sensitive, opt-in allowlisted auto-send.)
- [x] Add tool planning node. (`nodes.tool_planner_node` — respects the policy allow-list + max tool calls; never guesses order ids.)
- [x] Add tool execution node. (`nodes.tool_execution_node` over the `ToolExecutor` port mirroring the Milestone 8 envelope; permissions derived from policy.)
- [x] Add response drafting node. (`nodes.composer_node` via the `ModelProvider` port; safe-by-construction, skipped for hard human-only cases.)
- [x] Add critic/guardrail node. (`nodes.guardrail_node` — grounding, unsafe-promise, injection, missing-evidence checks; downgrade-only.)
- [x] Add escalation node. (`nodes.escalation_node` + `finalize_node` — combines policy/critic/confidence/grounding, builds the human approval package.)
- [x] Add eval capture. (`finalize_node` populates `eval_signals`; `RuntimeResult.eval_signals`.)
- [x] Add trace export. (`ai/runtime/tracing.py` `RunTrace.export()` — deterministic, redacted, harness §15.)
- [x] Add golden dataset fixtures. (`ai/evals/fixtures.py` + `ai/evals/golden_dataset.py` — 24 cases across every category.)
- [x] Add offline eval runner. (`ai/evals/runner.py` — metrics + hard-fail gates; `python3 -m evals.runner`.)
- [x] Add unit tests for graph nodes. (`ai/runtime/schemas_test.py`, `graph_test.py`, `nodes_test.py`.)
- [x] Add integration test with mocked model/tool calls. (`ai/runtime/runner_test.py`, `ai/evals/runner_test.py` — full runs, stub model/tool cases.)

Acceptance criteria:

- [x] AI graph returns structured routing and draft outputs. (`RuntimeResult.routing_decision` + `.draft`; verified in `runner_test.FullRunTest`.)
- [x] Risky cases escalate. (Legal/chargeback/fraud/injection → `human_only`, no draft; verified in `runner_test.EscalationTest` + eval gates.)
- [x] No customer-facing response is produced without evidence. (Auto-send requires evidence or a successful tool; `runner_test.GroundingGateTest`.)
- [x] Eval runner reports pass/fail metrics. (`EvalReport.passed` + metrics; `evals/runner_test.py`.)

## Milestone 10: Approval And Outbound Messaging

Goal: Complete human approval backend loop and outbound send activities.

Checklist:

- [ ] Define approval record schema.
- [ ] Add approval request creation.
- [ ] Add approval read APIs.
- [ ] Add approve/edit/reject/escalate APIs.
- [ ] Add approval signal to Temporal.
- [ ] Add outbound message schema.
- [ ] Add email outbound adapter.
- [ ] Add WhatsApp outbound adapter.
- [ ] Add outbound idempotency.
- [ ] Add outbound audit events.
- [ ] Add tests for approval resume.
- [ ] Add tests for edited draft audit trail.

Acceptance criteria:

- [ ] Workflow pauses until approval.
- [ ] Approved or edited responses are sent once.
- [ ] Rejected responses do not send.
- [ ] Human edits are stored for eval and QA.

## Milestone 11: Observability And QA

Goal: Make system behavior visible and reviewable.

Checklist:

- [ ] Add OpenTelemetry tracing.
- [ ] Add structured logs with trace IDs.
- [ ] Add metrics for APIs.
- [ ] Add metrics for workflows.
- [ ] Add metrics for AI runs.
- [ ] Add metrics for tool calls.
- [ ] Add metrics for approvals.
- [ ] Add QA review data model.
- [ ] Add QA sampling job.
- [ ] Add AI run trace links.
- [ ] Add basic dashboard definitions.
- [ ] Add alert definitions for critical failures.

Acceptance criteria:

- [ ] A ticket can be traced end to end.
- [ ] QA review can see conversation, evidence, tool calls, AI output, human edits, and final response.
- [ ] Critical failure modes have metrics or alerts.

## Milestone 12: Security And Pilot Readiness

Goal: Prepare for first pilot with controlled risk.

Checklist:

- [ ] Add RBAC enforcement.
- [ ] Add integration secret handling.
- [ ] Add PII redaction in logs.
- [ ] Add prompt-injection test suite.
- [ ] Add attachment validation.
- [ ] Add audit completeness tests.
- [ ] Add data retention policy hooks.
- [ ] Add pilot tenant seed data.
- [ ] Add pilot onboarding SOP.
- [ ] Add weekly review report query.
- [ ] Add auto-send allowlist controls.
- [ ] Add production deployment checklist.

Acceptance criteria:

- [ ] No known cross-tenant leakage.
- [ ] No high-risk action can bypass human approval.
- [ ] Pilot metrics can be reported.
- [ ] Incident and escalation SOPs are documented.

## Completed Log

Use reverse chronological order.

### 2026-07-03

- Completed Milestone 9 - AI Runtime With LangGraph (`feat-milestone9-ai-runtime`): a self-contained, dependency-free Python support agent graph under `ai/` that mirrors LangGraph's node model behind pluggable ports (ADR-0016).
  - `ai/runtime/`: `schemas.py` (validated I/O contracts + tool-call envelope mirror), `state.py` (`AgentState`), `graph.py` (LangGraph-style engine), `nodes.py` + `support_graph.py` (11-node graph with a conditional draft/skip edge), `providers.py` (`ModelProvider` port + deterministic offline model), `retrieval.py` (`RetrievalPort` + tenant-scoped stale-excluding retrieval), `tools.py` (`ToolExecutor` port mirroring Milestone 8 governance), `tracing.py` (deterministic redacted traces), `runner.py` (`run_support_graph`).
  - `ai/evals/`: fixtures, a 24-case golden dataset across every category, and an offline eval runner with hard-fail safety gates.
  - 49 Python unit/integration tests; golden dataset passes all gates (all metrics 1.000, zero unsafe auto-send / cross-tenant leakage). Docs updated: `docs/AI_RUNTIME_HARNESS.md`, `docs/TEST_STRATEGY.md`, `docs/DECISIONS.md` (ADR-0016), `docs/PROJECT_HISTORY.md`, `README.md`, `ai/evals/README.md`.

### 2026-07-02

- Advanced Milestone 6 Channel Intake to ~half complete in one clubbed `packages/integrations/src/channels` slice:
  - Added `parseInboundEmailMessage` (`RawInboundEmailSchema`) and `parseInboundWhatsAppMessages` (`RawInboundWhatsAppSchema`, batched WhatsApp Cloud) mapping non-strict raw provider payloads into the strict `NormalizedInboundMessage`, with attachment metadata by reference and threading (email `In-Reply-To`/`References`, WhatsApp sender `wa_id`).
  - Added timing-safe HMAC-SHA256 signature verification: `verifyWhatsAppCloudSignature` (`X-Hub-Signature-256`), `verifyMailgunSignature`, and the shared `verifyHmacSha256Signature` primitive; bad signatures are rejected.
  - Refined the shared contract: attachment `size_bytes` is nullable, and the non-empty-content rule moved to a message-level refinement (text, html, or an attachment).
  - Added `@support/shared-schemas` as an `@support/integrations` workspace dependency plus an `exports` map and barrel; kept adapters pure behind an `InboundAdapterContext` a webhook handler supplies.
  - Added adapter/signature unit tests; checked off the email/WhatsApp adapter, attachment metadata, signature verification, and inbound adapter test checklist items and the "bad signatures are rejected" acceptance criterion.
  - Updated `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, `README.md`, and `TODO.md`; left webhook ingress, raw payload/attachment storage, dedup persistence, conversation threading persistence, and workflow wiring for later slices.
- Verification for this session is recorded in the Verification Status section above.
- Started Milestone 6 Channel Intake:
  - Defined the normalized inbound message contract in `packages/shared-schemas/src/index.ts` as `NormalizedInboundMessageSchema` (`.strict()`) with `ChannelTypeSchema`, `NormalizedInboundChannelSchema` (`email | whatsapp`), `CustomerIdentityTypeSchema`, `NormalizedInboundCustomerIdentitySchema`, `NormalizedInboundBodySchema` (requires `text` or `html`), and `NormalizedInboundAttachmentSchema`, plus inferred type exports.
  - Required `external_message_id`, `raw_payload_ref`, and `idempotency_key` so raw payloads are stored by reference and inbound dedup has a stable key.
  - Added shared-schema unit tests for the canonical email fixture, a WhatsApp html-only/no-attachment message, and rejections of unsupported channels, empty bodies, missing `external_message_id`, and unknown top-level keys.
  - Checked off the Milestone 6 "Define normalized inbound message schema" checklist item; recorded the email adapter fixture parser as the next slice.
  - Updated `docs/BACKEND_SPEC.md`, `docs/TEST_STRATEGY.md`, `docs/PROJECT_HISTORY.md`, `README.md`, and `TODO.md`; kept provider adapters, ingress, signature verification, storage, dedup persistence, and conversation threading as later slices behind adapter boundaries.
- Verification for this session is recorded in the Verification Status section above.

### 2026-06-27

- Completed Milestone 5 Temporal workflow foundation:
  - Added the `sendOutboundMessage` activity placeholder contract, `sending_response`/`responded` workflow phases, and an `outbound_message_id` result field.
  - Made `ticketLifecycleWorkflow` approval routing outcome-aware: approved/edited send an outbound response (with a deterministic idempotency key), emit `support.message.sent.v1`, and record `message.sent` audit; rejected ends without sending; escalated routes to manual handling with `ticket.manual_escalated` audit.
  - Added the `support.message.sent.v1` emit helper plus `MessageSentEventPayload` type and wired the `emitDomainEvent` activity adapter to emit message-sent events; `sendOutboundMessage` uses the explicit side-effect retry policy.
  - Updated the approved/AI-failure workflow tests (now send) and added deterministic edited/rejected/escalated approval-outcome routing tests; verified all 7 live Temporal workflow tests pass.
  - Marked the Milestone 5 checklist and acceptance criteria complete; recorded Milestone 6 Channel Intake as the next milestone.
  - Kept real LangGraph calls, DB persistence, the real channel send behind `sendOutboundMessage`, API workflow start/signal wiring, and next-response/resolution SLA timers behind activity boundaries.
- Verification for this session is recorded in the Verification Status section above.
- Continued Milestone 5 Temporal workflow foundation:
  - Added the structured `runAiGraph` activity placeholder contract for AI success and structured AI runtime failure results.
  - Updated `ticketLifecycleWorkflow` to call the AI graph activity after triage, expose AI run state in workflow query/results, create human approval metadata from successful AI output, and audit structured AI failures before routing to human approval.
  - Added opt-in live Temporal workflow coverage for AI success-to-approval and AI failure-to-human routing.
  - Kept real LangGraph calls, DB persistence, outbound sends, API workflow start/signal wiring, and next-response/resolution SLA timers behind activity boundaries.
- Verification for this session is recorded in the Verification Status section above.

### 2026-06-26

- Continued Milestone 5 Temporal workflow foundation:
  - Added first-response SLA timer contracts to the ticket lifecycle workflow activity/result/query state.
  - Added deterministic first-response SLA breach handling while the workflow waits for approval/manual escalation/close signals.
  - Added ticket SLA breach domain event helper coverage and wired the ticket lifecycle `emitDomainEvent` activity adapter to `support.ticket.sla_breached.v1`.
  - Added explicit ticket lifecycle activity retry-policy constants and call-site retry options for event/audit side effects.
  - Added opt-in live Temporal workflow coverage for first-response SLA breach and workflow history replay.
  - Kept API CRUD endpoints disconnected from workflow starts/signals and real DB/AI/outbound side effects behind activity boundaries.
- Verification for this session is recorded in the Verification Status section above.

- Started Milestone 5 Temporal workflow foundation:
  - Added Temporal SDK dependencies and worker config/runtime scaffold in `@support/workers`.
  - Added deterministic ticket lifecycle workflow shell with message/customer-reply, approval-completed, manual-escalation, and close-request signals plus state query.
  - Added activity contracts/placeholders for ticket create/load, triage, approval creation, inbound persistence, audit writes, and domain event emission.
  - Added `emitDomainEvent` activity adapter that reuses the Milestone 4 ticket-created and ticket-transition domain event emit helpers.
  - Added offline unit coverage and opt-in live Temporal workflow coverage against local Compose Temporal.
  - Kept API CRUD endpoints disconnected from workflow starts/signals and direct event side effects.
- Verification for this session is recorded in the Verification Status section above.

- Completed Milestone 4 event bus foundation:
  - Added event-name-specific payload validation and structured event error record schemas.
  - Added workflow-ready emit helpers for message received, ticket created, and ticket state transition domain events.
  - Added `SUPPORT_EVENT_ERRORS` stream setup and structured event-error publishing.
  - Extended consumer processing to publish invalid-envelope and handler-failure records, retry recoverable failures, and term max-delivery failures after recording them.
  - Kept CRUD skeleton endpoints disconnected from direct event side effects; Temporal workflow/activity code remains the owner for real business event emission.
  - Added unit and live integration coverage for domain event payloads, emit helpers, error publisher behavior, consumer error handling, and error stream publish/consume behavior.
- Continued Milestone 4 event bus foundation:
  - Added worker-side durable pull-consumer config/setup helpers.
  - Added one-message event consumer processing with schema validation, subject/envelope validation, handler context, and ack/nak/term handling.
  - Added storage-agnostic consumer idempotency handling with an in-memory implementation for deterministic tests.
  - Added consumer idempotency tests for completed duplicates, in-progress duplicates, handler failure retry, invalid payload termination, and `processNext()`.
  - Kept CRUD event publication disabled until workflow/service-owned side effects are implemented.
- Verification for this session is recorded in the Verification Status section above.

### 2026-06-23

- Completed Milestone 3 audit event API expansion:
  - Added audit event read/list skeleton endpoints backed by the existing `audit_events` table.
  - Added ticket-scoped audit event list endpoint with parent ticket existence checks.
  - Added route-level RBAC for `audit_events:read`.
  - Added OpenAPI, shared schema, repository helper, API contract, repository integration, and live PostgreSQL-backed API integration coverage.
  - Kept audit event writes, event publication, workflow side effects, and ticket lifecycle side effects for future workflow/event-bus tasks.
- Marked the Milestone 3 API skeleton checklist complete.
- Verification for this session is recorded in the Verification Status section above.

### 2026-06-22

- Continued Milestone 3 approval API expansion:
  - Added approval read/list skeleton endpoints backed by the existing `approvals` table.
  - Added route-level RBAC for `approvals:read`.
  - Added OpenAPI, shared schema, repository helper, API contract, repository integration, and live PostgreSQL-backed API integration coverage.
  - Kept approval approve/edit/reject/escalate actions, Temporal signals, audit events, outbound side effects, and workflow resume behavior for future human-approval-loop tasks.
- Continued Milestone 3 KB document metadata API expansion:
  - Added KB document metadata read/list skeleton endpoints backed by the existing `kb_documents` table.
  - Added route-level RBAC for `kb_documents:read`.
  - Added OpenAPI, shared schema, repository helper, API contract, repository integration, and live PostgreSQL-backed API integration coverage.
  - Kept KB document creation, update, ingestion, chunking, embedding, retrieval search, audit side effects, and workflow side effects for future KB/RAG tasks.
- Verification for this session is recorded in the Verification Status section above.

### 2026-06-21

- Continued Milestone 3 policy API expansion:
  - Added policy read/list skeleton endpoints backed by the existing `tenant_policies` table.
  - Added route-level RBAC for `policies:read`.
  - Added OpenAPI, shared schema, repository helper, API contract, repository integration, and live PostgreSQL-backed API integration coverage.
  - Kept policy create, policy version creation, approval, activation, audit side effects, and immutable active-version enforcement for future policy workflow tasks.
- Continued Milestone 3 conversation/message API expansion:
  - Added conversation read/list and message read/list skeleton endpoints backed by existing schema.
  - Added route-level RBAC for `conversations:read` and `messages:read`.
  - Added OpenAPI, shared schema, repository helper, API contract, repository integration, and live PostgreSQL-backed API integration coverage.
  - Kept message creation, internal notes, outbound sends, idempotency side effects, attachment validation, and HTML sanitization enforcement for future workflow/channel tasks.
- Verification for this session is recorded in the Verification Status section above.

### 2026-06-20

- Continued Milestone 3 tenant/customer/ticket API contract expansion:
  - Added tenant/customer/ticket list-create-read-update skeleton endpoints where the current schema supports them.
  - Added route-level RBAC for list/create/update permissions.
  - Added OpenAPI, shared schema, repository helper, API contract, and live PostgreSQL-backed API integration coverage.
  - Kept ticket `PATCH` limited to triage/assignment fields; workflow lifecycle transitions remain future endpoints.
- Verified with `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` after `pnpm infra:up`.
- Continued Milestone 3 API skeleton:
  - Added role-to-permission checks for the current OpenAPI, tenant, customer, and ticket read endpoints.
  - Added PostgreSQL-backed API integration tests for tenant/customer/ticket read handlers and tenant isolation.
  - Expanded root `pnpm test:integration` to run DB/RLS integration tests and API integration tests.
- Updated README, backend spec, development rules, test strategy, project history, and TODO handoff for RBAC and API integration coverage.

### 2026-06-19

- Started Milestone 3 API skeleton:
  - Added placeholder auth, actor, role, tenant, request ID, and correlation ID middleware.
  - Added structured error responses with shared schema validation.
  - Added generated OpenAPI document endpoint.
  - Added read-only tenant/customer/ticket by-id skeleton endpoints.
  - Added DB-backed service adapters using the new tenant transaction helper.
- Extended DB RLS helpers:
  - Added `withTenantTransaction`.
  - Added tenant repository query helper.
  - Verified helper ordering in unit tests and helper behavior in live RLS integration coverage.
- Added shared API contract schemas for structured errors and first resource responses.
- Updated API, backend, testing, project history, README, and TODO documentation for the new API skeleton.

### 2026-06-18

- Completed and verified Milestone 1 backend scaffold:
  - `pnpm install`
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
  - `pnpm infra:up`
  - API `/health` and `/ready`
- Added backend scaffold in preparation for moving into the cloned GitHub repo:
  - `pnpm` workspace.
  - TypeScript packages for API, workers, shared schemas, DB config, and integration tool contracts.
  - Python AI runtime placeholder with stdlib `unittest`.
  - Docker Compose infra for PostgreSQL/pgvector, Redis, NATS JetStream, Temporal, MinIO, and OpenTelemetry collector.
  - GitHub Actions CI workflow.
  - `.env.example`, `.gitignore`, and root `README.md`.
- Created `AGENTS.md`, `PLAN.md`, `TODO.md`, and the full backend docs harness under `docs/`.
- Completed Milestone 0 documentation harness.
- Planned backend-only documentation harness.
- Selected TypeScript API/workers plus Python AI runtime.
- Selected Temporal plus LangGraph.
- Selected PostgreSQL + pgvector and NATS JetStream for v1.

## Verification Log

Use reverse chronological order.

### 2026-06-26

- Verified session preflight with `pnpm harness:preflight` after creating branch `feat-milestone4-event-consumers`; the first sandboxed run failed on pnpm store/registry access, and the approved rerun passed.
- Verified worker unit tests with `pnpm --filter @support/workers test`.
- Verified worker typecheck with `pnpm --filter @support/workers typecheck`.
- Applied formatting with `pnpm format`.
- Verified formatting with `pnpm format:check`.
- Verified static checks with `pnpm lint`.
- Verified repo typecheck with `pnpm typecheck`.
- Verified repo tests with `pnpm test`.
- Verified package builds with `pnpm build`.
- Did not rerun `pnpm test:integration`; this session did not change live PostgreSQL or NATS integration behavior.

### 2026-06-19

- Updated workspace dependencies with `pnpm install`.
- Verified shared schema tests with `pnpm --filter @support/shared-schemas test`.
- Verified shared schema typecheck with `pnpm --filter @support/shared-schemas typecheck`.
- Verified DB tests with `pnpm --filter @support/db test`.
- Verified API contract tests with `pnpm --filter @support/api test`.
- Verified API typecheck with `pnpm --filter @support/api typecheck`.
- Verified repo formatting with `pnpm format:check`.
- Verified repo lint with `pnpm lint`.
- Verified repo typecheck with `pnpm typecheck`.
- Verified repo tests with `pnpm test`.
- Verified repo build with `pnpm build`.
- Verified live PostgreSQL repository/RLS integration tests with `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration`.

### 2026-06-18

- Verified cloned repo dependency install with `pnpm install`.
- Approved pnpm build script for `esbuild`, required by `tsx`/`vitest`.
- Verified formatting with `pnpm format:check`.
- Verified static checks with `pnpm lint`.
- Verified TypeScript with `pnpm typecheck`.
- Verified tests with `pnpm test`.
- Verified package builds with `pnpm build`.
- Verified local infra startup with `pnpm infra:up`.
- Fixed infra issues found during verification:
  - Temporal DB driver changed from `postgresql` to `postgres12`.
  - Redis host port changed from `6379` to `6380` because local `6379` was already in use.
  - Temporal UI, Temporal auto-setup, MinIO, and OTel collector images changed to available `latest` tags for the initial scaffold.
- Verified API health endpoints under `pnpm dev`:
  - `GET /health`
  - `GET /ready`
- Verified file inventory with `find . -maxdepth 3 -type f -print | sort`.
- Verified docs size with `wc -l AGENTS.md PLAN.md TODO.md docs/*.md` for 5,016 total lines.
- Verified cross-doc references with `rg` for core doc names.
- Application tests not run because this change creates documentation only and no application code exists.
