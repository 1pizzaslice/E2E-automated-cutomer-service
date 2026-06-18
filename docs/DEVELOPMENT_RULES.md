# Development Rules

## Purpose

These rules define how this backend platform is built, tested, documented, and maintained with AI coding agents. The goal is to make the repository legible, mechanically verifiable, and resilient to drift as agent-generated code volume increases.

## 1. Source Of Truth Rules

- `AGENTS.md` is the short map for agents.
- `PLAN.md` is the high-level backend architecture and roadmap.
- `TODO.md` is the current work tracker and session handoff.
- `docs/BACKEND_SPEC.md` is the backend contract source of truth.
- `docs/AI_RUNTIME_HARNESS.md` is the AI runtime source of truth.
- `docs/TEST_STRATEGY.md` is the testing source of truth.
- `docs/SOPS.md` is the operations source of truth.
- `docs/DECISIONS.md` is the architecture decision log.

If code and docs disagree, treat it as a bug. Either update the docs to reflect intentional code behavior, or fix the code to match the docs.

## 2. Documentation Update Rule

Update docs in the same change whenever any of the following changes:

- Public API.
- Event schema.
- Database schema.
- Ticket state machine.
- Temporal workflow.
- LangGraph agent graph.
- Prompt template or prompt version.
- Tool schema, permissions, or side-effect behavior.
- Tenant policy behavior.
- Auth/RBAC behavior.
- Integration behavior.
- Test strategy.
- Operational SOP.
- Deployment or environment setup.

Minimum required updates:

- Behavior/API/data changes: update `docs/BACKEND_SPEC.md`.
- AI prompt/graph/tool/guardrail changes: update `docs/AI_RUNTIME_HARNESS.md`.
- Testing changes: update `docs/TEST_STRATEGY.md`.
- Operational changes: update `docs/SOPS.md`.
- Architecture default changes: update `docs/DECISIONS.md`.
- Any completed work: update `TODO.md`.

## 3. Session Handoff Rule

Before ending a session:

- Mark completed checklist items in `TODO.md`.
- Record verification results in `TODO.md`.
- Record blockers and risks in `TODO.md`.
- Set the next recommended task.
- Mention tests that were not run and why.

Do not leave a future agent dependent on chat history.

## 4. Architecture Layering

Each backend domain should follow a predictable dependency direction:

1. Types/schemas.
2. Config.
3. Repositories/data access.
4. Domain services.
5. Runtime adapters/workers/controllers.
6. App wiring.

Allowed dependency direction is inward-to-outward only. Lower layers must not import controllers, workers, or app wiring.

Cross-cutting concerns enter through explicit provider interfaces:

- Auth provider.
- Tenant context provider.
- Clock provider.
- ID provider.
- Logger/tracer provider.
- Event publisher.
- Integration/tool provider.
- Model provider.
- Object storage provider.

## 5. Boundary Validation

Validate all external or cross-service boundaries:

- HTTP request bodies.
- HTTP responses where generated from untyped sources.
- Webhook payloads.
- Event payloads.
- Database JSON fields.
- Tool inputs.
- Tool outputs.
- LLM structured outputs.
- Environment config.
- Migration seed data.

Use Zod in TypeScript and Pydantic in Python unless a future decision changes this.

Never build behavior on guessed JSON shapes. Add fixtures and schemas.

## 6. Tenancy Rules

Every data access path must include tenant context unless explicitly global.

Tenant-scoped entities:

- Customers.
- Customer identities.
- Conversations.
- Messages.
- Tickets.
- Policies.
- KB documents and chunks.
- Integrations.
- Tool definitions and calls.
- AI runs.
- Approvals.
- Audit events.
- QA reviews.

Tests must prove:

- Tenant A cannot read Tenant B data.
- Tenant A retrieval cannot return Tenant B KB chunks.
- Tenant A tool calls cannot use Tenant B credentials.
- Tenant A audit queries cannot expose Tenant B events.

## 7. Temporal Rules

Temporal workflows must be deterministic:

- No direct network calls inside workflow definitions.
- No direct database calls inside workflow definitions.
- No random values inside workflow definitions unless provided deterministically.
- No wall-clock reads outside Temporal APIs.
- No direct LLM calls inside workflow definitions.

Use activities for:

- Database reads/writes.
- AI runtime calls.
- Tool calls.
- Outbound sends.
- Audit writes.
- Metrics side effects.

Workflow changes must include:

- Workflow tests.
- Replay-safety considerations.
- Versioning plan if existing workflows may be running.

## 8. LangGraph And AI Runtime Rules

AI behavior must be structured and auditable:

- Every graph input has a typed state model.
- Every graph output has a typed response model.
- Every prompt has a stable version ID.
- Every model call stores input references, prompt version, model ID, output, latency, token/cost metrics, and trace ID.
- Every customer-facing draft includes evidence references.
- Every tool call goes through the tool registry.
- Every graph branch that escalates must include reason codes.

Do not let the AI runtime mutate ticket state directly. It returns structured recommendations to Temporal/backend services.

## 9. Tool Governance Rules

Every tool must define:

- Name.
- Description.
- Input schema.
- Output schema.
- Tenant scope.
- Required permission.
- Side-effect class.
- Idempotency behavior.
- Timeout.
- Retry policy.
- Human approval requirement.
- Redaction policy.
- Audit fields.

Side-effect classes:

- `read_only`: safe lookup.
- `draft_side_effect`: prepares an action but does not execute it.
- `reversible_write`: writes that can be reversed.
- `irreversible_write`: writes that cannot be safely reversed.

V1 allows AI to call `read_only` and selected `draft_side_effect` tools. Human approval is required for all write-capable tools.

## 10. Database Rules

- Use migrations for schema changes.
- Never modify production schema manually.
- Prefer explicit foreign keys and indexes.
- Add tenant-scoped indexes for common queries.
- Use immutable policy versions.
- Store raw large payloads in object storage and references in PostgreSQL.
- Keep audit events append-only.
- Keep AI run records append-only except for explicitly modeled lifecycle fields.
- Avoid unbounded JSON blobs for core domain state.

Migration PRs must include:

- Forward migration.
- Rollback or compatibility explanation.
- Data backfill plan if required.
- Tests or dry-run notes.

## 11. API Rules

All APIs require:

- Auth context unless health/readiness endpoint.
- Tenant context unless explicitly global.
- Request ID.
- Structured error response.
- Input validation.
- OpenAPI documentation.
- Contract tests.

Mutation APIs should support idempotency where clients or workflows may retry.

Do not expose internal provider payloads directly. Normalize provider data into domain contracts.

## 12. Event Rules

Domain events must:

- Use versioned names.
- Include `tenant_id`.
- Include `event_id`.
- Include `correlation_id`.
- Include `causation_id`.
- Include `occurred_at`.
- Include `schema_version`.
- Pass schema validation.

Consumers must:

- Be idempotent.
- Handle duplicate events.
- Handle out-of-order events where possible.
- Emit structured logs and metrics.

## 13. Logging Rules

Use structured logs only.

Required fields:

- `service`.
- `environment`.
- `trace_id`.
- `request_id` or `correlation_id`.
- `tenant_id` when available.
- `ticket_id` when available.
- `workflow_id` when available.
- `ai_run_id` when available.

Never log:

- API keys.
- Integration secrets.
- Full payment details.
- Full auth tokens.
- Raw sensitive PII unless explicitly redacted.
- Full prompt content in general service logs.

Prompt and model traces should go to the LLM observability store with redaction policy.

## 14. Observability Rules

Every service must emit:

- Health/readiness signal.
- Metrics.
- Structured logs.
- Traces.

Every ticket journey must be traceable from:

Inbound message -> API -> workflow -> AI run -> retrieval -> tool calls -> approval -> outbound message -> audit/eval.

New workflows, tools, and model calls must add spans.

## 15. Security Rules

Security-sensitive areas require negative tests:

- Auth.
- RBAC.
- Tenant isolation.
- Webhook signature verification.
- Tool permissions.
- Integration credentials.
- Prompt injection.
- Attachment handling.
- PII redaction.
- Audit completeness.

No high-risk side effect can be executed by AI without explicit policy and human approval in v1.

## 16. Testing Rules

A feature is not done without appropriate tests.

Required by change type:

- Pure function: unit tests.
- API behavior: contract/integration tests.
- Database behavior: migration/repository tests.
- Workflow behavior: Temporal workflow tests.
- Event behavior: schema and consumer idempotency tests.
- Tool behavior: schema, permission, audit, and failure tests.
- AI graph behavior: node tests, mocked integration tests, eval cases.
- Bug fix: regression test.
- Security change: negative tests.

If tests cannot run, document why in the final response and `TODO.md`.

## 16.1 Current Scaffold Commands

Run from the repository root:

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm infra:up
pnpm infra:down
pnpm test:py
```

Current command meanings:

- `pnpm lint`: TypeScript static checks across packages plus Python bytecode compilation.
- `pnpm format:check`: Prettier formatting check across repo text/code files.
- `pnpm typecheck`: TypeScript typechecking across packages.
- `pnpm test`: TypeScript package tests plus Python scaffold tests.
- `pnpm test:py`: Python stdlib `unittest` discovery under `ai/`.
- `pnpm dev`: API service in watch mode.

`uv` is still the preferred future Python package manager, but it is not installed locally at scaffold time. Do not add Python runtime dependencies until the AI runtime implementation task chooses and documents the Python dependency workflow.

## 17. Code Review Rules

Review changes for:

- Correctness.
- Tenant isolation.
- Boundary validation.
- Workflow determinism.
- Tool governance.
- AI traceability.
- Test coverage.
- Documentation updates.
- Error handling.
- Observability.
- Security/privacy.

Do not accept changes that add behavior but do not update tests or docs.

## 18. Dependency Rules

Before adding a dependency:

- Confirm it solves a real problem.
- Prefer established, well-maintained libraries.
- Check license compatibility.
- Confirm it is inspectable and testable.
- Document why it was added if it is architectural.

Avoid dependencies for tiny helpers that can be implemented clearly and tested locally.

## 19. Error Handling Rules

Errors must be typed or categorized:

- Validation error.
- Auth error.
- Permission error.
- Tenant isolation error.
- Not found.
- Conflict/idempotency conflict.
- Rate limit.
- Provider error.
- Workflow error.
- AI/model error.
- Tool error.
- Internal error.

Customer-visible errors should be safe and non-leaky. Internal errors should preserve diagnostic details in logs/traces.

## 20. Performance Rules

V1 performance targets:

- API p95 under 300ms for non-AI reads.
- Inbound webhook ack under 1s after durable persistence.
- AI draft p95 under 30s for simple tickets.
- Tool lookup p95 under 2s for mock tools.
- Retrieval p95 under 1s for v1 KB scale.

Performance-sensitive code must include metrics.

## 21. Naming Rules

Use consistent names:

- `tenant_id`, not `account_id` or `client_id` for platform tenant.
- `customer_id` for end customer.
- `conversation_id` for message thread.
- `ticket_id` for support work item.
- `message_id` for normalized message.
- `ai_run_id` for model/graph execution.
- `tool_call_id` for tool execution.
- `approval_id` for human approval record.
- `audit_event_id` for audit events.

## 22. File Size And Modularity

Prefer small modules with clear ownership.

If a file becomes hard for an AI agent to inspect, split by:

- schema.
- repository.
- service.
- controller.
- workflow.
- activity.
- tests.

Avoid mixing unrelated domains in one file.

## 23. Done Definition

Done means:

- Behavior implemented.
- Tests added/updated.
- Checks run.
- Docs updated.
- Audit/observability considered.
- Security implications reviewed.
- `TODO.md` updated.
- Decision log updated if needed.
