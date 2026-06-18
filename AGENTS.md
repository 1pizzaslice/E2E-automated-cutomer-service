# AGENTS.md

## Purpose

This repository is for a backend-first AI customer support BPO platform. The goal is to build the service and engineering harness for automated support operations: channel intake, ticket lifecycle, durable workflows, AI triage/drafting, tool-governed actions, human approval, auditability, evaluations, and pilot operations.

Do not build frontend UI until the backend contracts and workflows are implemented. Frontend references are allowed only when defining API needs for a future agent console.

## Required Reading Before Coding

Read these files in this order before making non-trivial changes:

1. `TODO.md` - current milestone, next task, blockers, and session handoff.
2. `docs/README.md` - guide to which deeper docs are relevant for the task.
3. `docs/PROJECT_HISTORY.md` - what has happened so far, pivots made, and current state.
4. The task-relevant deep doc only:
   - `PLAN.md` for product/backend architecture and roadmap.
   - `docs/DEVELOPMENT_RULES.md` for coding, testing, architecture, and documentation rules.
   - `docs/BACKEND_SPEC.md` for backend contracts, data model, APIs, workflows, events, and service boundaries.
   - `docs/AI_RUNTIME_HARNESS.md` for LangGraph agent graph, tool governance, prompts, evals, and guardrails.
   - `docs/TEST_STRATEGY.md` for required tests by change type.
   - `docs/DECISIONS.md` for accepted architectural decisions.

Use `docs/SOPS.md` for operations, client onboarding, QA, incident response, and support process details. Use `docs/ENGINEERING_HARNESS.md` for AI-scaled development workflow.

Do not load every deep doc by default. Use progressive disclosure: start with `TODO.md`, `docs/README.md`, and the specific doc for the subsystem being changed.

## Scope Rules

- Backend first: APIs, workers, workflows, data, integrations, AI runtime, observability, security, and tests.
- No frontend implementation unless a future task explicitly changes scope.
- Do not introduce app code without updating the relevant docs and `TODO.md`.
- Do not rely on undocumented behavior, guessed schemas, or ad hoc JSON. Validate data at boundaries.
- Do not create one-off scripts or helpers without deciding where they live and how they are tested.

## Architecture Defaults

- API and core backend services: TypeScript.
- AI runtime: Python.
- Durable workflow engine: Temporal.
- Stateful agent orchestration: LangGraph.
- Database: PostgreSQL with `pgvector` for v1 retrieval.
- Event bus: NATS JetStream for v1.
- Cache and rate limits: Redis.
- Observability: OpenTelemetry, structured logs, metrics, traces, and LLM trace/eval tooling.

If a change contradicts these defaults, update `docs/DECISIONS.md` in the same change with the reason.

## Current Commands

Use these commands from the repository root:

- Install TypeScript dependencies: `pnpm install`
- Run API in watch mode: `pnpm dev`
- Start local infrastructure: `pnpm infra:up`
- Stop local infrastructure: `pnpm infra:down`
- Lint/static checks: `pnpm lint`
- Format check: `pnpm format:check`
- Apply formatting: `pnpm format`
- Typecheck: `pnpm typecheck`
- Run tests: `pnpm test`
- Run TypeScript package tests: `pnpm -r test`
- Run Python scaffold tests: `pnpm test:py`
- Build TypeScript packages: `pnpm build`

Python currently uses standard library `unittest` for scaffold validation because `uv` is not installed in the local environment yet. Revisit Python dependency management when implementing the LangGraph runtime.

## Completion Rules

A task is not complete until:

- Relevant tests are added or updated.
- Relevant tests/checks are run, or the reason they could not run is documented.
- Public contracts, data models, prompts, workflows, or operational behavior are documented.
- `TODO.md` is updated with completed work, next task, blockers, and verification status.
- Any architecture-affecting decision is recorded in `docs/DECISIONS.md`.

## Documentation Update Rule

Whenever a feature, API, event, data model, workflow, prompt, tool, guardrail, test strategy, or operational process changes, update the concerned markdown file in the same change. Repo-local documentation is the system of record for future AI sessions.

## Testing Expectations

- Bug fixes require regression tests.
- New behavior requires unit and integration coverage at the correct boundary.
- Temporal workflows require deterministic workflow tests and replay-safe implementation.
- LangGraph/LLM behavior requires eval cases and traceability.
- Security-sensitive code requires negative tests.
- Migrations require forward and rollback/compatibility notes.

## Session Handoff Rule

Before ending a coding session, update `TODO.md`:

- Mark completed checklist items.
- Add the latest verification results.
- Record blockers or risks.
- Write the next recommended task in a way a new AI agent can start without hidden context.
