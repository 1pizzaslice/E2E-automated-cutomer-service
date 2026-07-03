# Architecture Decision Log

## Purpose

This file records decisions that future agents should not re-litigate unless new evidence or user direction changes the context. Add a new entry whenever architecture defaults, public contracts, platform choices, or operating rules change.

## Decision Format

Use this format:

```md
## ADR-000X: Title

- Date:
- Status: Accepted | Superseded | Proposed
- Context:
- Decision:
- Consequences:
- Follow-up:
```

## ADR-0001: Backend-Only V1

- Date: 2026-06-18
- Status: Accepted
- Context: The first goal is to design and implement the core service workflow, AI automation, integrations, observability, and operational harness. Frontend can be built later after backend contracts stabilize.
- Decision: V1 focuses on backend APIs, workflows, AI runtime, tools, data model, evals, security, observability, and docs. Do not implement frontend UI unless explicitly requested in a future task.
- Consequences: API contracts must anticipate a future console, but no UI implementation work should distract from backend correctness.
- Follow-up: When backend contracts stabilize, create a separate frontend plan.

## ADR-0002: First Customer Wedge Is D2C/E-Commerce Support

- Date: 2026-06-18
- Status: Accepted
- Context: Support automation needs a concrete vertical to avoid generic platform design. D2C/e-commerce has repetitive ticket types, clear order/refund workflows, and accessible integrations like Shopify and Stripe.
- Decision: V1 targets D2C/e-commerce brands handling order status, refunds, cancellations, and FAQs.
- Consequences: Initial schemas and tools should model orders, shipments, customer profiles, and refund/cancellation eligibility. Avoid overfitting to non-commerce support workflows in v1.
- Follow-up: Add vertical abstraction only after one pilot workflow works end to end.

## ADR-0003: TypeScript API/Workers Plus Python AI Runtime

- Date: 2026-06-18
- Status: Accepted
- Context: TypeScript is strong for APIs, service contracts, workers, and ecosystem integration. Python is stronger for LangGraph, AI orchestration, evals, and model tooling.
- Decision: Use TypeScript for API/core backend/workers and Python for AI runtime/evals.
- Consequences: Shared contracts must be generated or mirrored carefully. Use JSON Schema/OpenAPI as the interoperability layer.
- Follow-up: During repo scaffold, decide exact schema sharing mechanism.

## ADR-0004: Temporal Owns Durable Business Workflows

- Date: 2026-06-18
- Status: Accepted
- Context: Ticket workflows include retries, SLA timers, approval waits, outbound sends, and long-running state. These should survive crashes and deploys.
- Decision: Use Temporal for durable workflows and timers.
- Consequences: Workflow code must be deterministic. LLM calls and DB calls must happen in activities, not workflow definitions.
- Follow-up: Add workflow test and replay rules in implementation.

## ADR-0005: LangGraph Owns Stateful AI Agent Graphs

- Date: 2026-06-18
- Status: Accepted
- Context: AI resolution flows require classification, retrieval, tool-use planning, drafting, critique, and escalation decisions. The user selected Temporal + LangGraph.
- Decision: Use LangGraph in the Python AI runtime for stateful AI graph orchestration.
- Consequences: LangGraph returns structured outputs to Temporal/backend. It does not own durable ticket state.
- Follow-up: Define graph state schemas and eval fixtures before broad automation.

## ADR-0006: PostgreSQL Is Source Of Truth; pgvector First For Retrieval

- Date: 2026-06-18
- Status: Accepted
- Context: V1 needs low operational complexity and strong tenant-scoped data joins. pgvector provides vector search inside Postgres.
- Decision: Use PostgreSQL for source-of-truth data and pgvector for v1 KB retrieval.
- Consequences: Retrieval scale is limited by Postgres tuning, but v1 pilot complexity stays manageable.
- Follow-up: Revisit Qdrant when KB scale, hybrid search, or latency demands justify it.

## ADR-0007: NATS JetStream First For Eventing

- Date: 2026-06-18
- Status: Accepted
- Context: V1 needs durable async messages, replay, simple operations, and service fanout without Kafka-level complexity.
- Decision: Use NATS JetStream for v1 domain events and async processing.
- Consequences: Event design should stay versioned and portable so Kafka remains an upgrade path.
- Follow-up: Revisit Kafka when analytics consumers or event scale require it.

## ADR-0008: AI Draft + Human Approval Is Default Automation Mode

- Date: 2026-06-18
- Status: Accepted
- Context: Early automation must manage quality and trust risk. Human approval captures corrections and builds eval data.
- Decision: V1 defaults to AI draft plus human approval. Auto-send is only allowed for narrow, policy-approved, low-risk cases after eval and QA thresholds are met.
- Consequences: Approval APIs and workflow waits are first-class backend features.
- Follow-up: Define auto-send thresholds after initial golden dataset exists.

## ADR-0009: Repo Docs Are The AI Harness System Of Record

- Date: 2026-06-18
- Status: Accepted
- Context: Future AI sessions need durable context across sessions. OpenAI's harness engineering guidance favors a short agent map plus structured docs, not one giant instruction file.
- Decision: Keep `AGENTS.md` short and put detailed specs in `docs/`. Maintain `TODO.md` as the active state/handoff file.
- Consequences: Every feature/change must update concerned docs. Stale docs are treated as bugs.
- Follow-up: Add doc validation/linting once repo tooling exists.

## ADR-0010: No High-Risk Tool Side Effects In V1

- Date: 2026-06-18
- Status: Accepted
- Context: Refunds, cancellations, billing changes, and account writes can create customer and financial harm.
- Decision: V1 AI may use read-only tools and draft side-effect recommendations. Human approval is required for write-capable actions.
- Consequences: Tool schema must include side-effect class and approval requirement. Workflows must enforce the policy outside the AI runtime.
- Follow-up: Add reversible write support only after policy, audit, and approval tests are mature.

## ADR-0011: Drizzle For PostgreSQL Schema And Queries

- Date: 2026-06-19
- Status: Accepted
- Context: Milestone 2 needs explicit PostgreSQL control for tenant-scoped indexes, partial unique indexes, pgvector columns, reviewed SQL migrations, and typed TypeScript data access. Prisma would improve some CRUD velocity but abstracts more of the SQL surface this project needs to inspect.
- Decision: Use Drizzle for the TypeScript database schema/query layer. Keep reviewed SQL migrations in `packages/db/migrations/`, with Drizzle config available for generating future migration drafts.
- Consequences: Engineers and agents must understand SQL and review generated migrations. Repository helpers should enforce tenant scope instead of exposing unscoped table access by default.
- Follow-up: Add live migration verification to CI once integration infrastructure is available in CI.

## ADR-0012: Stable Main Plus Short-Lived Feature Branches

- Date: 2026-06-19
- Status: Accepted
- Context: AI-first coding benefits from clear, resumable units of work. During the earliest scaffold phase, direct commits to `main` kept setup simple. As the baseline stabilizes, separate branches make review, rollback, and parallel concern tracking cleaner.
- Decision: Keep `main` as the stable checkpoint branch. After baseline setup, prefer short-lived feature branches for separate concerns and merge back only after checks, docs, and `TODO.md` handoff updates are complete.
- Consequences: Future agents should create branches such as `feat/api-skeleton` or `feat/db-repository-integration-tests` before substantial implementation work. `main` should remain green and understandable from repo docs alone.
- Follow-up: Push the current baseline to `main`, then start the next implementation task from a feature branch.

## ADR-0013: Add PostgreSQL Row-Level Security Before Tenant APIs

- Date: 2026-06-19
- Status: Accepted
- Context: Repository helpers now enforce tenant filters and live PostgreSQL tests prove those helpers do not return cross-tenant rows. The platform will still expose high-risk multi-tenant support data through API endpoints, workflows, AI retrieval, tool execution, and audit reads.
- Decision: Add PostgreSQL row-level security policies for tenant-scoped tables before exposing tenant-scoped API endpoints. Repository tenant filters remain mandatory; RLS is a database-level defense in depth, not a replacement for scoped data access.
- Consequences: API and worker database transactions must set an explicit tenant context for tenant-scoped operations. Global or platform-admin access must use explicit, audited paths. Global tool definitions must remain visible where `tenant_id is null` while other tenants' tool definitions stay hidden.
- Implementation: `0002_tenant_rls.sql` enables RLS, defines `support_current_tenant_id()` over `app.current_tenant_id`, grants the non-owner `support_app` application role, and keeps global tool definitions visible to tenant contexts.
- Follow-up: Milestone 3 API and worker database code must set transaction-local tenant context before tenant-scoped operations.

## ADR-0014: KB Ingestion Uses A Deterministic Embedder Port, Content By Reference, And An HNSW Cosine Index

- Date: 2026-07-03
- Status: Accepted
- Context: Milestone 7 KB ingestion must chunk and embed tenant documents into `kb_chunks` for retrieval. A hosted embedding model is a network dependency that is non-deterministic across versions and unavailable in unit/CI runs, so ingestion built directly on it would be unreproducible and untestable. Raw document bodies can be large and do not belong inline in PostgreSQL. Retrieval needs an index for approximate nearest-neighbour search.
- Decision: (1) Chunking and embedding are pure, deterministic functions in `@support/integrations/kb` behind an `Embedder` port; the v1 default is `createDeterministicEmbedder` (a token-hash bag-of-words unit-vector embedder producing `vector(1536)`), and production swaps a hosted model behind the same interface. (2) Raw KB document content is stored by reference in a `KbContentStore` port (filesystem default, keyed by tenant + document id), never inline in the DB; the row keeps only metadata and a `content_hash`. (3) Retrieval is indexed with a pgvector HNSW index using `vector_cosine_ops` (`0003_kb_vector_index.sql`), because the v1 embedder emits L2-normalized vectors so cosine is the correct metric.
- Consequences: Ingestion is reproducible and unit-testable without a model or network, and remains replay-safe when a Temporal `KbIngestionWorkflow` later drives the same steps as activities. Similarity scores from the deterministic embedder are lexical, not semantic, so retrieval quality on real client data depends on choosing and documenting a production embedding model before pilot; the `vector(1536)` dimension and cosine metric must match whatever model is chosen. Content-store durability and access control are separate concerns from the DB.
- Follow-up: Retrieval half delivered in ADR-0015. Choose and document a production embedding model; re-embed if its dimension differs from 1536.

## ADR-0015: KB Retrieval Ranks By Cosine, Excludes Stale Documents At Query Time, And Treats Chunk Content As Untrusted

- Date: 2026-07-03
- Status: Accepted
- Context: Milestone 7's retrieval half must let the AI runtime find evidence in `kb_chunks` without ever crossing a tenant boundary, without surfacing retired knowledge, and without letting adversarial document text ("prompt injection") change system behavior. The v1 `Embedder` emits L2-normalized `vector(1536)` embeddings indexed by an HNSW `vector_cosine_ops` index (ADR-0014). A KB document's lifecycle `status` is mutated by PATCH on the `kb_documents` row only; a re-ingest replaces chunk rows but a plain status change to `stale`/`archived` does not touch existing chunk rows.
- Decision: (1) Retrieval is a tenant-scoped cosine (`<=>`) nearest-neighbour query (`searchKbChunksQuery`) exposed as `POST /v1/kb/search` behind a new `kb:search` permission; it embeds the query with the same `Embedder` used at ingestion and runs under `withTenantTransaction`/RLS with explicit `tenant_id` predicates as defense in depth. (2) Stale/inactive documents are excluded at query time by inner-joining `kb_documents` and requiring both `kb_chunks.status = 'active'` and `kb_documents.status = 'active'` — so a document PATCHed to `stale` drops out of answers even though its chunk rows remain, and no chunk rewrite is needed. (3) Results are `KbChunkResponseSchema`-based with a relevance `score` (cosine similarity = `1 - distance`) plus document-level citation fields (`document_title`, `document_type`, `source_type`, `source_ref`) so answers are attributable. (4) Retrieval treats chunk content as untrusted data: it returns adversarial text verbatim as evidence and never interprets it; ranking is relevance-only, so injected documents cannot hijack results. Downstream guardrails (the Milestone 9 AI runtime) are responsible for refusing to obey retrieved instructions.
- Consequences: Retrieval is reproducible and network-free in tests via the deterministic embedder; a golden eval corpus + labeled queries and adversarial prompt-injection fixtures guard ranking and injection-resilience, and tenant isolation is proven by unit and live-pgvector tests. Because stale exclusion is a query-time join, retiring a document is instant and reversible via PATCH with no re-embedding. The deterministic embedder is lexical, so real retrieval quality still depends on choosing a production embedding model (ADR-0014 follow-up) wired into both ingestion and retrieval behind the `Embedder` port. Raw embeddings are never returned to API clients or the AI runtime.
- Follow-up: A Temporal `KbIngestionWorkflow`; wire one shared production embedder instance into both ingestion and retrieval; consider a similarity-score floor and a max-context-tokens cap before retrieved chunks enter the AI runtime.
