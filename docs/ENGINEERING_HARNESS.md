# Engineering Harness

## Purpose

This document defines how humans and AI coding agents should build this backend platform together. It turns repository documentation, tests, plans, and checklists into a repeatable development harness.

The goal is not just to produce code. The goal is to produce code that future agents can understand, validate, extend, and safely change.

## 1. Harness Principles

### 1.1 Humans Steer, Agents Execute

Humans should define:

- Product priority.
- Acceptance criteria.
- Risk tolerance.
- Pilot constraints.
- Architectural direction.
- Final approval for high-risk behavior.

Agents should execute:

- Repo exploration.
- Implementation.
- Tests.
- Documentation updates.
- Refactors.
- Review passes.
- Handoff updates.

### 1.2 Docs Are The Shared Memory

Do not rely on:

- Chat history.
- Verbal decisions.
- Uncommitted assumptions.
- External docs not linked from the repo.

Do rely on:

- `AGENTS.md`.
- `PLAN.md`.
- `TODO.md`.
- `docs/*.md`.
- Tests.
- Schema files.
- Generated API docs.
- Decision log.

### 1.3 Progressive Disclosure

Agents should start from a small map and open deeper docs only when needed:

1. `AGENTS.md`
2. `TODO.md`
3. Task-relevant spec docs
4. Code files
5. Tests
6. External docs only when needed for current APIs

Avoid dumping every doc into every prompt.

### 1.4 Mechanical Enforcement Over Vague Taste

Whenever an agent repeatedly makes the same mistake, prefer one of:

- Test.
- Lint rule.
- Schema validation.
- CI check.
- Doc update with explicit example.
- Hook/check script.

Do not rely only on long prose instructions.

## 2. Standard Task Flow

Every non-trivial task should follow this loop:

1. Read `AGENTS.md`.
2. Read `TODO.md`.
3. Run `git status --short --branch`.
4. Create a short-lived feature/fix branch before non-trivial edits unless the user explicitly approves direct-main work.
5. Run `pnpm harness:preflight`.
6. Read relevant docs.
7. Inspect code and tests.
8. Restate the goal and acceptance criteria internally.
9. Implement the smallest coherent change.
10. Add or update tests.
11. Run targeted checks.
12. Review the diff.
13. Update docs.
14. Update `TODO.md`, including the active milestone checklist.
15. Run `pnpm harness:handoff`.
16. Summarize result, verification, and next step.

## 2.1 Branching Strategy

Use `main` as the stable checkpoint branch. Work directly on `main` only for baseline setup, documentation bootstrapping, and small emergency fixes.

After the baseline is stable, use short-lived feature branches for each coherent concern. Branch names should describe the milestone slice, for example:

- `feat/db-repository-integration-tests`
- `feat/api-skeleton`
- `feat/event-bus-foundation`
- `feat/temporal-ticket-workflow`

Active rule:

- If `git status --short --branch` shows `main` or `master`, branch before non-trivial edits.
- Run `pnpm harness:preflight` before implementation and `pnpm harness:handoff` before final response or push.
- Push the feature/fix branch by default. Push `main` only when the user explicitly asks for direct-main work.

Before merging a feature branch back to `main`:

- Relevant tests and checks must pass.
- Concerned docs must be updated.
- `TODO.md` must include the latest handoff.
- The branch should contain one coherent reviewable change set, not unrelated work.

This keeps AI coding sessions easier to review, roll back, and resume while preserving `main` as the source of stable handoffs.

## 3. Task Intake Template

When starting a task, capture:

```md
## Task

Goal:

Context:

In scope:

Out of scope:

Acceptance criteria:

Relevant docs:

Likely files/packages:

Tests expected:

Risks:
```

For small tasks, this can live in the conversation. For larger tasks, create an execution plan under `docs/exec-plans/active/` after the repo scaffold exists.

## 4. Execution Plans

Create an execution plan when a task:

- Spans multiple services.
- Changes public contracts.
- Changes workflow state.
- Changes AI graph behavior.
- Requires migration.
- Requires security review.
- Cannot be completed in one short session.

Future directory convention:

- `docs/exec-plans/active/YYYY-MM-DD-short-title.md`
- `docs/exec-plans/completed/YYYY-MM-DD-short-title.md`

Execution plan template:

```md
# Title

## Goal

## Context

## Acceptance Criteria

## Implementation Steps

- [ ] Step 1
- [ ] Step 2

## Tests

- [ ] Unit
- [ ] Integration
- [ ] Workflow
- [ ] Eval

## Docs To Update

- [ ] TODO.md
- [ ] Relevant spec

## Decisions

## Risks

## Handoff Notes
```

When completed, move to completed folder and update `TODO.md`.

## 5. Agent Roles For Future Parallel Work

Use subagents or parallel agents only when work is read-heavy or cleanly separable.

Recommended agent roles:

- Architecture reviewer: checks layering, boundaries, contracts, and consistency with docs.
- Security reviewer: checks tenant isolation, auth, PII, prompt injection, tool permissions.
- Test reviewer: checks missing tests, poor fixtures, weak assertions, and eval gaps.
- Workflow reviewer: checks Temporal determinism, retries, idempotency, and state transitions.
- AI reviewer: checks prompt/versioning, evals, guardrails, evidence, and hallucination risk.
- Docs reviewer: checks stale docs, missing `TODO.md`, and missing ADR updates.

Avoid parallel write-heavy implementation unless tasks are in separate packages and merge conflicts are unlikely.

## 6. Repo Structure Target

When application code is scaffolded, use a structure like:

```text
.
├── AGENTS.md
├── PLAN.md
├── TODO.md
├── docs/
│   ├── AI_RUNTIME_HARNESS.md
│   ├── BACKEND_SPEC.md
│   ├── DECISIONS.md
│   ├── DEVELOPMENT_RULES.md
│   ├── ENGINEERING_HARNESS.md
│   ├── SOPS.md
│   ├── TEST_STRATEGY.md
│   └── exec-plans/
├── packages/
│   ├── api/
│   ├── api-client/
│   ├── workers/
│   ├── shared-schemas/
│   ├── db/
│   ├── integrations/
│   └── observability/
├── apps/
│   └── console/
├── ai/
│   ├── runtime/
│   ├── evals/
│   └── prompts/
├── infra/
│   ├── docker-compose.yml
│   ├── temporal/
│   ├── nats/
│   └── otel/
└── scripts/
```

`packages/` is implemented. `packages/api-client/` arrives with Milestone 20 and `apps/console/` with Milestone 23 (ADR-0026); `apps/*` is not yet a `pnpm-workspace.yaml` glob.

## 7. Development Commands

Current scaffold commands:

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate
pnpm dev
pnpm infra:up
pnpm infra:down
pnpm test:py
```

`pnpm test:integration` exists as a placeholder and intentionally reports that integration tests are not implemented yet. `uv` is not installed locally, so Python scaffold tests currently use standard library `unittest`; switch to `uv` and/or `pytest` when implementing the real LangGraph runtime.

## 8. Implementation Invariants

Agents must preserve:

- Tenant isolation.
- Boundary validation.
- Typed contracts.
- Temporal determinism.
- Tool governance.
- Auditability.
- Observability.
- Eval coverage for AI behavior.
- Documentation freshness.

If a task cannot preserve an invariant, stop and record a blocker.

## 9. Review Loop

Before finalizing a change, run a local review:

1. Check changed files.
2. Confirm tests match behavior.
3. Confirm docs match behavior.
4. Check for accidental unrelated changes.
5. Check security-sensitive paths.
6. Check error handling.
7. Check observability.
8. Check `TODO.md`.

Suggested prompt to a future review agent:

```text
Review this change for backend correctness, tenant isolation, workflow determinism,
AI/tool governance, missing tests, and stale docs. Lead with actionable findings
and cite files/lines.
```

## 10. Documentation Gardening

Run doc gardening after major milestones or repeated drift.

Checklist:

- [ ] `AGENTS.md` still short and navigational.
- [ ] `TODO.md` next task is current.
- [ ] Completed items are marked.
- [ ] `PLAN.md` roadmap still matches actual implementation.
- [ ] `BACKEND_SPEC.md` matches schemas/APIs/events.
- [ ] `AI_RUNTIME_HARNESS.md` matches graph/prompts/tools/evals.
- [ ] `TEST_STRATEGY.md` matches actual commands and test locations.
- [ ] `DECISIONS.md` records major choices.
- [ ] No obsolete docs contradict current code.

## 11. Change Types And Required Artifacts

### 11.1 API Change

Required:

- Schema update.
- OpenAPI update.
- Contract tests.
- `docs/BACKEND_SPEC.md` update.
- `TODO.md` update.

### 11.2 Database Change

Required:

- Migration.
- Repository tests.
- Rollback/compat note.
- `docs/BACKEND_SPEC.md` update.
- `docs/DECISIONS.md` if architectural.

### 11.3 Workflow Change

Required:

- Workflow tests.
- Replay/determinism review.
- Event/audit review.
- `docs/BACKEND_SPEC.md` update.
- `TODO.md` update.

### 11.4 AI Graph Change

Required:

- Node tests.
- Eval cases.
- Prompt version update if behavior changes.
- Trace output verification.
- `docs/AI_RUNTIME_HARNESS.md` update.

### 11.5 Tool Change

Required:

- Tool schema update.
- Permission tests.
- Audit tests.
- Tool output redaction tests.
- `docs/AI_RUNTIME_HARNESS.md` and `docs/BACKEND_SPEC.md` updates.

### 11.6 Security Change

Required:

- Negative tests.
- Threat model note if needed.
- Audit/observability review.
- `docs/DEVELOPMENT_RULES.md` or `docs/SOPS.md` update if process changes.

## 12. AI Coding Prompt Pattern

Use this shape for future implementation prompts:

```text
Goal: [specific behavior]

Context:
- Read AGENTS.md and TODO.md first.
- Relevant docs: [list docs]
- Relevant code: [list files if known]

Constraints:
- Backend only.
- Preserve tenant isolation.
- Validate boundaries.
- Add tests.
- Update docs and TODO.md.

Done when:
- [acceptance criteria]
- [checks to run]
- TODO.md updated with handoff.
```

## 13. Avoid These Failure Modes

- Building UI before backend contracts. This is about sequencing, not placement: the console lives in this repo at `apps/console` (ADR-0026), but no console code lands before Milestone 20 publishes its contract.
- Letting AI bypass tool registry.
- Letting Temporal workflows call nondeterministic services directly.
- Adding schemas without tests.
- Adding prompts without evals.
- Adding integrations without audit logs.
- Adding events without versioned schemas.
- Updating code but not docs.
- Leaving `TODO.md` stale.
- Building on external chat context instead of repo docs.

## 14. Future Mechanical Enforcement

Once scaffolding exists, add checks for:

- `TODO.md` changed when code changes.
- `docs/DECISIONS.md` changed when architecture files change.
- OpenAPI generated spec is up to date.
- Event schemas are versioned.
- No cross-layer imports.
- No direct provider calls outside tool registry.
- No direct LLM calls outside AI runtime.
- No `console.log` or unstructured logs.
- No missing tenant filters in repositories.
- No unapproved write-capable tools.

## 15. Handoff Quality Bar

A good handoff says:

- What changed.
- Why it changed.
- What was verified.
- What was not verified.
- What is risky.
- What should happen next.

A poor handoff says only "done."

Future agents should improve poor handoffs when encountered.
