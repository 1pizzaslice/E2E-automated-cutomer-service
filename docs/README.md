# Docs Guide

## Purpose

This directory is the repo-local memory for the project. It is intentionally split into small entry docs and deeper reference docs so humans and AI agents can get the right context without loading everything.

Do not read every file by default. Start with this file, then open only the docs relevant to the current task.

## Fast Reading Path

For any new session:

1. Read `../AGENTS.md`.
2. Read `../TODO.md`.
3. Read this file.
4. Read `PROJECT_HISTORY.md`.
5. Open one or two task-specific deep docs.

## Which Doc To Use

- `PROJECT_HISTORY.md`: what has happened so far, pivots made, errors encountered, fixes applied, and current state.
- `DECISIONS.md`: accepted architecture decisions that should not be re-litigated casually.
- `DEVELOPMENT_RULES.md`: coding rules, testing rules, documentation update rules, and current commands.
- `ENGINEERING_HARNESS.md`: how to run AI-assisted development across sessions, plans, reviews, and handoffs.
- `BACKEND_SPEC.md`: backend data model, API families, events, workflows, tenancy, and service contracts.
- `AI_RUNTIME_HARNESS.md`: LangGraph runtime, AI graph nodes, prompts, tools, guardrails, and evals.
- `TEST_STRATEGY.md`: unit, integration, workflow, eval, security, and release test requirements.
- `SOPS.md`: operational process for onboarding, KB ingestion, policy approval, QA, incidents, and pilot reviews.

Use `../PLAN.md` when you need the overall product architecture, milestones, and roadmap.

## Context Discipline

These docs are useful, but loading all of them into every AI context is wasteful.

Default reading rule:

- Always read `AGENTS.md`, `TODO.md`, `docs/README.md`, and `docs/PROJECT_HISTORY.md`.
- For database work, read `BACKEND_SPEC.md`, `TEST_STRATEGY.md`, and `DECISIONS.md`.
- For AI runtime work, read `AI_RUNTIME_HARNESS.md`, `TEST_STRATEGY.md`, and `DECISIONS.md`.
- For infrastructure or tooling work, read `DEVELOPMENT_RULES.md`, `ENGINEERING_HARNESS.md`, and `TODO.md`.
- For operations or pilot process work, read `SOPS.md` and `PLAN.md`.

If a doc starts becoming too broad, split it instead of making `AGENTS.md` huge.

## Why The Docs Are Large

The project is not a simple CRUD app. It combines:

- Multi-tenant support data.
- Durable Temporal workflows.
- AI graph orchestration.
- Tool governance.
- Retrieval and evals.
- Security and audit requirements.
- Human approval operations.

The deep docs are meant to prevent repeated architecture decisions and unsafe agent assumptions. They are worth keeping as reference material, but they should be used selectively.

## When To Update Docs

Update docs in the same change when you change:

- API contracts.
- Database schema.
- Events.
- Temporal workflows.
- AI graph or prompts.
- Tool schemas or permissions.
- Tests or commands.
- Operational SOPs.
- Architecture decisions.

Always update `../TODO.md` before ending a session.
