# TODO.md

## Purpose

This file is the cross-session source of truth for what has been done, what is next, what is blocked, and what must be verified. Every coding session must update this file before ending.

## Current Status

- Project phase: Milestone 3 API skeleton is complete with tenant/customer/ticket list-create-read-update contracts plus conversation/message/policy/KB document metadata/approval/audit event read-list contracts, ticket audit event list contracts, RBAC checks, and PostgreSQL-backed API integration coverage. Milestone 4 event bus foundation is complete with typed event payload schemas, subject naming, publisher wiring, workflow-ready emit helpers, explicit local NATS JetStream domain/error stream config, worker-side consumer base/idempotency/error handling, and live publish/consume integration coverage. Milestone 5 Temporal workflow foundation is complete with the deterministic ticket workflow shell, activity boundaries, first-response SLA timer breach behavior, an AI graph activity placeholder with success/failure-to-human routing, a `sendOutboundMessage` activity placeholder with deterministic approval-outcome routing (approved/edited send once, rejected does not send, escalated routes to manual handling), explicit activity retry policies, and replay coverage. Milestone 6 channel intake is complete (normalized inbound schema, provider adapters, signature verification, webhook ingress, tenant-scoped persistence, and workflow start/signal wiring). Milestone 7 KB and retrieval is complete: the ingestion vertical (KB document/chunk ingestion contracts, deterministic chunking + embedding pipelines, a pgvector HNSW cosine index, content stored by reference, and tenant-scoped document create/update/ingest endpoints) plus the retrieval vertical (`POST /v1/kb/search` tenant-scoped cosine nearest-neighbour retrieval over active chunks/documents with citation metadata, stale-document exclusion, a `kb:search` permission, retrieval eval + prompt-injection fixtures, and tenant-isolation tests) are both done. Milestone 8 tool registry is complete: shared tool contracts (side-effect + permission classes, tool-call request/result envelope), a tenant-scoped tool executor with schema validation, permission-class checks, timeout + size-bounded AI-safe results, `tool_calls` audit logging, and idempotent replay for side-effect tools, plus the six first-party tools (order/shipment/refund/cancellation/customer lookups and calculators + a `kb_search` tool reusing the Milestone 7 retrieval service). Milestone 9 AI runtime is complete: a dependency-free Python LangGraph-style support agent graph under `ai/` (normalize → classifier → retrieval planner → retrieval → policy → tool planner → tool execution → conditional composer → guardrail critic → escalation → finalize) with structured Pydantic-equivalent I/O contracts, a `ModelProvider` port + deterministic offline model, `RetrievalPort` and `ToolExecutor` ports (the latter mirroring the Milestone 8 tool-call envelope + permission classes), deterministic trace capture, and an initial golden dataset with an offline eval runner enforcing hard-fail safety gates. Milestone 10 approval and outbound messaging is complete: approve/edit/reject/escalate decision endpoints behind a new `approvals:review` permission (pending-guarded resolution under RLS, `approval.{status}` audit events carrying both `requested_payload` and `approved_payload` for the edited-draft trail, and an injectable `ApprovalWorkflowSignaler` delivering `approval_completed` to the Temporal workflow), the shared `NormalizedOutboundMessageSchema` + send-status/sent-by-type contracts, pure email/WhatsApp outbound adapters plus an HTTP `OutboundChannelSender` (Mailgun/WhatsApp Cloud, injectable fetch) in `packages/integrations`, and production `createApproval`/`sendOutboundMessage`/`recordAuditEvent` Temporal activity implementations over a `TicketLifecyclePersistenceStore` port with database-index-enforced outbound idempotency and deterministic retry-safe approval/audit ids. Milestone 11 observability and QA is complete: a shared `@support/observability` package (OTel tracing/metrics bootstrap to the local collector, a typed `SupportMetrics` port with OTel/no-op/recording implementations, canonical `support.*` metric names and span attributes, and a structured JSON logger with trace-id injection and secret-key redaction), per-request API tracing/metrics with correlation-id log binding, spans+metrics on the tool executor and approval decisions, instrumented ticket lifecycle activities with critical-failure metrics, event-consumer dead-letter metrics, AI-run persistence with trace links via `createPersistedRunAiGraph` (materializing the Milestone 10 `approvals.ai_run_id`/`messages.ai_run_id` FK links), `GET /v1/ai-runs*` read endpoints, the QA review surface (list/read/create/complete + composite evidence read) behind new `ai_runs:read`/`qa_reviews:read`/`qa_reviews:write` permissions, a deterministic QA sampling job emitting `support.qa.review_created.v1`, and dashboards/alert definitions under `infra/observability/` with a Prometheus scrape endpoint on the collector. Milestone 12 security and pilot readiness is complete: deny-by-default RBAC with a self-verifying route×role matrix test and a new `reports:read` permission, a shared validating integration-secret resolver (env-var references only), content-level PII redaction in structured logs, an 18-case prompt-injection eval suite with hard-fail gates, inbound attachment size/type validation rejecting before any persistence, a closed audit-action taxonomy (`SupportAuditActionSchema`) with compile-time typing and completeness tests, per-tenant data retention hooks (`tenants.retention_policy` via migration `0004` + a fail-closed retention job auditing `retention.applied`), an idempotent pilot tenant seed (`pnpm db:seed:pilot`, including the global first-party tool definitions), the weekly pilot report (`GET /v1/reports/pilot-weekly`), fail-closed auto-send allowlist controls (an `automation` policy version with kill switch and closed low-risk topic set, `GET /v1/policies/automation`, the workers `evaluateAutoSendEligibility` gate, and a live workflow no-bypass test), and the pilot onboarding + production deployment SOPs (SOPS §1.1, §19). All twelve planned milestones are complete. Milestone 13 production worker entrypoint and ticket persistence is complete (the first V1 launch milestone): production `createOrUpdateTicket`/`runInitialTriage`/`recordInboundMessage` activities over the extended `TicketLifecyclePersistenceStore` (deterministic `tkt_{conversation_id}` create-or-load with SLA due dates from the tenant's active policy and initial-message linking, deterministic keyword triage persisting topic/subtopic/priority/language, duplicate-free inbound reconciliation with the `waiting_customer -> waiting_human` reply transition), the explicit `applyTicketStateTransition` activity persisting every workflow-owned transition with append-only `ticket_events` rows + closed-taxonomy audits, approval expiry (`expireApproval`, `APPROVAL_EXPIRY_MS`-configured wait returned by `createApproval` as history-recorded `expires_in_ms`, `approval.expired` audit action added to the taxonomy, `approval_expired` workflow phase), the `messages.send_status`/`sent_by_type` PostgreSQL enum migration (`0005`), `support.ai_run.completed.v1`/`support.tool_call.completed.v1` emission after every AI graph run, the deterministic TypeScript `createDeterministicRunAiGraph` stand-in (replaced by the Milestone 14 sidecar behind the same `createPersistedRunAiGraph` seam), the production worker entrypoint (`packages/workers/src/main.ts`, `pnpm worker:start`, fail-fast config validation, graceful shutdown), and the committed live end-to-end test (`pnpm test:e2e`: webhook → persisted ticket → deterministic draft → API approval → outbound send → complete audit/event trail, across a worker restart with no duplicates). ADR-0021. Milestone 14 AI runtime service bridge is complete: the Python runtime runs as a FastAPI sidecar under `ai/service/` (`POST /internal/ai/run` behind a bearer token resolved per SecretResolver conventions, `GET /health`, structured JSON logs carrying correlation/trace ids, uv `service` extra, `pnpm ai:service`, a uv-based `ai/Dockerfile` + Compose `ai-service`), the production TypeScript `createHttpRunAiGraph` activity calls it with explicit timeout and full retryable-vs-permanent classification (in-activity transient retries; every sidecar failure becomes a structured `failed` result routed to human — `AI_SIDECAR_UNAVAILABLE`/`AI_SIDECAR_ERROR`/`AI_SIDECAR_UNAUTHORIZED`/`AI_SIDECAR_REJECTED`/`AI_SIDECAR_CONTRACT_ERROR`/`AI_CONTEXT_UNAVAILABLE`) behind the unchanged `createPersistedRunAiGraph` seam, conversation/customer/tenant context loads via `createDatabaseAiGraphContextStore` and tenant automation policy feeds the `RuntimeRequest` (the Milestone 12 bridge), the API exposes `POST /internal/tools/execute` (Milestone 8 envelope, machine-token auth minting the reserved `internal_service` role, `tools:execute_internal` + `kb:search` only) with the Python `HttpToolExecutor`/`HttpRetrieval` adapters calling it and `POST /v1/kb/search` in service mode, the tool registry anchors in-flight runs with `started` ai_runs skeletons that `recordAiRunResult` completes, service-path determinism is proven byte-identical by `service.eval_parity` over the golden suite, and the committed live drive (`pnpm --filter @support/workers test:e2e:service`) covers the sidecar happy path with retrieval/tools over the network plus sidecar-down/sidecar-500 degradation. ADR-0022. Milestone 15 provider-agnostic model layer is code-complete: the config-driven LangChain `ModelProvider` (`ai/runtime/llm.py`, `SUPPORT_LLM_PROVIDER`/`SUPPORT_LLM_MODEL`, deterministic offline default, structured outputs over closed vocabularies, timeout/retry, token+latency+cost capture), versioned prompt files with a frontmatter-validated registry (`ai/runtime/prompts/`), the runtime-reported `model` provenance/usage section persisted onto `ai_runs` end to end, the platform priority unification (`p0`-`p3`), the env-selected TS `Embedder` factory (pilot default OpenAI `text-embedding-3-small`, 1536-dim allowlist) shared by ingestion+retrieval with `embedding_model_id` recording and fail-closed query-time match enforcement (HTTP 409), the retrieval similarity floor + max-context cap, the `scripted` provider proving env-only provider swaps through the full adapter path with all eval gates green, and the opt-in live gate (`python -m evals.live_runner`). The LangGraph engine swap is deferred again with reasons (ADR-0023). Milestone 15 closed live: `evals.live_runner` PASS on `claude-sonnet-5` (golden topic 0.960/routing 1.0, injection rate 1.0, zero unsafe auto-send/leaks) and `claude-opus-4-8`, pilot default `claude-sonnet-5`, plus the real-Claude citation-grounded e2e drive. Milestone 16 real authentication and policy lifecycle is complete (ADR-0024): production JWT auth is the API default — jose/JWKS verification (issuer/audience/expiry with clock tolerance, cached key rotation, RS256-only, uniform 401) at the `readAuthContext` choke point, verified subjects mapped to `users.idp_subject` (migration `0006`) with DB-sourced roles from `user_roles`, server-side tenant membership (tenant-bound users 403 on any other tenant; NULL-tenant platform users span tenants), the trusted-header mode surviving only behind explicit `SUPPORT_AUTH_MODE=insecure-headers` (JWT mode missing issuer/audience fails the boot), and the Milestone 14 machine token checked before user auth in every mode with internal endpoints rejecting user JWTs; the pilot IdP is Clerk (dev instance provisioned, session-token customization adds `aud`+`email`, live smoke verifies a real session token through the real JWKS). Policy lifecycle writes landed behind admin-only `policies:write`: `POST /v1/policies` (header + version-1 draft), `GET|POST /v1/policies/{id}/versions`, `POST /v1/policy-versions/{id}/activate` (single-shot activation stamping approver, stale-draft rejection, same-domain predecessor archival — exactly one active policy per domain), `POST /v1/policies/{id}/archive`, all emitting the reserved `policy.created|activated|archived` audits transactionally, with automation content validated against the closed allowlist ceiling at write and activation (fail-closed to safe defaults after archive); `retention_policy` is surfaced read-only on the tenant contract; the RBAC matrix runs under real RSA-signed JWTs via a local JWKS server with full negative suites (absent/expired/forged/wrong-audience/wrong-issuer/unknown-subject 401s everywhere, non-member 403s, header-spoof and internal-endpoint rejections), and a live-PostgreSQL auth+lifecycle integration suite plus the opt-in Clerk live smoke close the loop.
- Current milestone: Milestone 16 - Real Authentication And Policy Lifecycle is COMPLETE on `feat-milestone16-real-auth-policy-lifecycle` (ADR-0020/ADR-0024): all checklist items and acceptance criteria ticked, including the reworked RBAC matrix under real signed JWTs, the live-PostgreSQL auth + policy-lifecycle integration suite, and the live Clerk smoke (real session token minted via the Clerk Backend API and verified through the real JWKS; the dashboard session-token customization carrying `aud`+`email` confirmed by decoded claims). Clerk keys live in the local gitignored `.env` only. Next: Milestone 17 - Scheduled Jobs And Retention Execution (checklist below). Done in the Milestone 11 session: the new `packages/observability` package (`startTelemetry`/`loadTelemetryConfig` OTLP bootstrap, `createInMemoryTelemetry` test double, `SupportMetrics` port + `SUPPORT_METRIC_NAMES`/`SUPPORT_ATTR` constants, `withSpan`/`getActiveTraceContext`, `createStructuredLogger` with redaction); API request telemetry (`observability.ts` hook: `http.request` spans with correlation attributes, request-log rebinding with `trace_id`/`request_id`/`correlation_id`/`tenant_id`, per-request metrics), telemetry-first `server.ts`, metrics in `approvals.decide` (decision counter + latency + `approval_signal_failed`) and the tool executor (`tool.execute` spans + outcome metrics); shared-schemas AI run/tool call/QA review contracts (`AiRunResponseSchema`, `ToolCallResponseSchema`, `QaReview*` request/response/evidence schemas, defect taxonomy enums); db helpers (`createAiRunQuery`, `completeAiRunByIdQuery`, `aiRunsListQuery`, `toolCallsListQuery`, QA review CRUD + `qaSamplingCandidatesQuery`); API endpoints `GET /v1/ai-runs`(+`/{id}`) and `GET|POST /v1/qa-reviews`, `GET /v1/qa-reviews/{id}`, `POST /v1/qa-reviews/{id}/complete`, `GET /v1/qa-reviews/{id}/evidence` with RBAC + OpenAPI; workers `createPersistedRunAiGraph` + store `recordAiRunResult` (DB + in-memory), `instrumentTicketLifecycleActivities`, event-consumer dead-letter metrics, the deterministic QA sampling job + `emitQaReviewCreatedEvent`, `startWorkersTelemetry`/`createWorkersLogger`; a committed live-PostgreSQL workers integration test (AI-run persist/dedupe, approval FK link, send-once replay, QA sampling); and infra dashboards/alerts + the collector Prometheus exporter.
- Current scope: Core PostgreSQL schema, migration runner, Drizzle schema, tenant-scoped repository query helpers, PostgreSQL RLS, live PostgreSQL repository/RLS execution tests, API request/auth/tenant context middleware placeholders, structured errors, OpenAPI skeleton, role permission checks for current endpoint families, PostgreSQL-backed API integration tests, tenant/customer/ticket list-create-read-update skeleton contracts, conversation/message/policy/KB document metadata/approval/audit event read-list skeleton contracts, ticket audit event list contracts, shared v1 domain event envelope/payload schemas, tenant-aware NATS subject naming, worker-side NATS JetStream publisher plus connection/domain/error stream setup wiring, worker-side NATS JetStream event emit helpers including ticket SLA breach emission, worker-side NATS JetStream consumer base with storage-agnostic idempotency/error handling, local NATS JetStream config, live NATS publish/consume integration coverage, Temporal worker config/runtime scaffold, deterministic ticket lifecycle workflow shell, workflow activity contracts/placeholders including a structured AI graph placeholder, first-response SLA timer breach handling, structured AI failure-to-human routing, workflow-owned domain event emission activity adapter, explicit Temporal activity retry policies, opt-in live Temporal workflow/replay coverage, session harness preflight/handoff checks, approval decision endpoints with workflow signaling and audit, outbound channel adapters/senders, production approval/outbound/audit persistence activities, the shared observability package (tracing/metrics/structured logging ports), API request telemetry, instrumented workflow activities, AI-run persistence with trace links, AI run read endpoints, the QA review surface with composite evidence reads, the deterministic QA sampling job, dashboard/alert definitions, production ticket persistence activities (create-or-load, triage, inbound reconciliation, explicit state transitions with ticket events, approval expiry), the deterministic TypeScript AI graph stand-in, the production worker entrypoint (`pnpm worker:start`), and the committed live end-to-end lifecycle test (`pnpm test:e2e`). The full v1 ticket lifecycle now runs end to end as one process on local infra with the deterministic AI model; the real-AI sidecar, real providers, real auth, and scheduled jobs are Milestones 14-17.
- Default stack: TypeScript API/workers, Python AI runtime, Temporal, LangGraph, PostgreSQL, pgvector, Redis, NATS JetStream, OpenTelemetry.

## Active Harness Guardrails

- Start non-trivial work from a short-lived feature/fix branch. Do not work directly on `main` unless the user explicitly approves direct-main work.
- Run `pnpm harness:preflight` after branching.
- Before ending a coding session, update the active milestone checklist below as well as the session handoff text.
- Run `pnpm harness:handoff` before final response or push.
- Push feature/fix branches by default. Push `main` only when explicitly requested.

## Next Recommended Task

Start Milestone 17 - Scheduled Jobs And Retention Execution (full checklist below):

> Schedule the QA sampling and retention jobs per tenant on Temporal Schedules (daily) with idempotent create-if-missing bootstrap from the worker entrypoint, implement the blob sweeper for cleared raw-payload refs, implement the attachment-purge and AI-run-anonymization retention classes (currently counted-and-reported placeholders; keep fail-closed semantics), add per-run job metrics/logs plus a job-failure alert rule in `infra/observability/alerts.yaml`, and prove it live against local Temporal (schedules fire, a retention run clears refs/sweeps blobs/audits `retention.applied`, QA sampling emits `support.qa.review_created.v1`, re-runs stay idempotent).

Milestone 16 follow-ups to fold into later work (not blockers): the internal machine token stays a static shared secret until the sidecar leaves the internal trust boundary (rotation = env change + restart; Milestone 18 delivers it as a real secret on an internal-only network); auth costs two indexed DB lookups per request — add per-request role caching alongside Milestone 20's rate limiting if pilot load warrants it; the spec's separate policy-version `approve` step is folded into activation (activator = approver) until the Milestone 20 console needs a two-person rule; `integration.credential_changed` and `permission.granted|revoked` remain the last reserved-but-unproduced audit actions (user/role management API is future work); Milestone 18's hardened Compose must inject `SUPPORT_AUTH_ISSUER`/`SUPPORT_AUTH_AUDIENCE` (production Clerk instance) alongside the provider keys; and the console repo (Milestone 20) shares the same Clerk application for reviewer identity.

Milestone 15 follow-ups to fold into later work (not blockers): the OpenAI key is still pending — live real-embedding retrieval quality and the live second-provider `live_runner` re-run land with Milestone 19's live-provider work (the scripted proof already covers plumbing agnosticism); Milestone 18's hardened Compose must inject `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` as real secrets (the Compose ai-service currently passes them through from the host env); the workers' keyword triage still seeds initial topic/priority before the AI graph — replacing it with a classification read from the persisted run is deferred to the reopened-ticket work (Milestone 22, ADR-0023 follow-up); the retrieval similarity floor defaults to 0 — set `SUPPORT_KB_MIN_SIMILARITY` (suggested 0.25 for `text-embedding-3-small`) when real embeddings go live (Milestone 19); the scripted provider cannot judge real draft quality — the LLM-graded rubric is Milestone 21; and `evals.live_runner` prints per-suite reports but does not yet persist them — consider writing run artifacts when Milestone 21's expansion lands.

Milestone 14 follow-ups to fold into later work (not blockers): the runtime's `approval_package` is dropped at the activity boundary until a consumer exists (revisit for the Milestone 20 console); the sidecar's `ai_runs` provenance constants (`AI_SIDECAR_RUN_PROVENANCE`) now serve only as the fallback — since Milestone 15 the runtime result carries its own provenance/usage; the `internal_service` machine token is a single shared static secret until Milestone 16's IdP work (rotation = env change + restart); Compose's `ai-service` defaults to local dev tokens — Milestone 18's hardened profile must override them and move the sidecar onto an internal-only network; and the runtime priority vocabulary was unified to the platform `p0`-`p3` at Milestone 15 (done).

Milestone 13 follow-ups to fold into later work (not blockers): an outbound email subject strategy (still null; threading relies on the RFC 5322 reply headers — Milestone 10 carry-over); arming the next-response/resolution SLA timers (due dates are persisted on the ticket, but the workflow arms only first-response); reopened-conversation semantics (a customer reply after workflow completion starts a fresh run that re-triages the existing ticket — refine at Milestone 22 per ADR-0021); the ASCII-heuristic language detection and keyword triage are Milestone 15 replacements (real model behind the same seams); the store does not enforce the §6.2 transition matrix (workflow-owned sequencing is the guard); and `ticket_events` rows have no read API (audit events are the read surface — add if the console needs them, Milestone 20).

The per-milestone follow-up paragraphs below are retained for provenance; every item in them is absorbed into a Milestone 13-22 checklist.

Milestone 12 follow-ups to fold into later work (not blockers): real token verification in `readAuthContext` (deny-by-default roles landed; token validity is still trusted-header placeholder); the auto-send workflow branch behind `evaluateAutoSendEligibility` with shadow mode first (SOPS §17 ladder — v1 deliberately has no auto-send path); policy write/approve/activate endpoints emitting the reserved `policy.created|activated|archived` audit actions (allowlist changes are ops-applied policy versions until then); blob deletion + anonymization so the retention job can execute the planned attachment/AI-run classes (currently counted-and-reported placeholders); scheduling the retention job alongside QA sampling; surfacing `retention_policy` on the tenant API contract; and post-download attachment size re-checks when binary storage lands.

Milestone 11 follow-ups to fold into later work (not blockers): adopt `@temporalio/interceptors-opentelemetry` for strict parent-child span propagation across the API→Temporal boundary (v1 correlates cross-process spans by `support.correlation_id`/`support.ticket_id` attributes per ADR-0018); ship Prometheus/Grafana (or a hosted backend) in pilot infra and load `infra/observability/` (dashboards + alert rules are definitions-as-code; the collector already exposes the scrape endpoint on `:8889`); emit `support.ai_run.completed.v1`/`support.tool_call.completed.v1` domain events from the workflow (payload schemas already exist); schedule the QA sampling job (currently invoked per tenant from a worker process/script; SOPS §10 documents the cadence); wire `startWorkersTelemetry`/`createWorkersLogger`/`instrumentTicketLifecycleActivities` into the production worker entrypoint when it lands; and add OTLP log export once a log backend exists.

Milestone 10 follow-ups to fold into later work (not blockers): a production worker entrypoint composing `createTicketLifecyclePersistenceActivities` (+ `createDatabaseTicketLifecyclePersistenceStore` + `createHttpOutboundChannelSender`, now also `createPersistedRunAiGraph` + `instrumentTicketLifecycleActivities`) with the remaining placeholder activities into `createTicketLifecycleWorker`; migrating `messages.send_status`/`sent_by_type` from free text to PostgreSQL enums (contracts already exist in shared-schemas); an outbound email subject strategy (currently null — email threading relies on the RFC 5322 reply headers); and approval expiry handling (`expired` status + return-to-queue, BACKEND_SPEC §12). The live-PostgreSQL workers integration test for `createDatabaseTicketLifecyclePersistenceStore` landed in Milestone 11 (`ticket-lifecycle-persistence.integration.test.ts`).

Milestone 9 follow-ups to fold into later work (not blockers): Python dependency management is now provisioned — `uv` is installed, `ai/.python-version` pins uv-managed CPython 3.12, `ai/uv.lock` is committed, the harness runs via `uv run --frozen --project ai`, and the real AI stack installs with `uv sync --project ai --extra llm` (ADR-0016 follow-up). Swap a real LLM `ModelProvider` (LangChain/provider SDK) and, if adopted, the real LangGraph library behind the ports (`ModelProvider`, `RetrievalPort`, `ToolExecutor`) and the graph engine — the seams (ADR-0016); call the live TypeScript tool registry (`packages/api` `POST`-style executor) from the tool-execution node over the network boundary instead of the in-memory Python executor, and call `POST /v1/kb/search` from the retrieval node; wire the Python runtime behind the Temporal `RunAiGraphActivity` placeholder in `packages/workers` (the Python `RuntimeResult` already mirrors `RunAiGraphActivityResult`); expand the golden dataset to the recommended per-category counts in `docs/TEST_STRATEGY.md` §4 and add an LLM-graded draft-quality rubric; and add prompt files with stable IDs/versions (harness §8) once a real model is wired.

Milestone 8 follow-ups to fold into later work (not blockers): a live-PostgreSQL tool registry integration test exercising `createDatabaseToolRegistryStore` audit + idempotency end to end (needs seeded `tool_definitions`, plus `tickets`/`ai_runs` rows for the `tool_calls` FKs); seeding first-party `tool_definitions` rows (global visibility) via a migration/seed so `createDatabaseToolExecutor` resolves them; and, once Milestone 9 exists, wiring the executor's `ToolExecutionContext.grantedPermissions` to the AI runtime policy / RBAC roles instead of a caller-supplied set.

Milestone 6 follow-ups to fold into later slices (not blockers): attachment binary storage + oversize-attachment rejection, HTML sanitization to `body_html_ref`, and supporting multiple tickets per conversation (Milestone 6 wires one lifecycle workflow per conversation with a deterministic `tkt_{conversation_id}` ticket id).

Milestone 7 follow-ups to fold into later work (not blockers): a live-PostgreSQL KB ingestion integration test through the ingestion service (needs a seeded user for `created_by_user_id` FK, or keep it null); a Temporal `KbIngestionWorkflow` driving `load_document`/`chunk_document`/`embed_chunks`/`write_chunks`/`mark_document_active` as activities instead of the synchronous API path; choosing/documenting a production embedding model behind the `Embedder` port and wiring the same instance into both ingestion and retrieval (re-embed if its dimension != 1536); and optionally a similarity-score threshold / max-context-tokens cap on retrieval before the AI runtime consumes it.

## V1 Launch Plan (Milestones 13-22)

All twelve build milestones are complete. Launch engineering is organized into four phases, tracked as Milestones 13-22 below (checklists after Milestone 12). Platform decisions are recorded in ADR-0020: the Temporal `runAiGraph` activity calls the Python runtime as an HTTP sidecar service; model/embedding providers are config-driven behind the existing `ModelProvider`/`Embedder` ports with pilot defaults Anthropic Claude + OpenAI `text-embedding-3-small`; auth is hosted-IdP JWT verification via JWKS (default Clerk); staging/production run on a single VM with a hardened Compose profile; the reviewer console is a separate repository consuming this backend's APIs.

### Phase 1: Run End-To-End (Milestones 13-17)

The system runs as deployable processes with real persistence, real AI, real auth, and unattended jobs — all still on local infra.

- Milestone 13: Production Worker Entrypoint And Ticket Persistence.
- Milestone 14: AI Runtime Service Bridge.
- Milestone 15: Provider-Agnostic Model Layer And Real LLM Default.
- Milestone 16: Real Authentication And Policy Lifecycle.
- Milestone 17: Scheduled Jobs And Retention Execution.

### Phase 2: Deploy (Milestones 18-19)

- Milestone 18: Staging Environment On Hardened Compose.
- Milestone 19: Live Providers And Go-Live Rehearsal.

### Phase 3: Console Enablement (Milestone 20)

- Milestone 20: Console Enablement API. The console UI itself is a separate repository (user-owned track); this repo owes it CORS, queue ergonomics, an approval evidence composite, token-derived reviewer identity, rate limiting, and a published typed client.

### Phase 4: Pilot Readiness And Go-Live (Milestones 21-22)

- Milestone 21: Eval Expansion And Shadow Replay.
- Milestone 22: Pilot Gap-Closing And Go-Live.

Auto-send stays out of v1: the SOPS §17 ladder starts only after pilot QA data supports it, behind the existing `evaluateAutoSendEligibility` gate.

### User-Owned Launch Track (Not Code)

Start immediately (long lead times, parallel to Phase 1):

- [ ] Mailgun account + pilot support domain with SPF/DKIM/DMARC access (used by Milestone 19).
- [ ] Meta Business verification + WhatsApp Cloud API app (weeks of lead time; email go-live does not block on it).
- [ ] IdP account (default Clerk) + application setup (used by Milestone 16 and the console repo).
- [ ] Anthropic + OpenAI API keys with billing (used by Milestone 15).
- [ ] VM provisioning (Hetzner/EC2/DO) + staging/production DNS records + alert notification channel (used by Milestone 18).
- [ ] Pilot client outreach: target D2C brands, pilot contract, success metrics (SOPS §1).
- [ ] Console repository kickoff (consumes the Milestone 20 typed client; IdP shared with Milestone 16).

During Phases 2-4:

- [ ] Collect pilot client KB, refund/cancellation/shipping policies, escalation rules (SOPS §1/§2; feeds Milestones 21-22).
- [ ] Provide sanitized historical tickets for shadow replay (Milestone 21).
- [ ] Reviewer staffing and rota; escalation contacts; on-call owner (Milestone 22 / SOPS §13).
- [ ] Shadow-result review, threshold signoff, and the go/no-go decision (Milestones 21-22).
- [ ] Weekly pilot review cadence scheduled (SOPS §14).

## Session Handoff

### Last Session Summary

- Created feature branch `feat-milestone16-real-auth-policy-lifecycle` from `main` and ran `pnpm harness:preflight`.
- Completed Milestone 16 - Real Authentication And Policy Lifecycle in one coherent branch (all 9 checklist items + 3 acceptance criteria). Contract decisions recorded in ADR-0024 (Clerk confirmed as the pilot IdP, jose/JWKS verification at the `readAuthContext` choke point, DB-sourced roles + membership, static machine token retained with reasons, domain-exclusive policy activation with the approve step folded into activation).
- `packages/api/src/auth.ts` (new): `loadAuthConfig` (`SUPPORT_AUTH_MODE` default `jwt`; JWT mode REQUIRES `SUPPORT_AUTH_ISSUER`+`SUPPORT_AUTH_AUDIENCE` and fails the boot otherwise — no silent fallback to header trust; `SUPPORT_AUTH_JWKS_URL` override, `SUPPORT_AUTH_CLOCK_TOLERANCE_S` validated 0-300 default 60; `insecure-headers` only by explicit opt-in), `createJwksTokenVerifier` (jose `createRemoteJWKSet`+`jwtVerify`: cached JWKS with rate-limited refetch on unknown `kid` = restart-free rotation, issuer/audience/expiry with clock tolerance, RS256 allowlist, tokens without `exp`/`sub` rejected, every failure the same 401), and the `UserDirectory` port + `createDatabaseUserDirectory` (owner connection deliberately — auth precedes tenant selection and NULL-tenant platform users are RLS-invisible; only `active` users resolve; role grants filtered to global-or-home-tenant; `internal_service` can never be a user grant).
- `request-context.ts` reworked: `ResolvedAuth` (`jwt` with verifier+directory | `insecure-headers`) is a REQUIRED option — the caller decides, there is no implicit default; the machine token is checked before user auth in every mode; JWT mode ignores identity headers entirely and enforces tenant membership server-side (tenant-bound user selecting another tenant → 403 before route handlers; NULL tenant = platform-wide); header mode preserves the Milestone 12 deny-by-default rules. `buildApp` gains `auth`/`tokenVerifier`/`userDirectory` options (env-loaded defaults, directory closed on app close); `jose` added to `@support/api`; auth exports on the package barrel.
- DB: migration `0006_user_idp_subject.sql` + schema (`users.idp_subject`, partial unique index); new repo helpers `userByIdpSubjectQuery`/`userRoleGrantsQuery` (deliberately unscoped, documented) and the policy lifecycle queries (`createTenantPolicyQuery`, `createPolicyVersionQuery`, `policyVersionsListQuery`, `policyVersionByIdQuery`, `latestPolicyVersionNumberQuery`, `latestActivatedPolicyVersionQuery`, guarded single-shot `activatePolicyVersionQuery` (`activated_at is null`), `updateTenantPolicyStatusQuery`, `activePoliciesInDomainQuery`); pilot seed accepts `idpSubjects` (`PILOT_SEED_OPS|AGENT|QA_IDP_SUBJECT` in `seed-pilot-run.ts`) to link seeded users to real Clerk identities.
- Policy lifecycle (BACKEND_SPEC §17.8 realized): shared-schemas gain `PolicyVersionResponseSchema` (+resource/list), `PolicyCreateRequestSchema`/`PolicyVersionCreateRequestSchema`/`PolicyCreateResponseSchema`/`PolicyActivationResponseSchema`; services implement create (header `draft` + version-1 draft atomically), listVersions, createVersion (max+1, 409 on archived headers), activateVersion (single-shot stamp of `activated_at`/`approved_by_user_id`, 409 on re-activation and on drafts older than the highest activated version, automation content revalidated, header → `active`, same-domain active predecessors archived with `policy.archived` audits — exactly one active policy per domain), and archive (409 if already archived; archiving the active automation policy fails closed to safe defaults); all audits (`policy.created|activated|archived`, entity_type `policy`, actor the acting user) commit in the same tenant transaction; routes `POST /v1/policies`, `GET|POST /v1/policies/:id/versions`, `POST /v1/policy-versions/:id/activate`, `POST /v1/policies/:id/archive` behind the new admin-only `policies:write` permission; OpenAPI paths + components (+ `bearerFormat: JWT` and the Tenant `retention_policy` property); `TenantResponseSchema`/`mapTenant` surface `retention_policy` read-only.
- RBAC matrix reworked under real tokens: per-suite RSA key pair served from a local JWKS HTTP server, tokens minted with jose and verified by the production `createJwksTokenVerifier`; catalog gains the five policy-lifecycle routes; new invariants (policies:write admin-only) and negative suites — absent/expired/forged/wrong-audience tokens 401 on EVERY catalogued route, wrong-issuer/expiry-less/unknown-subject 401, valid non-member token 403 on every tenant-scoped route, platform (NULL-tenant) user spans tenants, identity headers ignored under JWT (support_agent token + platform_admin headers still 403 on tenant create), user JWTs rejected on `/internal/tools/execute`.
- Tests: new `auth.test.ts` (config loader incl. fail-fast + opt-in; verifier subject/email/clock-tolerance/uniform-401 against a live local JWKS; request flow with stub verifier: membership 403, no-roles 403-not-401, unprovisioned 401, health public); new committed `auth.integration.test.ts` (live PostgreSQL, in `test:integration`): real tokens through the DATABASE user directory (idp_subject resolution, DB-sourced roles, suspended/unprovisioned 401, membership both directions, platform user, `retention_policy` surfaced) plus the full policy lifecycle live (create/version/activate with audits attributed to the acting user, immutability 409s, predecessor archival, effective-automation flip and fail-closed archive, version list) — 5/5 PASS this session; new opt-in `auth.clerk-live.integration.test.ts` (`RUN_CLERK_LIVE_TESTS=true`): mints a real Clerk session token via the Backend API and verifies it through the production JWKS path — 1/1 PASS live this session (plus non-member 403 and tampered-token 401). Business-logic suites opt into `SUPPORT_AUTH_MODE=insecure-headers` explicitly (app.test.ts env line; explicit `auth` option in webhooks/internal-routes/app.integration and both workers e2e suites); app.test.ts gains the policy-lifecycle endpoint contract tests + tenant `retention_policy` assertion; seed-pilot/migrations/shared-schemas suites extended.
- Docs: BACKEND_SPEC §3.2 (idp_subject + membership), §8.2 (immutability/domain-exclusive rules), §13 (policy.\* producers live), §17.0 (JWT auth contract rewrite + policies:write + real-token matrix note), §17.8 (implemented lifecycle semantics), §22 (retention_policy surfaced); SOPS §1.1 (Clerk app setup + per-user provisioning + live check) + §3 (v1 lifecycle implementation note); TEST_STRATEGY §3.2 Milestone 16 real-auth coverage + §3.6 policy-lifecycle coverage; DECISIONS ADR-0024; README (auth section, endpoint list, status); PROJECT_HISTORY (Current State M15+M16 bullets, verification, next task); `.env.example` (auth vars + seed link vars + Clerk key note); this file.

Previous session (Milestone 15):

- Created feature branch `feat-milestone15-provider-model-layer` from `main` and ran `pnpm harness:preflight`.
- Implemented Milestone 15 - Provider-Agnostic Model Layer And Real LLM Default to code-complete (9 of 11 checklist items + 1 of 3 acceptance criteria ticked; the remaining two of each are the live runs blocked ONLY on the user-owned `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`). Contract decisions recorded in ADR-0023 (config-selected LangChain adapter, scripted-provider agnosticism proof, LangGraph engine deferred again, runtime-reported provenance, metadata-based embedding-space enforcement, platform priority unification).
- `ai/runtime/llm.py` (new): `load_llm_config`/`collect_llm_config` (stdlib env loader — `SUPPORT_LLM_PROVIDER` unset → deterministic; provider-specific key-ref defaults `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` per SecretResolver conventions; timeout/retries/temperature/price overrides validated fail-fast); `LangChainSupportModel` over `init_chat_model` (lazy import; renders the versioned prompt files as system instructions + fenced-JSON input block, enforces structured outputs via `with_structured_output` with closed-vocabulary JSON schemas, per-call timeout + SDK transport retries + one in-adapter parse-repair attempt, per-call `ModelMetadata` with tokens/latency/cost from a built-in per-model price table with env overrides; temperature only sent when explicitly configured — current Claude models reject non-default sampling params); `ScriptedSupportChatModel` (stdlib chat-model stand-in running the deterministic rules through the SAME adapter path — the offline provider-agnosticism proof) and `build_model_provider` selecting deterministic/scripted/real by env.
- `ai/runtime/prompts/` (new): `support_classifier.v1.md` + `support_response_composer.v1.md` (real-model prompts: controlled vocabularies, grounding/no-unsafe-promise rules mirroring the guardrails, injection-as-data handling, platform priorities with `p0` operator-reserved) behind a frontmatter-validated registry (`load_prompt`, `KNOWN_PROMPT_IDS`; shipped versions are never edited in place).
- Runtime metadata end to end: `RunTrace` gains `record_usage`/`model_usage()` aggregation; nodes record usage on both model calls; `RuntimeResult` (and its wire JSON) gains a `model` section (provider, model_id, prompt_versions, calls, input/output tokens, latency_ms, cost_estimate) on succeeded AND failed runs; `AiRuntimeModelUsageSchema` (optional/nullable) added to `AiRuntimeRunResultSchema` in shared-schemas; `createHttpRunAiGraph` maps it through; `createPersistedRunAiGraph` prefers it over the static provenance (which stays as the TS stand-in/old-sidecar fallback) and persists `ai_runs.input_tokens`/`output_tokens`/`cost_estimate` with `prompt_version` = sorted prompt ids (`formatPromptVersions`).
- Priority unification: runtime `PRIORITIES` is now the platform `p0`-`p3` (p4 dropped; deterministic model unchanged semantically — it emits p1-p3; classifier schema enum `p1`-`p3` with p0 reserved); stale `p1-p4` contract comments updated in shared-schemas/http-ai-graph.
- Service wiring: `ServiceConfig` embeds the `LlmConfig` (all config problems reported in one boot error); `create_app` resolves the model provider once at startup (ports_factory still wins for tests/parity); `GET /health` reports `model_provider`; `ai/Dockerfile` + root `ai:service` unchanged run path, image now ships `--extra llm` so real-provider activation is config-only; Compose `ai-service` passes through `SUPPORT_LLM_PROVIDER`/`SUPPORT_LLM_MODEL`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`; `ai/pyproject.toml` `llm` extra now includes `langchain` + `langchain-anthropic` + `langchain-openai` (lock updated, install verified).
- Evals: `run_eval` gains `model_factory` (deterministic default; one instance reused across cases), `run_injection_suite` passes it through; new opt-in `evals/live_runner.py` runs golden + injection against the env-configured provider with the unchanged hard-fail gates and non-zero exit on violation; scripted-provider run verified green end to end (25 golden + 18 injection, all gates PASS); `service.eval_parity` still byte-identical.
- `packages/integrations`: `Embedder` port gains `modelId` (`DETERMINISTIC_EMBEDDER_MODEL_ID = deterministic-fnv1a-1536`); new `createOpenAiEmbedder` (allowlisted 1536-dim-capable models — `text-embedding-3-small`/`-3-large` with explicit `dimensions: 1536`, `ada-002` without; bearer fetch with bounded 429/5xx/transport retries, permanent 4xx, index re-ordering, dimension validation, empty-batch short-circuit) and `createEmbedderFromEnv` (`SUPPORT_EMBEDDING_PROVIDER` unset/deterministic → offline default; `openai` requires the key via `SUPPORT_EMBEDDING_API_KEY_REF` → default `OPENAI_API_KEY`).
- `packages/api`: ingestion stamps `embedding_model_id` into chunk metadata (jsonb — no migration); retrieval enforces the ingestion/retrieval embedding-space match at query time (`EmbeddingModelMismatchError`; missing id = legacy deterministic) surfaced as HTTP 409 CONFLICT by the search endpoint (the sidecar's retrieval adapter already degrades any non-200 to a human-routed failed run); the similarity floor (`SUPPORT_KB_MIN_SIMILARITY`, default 0) and max-context cap (`SUPPORT_KB_MAX_CONTEXT_CHARS`, default 24000 chars, top hit always kept) run in `createKbRetrievalService` before results reach the AI runtime; `createDatabaseKbIngestionService`/`createDatabaseKbRetrievalService` accept an injected embedder and `createDatabaseApiServices` builds ONE `createEmbedderFromEnv` instance shared by both (ADR-0014 follow-up closed).
- Tests: new `ai/runtime/llm_test.py` (25: config loader, prompt registry, scripted-adapter parity with the deterministic rules, full-graph run with usage capture + reproducible deterministic `model` section, parse-retry/persistent-failure, cost table/overrides, priority schema vocabulary); new `packages/integrations/src/kb/embedder-factory.test.ts` (16: factory selection/validation + OpenAI embedder wire behavior); `kb-retrieval.test.ts` +5 (model-id recording, floor, cap, fail-closed mismatch, legacy chunks); `ticket-lifecycle-persistence.test.ts` +2 (usage-preferred provenance, fallback); `http-ai-graph.test.ts` carries the wire `model` section; `app_test.py` updated for the `model` result key + health `model_provider`. Suites: 139 Python, all TS packages green, `pnpm typecheck` green.
- Closed the milestone live (same session, user-provided Anthropic key in the gitignored local `.env` only — NEVER committed): ran `evals.live_runner` against `claude-sonnet-5` (golden 25 PASS topic 0.960/routing 1.0; injection 18 PASS rate 1.0; all zero-counts) and `claude-opus-4-8` (both suites PASS; conservatively human-routes the allowlisted auto-send case); recorded `claude-sonnet-5` as the pilot default. Added the sidecar e2e's opt-in real-model mode (`E2E_AI_REAL_PROVIDER`/`E2E_AI_REAL_MODEL`: sidecar spawned with `--extra llm` + provider env; real-provenance/token/cost/prompt-version assertions + draft surfaced in output) — 3/3 PASS live with real Claude and 3/3 in the deterministic default mode. The live runs exposed that provider tool-calling does not hard-enforce nested schema enums, so the adapter gained deterministic post-parse normalization (`normalize_model_output`: only provided ref_ids may be cited, citation `type` derived from the real document_type, confidences clamped; +4 tests, verified on a live call). Total spend for all live runs: a few dollars.
- Docs: AI_RUNTIME_HARNESS §8 (prompt files realized) / §9 (adapter note) / §20.2 (provider resolved at startup) / new §21 (config table, adapter behavior, scripted proof, live gate); BACKEND_SPEC §9 Milestone 15 embedding note; TEST_STRATEGY §3.10 Milestone 15 coverage; SOPS §11.1 (LLM swap gate) + §11.2 (embedding swap = re-embed); DECISIONS ADR-0023; README (provider section, layout note); AGENTS.md (live-gate command, uv note); `.env.example` (LLM/embedding/retrieval-bounds vars with pilot defaults); this file.

Previous session (Milestone 14):

- Created feature branch `feat-milestone14-ai-runtime-service-bridge` from `main` and ran `pnpm harness:preflight`.
- Completed Milestone 14 - AI Runtime Service Bridge in one coherent branch (all 11 checklist items + 3 acceptance criteria) — the ADR-0020 sidecar decision realized. Recorded the contract decisions in ADR-0022 (200-for-domain-failures, never-throw activity, reserved-role machine auth, activity-side context loading, proven parity).
- `packages/shared-schemas`: new `internal_service` role (reserved — rejected when claimed via `x-user-roles`); `InternalToolExecuteRequestSchema`/`InternalToolExecuteResponseSchema` (the Milestone 8 envelope wrapped with `tenant_id`/`ticket_id`/`ai_run_id`/`granted_permissions`); the sidecar wire contracts `AiRuntimeRunRequestSchema` (strict mirror of the Python `RuntimeRequest`, nested customer/tenant/policy/options sections) and `AiRuntimeRunResultSchema` (succeeded/failed discriminated union with typed routing decision/draft/final recommendation), plus `AiRiskLevelSchema` and exported types.
- `packages/api`: `internal-auth.ts` (`loadInternalAuthConfig` reading `SUPPORT_INTERNAL_API_TOKEN_REF` → default ref `SUPPORT_INTERNAL_API_TOKEN`, fail-fast on malformed refs, disabled/fail-closed when unset; constant-time `isInternalServiceToken` over sha256 digests; actor `svc:ai-runtime`); `request-context.ts` mints the machine actor on a token match and rejects header-claimed `internal_service`; `rbac.ts` adds `tools:execute_internal` granted only to `internal_service` (with `kb:search`); `internal-routes.ts` registers `POST /internal/tools/execute` (auth → permission → strict body → `createDatabaseToolExecutor` → envelope out; all tool outcomes are HTTP 200, HTTP errors reserved for 401/403/400); `buildApp` gains `toolExecutor`/`internalAuth` options with lifecycle close; OpenAPI documents the internal route + tool envelope components; `tool-registry.ts` `createDatabaseToolRegistryStore.recordStart` now anchors in-flight runs — when `tool_calls.ai_run_id` references a run the worker has not persisted yet (the bridge executes tools mid-run), it inserts a `started` skeleton `ai_runs` row (conversation resolved from the ticket, provenance `unrecorded`) inside the same RLS transaction.
- `ai/service/` (new, uv `service` extra: fastapi/uvicorn/httpx; `ai/uv.lock` updated): `config.py` (fail-fast env config, SecretResolver ref conventions: `SUPPORT_AI_SERVICE_TOKEN_REF`→token, `SUPPORT_AI_SERVICE_MODE` local|service, `SUPPORT_API_BASE_URL` + `SUPPORT_API_TOKEN_REF` in service mode, `SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS`), `logs.py` (structured JSON lines: service `ai-runtime`, correlation/trace/tenant/ticket/ai_run ids, outcomes only — never content), `http.py` (stdlib urllib post seam), `request_parsing.py` (strict stdlib parser mirroring the zod request schema; unknown keys rejected at every level), `adapters.py` (`HttpToolExecutor` — never raises, transport/non-200/malformed → failed `tool_error`; `HttpRetrieval` — Evidence mapping mirroring `InMemoryRetrieval` (same `deterministic_id` derivation, type rule, 400-char excerpt; `policy_version_id` from chunk metadata), `RetrievalUnavailableError` routes to human via the graph), `app.py` (`create_app` factory: `GET /health` unauthenticated; `POST /internal/ai/run` constant-time bearer → 401, contract violations → 400, both succeeded and failed runs → 200 with `RuntimeResult.to_dict()` verbatim, one structured log line per run, injectable ports factory for tests/evals), `eval_parity.py` (`python -m service.eval_parity`: every golden case run in-process AND through the service path with byte-identical JSON required, then the full eval gates through the service; `run_eval` gained a backwards-compatible keyword-only `invoke` param).
- `packages/workers`: `activities/ai-graph-context.ts` (`AiGraphContextStore` + database/in-memory impls: conversation messages → runtime roles under RLS with chronological order, customer context incl. metadata-driven VIP tier, tenant brand/timezone); `activities/http-ai-graph.ts` (`createHttpRunAiGraph`: builds the zod-validated `RuntimeRequest` from workflow input + context + `createDatabaseAutomationPolicyStore` (`auto_send_allowed_topics`, `allow_auto_send`, active policy version ids — the Milestone 12 bridge), posts with `AbortSignal.timeout`, forwards `x-correlation-id`/`x-trace-id`, retries transient transport/5xx in-activity with backoff, classifies every failure into structured `failed` results — `AI_SIDECAR_UNAVAILABLE`/`AI_SIDECAR_ERROR` retryable, `AI_SIDECAR_UNAUTHORIZED`/`AI_SIDECAR_REJECTED`/`AI_SIDECAR_CONTRACT_ERROR`/`AI_CONTEXT_UNAVAILABLE` permanent — and never throws for sidecar problems so the workflow never fails and every run is persisted/audited; ticket priority stays authoritative in the typed routing decision, `approval_package` is dropped at the boundary); `worker-runtime.ts` (fail-fast `AI_RUNTIME_SERVICE_URL`/`AI_RUNTIME_SERVICE_TOKEN_REF` (default `SUPPORT_AI_SERVICE_TOKEN`)/`AI_RUNTIME_SERVICE_TIMEOUT_MS` validation; sidecar-configured runtimes compose `createHttpRunAiGraph` + the two stores behind the unchanged `createPersistedRunAiGraph` with `AI_SIDECAR_RUN_PROVENANCE` (`deterministic-support-v1`), unset keeps the deterministic stand-in; store lifecycle on shutdown); `createPersistedRunAiGraph` gained optional `provenance` and `recordAiRunResult` now completes a pre-existing (anchor or retried) row with the terminal outcome via `completeAiRunByIdQuery` instead of silently skipping.
- Infra/run path: `ai/Dockerfile` (uv-based image, dependency layer from the lockfile, uvicorn `--factory service.app:create_app` on 8090), Compose `ai-service` (service mode, host-gateway back to the host API, healthcheck, local-dev default tokens), `.env.example` (`AI_RUNTIME_SERVICE_URL`, `SUPPORT_AI_SERVICE_TOKEN`, `SUPPORT_INTERNAL_API_TOKEN` + ref conventions), root scripts `ai:service` and `test:py`/`lint` now running with `--extra service`.
- Committed live e2e test (`e2e-ai-service-bridge.integration.test.ts`, `pnpm --filter @support/workers test:e2e:service`, gated by `RUN_AI_SERVICE_E2E_TESTS` + `DATABASE_URL`): spawns the sidecar via uv, listens the real API on a random port with the machine token, seeds + ingests a KB document and the global tool definitions, then drives (1) the happy path — webhook → ticket `waiting_human` with the AI decision made in the Python process (`ai_runs` row `modelId: deterministic-support-v1` with `trace_` link), retrieval over `POST /v1/kb/search` (evidence surfaced in the run), tools over `POST /internal/tools/execute` (audited `tool_calls` rows linked to the run), approval → exactly one send → `waiting_customer`; (2) sidecar-down — audited failed run `AI_SIDECAR_UNAVAILABLE` (retryable), `ai_graph.failed` audit, pending approval still gating; (3) sidecar-500 — `AI_SIDECAR_ERROR`, same human routing.
- Tests added: workers `http-ai-graph.test.ts` (14: request shape/auth/correlation/policy feed, success mapping, transient retry + exhaustion, every failure class, context-missing short-circuit) + `worker-runtime.test.ts` sidecar config cases; api `internal-routes.test.ts` (auth negatives incl. reserved-role rejection and fail-closed unset token, envelope passthrough for blocked results, machine actor scope on `/v1` routes) + rbac-matrix machine-role integration; shared-schemas bridge-contract cases; Python `config_test`/`request_parsing_test`/`adapters_test` (incl. Evidence parity with `InMemoryRetrieval`)/`app_test`/`eval_parity_test` (fastapi-gated tests skip without the extra).
- Docs: BACKEND_SPEC §2.3 sidecar implementation note + new §17.16 Internal Service Endpoints; AI_RUNTIME_HARNESS §4 note + new §20 Service Bridge (endpoints/auth, modes/adapters, activity classification, correlation/logs, run + parity commands); TEST_STRATEGY §3.10 bridge coverage + commands (uv `--extra service`, e2e drives); DECISIONS ADR-0022; README (ai:service, sidecar section, Compose service list, layout); AGENTS.md commands; PROJECT_HISTORY; this file.
- Completed Milestone 13 - Production Worker Entrypoint And Ticket Persistence in one coherent branch (all 10 checklist items + 3 acceptance criteria) — the first V1 launch milestone. Recorded the approach in ADR-0021 (explicit transition activity, history-recorded approval expiry, deterministic TS AI stand-in).
- `packages/shared-schemas`: added `approval.expired` to the closed `SupportAuditActionSchema` taxonomy; exported the `AiRunCompletedEventPayload`/`ToolCallCompletedEventPayload` types (schemas already existed).
- `packages/db`: migration `0005_message_send_status_enums.sql` converts `messages.send_status`/`sent_by_type` to PostgreSQL enums (`message_send_status`, `message_sent_by_type`; schema.ts columns now `pgEnum`, `TicketEvent`/`NewTicketEvent` types exported); new repository queries `createTicketIfAbsentQuery` (conflict-safe deterministic-id creation), `activeSlaPolicyForTenantQuery`, `createTicketEventQuery` (append-only, conflict-safe), `ticketEventsForTicketQuery`, and `linkMessageToTicketByIdQuery` (guarded: unlinked or same-ticket replay only) with SQL-shape tests.
- `packages/workers` ticket persistence: `TicketLifecyclePersistenceStore` gained `createOrLoadTicket`, `recordInboundMessage`, `getInboundMessageForTriage`, `applyInitialTriage`, `applyTicketStateTransition`, and `expireApproval` (DB impl under `withTenantTransaction`/RLS + in-memory mirror with new `slaPolicies`/`inboundMessages`/`tickets` fixtures and `listTickets`/`listTicketEvents`/`listInboundMessages` inspectors). `createTicketLifecyclePersistenceActivities` now returns the production `createOrUpdateTicket` (derives the conversation from the `tkt_{conversation_id}` id, stamps SLA due dates from the tenant's active policy, links the initial message, audits `ticket.created` + `ticket_events`), `runInitialTriage` (pure `classifyInitialTriage` keyword classifier in `src/triage.ts` mirroring the Python deterministic model's topics/sensitive flags; persists topic/subtopic/priority/language, `new -> triaged`, escalates priority but never lowers it, routes hard-sensitive text to manual escalation), `recordInboundMessage` (reconciles intake-persisted rows onto the ticket, no duplicates, `waiting_customer -> waiting_human` on customer reply, graceful skip when the ticket row does not exist yet, `NonRetryableActivityError` on cross-ticket links), `applyTicketStateTransition` (idempotent via current-status no-op + deterministic `tev_`/`aud_` ids keyed by `transition_key`; `ticket.closed` audit action for closed, else `ticket.updated`; stamps `resolved_at`/`closed_at`), and `expireApproval` (pending-guarded `pending -> expired` reusing the decide path's guard, `approval.expired` audit, idempotent retry replay, reviewer decisions win races).
- Workflow (`ticket-lifecycle-workflow.ts`): calls `applyTicketStateTransition` at every state change (`waiting_human` on the triage manual-escalation branch, `waiting_ai` before `runAiGraph`, `waiting_human` after `createApproval`, `waiting_customer` after the outbound send, `closed` on close request — the close path also emits `support.ticket.closed.v1`); emits `support.ai_run.completed.v1` after every AI graph result (failed runs included; deterministic run id backfilled by `createPersistedRunAiGraph`) plus one `support.tool_call.completed.v1` per executed tool call; `createApproval` returns `expires_in_ms` (from `APPROVAL_EXPIRY_MS`, default 24h, non-positive disables) and the approval wait is now a three-way race (decision signals vs first-response SLA deadline vs expiry deadline, absolute workflow-clock timestamps; SLA wins ties). On expiry the workflow calls `expireApproval` — if a reviewer decision won the race it resumes waiting for the signal; otherwise it ends in the new `approval_expired` phase with the ticket left in `waiting_human`. New `EmitAiRunCompletedDomainEventInput`/`EmitToolCallCompletedDomainEventInput` union variants, dispatch cases, and `buildAiRunCompletedEvent`/`emitAiRunCompletedEvent` + tool-call helpers in `domain-events.ts`; `instrumentTicketLifecycleActivities` wraps the two new activities.
- Deterministic AI stand-in: `createDeterministicRunAiGraph` (`activities/deterministic-ai-graph.ts`) — templated commitment-free drafts per triage topic, always `human_approve`, no tools, medium risk for refund/cancellation, deterministic `air_` id, trace id from the active span; explicitly the Milestone 14 sidecar's replacement target behind the unchanged `createPersistedRunAiGraph` seam.
- Production worker entrypoint: `worker-runtime.ts` (`loadTicketLifecycleWorkerRuntimeConfig` fail-fast env validation reporting every problem at once — required `DATABASE_URL`, Temporal overrides, `APPROVAL_EXPIRY_MS`; `startTicketLifecycleWorkerRuntime` composes NATS event bus with idempotent stream provisioning, the database store, the HTTP outbound sender, the persisted deterministic AI graph, and full instrumentation into `createTicketLifecycleWorker`, returning `run()`/`shutdown()` with drain-and-close semantics) + `main.ts` (telemetry-first bootstrap, SIGINT/SIGTERM graceful shutdown) + `pnpm --filter @support/workers start` / root `pnpm worker:start`. `ticketLifecycleWorkflowsPath` now falls back to the `.ts` module when no compiled output exists (tsx/vitest runs). `packages/api` gained an `index.ts` entry (`buildApp` export + `exports` field) so the e2e test composes the real app.
- Committed live e2e test (`e2e-ticket-lifecycle.integration.test.ts`, `pnpm test:e2e`, gated by `RUN_E2E_TICKET_LIFECYCLE_TESTS` + `DATABASE_URL`): signed Mailgun webhook → real API intake → running worker entrypoint (stubbed provider fetch through the real HTTP sender) → asserts persisted ticket (status/priority/topic/language/SLA), ordered ticket events (`null->new->triaged->waiting_ai->waiting_human`), deterministic AI run + approval FK link, follow-up message reconciliation onto the same ticket, intake dedup of duplicate deliveries, worker restart mid-workflow, API approve → workflow signal → exactly one provider send (Mailgun URL/basic-auth asserted), `waiting_customer` final status via `GET /v1/tickets/{id}`, complete audit trail, and the JetStream domain events (`ticket.created`, `ticket.triaged`, `ai_run.completed`, `message.sent`).
- Tests: new suites `triage.test.ts` (10), `deterministic-ai-graph.test.ts` (3), `worker-runtime.test.ts` (4 config), `ticket-state-persistence.test.ts` (16 across the six new store/activity behaviors); `audit-completeness.test.ts` extended to drive the new producers (`ticket.created`, `ticket.updated`, `ticket.closed`, `approval.expired`); `domain-events.test.ts` covers the two new events; workflow suite updated for the new call orders + 3 new live tests (approval expiry → `approval_expired`, reviewer-beats-expiry resume, close request with persisted transition + `ticket.closed.v1` event).
- Docs: BACKEND_SPEC §2.2 (worker entrypoint), §5.2 (message enums), §6.3 (ticket persistence + transitions), §7 (SLA due-date stamping), §12 (approval expiry), §13 (new audit producers); README (worker:start + test:e2e commands and env notes); DECISIONS ADR-0021; PROJECT_HISTORY; this file.
- Planning session on `docs-v1-launch-plan` (docs only, no app code): designed the V1 launch plan — four phases, Milestones 13-22 — by consolidating the accumulated milestone follow-ups, and recorded it in this file (V1 Launch Plan section + Milestone 13-22 checklists + refreshed Active Blockers/Open Questions), `PLAN.md` (§17 V1 Launch Phases), `docs/DECISIONS.md` (ADR-0020), `docs/PROJECT_HISTORY.md`, and `README.md`.
- Platform decisions locked with the user (ADR-0020): (1) the Temporal `runAiGraph` activity calls the Python runtime as an HTTP sidecar (FastAPI `POST /internal/ai/run`, internal bearer token) so `createPersistedRunAiGraph`/instrumentation stay unchanged; (2) model/embedding providers are config-driven behind the existing `ModelProvider`/`Embedder` ports — pilot defaults Anthropic Claude + OpenAI `text-embedding-3-small`, 1536-dim standard, provider swap = config change + eval-gate re-run, embedding swap additionally = full re-embed; (3) auth is hosted-IdP JWT verification via JWKS (default Clerk) with DB-sourced roles and server-side tenant membership; (4) staging/production is a single VM running a hardened Compose profile with offsite backups and tested rollback; (5) the reviewer console is a separate repository — Milestone 20 provides its API surface.
- Created feature branch `feat-milestone12-security-pilot-readiness` from `main` and ran `pnpm harness:preflight`.
- Completed Milestone 12 - Security And Pilot Readiness in one coherent branch (all 12 checklist items + 4 acceptance criteria) — the final planned milestone. Recorded the approach in ADR-0019 (security controls fail closed).
- `packages/api` RBAC: removed the implicit `support_agent` role fallback in `request-context.ts` (`parseRoles` now throws `401 AUTH_REQUIRED` for missing/blank/unparseable `x-user-roles` — deny-by-default), exported `ROLE_PERMISSIONS` from `rbac.ts` as the single source of truth, added the `reports:read` permission (platform_admin, ops_admin, qa_reviewer, client_viewer), and added `rbac-matrix.test.ts`: an `onRoute` collector proves every registered route is in a permission catalog, then a full route×role matrix asserts `403` exactly when the role lacks the documented permission plus `401` for role-less requests (8 tests, ~260 assertions).
- Integration secret handling: new shared `SecretResolver` in `packages/integrations/src/secrets.ts` (`createEnvSecretResolver`, `createStaticSecretResolver`, `isValidSecretRef` requiring `^[A-Z][A-Z0-9_]*$` before the environment is read); `createEnvWebhookSecretResolver` (api) and `createEnvOutboundCredentialResolver` (workers) now delegate to it; negative tests prove malformed references never touch process state.
- PII redaction: `packages/observability` logger now scrubs string content — emails, phone numbers (10-15 digits, separator-tolerant), and card-like 13-19 digit runs → `[REDACTED_EMAIL]`/`[REDACTED_PHONE]`/`[REDACTED_NUMBER]` — across fields, nested objects, arrays, and the log message itself; key-based secret redaction is unchanged and non-disableable; `redactPii: false` opts out of the content layer only; boundary guards keep trace ids/UUIDs/ISO timestamps/versions intact (44 observability tests).
- Prompt-injection suite: `ai/evals/injection_suite.py` + `injection_suite_test.py` — 15 user-text injection cases (direct override, system-prompt exfiltration, embedded in refund/order-status requests, role-play/developer-mode jailbreaks, override-policy/forget-instructions, tool-abuse "$500 refund", auto-send-enabled + allowlisted hijack attempts, multi-message late injection, injection buried in polite text) and 3 KB-content injection cases against a poisoned corpus (`build_adversarial_documents`), run through `run_eval` (which gained an optional backwards-compatible `documents` param); all hard-fail gates green (`prompt_injection_pass_rate == 1.0`, zero unsafe auto-send/output/leaks). `ai/evals/README.md` documents the suite and its governance-under-detection scope.
- Attachment validation: pure `validateInboundAttachments`/`DEFAULT_ATTACHMENT_VALIDATION_POLICY` in `packages/integrations/src/channels/attachment-validation.ts` (10 MiB cap, content-type allowlist excluding executables/HTML/octet-stream, filename traversal/control-char/length checks, 10-attachment bound, null-size accepted pending binary download); enforced at the top of `ingestNormalizedMessage` so a rejected message creates no customer/conversation/message and never signals the workflow; `InboundWebhookMessageResultSchema`/`InboundWebhookAcceptedResponseSchema` gained `rejected`/`rejection_reason` + a `rejected` count so providers get a 202, not a retry-provoking error.
- Audit completeness: `SupportAuditActionSchema` (closed taxonomy incl. reserved `policy.*`, `integration.credential_changed`, `permission.*` actions) in shared-schemas; `RecordAuditEventActivityInput.action`/`AppendAuditEventInput.action` typed to it (compile-time enforcement); the API decide path validates `approval.{status}` against it at runtime; `packages/workers/src/audit-completeness.test.ts` drives every live producer (approval.requested, message.send_failed via a permanent send failure, the six workflow actions, retention.applied) and asserts canonical membership.
- Data retention: migration `0004_tenant_retention_policy.sql` adds `tenants.retention_policy` jsonb; `TenantRetentionPolicySchema` (raw_payload/attachment/ai_run/audit_event days, absent = keep forever); `packages/workers/src/retention.ts` — `computeRetentionCutoffs`, `runTenantRetentionJob`, `createDatabaseRetentionStore` (RLS) + in-memory store — clears expired `messages.raw_payload_ref` in bounded batches, returns cleared refs for the blob sweeper, audits `retention.applied` (deterministic id), counts attachment/AI-run purges as placeholders, fails closed on missing/malformed config (6 tests + live drive).
- Pilot seed: `packages/db/src/seed-pilot.ts` (`buildPilotSeedPlan`/`applyPilotSeed`, all inserts `onConflictDoNothing`) + `seed-pilot-run.ts` CLI wired as `pnpm db:seed:pilot`; seeds tenant (with retention policy), 6 global roles, 3 users + role links, mailgun channel with env-ref secrets, active SLA policy, refunds/escalation/automation policies + activated v1 versions (automation content = auto-send disabled, empty allowlist), and the six global first-party `tool_definitions` (closing the Milestone 8 seeding follow-up); 7 plan unit tests (determinism, no plaintext secrets, contract-valid content).
- Weekly report: thirteen aggregate query builders in `packages/db/src/repositories.ts` (tickets created/resolved stats, first-response average via a grouped outbound subquery join, audit action counts, AI run status counts + drafted-tickets distinct count, approval requested/resolution counts, outbound send/sent-by-type counts, QA created/completed-with-defects, top topics) + `services.reports.weekly` assembling `WeeklyPilotReportSchema` in one RLS transaction; `GET /v1/reports/pilot-weekly` behind `reports:read` with optional `since`/`until` (400 on inverted windows; rates null on zero denominators).
- Auto-send allowlist controls: shared `AutoSendTopicSchema` (`faq | order_status` — the contract-level ceiling) + `AutomationPolicyContentSchema` (kill switch + allowlist) + `EffectiveAutomationPolicyResponseSchema`; `activeAutomationPolicyVersionQuery` in db; `GET /v1/policies/automation` resolving fail-closed (no/inactive/malformed policy → disabled defaults); `packages/workers/src/automation-policy.ts` — `createDatabaseAutomationPolicyStore`/`createInMemoryAutomationPolicyStore`, `DISABLED_AUTOMATION_POLICY`, and `evaluateAutoSendEligibility` (kill switch → succeeded → explicit auto_send recommendation → low risk → guardrails passed → draft present → allowlisted topic; 8 tests); new live Temporal workflow test proves an `auto_send` recommendation still parks in `waiting_for_approval` with no send until the human signal; golden case `auto_2` proves a tenant-allowlisted `refund` cannot auto-send.
- SOPs/docs: SOPS §1.1 (pilot onboarding v1 implementation), §16 (data handling implementation: two-layer redaction, retention job runbook, secret refs), §17 (auto-send controls implementation + kill switch), §19 (production deployment checklist); BACKEND_SPEC §4.2/§13/§17.0/§17.8/§17.15/§22 implementation notes; TEST_STRATEGY §3.2/§3.3/§3.12/§4 coverage notes; AI_RUNTIME_HARNESS injection-suite note; DECISIONS ADR-0019; PROJECT_HISTORY; README; this file.
- Completed Milestone 11 - Observability And QA in one coherent branch (all 12 checklist items + 3 acceptance criteria). Recorded the approach in ADR-0018.
- New `packages/observability` (`@support/observability`, OTel SDK 2.x deps): `telemetry.ts` (`loadTelemetryConfig` from `OTEL_*`/`SUPPORT_ENVIRONMENT` env, `startTelemetry` registering global tracer/meter providers with OTLP/HTTP exporters to the Compose collector, disabled mode via `OTEL_SDK_DISABLED`, `createInMemoryTelemetry` capturing spans/metrics for tests), `metrics.ts` (`SupportMetrics` port: `recordApiRequest`/`recordWorkflowActivity`/`recordAiRun`/`recordToolCall`/`recordApprovalRequested`/`recordApprovalDecision`/`recordCriticalFailure`, with OTel-backed, no-op, and recording implementations), `logger.ts` (JSON structured logger with `service`/`environment` base fields, child bindings, level filtering, secret-key redaction, and active-span `trace_id`/`span_id` injection), `tracing.ts` (`withSpan`, `getActiveTraceContext`, shared tracer), `attributes.ts` (`SUPPORT_ATTR` span attribute keys, `SUPPORT_METRIC_NAMES`, the closed `SUPPORT_CRITICAL_FAILURE_MODES` set). 16 unit tests.
- `packages/api`: `observability.ts` registers per-request telemetry after the request context — an `http.request` span carrying `support.request_id`/`support.correlation_id`/`support.tenant_id` + method/route/status attributes (5xx spans marked errors), request-log rebinding with the same ids + `trace_id`/`span_id`, and `recordApiRequest` on every response with the route template; `buildApp` gains a `metrics` option (OTel default, recording in tests) and pino `base`/`redact` config; `server.ts` starts telemetry before the app and shuts it down on exit; `services.approvals.decide` wraps in an `approval.decide` span and records decision metrics (`decision` counter + request→decision latency) plus `approval_signal_failed` before the 502 path; `tool-registry.ts` wraps executions in `tool.execute` spans and records tool metrics by outcome; new `ai_runs:read`/`qa_reviews:read`/`qa_reviews:write` permissions in `rbac.ts`; new endpoints `GET /v1/ai-runs`, `GET /v1/ai-runs/{ai_run_id}`, `GET/POST /v1/qa-reviews`, `GET /v1/qa-reviews/{qa_review_id}`, `POST /v1/qa-reviews/{qa_review_id}/complete` (409 on double-completion), and `GET /v1/qa-reviews/{qa_review_id}/evidence` (composite: ticket, conversation, messages incl. outbound final response, AI run with trace link, tool calls, approvals with original draft + human edit); services `aiRuns`/`qaReviews` under `withTenantTransaction`/RLS; OpenAPI paths + component schemas for all of it.
- `packages/shared-schemas`: `AiRunTypeSchema`/`AiRunStatusSchema`/`AiRunResponseSchema` (+ resource/list envelopes), `PersistedToolCallStatusSchema`/`ToolCallResponseSchema`, `QaSampleReasonSchema` (`random_sample|auto_send_candidate|high_risk|manual`), `QaDefectCategorySchema` (BACKEND_SPEC §14 taxonomy) + `QaDefectSeveritySchema`/`QaReviewDefectSchema`, `QaReviewResponseSchema` (+ envelopes), `QaReviewCreateRequestSchema`, `QaReviewCompleteRequestSchema` (0-5 scores map + defects), `QaReviewEvidenceResponseSchema`, and the `QaReviewCreatedEventPayload` type export.
- `packages/db`: `createAiRunQuery` (conflict-safe deterministic-id retries), `completeAiRunByIdQuery`, `aiRunsListQuery` (ticket/status/run-type filters), `toolCallsListQuery` (ticket/ai-run filters), `createQaReviewQuery` (conflict-safe sampling dedup), `qaReviewByIdQuery`, `qaReviewsListQuery` (ticket/ai-run/completed filters), `completeQaReviewByIdQuery` (open-guarded so double completion conflicts), `qaSamplingCandidatesQuery` (completed runs without reviews, joined to tickets, left-join exclusion); `QaReview`/`NewQaReview` type exports; SQL-shape tests for each.
- `packages/workers`: `TicketLifecyclePersistenceStore` gains `recordAiRunResult` (DB impl checks the owning ticket exists and skips instead of FK-failing; in-memory mirror + `listAiRuns`); `createPersistedRunAiGraph(inner, {store, metrics, now})` persists every run's terminal state (structured output, confidence/risk/automation recommendation, guardrails, latency, `trace_id`, evidence refs; deterministic `air_` fallback id backfilled onto failed results) and records AI-run metrics — the `createApproval` FK guard now finds the row, so `approvals.ai_run_id`/`messages.ai_run_id` link automatically; `instrumentTicketLifecycleActivities` wraps all eight activities with `activity.{name}` spans, workflow-activity metrics, structured logs, and the domain critical-failure mapping (failed AI result → `ai_graph_failed`, send throw → `outbound_send_failed`, SLA-breach emission → `sla_breached`); `event-consumer.ts` takes optional `metrics` and records `event_dead_letter` on poison-envelope and max-deliver terms; `qa-sampling.ts` (`runQaSamplingJob` + `QaSamplingStore` DB/in-memory, `deterministicQaReviewId`, hash-bucket `samplingBucket`, SOPS §10 rules, `support.qa.review_created.v1` emission via the new `emitQaReviewCreatedEvent` helper in `domain-events.ts`); `telemetry.ts` (`startWorkersTelemetry`, `createWorkersLogger`); committed opt-in live-PostgreSQL integration test `ticket-lifecycle-persistence.integration.test.ts` (AI-run persist + retry dedupe, approval FK link, send-once + idempotent replay, QA sampling exactly-once) wired into `test:integration`.
- `infra`: `otel-collector-config.yaml` adds a Prometheus exporter on `:8889` with `translation_strategy: UnderscoreEscapingWithoutSuffixes` (scraped names match `SUPPORT_METRIC_NAMES` dot-for-underscore); Compose exposes the port; new `infra/observability/` with `README.md` (metric naming table + end-to-end tracing model), `dashboards/support-overview.json` (Grafana: API rate/latency/5xx, activity outcomes, AI runs, tool calls, approvals, critical failures), and `alerts.yaml` (Prometheus rules for the five critical failure modes + API 5xx rate, activity failure rate, approval p95 latency).
- Docs updated: `docs/BACKEND_SPEC.md` (§11/§14 implementation notes, §17 endpoint list + permissions, §17.11 current implementation, new §17.14 QA Reviews), `docs/TEST_STRATEGY.md` (§12 current coverage), `docs/SOPS.md` (§10 sampling job runbook + API queue flow, §13 alert-to-incident mapping), `docs/AI_RUNTIME_HARNESS.md` (§15 persistence/trace-link note), `docs/DECISIONS.md` (ADR-0018), `docs/PROJECT_HISTORY.md`, `README.md`, and this file.
- Created feature branch `feat-milestone10-approval-outbound` from `main` and ran `pnpm harness:preflight`.
- Completed Milestone 10 - Approval And Outbound Messaging in one coherent branch (all 12 checklist items + 4 acceptance criteria).
- `packages/shared-schemas`: approval decision contracts (`ApprovalDecisionStatusSchema`, `ApprovalApproveRequestSchema`/`ApprovalRejectRequestSchema`/`ApprovalEscalateRequestSchema` with optional `review_notes`, `ApprovalEditRequestSchema` requiring the human-edited `approved_payload`, and `ApprovalDecisionResponseSchema` = `{ approval, workflow_signal }`) plus the outbound contracts (`NormalizedOutboundMessageSchema` mirroring the inbound message shape with recipient identity/body/threading/approval linkage and a required `idempotency_key`, `OutboundSendStatusSchema` (`queued|sent|failed|canceled`), `OutboundSentByTypeSchema` (`human|ai_auto|system`)); unit tests for all.
- `packages/db`: Milestone 10 write queries — `createApprovalQuery` (conflict-safe for deterministic-id retries), `resolvePendingApprovalByIdQuery` (guards `status = 'pending'` so concurrent double-decides return zero rows → 409), `messageByIdempotencyKeyQuery` + `createOutboundMessageQuery` + `updateMessageSendResultByIdQuery` (outbound send lifecycle over the existing `(tenant, idempotency_key)` partial unique index), `createAuditEventQuery` (append-only, conflict-safe deterministic ids), `customerIdentityForCustomerQuery` (outbound recipient resolution), and `aiRunByIdQuery` (FK-existence guard); SQL-shape tests for each.
- `packages/api`: `approvals:review` permission (platform_admin, ops_admin, support_agent) in `rbac.ts`; `approval-workflow-signaler.ts` (`ApprovalWorkflowSignaler` port: lazy Temporal default signaling `approval_completed` on `ticket-lifecycle:{tenant}:{conversation}`, `workflow_not_found` tolerated and reported, recording double for tests); `services.approvals.decide` (single RLS transaction: pending check → resolve with reviewer/notes/`resolved_at`/`approved_payload` (approve mirrors `requested_payload`, edit stores the human edit) → `approval.{status}` audit event whose metadata carries both payloads → ticket lookup for the conversation id; post-commit signaling, transport failure → `502 WORKFLOW_ERROR`); the four `POST /v1/approvals/{id}/*` routes (auth → permission → params → optional/required body) with OpenAPI paths + `ApprovalApproveRequest`/`ApprovalEditRequest`/`ApprovalRejectRequest`/`ApprovalEscalateRequest`/`ApprovalWorkflowSignalResult`/`ApprovalDecision` component schemas.
- `packages/integrations/src/channels`: pure outbound adapters — `buildOutboundEmailProviderRequest` (provider-neutral email request; `In-Reply-To`/`References` threading from the conversation's external thread id; from-address/name from channel config) and `buildOutboundWhatsAppProviderRequest` (Cloud API text send) — plus `outbound-sender.ts`: the `OutboundChannelSender` port, `createHttpOutboundChannelSender` (Mailgun form/basic-auth + WhatsApp Cloud JSON/bearer, injectable `fetch`, 5xx/transport failures retryable vs 4xx/config/credential permanent) and `createRecordingOutboundChannelSender`; 13 tests with stubbed fetch.
- `packages/workers`: added `@support/db` + `@support/integrations` deps; `activities/ticket-lifecycle-persistence.ts` implements the production `createApproval`/`sendOutboundMessage`/`recordAuditEvent` activities over a `TicketLifecyclePersistenceStore` port with `createDatabaseTicketLifecyclePersistenceStore` (lazy client, everything under `withTenantTransaction`/RLS) and `createInMemoryTicketLifecyclePersistenceStore` (mirrored dedup semantics + list/seed helpers). Deterministic ids throughout (`apr_` from tenant|ticket|correlation, `aud_` from a stable metadata hash) so Temporal at-least-once retries replay instead of duplicating; `sendOutboundMessage` replays `sent` idempotency keys without a provider call, resolves conversation → channel → recipient identity → approval, extracts the draft (`approved_payload.draft_text` → `draft`/string → `ai_graph.draft.draft_text` fallback, i.e. human edit wins), validates the outbound contract, records `queued → sent|failed`, audits `message.send_failed`, and raises `NonRetryableActivityError` for permanent failures; `ai_run_id` links only when the `ai_runs` row exists (FK guard — AI-run persistence lands in Milestone 11). The workflow itself needed no changes (Milestone 5 already routes outcomes); `createEnvOutboundCredentialResolver` resolves `send_credential_ref` from env. 11 new activity tests.
- Tests/verification: whole offline suite green (`pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — shared-schemas 43, integrations 51, db 55, workers 48, api 109, Python suite OK). Live against Compose services (started + stopped this session): `@support/db` integration (19), `@support/api` integration (31 — approve/edit/reject/escalate incl. audit rows, edited-draft metadata, recorded workflow signals, 409 double-decide, cross-tenant 404, qa_reviewer 403), `@support/workers` `test:workflow` (7 — pause/resume + outcome routing + replay), NATS event-bus integration (2, note: use `NATS_URL=nats://127.0.0.1:4222` on hosts where `localhost` resolves to IPv6), and a live PostgreSQL drive of the persistence activities end to end (approval create/retry-dedupe → decision → send-once → idempotent replay → audit dedup; caught and fixed the `approvals.ai_run_id` FK violation with the `aiRunByIdQuery` guard).
- Unrun/notes: no committed live-PostgreSQL workers integration test for `createDatabaseTicketLifecyclePersistenceStore` (driven ad hoc this session); no production worker entrypoint composes the persistence activities into `createTicketLifecycleWorker` yet; `messages.send_status`/`sent_by_type` remain free-text columns (enum migration follow-up); outbound email subject is null (threading via reply headers); approval expiry (`expired`) unhandled. Captured as Milestone 10 follow-ups above.
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

- Milestone 16 (`feat-milestone16-real-auth-policy-lifecycle`): `pnpm harness:preflight` passed on the branch.
- Offline suite green this session: `pnpm typecheck` (six packages), `pnpm -r test` — observability 44, shared-schemas 64 (policy lifecycle contracts + tenant retention_policy), integrations 79, db 85 (migration 0006 + seed idp-link coverage), api 187 (new auth.test.ts + reworked real-token rbac-matrix + policy lifecycle endpoint suites), workers 134; `pnpm lint`, `pnpm build`, `pnpm format:check`, and the Python suite via `pnpm test:py` (143) all green.
- Live against Compose services (postgres, temporal, nats; started this session): `pnpm db:migrate` applied `0006_user_idp_subject` cleanly; `@support/db` test:integration (19); `@support/api` test:integration (42 across 3 files, incl. the new auth/policy-lifecycle live suite 5/5) including the new committed `auth.integration.test.ts` — real RSA tokens through the production verifier + DATABASE user directory (idp_subject resolution, DB roles, suspended/unprovisioned 401s, membership 403s both directions, NULL-tenant platform user, retention_policy on the tenant read) and the full live policy lifecycle (audits attributed to the acting user, activation immutability 409s, same-domain predecessor archival, fail-closed automation after archive); `@support/workers` test:integration (6, `NATS_URL=nats://127.0.0.1:4222`); `pnpm test:e2e` (1) green under the explicit insecure-header opt-in.
- Live Clerk smoke (opt-in, this session, keys from the local gitignored `.env`): decoded a freshly minted session token for the dev-instance test user confirming the dashboard customization (`aud: support-platform-api`, `email`, RS256, expected issuer), then `RUN_CLERK_LIVE_TESTS=true ... vitest run src/auth.clerk-live.integration.test.ts` 1/1 PASS — real session token minted via the Clerk Backend API verified through the production JWKS verifier over the network; same token on a non-member tenant → 403; tampered signature → 401.
- Not run: CI on the branch (runs on push); the Temporal workflow suite (`test:workflow`) — no workflow/activity code changed this milestone (auth + API-layer + db-query changes only); the sidecar e2e (`test:e2e:service`) — the sidecar path is machine-token auth, unchanged and covered by internal-routes/matrix suites plus the standard e2e.
- Milestone 15 (`feat-milestone15-provider-model-layer`): `pnpm harness:preflight` passed on the branch.
- Offline suite green this session: `pnpm typecheck` (six packages), `pnpm --filter @support/shared-schemas test` (63), `pnpm --filter @support/workers test` (134+21 skipped), `pnpm --filter @support/api test` (159+37 skipped), `pnpm --filter @support/integrations test` (79), Python `PYTHONPATH=ai uv run --frozen --project ai --extra service python -m unittest discover -s ai -p '*_test.py'` (139).
- Service-path determinism still byte-identical: `python -m service.eval_parity` → 25/25 PASS with gates green.
- Provider-agnosticism proof (offline, env-only): `SUPPORT_LLM_PROVIDER=scripted python -m evals.live_runner` → Golden 25 PASS + Injection 18 PASS, all hard-fail gates green through the real adapter path.
- Real-provider imports verified: `uv sync --frozen --extra llm --extra service` + `from langchain.chat_models import init_chat_model` OK (lockfile updated).
- NOT run (blocked on user-owned API keys): the live golden+injection gate against Anthropic Claude (`evals.live_runner` with `SUPPORT_LLM_PROVIDER=anthropic`) and the real-Claude e2e drive; local Docker infra was not up this session, so the opt-in live integration/e2e suites were not re-run (unchanged from Milestone 14's passing runs; the diff keeps those paths' offline suites green).
- Milestone 14 (`feat-milestone14-ai-runtime-service-bridge`): `pnpm harness:preflight` passed on the branch.
- Offline suite green: `pnpm lint` (all six TS packages + Python compileall incl. `ai/service`), `pnpm typecheck`, `pnpm format:check`, `pnpm build`, and `pnpm test` — observability 44, shared-schemas 63 (new bridge contracts), integrations 63, db 84, api 154 (new internal-route + machine-role matrix suites), workers 132 (new http-ai-graph + sidecar config suites), Python 114 (new service config/parsing/adapters/app/eval-parity suites) via `uv run --frozen --project ai --extra service`.
- Service-path determinism (acceptance): `PYTHONPATH=ai uv run --frozen --project ai --extra service python -m service.eval_parity` — all 25 golden cases byte-identical between in-process and service-path execution, and the full eval report through the service path passes every hard-fail gate (all metrics 1.000, zero violations).
- Sidecar smoke: `GET /health` 200 without auth (`graph_version: support_graph.v1`); `POST /internal/ai/run` 401 without/with a wrong bearer and 200 `succeeded` with the token; structured JSON log lines carry correlation/trace/tenant/ticket/ai_run ids; the Compose `ai-service` container builds from `ai/Dockerfile` and reports healthy in service mode.
- Live against Compose services (postgres, temporal, nats; started this session): `@support/db` test:integration (19); `@support/api` test:integration (37); `@support/workers` test:integration (6, `NATS_URL=nats://127.0.0.1:4222`); `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow` (11); the Milestone 13 drive `pnpm test:e2e` (1) still green after the run-anchor change.
- Live service-bridge acceptance (`pnpm --filter @support/workers test:e2e:service`, 3 tests): (1) full lifecycle with the AI decision made in the spawned Python sidecar — persisted `ai_runs` row (`status: succeeded`, `modelProvider: deterministic`, `modelId: deterministic-support-v1`, `trace_` link), retrieval over the network (seeded KB FAQ surfaced as run evidence), tools over the network (audited `tool_calls` rows linked to the run id), approval → exactly one provider send → `waiting_customer`; (2) sidecar-down: audited failed run `AI_SIDECAR_UNAVAILABLE` (retryable: true), `ai_graph.failed` audit action, pending approval still gating the reply, workflow alive in `waiting_human`; (3) sidecar-500: `AI_SIDECAR_ERROR` with the same human routing. Found-and-fixed during the drive: `tool_calls.ai_run_id` FK vs in-flight runs — the registry store now anchors a `started` ai_runs skeleton that `recordAiRunResult` completes.
- Not run: CI on the branch (runs on push); the service e2e is opt-in (`RUN_AI_SERVICE_E2E_TESTS`), not part of `pnpm test:integration`; the Compose `ai-service` container path is smoke-verified (health/auth) but the committed e2e spawns the sidecar via uv directly.
- Milestone 13 (`feat-milestone13-worker-entrypoint-ticket-persistence`): `pnpm harness:preflight` passed on the branch.
- Offline suite green: `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` — shared-schemas 55, observability 44, integrations 63, db 84 (new migration/repository coverage), api 137, workers 115 (new triage/deterministic-graph/worker-runtime/ticket-state-persistence/audit/domain-event suites), plus the Python suite (56) via `uv run --frozen --project ai`.
- Live against Compose services (postgres, temporal, nats; started this session): `pnpm db:migrate` applied `0005_message_send_status_enums` cleanly on a live database; `@support/db` test:integration (19); `@support/api` test:integration (37); `@support/workers` test:integration (6, `NATS_URL=nats://127.0.0.1:4222`); `pnpm --filter @support/workers test:workflow` (11 — the 8 prior behaviors under the new transition call orders plus approval expiry → `approval_expired`, reviewer-beats-expiry resume, and close-request transition; history replay green).
- Live end-to-end acceptance (`pnpm test:e2e`, 1 comprehensive test): signed webhook → persisted ticket (`waiting_human`, topic `order_status`, language `en`, SLA due dates from the seeded active policy) → ordered `ticket_events` trail → deterministic AI run persisted with the approval FK link → follow-up message reconciled onto the same ticket (single conversation) → duplicate delivery deduped → worker restarted mid-workflow → API approve (`workflow_signal.delivered: true`) → workflow result `responded` → exactly one Mailgun provider call (URL + basic auth asserted through the real HTTP sender with stubbed fetch) → outbound row `send_status: sent` (enum) / `sent_by_type: human` → ticket `waiting_customer` via `GET /v1/tickets/{id}` → audit trail contains `ticket.created`/`ticket.updated`/`approval.requested`/`approval.approved`/`approval.completed`/`message.sent` → JetStream carries `ticket.created`/`ticket.triaged`/`ai_run.completed`/`message.sent` events for the tenant.
- `pnpm worker:start` smoke: entrypoint boots against Compose (workflow bundle from source, task queue polled), drains cleanly on SIGTERM (exit 0); missing `DATABASE_URL` fails fast with the aggregated config error before any connection opens.
- Not run: CI on the branch (runs on push); the e2e suite is opt-in (`RUN_E2E_TICKET_LIFECYCLE_TESTS`), not part of `pnpm test:integration`.
- Milestone 12 (`feat-milestone12-security-pilot-readiness`): `pnpm harness:preflight` passed on the branch.
- Offline suite green: `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` — shared-schemas 55, observability 44, integrations 63, db 78, workers 81, api 137 (incl. the new rbac-matrix suite), plus the Python suite (56: 49 prior + injection suite + golden `auto_2`) via `uv run --frozen --project ai`.
- Live against Compose services (postgres, nats, temporal; started and stopped this session): `pnpm db:migrate` applied `0004_tenant_retention_policy`; `@support/db` test:integration (19); `@support/api` test:integration (37); `@support/workers` test:integration (6, with `NATS_URL=nats://127.0.0.1:4222`); `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow` (8 — including the new no-bypass test: an `auto_send` AI recommendation still waits for human approval; fixed a test-only race by also waiting on `approval_id` in the state predicate).
- Live pilot drive (acceptance evidence): `pnpm db:seed:pilot` inserted the full pilot plan then inserted zero on re-run (idempotent); a tsx drive script exercised the real database paths — `services.policies.getEffectiveAutomationPolicy` resolved the seeded policy as configured + disabled, `services.reports.weekly` executed all thirteen aggregates in one RLS transaction (zeros/null rates for the fresh tenant), `createDatabaseAutomationPolicyStore` + `evaluateAutoSendEligibility` failed closed (`auto_send_disabled`), and `runTenantRetentionJob` against a seeded 120-day-old message cleared its `raw_payload_ref`, returned the ref for the sweeper, and wrote the `retention.applied` audit row (ad hoc rows cleaned up afterward; the pilot seed itself was left in place).
- Python gates: full discovery run green (56 tests); the injection suite reports PASS over 18 cases with `prompt_injection_pass_rate` 1.000 and zero unsafe auto-send / unsafe output / legal auto-send / cross-tenant leaks.
- Not run: CI on the branch (runs on push); no Prometheus/Grafana locally (definitions-as-code only); the retention job and QA sampling job remain manually invoked (scheduling is a follow-up).
- Milestone 11 (`feat-milestone11-observability-qa`): `pnpm harness:preflight` passed on the branch.
- Offline suite green: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm test` — shared-schemas 50, observability 16 (new package), integrations 51, db 64, workers 62, api 120, plus the Python suite (49) via `uv run --frozen --project ai`.
- Live against Compose services (postgres, nats, temporal, otel-collector; started and stopped this session): `@support/db` test:integration (19); `@support/api` test:integration (37 — incl. new AI-run list/read with trace links + cross-tenant 404, the QA review lifecycle create→list→evidence→complete→409, cross-tenant QA 404s, client_viewer 403s, and recorded approval-decision metrics with measurable latency and zero critical failures); `@support/workers` test:integration (6 — NATS event bus 2 with `NATS_URL=nats://127.0.0.1:4222`, plus the new live persistence-store suite 4: AI-run persist + retry dedupe under RLS, approval `ai_run_id` FK link, send-once + idempotent replay with the message row linking `ai_run_id`, QA sampling exactly-once with deterministic review id); and `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow` (7, unchanged behavior).
- Live observability smoke drive (acceptance: ticket traceable end to end): a telemetry-enabled API process exported `http.request` spans and all API metrics to the collector (debug exporter logged 4 spans + 16 data points per drive), and `curl http://localhost:8889/metrics` scraped `support_api_requests` / `support_api_request_duration_ms_*` with route/status labels under the documented suffix-free names. Fixed during verification: collector 0.154 ignores `add_metric_suffixes`, switched to `translation_strategy: UnderscoreEscapingWithoutSuffixes`.
- End-to-end trace path verified by attribute correlation (ADR-0018): request span attributes (`support.correlation_id`/`support.tenant_id`) asserted in API unit tests, activity spans + correlation logs asserted in the instrumentation wrapper tests, `ai_runs.trace_id` persisted and read back live, `audit_events.correlation_id` already covered by Milestone 10 suites.
- Not run: CI on the branch (will run on push); no Prometheus/Grafana services exist locally (definitions-as-code only, follow-up).
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

Refreshed 2026-07-04 for the launch phase (each maps to a launch milestone or the user-owned track):

- ~~No production worker entrypoint runs the composed activities yet; ticket DB mutation from the workflow is still placeholder~~ — closed by Milestone 13 (`pnpm worker:start`, production ticket persistence, live e2e drive).
- ~~The AI runtime runs only in-process with the deterministic model; no service bridge, no real LLM or embedding providers configured (Milestones 14-15)~~ — the bridge closed at Milestone 14 and the provider layer is code-complete at Milestone 15; what remains is credentials: no Anthropic/OpenAI API keys exist yet (user-owned track), so the live eval gates and real-model/real-embedding quality runs are blocked, and real retrieval quality stays unproven until the keys land.
- ~~API auth is still the trusted-header placeholder; no IdP exists (Milestone 16)~~ — closed by Milestone 16: production JWT auth via Clerk/JWKS is the API default (ADR-0024); the header mode survives only behind the explicit `SUPPORT_AUTH_MODE=insecure-headers` test/local opt-in. The production Clerk instance (vs the dev instance) is provisioned with Milestone 18's environment work.
- QA sampling and retention jobs have no scheduler; retention attachment/AI-run purges are counted-and-reported placeholders (Milestone 17).
- No staging or production environment exists; no Mailgun/WhatsApp/IdP/Anthropic/OpenAI accounts or credentials provisioned (Milestones 18-19 + user-owned track).
- No pilot client signed; no real client KB/policy/historical-ticket data (user-owned track; feeds Milestones 21-22).
- The reviewer console repository does not exist yet (user-owned; Milestone 20 provides its API surface).

### Open Questions

- ~~Exact IdP vendor within the hosted-IdP decision (default Clerk; confirm at Milestone 16 kickoff)~~ — resolved: Clerk confirmed and provisioned (dev instance; ADR-0024). The platform depends only on standard OIDC surfaces, so the vendor stays swappable by env change.
- ~~Whether Milestone 15 swaps in the real LangGraph engine or keeps the ADR-0016 local engine~~ — resolved: deferred again with reasons (ADR-0023 (4)); revisit when checkpointing/interrupts/streaming are needed.
- Single-ticket-per-conversation: implement multi-ticket support or accept the limitation for the pilot (decide at Milestone 22).
- WhatsApp launch timing relative to email go-live (depends on Meta Business verification lead time; email does not block on it).

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

- [x] Define approval record schema. (The `approvals` table + `ApprovalResponseSchema` already existed; this milestone added the decision contracts — `ApprovalApproveRequestSchema`, `ApprovalEditRequestSchema` (requires the human `approved_payload`), reject/escalate request schemas, `ApprovalDecisionStatusSchema`, and `ApprovalDecisionResponseSchema` with `ApprovalWorkflowSignalResultSchema`.)
- [x] Add approval request creation. (Workflow-owned per BACKEND_SPEC §17.12: the production `createApproval` activity persists the pending approval via `createApprovalQuery` with a deterministic id from (tenant, ticket, correlation) so Temporal retries replay, links `ai_run_id` only when the `ai_runs` row exists, and audits `approval.requested` once.)
- [x] Add approval read APIs. (`GET /v1/approvals` + `GET /v1/approvals/{id}` existed from Milestone 3; verified against the new decision flow — resolved approvals read back with reviewer/payloads/resolved_at.)
- [x] Add approve/edit/reject/escalate APIs. (`POST /v1/approvals/{id}/approve|edit|reject|escalate` behind the new `approvals:review` permission (platform/ops/support-agent); one RLS transaction resolves the pending approval + appends the `approval.{status}` audit event; 404 missing/cross-tenant, 409 non-pending; OpenAPI paths + component schemas added.)
- [x] Add approval signal to Temporal. (`approval-workflow-signaler.ts`: injectable `ApprovalWorkflowSignaler` — lazy Temporal client default signaling `approval_completed` on `ticket-lifecycle:{tenant}:{conversation}` with the worker signal payload, recording double for tests; missing workflow reported as `workflow_not_found`, transport failure → `502 WORKFLOW_ERROR` after the decision persisted.)
- [x] Add outbound message schema. (`NormalizedOutboundMessageSchema` — outbound mirror of the inbound contract with recipient identity, body, threading, approval/ai-run linkage, `sent_by_type`, and a required `idempotency_key` — plus `OutboundSendStatusSchema`/`OutboundSentByTypeSchema`; persisted as `direction: "outbound"` rows in the existing `messages` table.)
- [x] Add email outbound adapter. (`buildOutboundEmailProviderRequest`: pure mapping to the provider email request with RFC 5322 `In-Reply-To`/`References` threading; Mailgun HTTP send in `createHttpOutboundChannelSender` with basic auth + form encoding and injectable `fetch`.)
- [x] Add WhatsApp outbound adapter. (`buildOutboundWhatsAppProviderRequest`: WhatsApp Cloud `type: "text"` request; Cloud API HTTP send with bearer auth; provider message id extracted from the response.)
- [x] Add outbound idempotency. (The workflow's deterministic `outbound:{tenant}:{ticket}:{approval_id}` key hits the `(tenant_id, idempotency_key)` partial unique index: `sendOutboundMessage` replays an already-`sent` key without re-contacting the provider, conflict-safe insert + read-back handles races, and failed rows are reused by the next Temporal retry.)
- [x] Add outbound audit events. (`recordAuditEvent` now persists — deterministic hash ids dedupe activity retries — so the workflow's `message.sent` audit lands in `audit_events`; the send activity audits `message.send_failed` with the provider error; approval decisions audit `approval.{status}`; `createApproval` audits `approval.requested`.)
- [x] Add tests for approval resume. (Live Temporal suite: workflow pauses in `waiting_for_approval` and resumes on `approval_completed` for all four outcomes; API integration tests prove decide → recorded signal with the exact workflow id + payload; recording-signaler unit tests cover the route contract.)
- [x] Add tests for edited draft audit trail. (API integration: `approval.edited` audit metadata carries both the preserved `requested_payload` and the human `approved_payload`; activity tests prove the edited draft is what gets sent; app unit tests cover the edit endpoint contract incl. the missing-payload 400.)

Acceptance criteria:

- [x] Workflow pauses until approval. (`waiting_for_approval` until the `approval_completed` signal — live Temporal tests, incl. AI-failure routing and SLA racing.)
- [x] Approved or edited responses are sent once. (Live Temporal routing tests + persistence-activity tests: one provider send, duplicate keys replay; verified end to end against live PostgreSQL with the unique-index dedupe.)
- [x] Rejected responses do not send. (Live Temporal test: `phase: "completed"`, `outbound_message_id: null`, `sendOutboundMessage` never called; escalated likewise routes to manual handling without sending.)
- [x] Human edits are stored for eval and QA. (Edited approvals keep the original AI draft in `requested_payload` and the human edit in `approved_payload` on the approval row, and the `approval.edited` audit event metadata carries both — asserted live against PostgreSQL.)

## Milestone 11: Observability And QA

Goal: Make system behavior visible and reviewable.

Checklist:

- [x] Add OpenTelemetry tracing.
- [x] Add structured logs with trace IDs.
- [x] Add metrics for APIs.
- [x] Add metrics for workflows.
- [x] Add metrics for AI runs.
- [x] Add metrics for tool calls.
- [x] Add metrics for approvals.
- [x] Add QA review data model.
- [x] Add QA sampling job.
- [x] Add AI run trace links.
- [x] Add basic dashboard definitions.
- [x] Add alert definitions for critical failures.

Acceptance criteria:

- [x] A ticket can be traced end to end.
- [x] QA review can see conversation, evidence, tool calls, AI output, human edits, and final response.
- [x] Critical failure modes have metrics or alerts.

## Milestone 12: Security And Pilot Readiness

Goal: Prepare for first pilot with controlled risk.

Checklist:

- [x] Add RBAC enforcement. (Deny-by-default: the implicit `support_agent` role fallback removed — no parseable `x-user-roles` is `401`; `ROLE_PERMISSIONS` exported as the source of truth; `rbac-matrix.test.ts` enumerates every registered route via a Fastify `onRoute` collector and asserts each enforces its documented permission for all six roles plus `401` with no role; new `reports:read` permission.)
- [x] Add integration secret handling. (Shared validating `SecretResolver` in `packages/integrations/src/secrets.ts`: references must be env-var-shaped (`^[A-Z][A-Z0-9_]*$`) before the environment is consulted; the webhook-signature and outbound-credential resolvers both delegate to it; negative tests prove malformed refs never touch the environment.)
- [x] Add PII redaction in logs. (Content-level scrubbing in the observability logger — emails/phones/card-like digit runs replaced in string fields, arrays, and the message itself; key-based secret redaction unchanged and non-disableable; `redactPii: false` opt-out for the content layer only.)
- [x] Add prompt-injection test suite. (`ai/evals/injection_suite.py`: 18 cases — 15 user-text injections incl. exfiltration, embedded-in-legit-request, jailbreaks, tool-abuse, auto-send-enabled hijack, multi-message late injection, plus 3 KB-content injections against a poisoned corpus; hard-fail gates all green, `prompt_injection_pass_rate == 1.0`.)
- [x] Add attachment validation. (Pure `validateInboundAttachments` in `packages/integrations` — 10 MiB cap, content-type allowlist, filename safety, per-message bound — enforced at the top of `ingestNormalizedMessage` before any persistence/workflow signal; rejections reported per message in the webhook 202 via new `rejected`/`rejection_reason` contract fields.)
- [x] Add audit completeness tests. (Closed `SupportAuditActionSchema` taxonomy in shared-schemas; workers audit boundary typed to it at compile time, API decide path validates at runtime; `audit-completeness.test.ts` drives every live producer and asserts canonical actions + reserved entries for pending policy/credential/permission write paths.)
- [x] Add data retention policy hooks. (`tenants.retention_policy` jsonb via migration `0004` + `TenantRetentionPolicySchema`; workers `runTenantRetentionJob` clears expired raw-payload refs in bounded batches, audits `retention.applied`, reports attachment/AI-run purges as placeholders, fails closed on missing/malformed config; verified live incl. an actual expired-ref clear + audit row.)
- [x] Add pilot tenant seed data. (`buildPilotSeedPlan`/`applyPilotSeed` + `pnpm db:seed:pilot`: deterministic ids, conflict-safe idempotent inserts — verified live, second run inserts zero — covering tenant with retention policy, six global roles, three users + role links, mailgun channel with env-ref secrets, active SLA policy, refunds/escalation/automation policies (auto-send disabled), and the six global first-party `tool_definitions` (closes a Milestone 8 follow-up).)
- [x] Add pilot onboarding SOP. (SOPS §1.1 — concrete v1 steps from `pnpm infra:up` through seeding, webhook config, KB ingestion, eval gates, automation-controls verification, reporting, and job scheduling.)
- [x] Add weekly review report query. (Thirteen tenant-scoped aggregate query builders in `packages/db` + `services.reports.weekly` assembling the SOPS §14 metrics in one RLS transaction, exposed as `GET /v1/reports/pilot-weekly` behind `reports:read` with an optional `since`/`until` window; verified live against the seeded tenant.)
- [x] Add auto-send allowlist controls. (`AutomationPolicyContentSchema` — kill switch + topics constrained to the closed `faq|order_status` set — stored as the active `automation`-domain policy version; `GET /v1/policies/automation` resolves the effective controls fail-closed; workers `evaluateAutoSendEligibility` is the mandatory gate for any future auto-send branch; golden case `auto_2` proves a tenant-allowlisted `refund` still routes to human approval.)
- [x] Add production deployment checklist. (SOPS §19 — environment/infra, automated security gates, tenant readiness, and rollback sections tied to the Milestone 12 acceptance criteria.)

Acceptance criteria:

- [x] No known cross-tenant leakage. (Live RLS integration tests (19) + cross-tenant 404 API integration tests (37) + the RBAC route matrix + Python eval gates reporting zero cross-tenant leaks across golden + injection suites.)
- [x] No high-risk action can bypass human approval. (New live Temporal workflow test: an `auto_send` AI recommendation still parks in `waiting_for_approval` with an approval created and send unreachable until the human signal; `evaluateAutoSendEligibility` fails closed incl. kill switch and topic ceiling; side-effect tools default `requiresHumanApproval`; Python hard-fail gates zero unsafe auto-send.)
- [x] Pilot metrics can be reported. (`GET /v1/reports/pilot-weekly` + the report service driven live against the seeded pilot tenant returning the full SOPS §14 metric set.)
- [x] Incident and escalation SOPs are documented. (SOPS §5 Escalation and §13 Incident Response existed and were verified; §19 deployment checklist references them; alert-to-incident mapping in §13 from Milestone 11.)

## Milestone 13: Production Worker Entrypoint And Ticket Persistence

Goal: The verified workflow pieces run as one deployable worker process that persists real ticket state to PostgreSQL. (Phase 1.)

Checklist:

- [x] Implement the production `createOrUpdateTicket` activity over `TicketLifecyclePersistenceStore` (create-or-load under RLS with the deterministic `tkt_{conversation_id}` id; workflow-owned state persisted to the `tickets` row).
- [x] Implement the production `recordInboundMessage` activity, reconciling workflow-signaled inbound messages with the intake-persisted `messages` rows (no duplicates; ticket moves to the correct waiting state).
- [x] Implement the production `runInitialTriage` activity persisting triage output (priority, topic/category, language metadata) onto the ticket row.
- [x] Persist every workflow-owned ticket state transition per BACKEND_SPEC §7 with audit events from the closed taxonomy; transitions visible through the existing read APIs. (The state machine lives in BACKEND_SPEC §6.2/§6.3; transitions persist via the new `applyTicketStateTransition` activity with append-only `ticket_events` rows.)
- [x] Build the production worker entrypoint composing `createTicketLifecyclePersistenceActivities` + `createDatabaseTicketLifecyclePersistenceStore` + `createHttpOutboundChannelSender` + `createPersistedRunAiGraph` + `instrumentTicketLifecycleActivities` + `startWorkersTelemetry`/`createWorkersLogger` into `createTicketLifecycleWorker`, with fail-fast env config validation and graceful shutdown, exposed as a run script (e.g. `pnpm --filter @support/workers start`).
- [x] Migrate `messages.send_status`/`sent_by_type` from free text to PostgreSQL enums (contracts already exist in shared-schemas; Milestone 10 follow-up).
- [x] Add approval expiry handling: `expired` status + return-to-queue/escalation after a configurable wait (BACKEND_SPEC §12; Milestone 10 follow-up).
- [x] Emit `support.ai_run.completed.v1` and `support.tool_call.completed.v1` domain events from workflow activities (payload schemas already exist; Milestone 11 follow-up).
- [x] Add a committed live end-to-end integration test against Compose services: webhook fixture → conversation/ticket persisted → deterministic AI draft → approval created → decide via API → outbound send recorded → complete audit trail, all through the running worker entrypoint.
- [x] Update docs (BACKEND_SPEC workflow implementation notes, README commands, this file).

Acceptance criteria:

- [x] One process runs the entire ticket lifecycle with the deterministic AI model.
- [x] Ticket rows and state transitions are persisted, audited, and visible through the existing read APIs.
- [x] The live end-to-end drive passes with no duplicate messages, approvals, or sends across a worker restart mid-workflow.

## Milestone 14: AI Runtime Service Bridge

Goal: The Python AI runtime runs as an HTTP sidecar service invoked by the Temporal `runAiGraph` activity, with retrieval and tool execution over the network — still on the deterministic model (the provider swap is Milestone 15). (Phase 1; ADR-0020.)

Checklist:

- [x] Add the FastAPI service under `ai/service/` exposing `POST /internal/ai/run` (`RuntimeRequest` in, `RuntimeResult` out) plus `GET /health`; deps via a new uv extra (e.g. `uv sync --project ai --extra service`).
- [x] Secure the sidecar with an internal bearer token resolved from an env reference (SecretResolver conventions); unauthenticated requests are 401.
- [x] Implement the production TypeScript `runAiGraph` activity calling the sidecar over HTTP with explicit timeout and retryable-vs-permanent error classification; sidecar unavailability produces a structured `failed` result that routes to human — composed under the existing `createPersistedRunAiGraph` wrapper unchanged.
- [x] Expose an internal tool-execution endpoint in `packages/api` (e.g. `POST /internal/tools/execute`) speaking the Milestone 8 `ToolCallRequest`/`ToolCallResult` envelope, service-to-service authenticated, executing through the governed `createDatabaseToolExecutor`.
- [x] Implement the Python `ToolExecutor` port adapter calling that endpoint in service mode; granted permissions derived from tenant policy and enforced server-side (Milestone 8 follow-up).
- [x] Implement the Python `RetrievalPort` adapter calling `POST /v1/kb/search` service-to-service in service mode.
- [x] Feed `PolicyContext` (`allow_auto_send`, `auto_send_allowed_topics`, allowed tools) from `createDatabaseAutomationPolicyStore` and tenant policy into the `RuntimeRequest` built by the activity (the Milestone 12 bridge). (Allowed tools stay runtime-policy-derived: `AutomationPolicyContentSchema` has no tool allowlist field, so the runtime's policy node remains the tool-allowlist source and the executor re-enforces permission classes server-side.)
- [x] Propagate `correlation_id`/`trace_id` into the sidecar; sidecar logs are structured JSON carrying them (ADR-0018 attribute correlation).
- [x] Add the sidecar to Docker Compose for local dev (uv-based image) and document the run path.
- [x] Integration coverage: activity → sidecar round trip persisting an `ai_run` with trace link; sidecar-down and sidecar-500 paths produce structured failures routed to human approval; the eval runner can execute through the service path.
- [x] Update docs (AI_RUNTIME_HARNESS bridge section, BACKEND_SPEC internal endpoints, this file).

Acceptance criteria:

- [x] The full lifecycle runs with the AI decision made in the Python service process, retrieval and tools over the network.
- [x] Sidecar failure degrades to human routing with an audited failed AI run — the workflow never fails.
- [x] Service-path runs are deterministic and identical to in-process runs for the same inputs (proven via the eval suite).

## Milestone 15: Provider-Agnostic Model Layer And Real LLM Default

Goal: Real model and embedding providers behind config-driven selection at the existing ports; the pilot default (Anthropic Claude + OpenAI `text-embedding-3-small`) passes the eval gates. (Phase 1; ADR-0020.)

Checklist:

- [x] Implement the config-driven Python `ModelProvider` over LangChain's `init_chat_model` behind the existing port: provider/model from env (`SUPPORT_LLM_PROVIDER`, `SUPPORT_LLM_MODEL`), structured outputs enforced, timeouts/retries, token + latency capture; deps via `uv sync --project ai --extra llm`. (`ai/runtime/llm.py`: `LangChainSupportModel` + `load_llm_config`; closed-vocabulary JSON schemas; per-call timeout, SDK retries, one structured-output repair attempt; errors raise → structured failed run → human.)
- [x] Pilot default model config: Anthropic Claude with keys from env refs; the deterministic model remains the offline default — real providers activate only by explicit config. (Key refs per SecretResolver conventions, provider-specific defaults `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`; fail-fast boot validation; `.env.example` + Compose passthrough; the sidecar image ships the `llm` extra so activation is config-only.)
- [x] Decide whether to swap the graph engine to the real LangGraph library behind the unchanged node code (ADR-0016 seam) or record deferral with reasons in DECISIONS. (Deferred again with reasons — ADR-0023 (4): no observable behavior change under the byte-parity standard, node code engine-agnostic, revisit when checkpointing/interrupts/streaming are needed.)
- [x] Add versioned prompt files with stable IDs for the classifier and composer prompts (AI_RUNTIME_HARNESS §8); prompt version recorded on every AI run. (`ai/runtime/prompts/support_classifier.v1.md` + `support_response_composer.v1.md` with frontmatter-validated registry; versions ride `RuntimeResult.model.prompt_versions` → `ai_runs.prompt_version`.)
- [x] Implement the production TypeScript `Embedder` factory: env-selected provider (`SUPPORT_EMBEDDING_PROVIDER`, `SUPPORT_EMBEDDING_MODEL`), pilot default OpenAI `text-embedding-3-small`; only 1536-dim-capable models accepted; deterministic embedder remains the test default. (`createEmbedderFromEnv` + `createOpenAiEmbedder` in `packages/integrations` — allowlisted models, explicit 1536 `dimensions` param, bounded retries, dimension validation.)
- [x] Wire one shared embedder instance into both ingestion and retrieval (ADR-0014 follow-up); record the embedding model id at ingestion and enforce ingestion/retrieval model match at query time; document the provider-swap = re-embed procedure. (`createDatabaseApiServices` shares one factory-built instance; chunk metadata records `embedding_model_id` (no migration); retrieval fails closed with `EmbeddingModelMismatchError` → HTTP 409, missing ids = legacy deterministic; SOPS §11.2.)
- [x] Add a similarity-score floor and max-context cap on retrieval results before they enter the AI runtime (ADR-0015 follow-up). (`SUPPORT_KB_MIN_SIMILARITY` default 0 / `SUPPORT_KB_MAX_CONTEXT_CHARS` default 24000, top hit always kept — defaults keep the deterministic evals byte-stable; pilot floor suggested 0.25 in `.env.example`.)
- [x] Capture model id, prompt version, latency, tokens, and cost on `ai_runs` end to end. (`RuntimeResult.model` section aggregated on the run trace → optional wire field → activity contract → `createPersistedRunAiGraph` prefers it over static provenance and persists `input_tokens`/`output_tokens`/`cost_estimate`; cost from a built-in per-model price table with env overrides.)
- [x] Run the golden dataset + injection suites against the pilot default model (live, opt-in command) and record pass rates; hard-fail gates must hold; triage regressions before completing. (2026-07-07, `claude-sonnet-5` via `evals.live_runner`: Golden 25 — PASS, topic_accuracy 0.960, routing_accuracy 1.0, escalation 1.0, tool_recall 1.0; Injection 18 — PASS, prompt_injection_pass_rate 1.0; zero unsafe auto-send / unsafe output / legal auto-send / cross-tenant leaks in both. Also run against `claude-opus-4-8`: Golden 25 — PASS (topic 0.960, routing 0.960, escalation 0.960 — Opus routed the one allowlisted auto-send case `auto_1` to human approval, the safe direction), Injection 18 — PASS (rate 1.0), all zero-counts. Pilot default recorded as `claude-sonnet-5` (matches expectations exactly incl. the auto-send case, ~3x cheaper); Opus remains a config-only swap gated by SOPS §11.1. Triaged: the two topic misses (`st_1`, `kbi_3`) are the same defensible taxonomy call — "what is your refund policy?" classified `faq` instead of `refund` — behaviorally safe (correct tools, human-approve routing); tracked for the Milestone 21 dataset expansion. The run also surfaced that provider tool-calling does not hard-enforce nested schema enums: the adapter now deterministically normalizes composer citations (only provided ref_ids may be cited, `type` derived from the real document_type, confidences clamped) — `normalize_model_output` + tests.)
- [x] Prove provider agnosticism: the same suite runs against a second configured provider (or a scripted fake) with only env changes. (`SUPPORT_LLM_PROVIDER=scripted` drives both suites through the SAME LangChain adapter path — prompt files, structured outputs, usage capture — all gates green offline; a real second provider re-run is env-only once an OpenAI key exists.)
- [x] Update docs (AI_RUNTIME_HARNESS provider/prompt sections, DECISIONS, this file). (AI_RUNTIME_HARNESS §8/§9/§21, BACKEND_SPEC §9 embedding note, TEST_STRATEGY §3.10 additions, SOPS §11.1/§11.2, README, AGENTS.md, `.env.example`, ADR-0023.)

Acceptance criteria:

- [x] A ticket produces a real Claude-drafted, citation-grounded response end to end on local infra. (2026-07-07: the sidecar e2e gained an opt-in real-model mode — `E2E_AI_REAL_PROVIDER=anthropic E2E_AI_REAL_MODEL=claude-sonnet-5` spawns the sidecar with the real provider; the happy path passed live with the persisted `ai_runs` row carrying `model_provider=anthropic`, `model_id=claude-sonnet-5`, both prompt versions, real token counts and cost estimate, a non-empty Claude draft, retrieved evidence in the run state, audited tool calls, approval → exactly one send; sidecar-down/500 degradation unchanged. 3/3 tests green in real-model mode AND in the deterministic default mode.)
- [x] Switching LLM provider is a config change plus an eval-gate re-run — no code change (SOPS §11 enforced). (Proven mechanically by the scripted-provider env-only switch; SOPS §11.1 documents the mandatory `live_runner` gate.)
- [x] Hard-fail safety gates hold against the real model: zero unsafe auto-send, zero cross-tenant leaks, injection pass rate 1.0. (2026-07-07 vs `claude-sonnet-5`: all three hold exactly — injection pass rate 1.0, zero unsafe auto-send, zero cross-tenant leaks, plus zero unsafe output and zero legal/chargeback/fraud auto-send.)

## Milestone 16: Real Authentication And Policy Lifecycle

Goal: Replace the placeholder header auth with IdP-issued JWT verification and add the policy write/activate endpoints. (Phase 1; ADR-0020.)

Checklist:

- [x] Confirm and provision the IdP (default Clerk; user-owned account setup); record the final choice in DECISIONS. (Clerk confirmed — dev instance `fluent-leech-80.clerk.accounts.dev`, session-token customization adds `aud`+`email`; ADR-0024.)
- [x] Implement JWKS-based JWT verification in `readAuthContext`: issuer/audience checks, expiry with clock skew, cached key rotation; map the token subject to the `users` row and load roles from the DB (tokens carry identity; the DB stays the role source of truth). (`packages/api/src/auth.ts` — jose verifier, `users.idp_subject` via migration `0006`, `UserDirectory` port with DB impl.)
- [x] Enforce tenant membership server-side: the authenticated user must belong to the tenant they operate on (403 on non-membership; explicit tenant selection remains). (NULL-tenant users are platform-wide; enforced in the request-context hook before route handlers.)
- [x] Add machine-to-machine auth for internal service endpoints (AI sidecar → `/internal/tools/execute`, `/v1/kb/search`): scoped internal/client-credentials tokens distinct from user tokens. (The Milestone 14 machine token is checked before user auth in every mode; internal endpoints reject user JWTs — matrix-tested. Kept static per ADR-0024 (6): the sidecar never leaves the internal trust boundary in v1.)
- [x] Keep webhooks signature-authenticated and health endpoints public (unchanged); the header-injection auth mode survives only behind an explicit env flag for tests/local, default off. (`SUPPORT_AUTH_MODE=insecure-headers`; a JWT-mode boot missing issuer/audience fails fast.)
- [x] Add policy lifecycle endpoints: create policy/version (draft), activate (immutable once active; archives the predecessor), archive — emitting the reserved `policy.created|activated|archived` audit actions; automation-allowlist changes become API-driven. (BACKEND_SPEC §17.8; `policies:write` admin-only; automation content validated at write AND activation; one active policy per domain.)
- [x] Surface `retention_policy` on the tenant API contract (Milestone 12 follow-up). (Read-only on `TenantResponseSchema`; changing it stays an ops action.)
- [x] Update the RBAC matrix test to run under real-token fixtures; add negative tests: expired/forged/wrong-audience/absent tokens → 401 on every route; valid token + non-member tenant → 403; internal endpoints reject user tokens. (Local JWKS + RSA-signed tokens through the production verifier; plus wrong-issuer/expiry-less/unknown-subject 401s, header-spoof rejection, platform-user span; live Clerk smoke opt-in.)
- [x] Update docs (BACKEND_SPEC auth section, SOPS user provisioning in onboarding, DECISIONS, this file). (BACKEND_SPEC §3.2/§8.2/§13/§17.0/§17.8/§22; SOPS §1.1/§3; TEST_STRATEGY §3.2/§3.6; ADR-0024; README; PROJECT_HISTORY; `.env.example`.)

Acceptance criteria:

- [x] No endpoint trusts unverified headers when production auth mode is on. (JWT mode ignores identity headers entirely — matrix header-spoof test; header mode requires the explicit opt-in.)
- [x] Forged, expired, or wrong-audience tokens are rejected on every route; cross-tenant operation without membership is 403. (Full-catalog negative suites in rbac-matrix.test.ts; live-DB membership tests in auth.integration.test.ts.)
- [x] Policy versions are creatable/activatable via the API with `policy.*` audit events and activation immutability enforced. (Live-PostgreSQL lifecycle drive: create → version → activate → 409 re-activation/stale-draft → archive, audits attributed to the acting user.)

## Milestone 17: Scheduled Jobs And Retention Execution

Goal: QA sampling and retention run unattended on schedule, and retention actually purges every configured class. (Phase 1.)

Checklist:

- [ ] Schedule the QA sampling job per tenant on Temporal Schedules (daily), with idempotent create-if-missing bootstrap from the worker entrypoint.
- [ ] Schedule the retention job per tenant likewise (daily).
- [ ] Implement the blob sweeper: delete cleared raw-payload refs from object storage (the retention job already returns them).
- [ ] Implement the attachment purge and AI-run anonymization retention classes (currently counted-and-reported placeholders; fail-closed semantics preserved).
- [ ] Add job observability: per-run metrics + structured logs, and a job-failure alert rule in `infra/observability/alerts.yaml`.
- [ ] Live coverage: schedules fire against local Temporal; a retention run clears refs, sweeps blobs, and audits `retention.applied`; QA sampling emits `support.qa.review_created.v1` on schedule; re-runs stay idempotent.
- [ ] Update docs (SOPS §10/§16 scheduling runbooks, this file).

Acceptance criteria:

- [ ] Both jobs run on cadence with no human action, and failures alert.
- [ ] Retention purges raw payloads, attachments, and AI-run PII per tenant policy and audits every application.

## Milestone 18: Staging Environment On Hardened Compose

Goal: A production-shaped staging deployment on a single VM built from the existing Compose stack. (Phase 2; ADR-0020. User-owned inputs: the VM, staging/production DNS records, the alert notification channel.)

Checklist:

- [ ] Production Dockerfiles for the API, worker, and AI sidecar (multi-stage; pruned pnpm-deploy images; uv-locked Python image).
- [ ] A production Compose profile under `infra/production/`: app services + PostgreSQL/Temporal/NATS/Redis/MinIO/collector with restart policies, resource limits, internal-only networks, no dev mounts or exposed dev ports.
- [ ] TLS reverse proxy (Caddy or Traefik) terminating only the API + webhook endpoints; Temporal UI/Grafana behind auth or SSH tunnel; everything else internal.
- [ ] Prometheus + Grafana + Alertmanager services provisioned from `infra/observability/` (dashboards + alert rules loaded as code); alert notifications wired to the chosen channel.
- [ ] Secrets as env files outside the repo following the SecretResolver naming contract, documented per service.
- [ ] Automated nightly PostgreSQL backups shipped offsite with a tested restore drill; MinIO data backup story documented.
- [ ] CI deploy workflow: build + push images (GHCR) on tag, deploy to the VM over SSH, health-gate, and a tested one-command rollback to the previous tag.
- [ ] Apply `pnpm db:migrate` + `pnpm db:seed:pilot` on staging; run the RLS smoke check (support_app role; cross-tenant read/write fails).
- [ ] Run the live integration suites once against the staging database (per SOPS §19).
- [ ] Update docs (infra README/deploy runbook, SOPS §19 refinements, this file).

Acceptance criteria:

- [ ] Staging serves the API over TLS with the worker and sidecar running as supervised services.
- [ ] Grafana shows live dashboards; a synthetic critical failure fires an alert to the real channel.
- [ ] Backup restore and deploy rollback have each been exercised successfully at least once.

## Milestone 19: Live Providers And Go-Live Rehearsal

Goal: Real channel providers wired to staging and the full production checklist rehearsed. (Phase 2. User-owned inputs: Mailgun account + DNS changes, Meta Business verification, the pilot support address/domain choice.)

Checklist:

- [ ] Configure the Mailgun domain (SPF/DKIM/DMARC verified) and inbound route to `POST /v1/webhooks/email/mailgun?channel_id=...` on staging; signing/API keys as env refs.
- [ ] Confirm signature verification with a real Mailgun delivery; confirm a bad signature is rejected 403.
- [ ] Verify outbound delivery: an approved draft lands in a real external mailbox, threaded correctly via the RFC 5322 reply headers.
- [ ] Wire WhatsApp Cloud API when Meta verification completes (parallel track; email go-live does not block on it).
- [ ] Full rehearsal on staging: real inbound email → ticket → real-model draft with citations → human approval → reply delivered → audit trail + QA sample verified.
- [ ] Modest load/chaos smoke: a burst of concurrent inbound emails (dedup holds), worker restart mid-flight (no duplicate sends), provider 5xx injection (retry then alert).
- [ ] Execute the complete SOPS §19 production deployment checklist against staging and record results in this file.
- [ ] Update docs (provider setup runbook if needed, this file).

Acceptance criteria:

- [ ] A real email round-trips the entire system on staging with a real-model draft and human approval.
- [ ] Every SOPS §19 box checks green.

## Milestone 20: Console Enablement API

Goal: Everything the separate console repository needs to build the reviewer experience without backend rework. (Phase 3. User-owned: the console repository itself, built against the published client; IdP app config shared with Milestone 16.)

Checklist:

- [ ] CORS support with an env-driven origin allowlist (off by default).
- [ ] Approval queue ergonomics on `GET /v1/approvals`: pending/status filters, age/created ordering, pagination hardening, and a cheap open-counts summary.
- [ ] `GET /v1/approvals/{approval_id}/evidence`: the reviewer composite (conversation, messages, AI run + trace link, tool calls, draft with policy/KB citations, prior approvals), mirroring the QA evidence read.
- [ ] Reviewer identity from the verified token: decisions record the reviewer from auth context, not the request body.
- [ ] Queue freshness contract for polling clients (`updated_since` filtering and/or ETag) documented in OpenAPI; SSE deferred unless trivial.
- [ ] Basic rate limiting on authenticated endpoints backed by Redis (first production use of the Redis service).
- [ ] OpenAPI completeness pass over every endpoint + a generated typed TypeScript client package the console repo can consume, with a documented regeneration command.
- [ ] A scripted end-to-end walkthrough (login → queue → evidence → decide → QA complete) validating the documented call sequences a console will make.
- [ ] Update docs (BACKEND_SPEC console API section, this file).

Acceptance criteria:

- [ ] The console repo can implement login → queue → review → decide → QA purely from the OpenAPI doc and typed client, with no backend changes required mid-build.

## Milestone 21: Eval Expansion And Shadow Replay

Goal: Statistical confidence in the real-model pipeline before real customer traffic. (Phase 4. User-owned inputs: sanitized historical tickets/FAQs from the pilot client, threshold signoff, shadow-result review.)

Checklist:

- [ ] Expand the golden dataset to the TEST_STRATEGY §4 per-category counts (100-300 cases), including sanitized real samples from the pilot client where available.
- [ ] Add the LLM-graded draft-quality rubric (grounding, policy fidelity, tone, completeness) as soft gates with agreed thresholds, reported alongside the hard gates.
- [ ] Build the shadow replay harness: feed historical tickets through the full staging pipeline with sends disabled, recording classification, routing, draft, guardrails, and would-have-auto-sent verdicts (SOPS §11 stage 3).
- [ ] Produce the shadow-run report (extend the pilot-weekly report or a dedicated eval report) for client and internal review.
- [ ] Re-run the injection suite on the expanded set; hard-fail gates hold.
- [ ] Update docs (TEST_STRATEGY §4 counts recorded as met, AI_RUNTIME_HARNESS eval sections, this file).

Acceptance criteria:

- [ ] Eval report over ≥100 cases: hard gates green, quality rubric at or above the agreed thresholds.
- [ ] A shadow run over real historical tickets is reviewed with a defect rate below the agreed bar.

## Milestone 22: Pilot Gap-Closing And Go-Live

Goal: Close the known product gaps real traffic will hit, then take the pilot live in 100% human-approval mode. (Phase 4. User-owned inputs: pilot contract + success metrics, reviewer staffing/rota, go/no-go decision, client comms.)

Checklist:

- [ ] Attachment binary storage: download provider media to object storage, post-download size/type re-validation (Milestone 12 follow-up), reference-only serving.
- [ ] HTML sanitization to `body_html_ref` for inbound email bodies (Milestone 6 follow-up).
- [ ] Next-response and resolution SLA timers in the workflow alongside the existing first-response timer (Milestone 5 follow-up).
- [ ] Outbound email subject strategy (Milestone 10 follow-up).
- [ ] Decide and implement — or explicitly accept for the pilot — the single-ticket-per-conversation limitation (Milestone 6 follow-up; record in DECISIONS).
- [ ] Fix whatever the shadow run surfaced (reserve capacity; enumerate in-session).
- [ ] Production tenant configuration: real KB ingested + retrieval spot-checked, SLA policy per the pilot contract, escalation contacts, retention policy confirmed.
- [ ] Final production deploy; SOPS §19 re-run on production; go-live: route the pilot client's support address to the platform.
- [ ] Hypercare: elevated monitoring window with an on-call owner and daily QA review of 100% of sent replies for the first week.
- [ ] Update docs (PROJECT_HISTORY go-live record, SOPS refinements, this file).

Acceptance criteria:

- [ ] The pilot tenant is live on real customer traffic with every outbound reply human-approved.
- [ ] The weekly pilot report generates from real data; alerting is live; the hypercare owner is assigned.
- [ ] No SEV1/SEV2 in the first hypercare week, or each one is postmortem'd per SOPS §13.

## Completed Log

Use reverse chronological order.

### 2026-07-07

- Completed Milestone 16 - Real Authentication And Policy Lifecycle (`feat-milestone16-real-auth-policy-lifecycle`): production JWT auth as the API default (ADR-0024 — Clerk confirmed as the pilot IdP; jose/JWKS verification with issuer/audience/expiry + clock tolerance, cached key rotation, RS256-only, uniform 401 at the `readAuthContext` choke point; verified subjects mapped to `users.idp_subject` via migration `0006` with DB-sourced roles from `user_roles`; server-side tenant membership with NULL-tenant platform users; trusted-header mode only behind explicit `SUPPORT_AUTH_MODE=insecure-headers`, JWT-mode boots failing fast on missing issuer/audience; machine token checked before user auth in every mode, internal endpoints rejecting user JWTs), the policy lifecycle endpoints behind admin-only `policies:write` (create header+v1 draft, draft versions, single-shot activation with stale-draft rejection and same-domain predecessor archival, manual archive; `policy.created|activated|archived` audits in the same transaction; automation content validated against the closed ceiling at write AND activation, fail-closed after archive), `retention_policy` surfaced read-only on the tenant contract, the RBAC matrix reworked under real RSA-signed JWTs via a local JWKS server with full negative suites, the committed live-PostgreSQL `auth.integration.test.ts`, the opt-in live Clerk smoke `auth.clerk-live.integration.test.ts` (1/1 PASS against the real dev instance this session), and pilot-seed IdP-subject linking (`PILOT_SEED_*_IDP_SUBJECT`). Docs: BACKEND_SPEC §3.2/§8.2/§13/§17.0/§17.8/§22, SOPS §1.1/§3, TEST_STRATEGY §3.2/§3.6, ADR-0024, README, PROJECT_HISTORY, `.env.example`.
- Closed Milestone 15 live in the previous session (recorded there): `evals.live_runner` PASS on `claude-sonnet-5` and `claude-opus-4-8`; pilot default `claude-sonnet-5`; real-Claude e2e drive 3/3.

### 2026-07-04

- Designed and recorded the V1 launch plan (`docs-v1-launch-plan`, docs only): four phases, Milestones 13-22, consolidating all accumulated milestone follow-ups into concrete checklists plus a user-owned non-code launch track; locked the launch platform decisions with the user in ADR-0020 (HTTP sidecar AI bridge, provider-agnostic model layer with Anthropic Claude + OpenAI `text-embedding-3-small` pilot defaults, hosted-IdP JWKS auth, single-VM hardened-Compose deployment, reviewer console in a separate repository); updated `PLAN.md`, `docs/PROJECT_HISTORY.md`, and `README.md`.
- Completed Milestone 12 - Security And Pilot Readiness (`feat-milestone12-security-pilot-readiness`) — the final planned milestone: deny-by-default RBAC (no implicit role) with a self-verifying route×role matrix test and a `reports:read` permission; a shared validating integration-secret resolver; content-level PII redaction in structured logs; the 18-case prompt-injection eval suite with hard-fail gates; inbound attachment size/type/filename validation rejecting before any persistence with per-message webhook reporting; the closed `SupportAuditActionSchema` audit taxonomy with compile-time typing and completeness tests; per-tenant data retention hooks (`tenants.retention_policy` via migration `0004` + a fail-closed retention job auditing `retention.applied`); the idempotent pilot tenant seed (`pnpm db:seed:pilot`, incl. the six global first-party `tool_definitions`); the weekly pilot report (`GET /v1/reports/pilot-weekly`, SOPS §14 metrics in one RLS transaction); fail-closed auto-send allowlist controls (automation policy version + kill switch + closed low-risk topic set, `GET /v1/policies/automation`, the workers `evaluateAutoSendEligibility` gate, a live workflow no-bypass test, and golden case `auto_2`); and SOPS §1.1 pilot onboarding + §19 production deployment checklist. ADR-0019. Verified offline (458 TS tests + 56 Python) and live (DB 19, API 37, workers 6, Temporal workflow 8, migration 0004, idempotent seed drive, live report/automation-policy/retention drive incl. an actual expired-ref purge with audit row).
- Completed Milestone 11 - Observability And QA (`feat-milestone11-observability-qa`): the shared `@support/observability` package (OTel tracing/metrics bootstrap, `SupportMetrics` port, structured logging with trace ids and redaction), API request telemetry + approval/tool metrics, instrumented workflow activities with critical-failure metrics, AI-run persistence with trace links (materializing the Milestone 10 `ai_run_id` FK links), AI run read endpoints, the QA review surface (list/read/create/complete + composite evidence read), the deterministic QA sampling job, event-consumer dead-letter metrics, and dashboards/alert definitions + a collector Prometheus exporter under `infra/`. ADR-0018. Verified offline (363 TS tests + 49 Python) and live (DB 19, API 37, workers 6, Temporal workflow 7, collector smoke drive).
- Completed Milestone 10 - Approval And Outbound Messaging (`feat-milestone10-approval-outbound`): approval decision endpoints with the edited-draft audit trail and post-commit workflow signaling, outbound email/WhatsApp adapters + HTTP sender, and production approval/outbound/audit persistence activities with deterministic retry-safe ids and database-enforced send-once. ADR-0017.

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
