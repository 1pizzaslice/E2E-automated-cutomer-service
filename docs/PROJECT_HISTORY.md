# Project History And Handoff

## Purpose

This file records what has happened so far so a new human or AI agent can understand the project without relying on chat history.

## Current State

- GitHub repo cloned at `/home/anish/CODE01/STARTUPS/E2E-automated-cutomer-service`.
- Backend scaffold has a local `main` commit.
- No frontend has been implemented.
- No business workflows have been implemented yet.
- Milestone 0 documentation harness is complete.
- Milestone 1 backend scaffold is complete and locally verified.
- Milestone 2 database foundation is implemented and locally verified, including live PostgreSQL repository execution tests and row-level security enforcement tests.
- Milestone 3 API skeleton is complete with request/auth/tenant context middleware placeholders, structured errors, a generated OpenAPI document endpoint, role permission checks, typed tenant/customer/ticket list-create-read-update contracts, typed conversation/message/policy/KB document/approval/audit event read-list contracts, ticket audit event list contracts, and PostgreSQL-backed API integration tests for those endpoint families.
- Milestone 4 event bus foundation has started with shared v1 domain event envelope schemas, a tenant-aware NATS subject convention, and a worker-side NATS JetStream publisher scaffold. CRUD skeleton endpoints still do not publish events.
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
- Added `buildDomainEventSubject`, which maps `support.ticket.created.v1` style event names to tenant-aware subjects such as `support.events.tenant.ten_test.ticket.created.v1`.
- Added subject-safe tenant token validation for event publishing.
- Added `packages/workers/src/event-publisher.ts` with `NatsJetStreamDomainEventPublisher`, which validates envelopes, JSON-encodes events, publishes to the derived tenant-aware subject, and uses `event_id` as the JetStream message ID for duplicate detection.
- Added shared schema and worker publisher contract tests. No live NATS stream configuration or publish/consume integration test exists yet.
- Left current CRUD skeleton endpoints disconnected from event publication; workflow/service-owned event side effects remain future work.

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
- `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration`

## Current Architecture Follow-Ups

- Repository tenant filters remain mandatory even with PostgreSQL row-level security.
- API and worker database code must set transaction-local `app.current_tenant_id` before tenant-scoped operations. The DB package now provides `withTenantTransaction`, which also sets `support_app` as the transaction-local role before repository work.
- CI includes a live PostgreSQL integration test job step, but the remote workflow result has not been observed yet.
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

Start Milestone 4 by adding the event bus foundation:

1. Define the versioned domain event envelope schema and subject naming convention.
2. Add the first NATS JetStream publisher scaffold with contract tests.
3. Keep event publication disabled from current CRUD skeletons until workflow-owned side effects are implemented.
