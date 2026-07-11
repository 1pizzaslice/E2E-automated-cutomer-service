# AGENTS.md

## Purpose

This repository is for a backend-first AI customer support BPO platform. The goal is to build the service and engineering harness for automated support operations: channel intake, ticket lifecycle, durable workflows, AI triage/drafting, tool-governed actions, human approval, auditability, evaluations, and pilot operations.

Frontend belongs in this repository at `apps/console` and nowhere else (ADR-0026). Do not write console code before Milestone 20 lands its contract; until then, frontend references are allowed only when defining API needs for the reviewer console. The console UI itself is Milestone 23.

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

## Active Session Guardrails

Before non-trivial edits:

- Run `git status --short --branch`.
- If the branch is `main` or `master`, create a short-lived feature/fix branch before editing. Direct work on `main` is allowed only when the user explicitly asks for a direct-main hotfix or baseline update.
- Run `pnpm harness:preflight` after branching. If it fails, fix the workflow state before coding.

Before ending a coding session:

- Update the active milestone checklist in `TODO.md`, not just the handoff prose.
- Add verification results and unrun-test notes to `TODO.md`.
- Run `pnpm harness:handoff` before the final response or before pushing.
- Push the feature/fix branch by default. Push `main` only when the user explicitly asks for direct-main work.

## Scope Rules

- Backend first: APIs, workers, workflows, data, integrations, AI runtime, observability, security, and tests.
- Frontend implementation only under `apps/console`, and only from Milestone 20 onward (ADR-0026). Backend correctness still comes first: the console consumes contracts, it does not shape them mid-build.
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
- Reviewer console: a static Vite + React 19 SPA at `apps/console`, calling `/v1/*` through `packages/api-client` (ADR-0028). No backend-for-frontend — `packages/api` is the console's backend (ADR-0026). Clerk runs client-side behind an auth-provider seam; browser tests are Playwright behind `test:e2e:console`, out of root `pnpm test`.

If a change contradicts these defaults, update `docs/DECISIONS.md` in the same change with the reason.

## Current Commands

Use these commands from the repository root:

- Install TypeScript dependencies: `pnpm install`
- Run API in watch mode: `pnpm dev` (Milestone 16: the API defaults to production JWT auth and requires `SUPPORT_AUTH_ISSUER`/`SUPPORT_AUTH_AUDIENCE`; for header-driven local work set `SUPPORT_AUTH_MODE=insecure-headers` explicitly)
- Start local infrastructure: `pnpm infra:up`
- Stop local infrastructure: `pnpm infra:down`
- Apply database migrations: `pnpm db:migrate`
- Generate a Drizzle migration draft: `pnpm --filter @support/db generate:migration`
- Run session branch preflight: `pnpm harness:preflight`
- Run session handoff guard: `pnpm harness:handoff`
- Lint/static checks: `pnpm lint`
- Format check: `pnpm format:check`
- Apply formatting: `pnpm format`
- Typecheck: `pnpm typecheck`
- Run tests: `pnpm test`
- Run live PostgreSQL integration tests: `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration`
- Run TypeScript package tests: `pnpm -r test`
- Run Python (AI runtime) tests: `pnpm test:py`
- Run the AI runtime sidecar locally: `SUPPORT_AI_SERVICE_TOKEN=local-ai-service-token pnpm ai:service`
- Run the live sidecar-bridge end-to-end drive: `DATABASE_URL=... NATS_URL=nats://127.0.0.1:4222 pnpm --filter @support/workers test:e2e:service`
- Run the live eval gate against a configured real model (opt-in, costs tokens): `SUPPORT_LLM_PROVIDER=anthropic SUPPORT_LLM_MODEL=claude-sonnet-5 PYTHONPATH=ai uv run --frozen --project ai --extra llm python -m evals.live_runner` (offline agnosticism proof: `SUPPORT_LLM_PROVIDER=scripted` with `--extra service`)
- Build TypeScript packages: `pnpm build`

The Python AI runtime under `ai/` is managed by **uv** (installed at `~/.local/bin`; `ai/.python-version` pins CPython 3.12, which uv provisions — the system `python3` is 3.14). `pnpm test:py` and the Python step of `pnpm lint` run through `uv run --frozen --project ai`, so they are reproducible regardless of the system interpreter; `ai/uv.lock` is committed. Do **not** fall back to a stdlib-only approach because deps "won't install": the real AI stack (pydantic, langgraph, langchain + langchain-anthropic/langchain-openai) installs via `uv sync --project ai --extra llm`. The v1 graph still runs on the standard library behind pluggable ports (ADR-0016); since Milestone 15 the real model is a config-selected LangChain adapter behind the `ModelProvider` port (`SUPPORT_LLM_PROVIDER`/`SUPPORT_LLM_MODEL`; deterministic offline model when unset — see AI_RUNTIME_HARNESS §21). If `uv` is somehow missing, reinstall with `curl -LsSf https://astral.sh/uv/install.sh | sh`.

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
