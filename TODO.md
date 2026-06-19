# TODO.md

## Purpose

This file is the cross-session source of truth for what has been done, what is next, what is blocked, and what must be verified. Every coding session must update this file before ending.

## Current Status

- Project phase: Milestone 2 database foundation implemented and locally verified; RLS hardening is the final pre-API database task.
- Current milestone: Milestone 2 - database and core models.
- Current scope: Core PostgreSQL schema, migration runner, Drizzle schema, tenant-scoped repository query helpers, and live PostgreSQL repository execution tests. No business workflow implementation yet.
- Default stack: TypeScript API/workers, Python AI runtime, Temporal, LangGraph, PostgreSQL, pgvector, Redis, NATS JetStream, OpenTelemetry.

## Next Recommended Task

The next implementation task is:

> Continue Milestone 2 by adding PostgreSQL row-level security policies for tenant-scoped tables before exposing API endpoints. Keep repository tenant filters mandatory, add a migration for RLS, and add live negative tests that prove cross-tenant reads are blocked when tenant context is set.

## Session Handoff

### Last Session Summary

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
- `pnpm --filter @support/db test` passes, including 14 normal tests with the 6 live integration cases skipped unless explicitly enabled.
- `pnpm --filter @support/db typecheck` passes.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration` passes against the local Compose PostgreSQL database with 6 live repository execution tests.
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm db:migrate` applied `0001_initial_core`.
- A second `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm db:migrate` returned no pending migrations.
- `pnpm infra:up` starts the Docker Compose stack successfully.
- API `/health` and `/ready` respond correctly under `pnpm dev`.
- `docs/PROJECT_HISTORY.md` documents what has happened so far, pivots, errors, and fixes.
- `docs/README.md` documents how to use the docs without loading the whole repo context.
- No business logic exists yet.

### Active Blockers

- GitHub Actions includes the live PostgreSQL repository integration test step, but it has not run remotely yet.
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
- [ ] Add PostgreSQL RLS policies and live RLS negative tests.

Acceptance criteria:

- [x] Migrations apply cleanly to empty DB.
- [x] Migrations can be rolled back or compatibility path is documented.
- [x] Core repository tests pass.
- [x] Tenant-scoped query tests prove no cross-tenant reads.
- [ ] PostgreSQL RLS blocks cross-tenant reads before tenant-scoped API endpoints are exposed.

## Milestone 3: Backend API Skeleton

Goal: Expose typed backend APIs without full business automation.

Checklist:

- [ ] Create API service.
- [ ] Add auth placeholder/middleware.
- [ ] Add tenant context middleware.
- [ ] Add request ID/correlation ID middleware.
- [ ] Add structured error format.
- [ ] Add OpenAPI generation.
- [ ] Add health endpoint.
- [ ] Add readiness endpoint.
- [ ] Add tenant endpoints.
- [ ] Add customer endpoints.
- [ ] Add conversation endpoints.
- [ ] Add ticket endpoints.
- [ ] Add message endpoints.
- [ ] Add policy endpoints.
- [ ] Add KB metadata endpoints.
- [ ] Add approval endpoints.
- [ ] Add audit read endpoints.
- [ ] Add contract tests.

Acceptance criteria:

- [ ] All request/response schemas are validated.
- [ ] OpenAPI spec is generated.
- [ ] Contract tests cover happy and unhappy paths.
- [ ] Auth and tenant context are required except health endpoints.

## Milestone 4: Event Bus Foundation

Goal: Add versioned domain events and NATS JetStream.

Checklist:

- [ ] Define event envelope schema.
- [ ] Define event subject naming convention.
- [ ] Implement event publisher.
- [ ] Implement event consumer base.
- [ ] Add idempotent consumer handling.
- [ ] Add dead-letter/error stream strategy.
- [ ] Add local NATS config.
- [ ] Emit message received event.
- [ ] Emit ticket created event.
- [ ] Emit ticket state transition events.
- [ ] Add event schema tests.
- [ ] Add consumer idempotency tests.

Acceptance criteria:

- [ ] Events are versioned.
- [ ] Consumers are idempotent.
- [ ] Event publication includes correlation and causation IDs.

## Milestone 5: Temporal Workflow Foundation

Goal: Implement durable ticket workflow shell.

Checklist:

- [ ] Add Temporal worker package.
- [ ] Define ticket workflow.
- [ ] Define message ingest signal.
- [ ] Define approval signal.
- [ ] Define SLA timer activity.
- [ ] Define AI activity placeholder.
- [ ] Define outbound send activity placeholder.
- [ ] Define audit activity.
- [ ] Add deterministic workflow tests.
- [ ] Add retry policy tests.
- [ ] Add workflow replay safety check.

Acceptance criteria:

- [ ] Inbound message starts or signals a workflow.
- [ ] Workflow updates ticket state through allowed transitions.
- [ ] Workflow can wait for human approval.
- [ ] Workflow tests pass without real LLM calls.

## Milestone 6: Channel Intake

Goal: Normalize email and WhatsApp inbound messages.

Checklist:

- [ ] Define normalized inbound message schema.
- [ ] Add email adapter fixture parser.
- [ ] Add email webhook/polling placeholder.
- [ ] Add WhatsApp adapter fixture parser.
- [ ] Add WhatsApp webhook handler.
- [ ] Add signature verification for supported provider.
- [ ] Add raw payload storage.
- [ ] Add attachment metadata handling.
- [ ] Add dedup/idempotency.
- [ ] Add conversation threading.
- [ ] Add inbound adapter tests.

Acceptance criteria:

- [ ] Duplicate inbound events do not create duplicate messages.
- [ ] Raw payloads are stored by reference.
- [ ] Conversation threading works for fixtures.
- [ ] Bad signatures are rejected.

## Milestone 7: KB And Retrieval

Goal: Ingest tenant knowledge and retrieve evidence.

Checklist:

- [ ] Define KB document schema.
- [ ] Define KB chunk schema.
- [ ] Add document upload/ingestion API.
- [ ] Add chunking pipeline.
- [ ] Add embedding pipeline.
- [ ] Add pgvector index.
- [ ] Add tenant-scoped retrieval.
- [ ] Add citation metadata.
- [ ] Add stale document handling.
- [ ] Add retrieval evaluation fixtures.
- [ ] Add prompt-injection test content.
- [ ] Add tenant isolation retrieval tests.

Acceptance criteria:

- [ ] Retrieval never crosses tenant boundary.
- [ ] Results include citation IDs and source metadata.
- [ ] Stale/inactive policy docs are excluded from active answers.

## Milestone 8: Tool Registry

Goal: Expose safe, typed tools for AI and workflows.

Checklist:

- [ ] Define tool definition schema.
- [ ] Define tool call input/output schema.
- [ ] Define side-effect classes.
- [ ] Define permission classes.
- [ ] Implement tool execution interface.
- [ ] Add mock order lookup tool.
- [ ] Add shipment tracking lookup tool.
- [ ] Add refund eligibility calculator.
- [ ] Add cancellation eligibility calculator.
- [ ] Add customer profile lookup tool.
- [ ] Add KB search tool.
- [ ] Add tool audit logging.
- [ ] Add idempotency handling for side-effect-capable tools.
- [ ] Add permission tests.
- [ ] Add schema validation tests.

Acceptance criteria:

- [ ] Invalid tool arguments are rejected.
- [ ] Unauthorized tools cannot execute.
- [ ] Tool results are bounded and AI-safe.
- [ ] Every tool call is audited.

## Milestone 9: AI Runtime With LangGraph

Goal: Implement the first support agent graph.

Checklist:

- [ ] Create Python AI runtime package.
- [ ] Define agent state model.
- [ ] Define structured outputs.
- [ ] Add classifier node.
- [ ] Add retrieval node.
- [ ] Add policy decision node.
- [ ] Add tool planning node.
- [ ] Add tool execution node.
- [ ] Add response drafting node.
- [ ] Add critic/guardrail node.
- [ ] Add escalation node.
- [ ] Add eval capture.
- [ ] Add trace export.
- [ ] Add golden dataset fixtures.
- [ ] Add offline eval runner.
- [ ] Add unit tests for graph nodes.
- [ ] Add integration test with mocked model/tool calls.

Acceptance criteria:

- [ ] AI graph returns structured routing and draft outputs.
- [ ] Risky cases escalate.
- [ ] No customer-facing response is produced without evidence.
- [ ] Eval runner reports pass/fail metrics.

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
