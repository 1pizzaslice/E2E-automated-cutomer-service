# TODO.md

## Purpose

This file is the cross-session source of truth for what has been done, what is next, what is blocked, and what must be verified. Every coding session must update this file before ending.

## Current Status

- Project phase: Milestone 3 API skeleton is complete with tenant/customer/ticket list-create-read-update contracts plus conversation/message/policy/KB document metadata/approval/audit event read-list contracts, ticket audit event list contracts, RBAC checks, and PostgreSQL-backed API integration coverage. Milestone 4 event bus foundation now has event schemas, subject naming, publisher wiring, explicit local NATS JetStream config, and live publish/consume integration coverage.
- Current milestone: Milestone 4 - event bus foundation is in progress.
- Current scope: Core PostgreSQL schema, migration runner, Drizzle schema, tenant-scoped repository query helpers, PostgreSQL RLS, live PostgreSQL repository/RLS execution tests, API request/auth/tenant context middleware placeholders, structured errors, OpenAPI skeleton, role permission checks for current endpoint families, PostgreSQL-backed API integration tests, tenant/customer/ticket list-create-read-update skeleton contracts, conversation/message/policy/KB document metadata/approval/audit event read-list skeleton contracts, ticket audit event list contracts, shared v1 domain event envelope schemas, tenant-aware NATS subject naming, worker-side NATS JetStream publisher plus connection/stream setup wiring, local NATS JetStream config, live NATS publish/consume integration coverage, and session harness preflight/handoff checks. No business workflow implementation yet.
- Default stack: TypeScript API/workers, Python AI runtime, Temporal, LangGraph, PostgreSQL, pgvector, Redis, NATS JetStream, OpenTelemetry.

## Active Harness Guardrails

- Start non-trivial work from a short-lived feature/fix branch. Do not work directly on `main` unless the user explicitly approves direct-main work.
- Run `pnpm harness:preflight` after branching.
- Before ending a coding session, update the active milestone checklist below as well as the session handoff text.
- Run `pnpm harness:handoff` before final response or push.
- Push feature/fix branches by default. Push `main` only when explicitly requested.

## Next Recommended Task

The next implementation task is:

> Continue Milestone 4 from a short-lived feature branch by adding the worker-side event consumer base and idempotent consumer handling/tests. Run `pnpm harness:preflight` before editing and keep CRUD endpoint event publication disabled until Temporal workflow-owned side effects are implemented.

## Session Handoff

### Last Session Summary

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
- [x] Implement event publisher. Current: worker-side publisher plus live NATS connection/stream wiring is complete; workflow-owned event emission is pending.
- [ ] Implement event consumer base.
- [ ] Add idempotent consumer handling.
- [ ] Add dead-letter/error stream strategy.
- [x] Add local NATS config.
- [x] Add live NATS publish/consume integration test.
- [ ] Emit message received event.
- [ ] Emit ticket created event.
- [ ] Emit ticket state transition events.
- [x] Add event schema tests.
- [ ] Add consumer idempotency tests.

Acceptance criteria:

- [x] Events are versioned.
- [ ] Consumers are idempotent.
- [x] Event publication includes correlation and causation IDs. Current: enforced by the shared envelope and publisher validation; real workflow-owned emission remains pending.

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
