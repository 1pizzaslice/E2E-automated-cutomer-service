# Project History And Handoff

## Purpose

This file records what has happened so far so a new human or AI agent can understand the project without relying on chat history.

## Current State

- GitHub repo cloned at `/home/anish/CODE01/STARTUPS/E2E-automated-cutomer-service`.
- Backend scaffold has a local `main` commit.
- No frontend has been implemented. The reviewer console is planned in-repo at `apps/console` as Milestone 23 (ADR-0026).
- The full v1 ticket lifecycle now runs end to end with the AI decision made in the Python runtime service (Milestone 14): the FastAPI sidecar under `ai/service/` serves the support graph over `POST /internal/ai/run` (bearer-token auth, structured JSON logs), the production `createHttpRunAiGraph` Temporal activity calls it with full failure classification (sidecar outages degrade to audited failed AI runs routed to human — never failed workflows), tool execution flows over the API's machine-token-authenticated `POST /internal/tools/execute` into the governed registry, retrieval flows over `POST /v1/kb/search`, and service-path runs are proven byte-identical to in-process runs by the eval-parity harness. Since Milestone 15 the sidecar's model is the config-selected real provider (pilot default Anthropic `claude-sonnet-5`, live-gated), since Milestone 16 the API enforces real IdP JWT auth, since Milestone 17 the QA-sampling/retention jobs run unattended on per-tenant Temporal Schedules, and since Milestone 18 a production-shaped single-VM deployment exists as code (`infra/production/`, validated locally). Still pending on the launch path: standing the staging stack up on a real VM + live channel providers (Milestone 19), the console-enablement API (Milestone 20), and next-response/resolution SLA timers.
- Milestone 0 documentation harness is complete.
- Milestone 1 backend scaffold is complete and locally verified.
- Milestone 2 database foundation is implemented and locally verified, including live PostgreSQL repository execution tests and row-level security enforcement tests.
- Milestone 3 API skeleton is complete with request/auth/tenant context middleware placeholders, structured errors, a generated OpenAPI document endpoint, role permission checks, typed tenant/customer/ticket list-create-read-update contracts, typed conversation/message/policy/KB document/approval/audit event read-list contracts, ticket audit event list contracts, and PostgreSQL-backed API integration tests for those endpoint families.
- Milestone 4 event bus foundation is complete with shared v1 domain event envelope and payload schemas, a tenant-aware NATS subject convention, worker-side NATS JetStream publisher/consumer base and connection wiring, explicit domain/error stream config, idempotent consumer handling, structured consumer error records, workflow-ready event emit helpers, and live NATS publish/consume integration coverage. CRUD skeleton endpoints still do not publish events.
- Milestone 5 Temporal workflow foundation is complete with Temporal TypeScript SDK dependencies, worker config/runtime scaffolding, a deterministic ticket lifecycle workflow shell, activity contracts/placeholders, first-response SLA timer behavior, a structured AI graph activity placeholder with success/failure-to-human routing, a `sendOutboundMessage` activity placeholder with deterministic approval-outcome routing, a domain-event activity adapter that reuses the Milestone 4 emit helpers (now including message-sent), explicit activity retry policies, offline unit coverage, and an opt-in live Temporal workflow test with replay coverage. Real DB/AI/channel side effects and API workflow start/signal wiring remain bound behind activity boundaries for later milestones.
- Milestone 6 channel intake is complete. The normalized inbound message contract is defined in `packages/shared-schemas` as `NormalizedInboundMessageSchema` (plus `NormalizedInboundChannelSchema`, `CustomerIdentityTypeSchema`, and customer-identity/body/attachment sub-schemas and inferred types; attachment size is nullable and a message must carry text, html, or an attachment). `packages/integrations/src/channels` adds pure provider adapters — `parseInboundEmailMessage` (email) and `parseInboundWhatsAppMessages` (WhatsApp Cloud, batched) — that map non-strict raw provider payloads into the strict normalized contract with attachment metadata and threading, plus timing-safe HMAC-SHA256 signature verification for WhatsApp (`X-Hub-Signature-256`) and Mailgun. `packages/api` completes intake with the `POST /v1/webhooks/email/{provider}` and `POST /v1/webhooks/whatsapp/{provider}` ingress endpoints (unauthenticated, signature-verified over the raw body, tenant resolved by `channel_id`), raw payload storage by reference (`RawPayloadStore` port; filesystem default), a tenant-scoped `InboundIntakeStore` (PostgreSQL under RLS) that dedups on `external_message_id`/idempotency key and threads conversations on `external_thread_id`, and start/signal wiring to `ticketLifecycleWorkflow` through an `InboundWorkflowLauncher` port (Temporal `signalWithStart`, per-conversation workflow id). An email polling placeholder marks the future scheduled-pull path. Attachment binary storage/oversize rejection, HTML sanitization to `body_html_ref`, and multi-ticket-per-conversation lifecycle remain later slices.
- Milestone 7 KB and retrieval is complete. Ingestion vertical: `packages/shared-schemas` adds `KbDocumentCreateRequestSchema` (content is required and stored by reference), `KbDocumentUpdateRequestSchema` (metadata/status PATCH), `KbChunkResponseSchema` (embeddings intentionally omitted from the contract), and `KbIngestionResultSchema`; `packages/integrations/src/kb` adds the pure, deterministic `chunkDocument` (overlapping paragraph-aware chunks) and an `Embedder` port with `createDeterministicEmbedder` (token-hash L2-normalized `vector(1536)` vectors); `packages/db` adds `0003_kb_vector_index.sql` (a pgvector HNSW `vector_cosine_ops` index over `kb_chunks.embedding`) plus tenant-scoped `createKbDocumentQuery`/`updateKbDocumentByIdQuery`/`deleteKbChunksForDocumentQuery`/`insertKbChunksQuery` helpers; `packages/api` adds a `KbContentStore` port (filesystem default, raw bodies out of PostgreSQL), a tenant-scoped `KbIngestionStore` (writes under RLS; atomic chunk replacement), a `KbIngestionService`, and the endpoints `POST /v1/kb/documents` (create as draft), `PATCH /v1/kb/documents/{id}` (metadata/status), and `POST /v1/kb/documents/{id}/ingest` (chunk, embed, activate) behind a `kb_documents:write` permission. Retrieval vertical: `packages/shared-schemas` adds `KbSearchRequestSchema`, `KbSearchResultSchema` (`KbChunkResponseSchema` plus a relevance `score` and `document_title`/`document_type`/`source_type`/`source_ref` citation fields), and `KbSearchResponseSchema`; `packages/db` adds `searchKbChunksQuery` (tenant-scoped cosine `<=>` nearest-neighbour over the HNSW index, inner-joining `kb_documents` to require `status = 'active'` on both chunk and document — excluding stale/inactive/draft at query time — with optional `document_type`/`source_type` filters and citation columns); `packages/api` adds `kb-retrieval.ts` (a `KbRetrievalStore` port with a DB impl under RLS and an in-memory impl over the ingestion store, and a `KbRetrievalService` that embeds the query with the same `Embedder`) exposed as `POST /v1/kb/search` behind a new `kb:search` permission (granted to the KB-read roles), plus retrieval eval + adversarial prompt-injection fixtures (`kb-eval-fixtures.ts`). Retrieval returns citation IDs and document metadata, never raw embeddings, and treats chunk content as untrusted data (adversarial text is inert evidence, ranking is relevance-only). Verified end to end against a live pgvector database (create → ingest → search: refund query ranks the refunds policy first, cross-tenant search returns nothing, PATCH-to-stale drops the document from answers).
- Milestone 8 tool registry is complete. `packages/shared-schemas` adds the tool contracts (`ToolSideEffectClassSchema`, `ToolPermissionClassSchema`, and the `ToolCallRequestSchema`/`ToolCallResultSchema` envelope with error codes); `packages/integrations` re-exports the enums as the single source of truth and adds `defineSideEffectTool`; `packages/db` adds `tool_calls` repository queries; `packages/api` adds `createToolExecutor` (per-call visibility → permission-class → args validation → timed execution → bounded AI-safe result → `tool_calls` audit, with idempotent replay for side-effect tools) plus the six first-party tools over injectable commerce fixtures and a `kb_search` reusing the Milestone 7 retrieval service.
- Milestone 9 AI runtime is complete. `ai/` holds the v1 support agent graph, implemented (ADR-0016) as a self-contained, dependency-free Python package that mirrors LangGraph's node model behind pluggable ports (`ModelProvider`, `RetrievalPort`, `ToolExecutor`) — because the local harness runs Python via the system interpreter on 3.14 with no `uv`, so LangGraph/LangChain/Pydantic are not installable. The graph is `normalize → classifier → retrieval planner → retrieval → policy → tool planner → tool execution → (conditional) composer → guardrail critic → escalation → finalize`; classification/drafting go through the model port while policy and guardrail are deterministic governance (default human-approval, `human_only` for legal/chargeback/fraud/safety/injection, no auto-send without grounding, tool permissions derived from policy). `RuntimeResult` mirrors the Temporal `RunAiGraphActivityResult` boundary; the tool node speaks the Milestone 8 envelope. `ai/evals/` adds an initial golden dataset + an offline eval runner with hard-fail safety gates. Verified with 49 Python tests and a green eval report (all metrics 1.000, zero unsafe auto-send / cross-tenant leakage).
- Milestone 10 approval and outbound messaging is complete. `packages/shared-schemas` adds the approval decision contracts (`ApprovalApproveRequestSchema`, `ApprovalEditRequestSchema` requiring the human-edited `approved_payload`, reject/escalate request schemas, `ApprovalDecisionResponseSchema` with a `workflow_signal` block) and the outbound contracts (`NormalizedOutboundMessageSchema` — the outbound mirror of the inbound contract — plus `OutboundSendStatusSchema`/`OutboundSentByTypeSchema`). `packages/db` adds the write queries `createApprovalQuery`/`resolvePendingApprovalByIdQuery` (pending-guarded so double-decides conflict instead of overwriting), `createOutboundMessageQuery`/`messageByIdempotencyKeyQuery`/`updateMessageSendResultByIdQuery` (outbound idempotency over the existing `(tenant, idempotency_key)` unique index), `createAuditEventQuery`, `customerIdentityForCustomerQuery`, and `aiRunByIdQuery`. `packages/api` adds `POST /v1/approvals/{id}/approve|edit|reject|escalate` behind a new `approvals:review` permission: one tenant transaction resolves the pending approval (reviewer, notes, `resolved_at`, `approved_payload`; approve mirrors the AI draft, edit stores the human edit while `requested_payload` preserves the original) and appends an `approval.{status}` audit event carrying both payloads (the edited-draft audit trail), then the API signals `approval_completed` on `ticket-lifecycle:{tenant}:{conversation}` through an injectable `ApprovalWorkflowSignaler` (Temporal default, recording double for tests; missing workflows are reported, transport failures are `502 WORKFLOW_ERROR`). `packages/integrations/src/channels` adds the pure outbound adapters (`buildOutboundEmailProviderRequest` with reply-threading headers, `buildOutboundWhatsAppProviderRequest`) and the `OutboundChannelSender` port with `createHttpOutboundChannelSender` (Mailgun + WhatsApp Cloud, injectable `fetch`, retryable-vs-permanent failure mapping) and a recording double. `packages/workers/src/activities/ticket-lifecycle-persistence.ts` implements the production `createApproval`/`sendOutboundMessage`/`recordAuditEvent` activities over a `TicketLifecyclePersistenceStore` port (database impl under RLS + in-memory impl): deterministic approval/audit ids make Temporal retries replay instead of duplicate, `sendOutboundMessage` replays a `sent` idempotency key without re-contacting the provider, records `queued → sent|failed` on the outbound message row, audits `message.send_failed`, and fails fast (`NonRetryableActivityError`) on missing context. The workflow itself was already outcome-aware from Milestone 5 and needed no changes. Verified offline (306 TS tests + Python suite) and live: PostgreSQL API integration (31, incl. the decision endpoints + edited-draft audit), Temporal workflow suite (7, approval pause/resume + send-once/no-send/escalate routing), and a live DB persistence-store drive (approval → decision → send-once → replay → audit dedup, incl. the `ai_runs` FK guard).
- Milestone 11 observability and QA is complete. A new `packages/observability` (`@support/observability`) package is the shared telemetry seam: `startTelemetry` boots OTel tracing + metrics with OTLP/HTTP exporters to the local collector (`OTEL_SDK_DISABLED` opt-out), `createInMemoryTelemetry` captures spans/metrics for tests, the typed `SupportMetrics` port (OTel-backed / no-op / recording) carries the canonical instruments (`SUPPORT_METRIC_NAMES`: API requests/duration, workflow activity executions/duration, AI run completions/duration, tool call executions/duration, approval requests/decisions/latency, and a `support.critical_failures` counter keyed by failure mode), and `createStructuredLogger` emits redacted JSON logs that inject the active span's `trace_id` (DEVELOPMENT_RULES §13 fields). The API traces every request (`http.request` span with `support.request_id`/`support.correlation_id`/`support.tenant_id` attributes; pino rebound with the same ids + `service`/`environment` base fields and auth-header redaction), records per-request metrics with route templates, spans+meters the tool executor and `approvals.decide` (decision counter, request→decision latency, `approval_signal_failed` critical metric), and boots telemetry first in `server.ts`. Workers gained `instrumentTicketLifecycleActivities` (span/metrics/log wrapper for every ticket lifecycle activity with domain critical-failure mapping: failed AI results → `ai_graph_failed`, send throws → `outbound_send_failed`, SLA breach emission → `sla_breached`), event-consumer dead-letter metrics, and `createPersistedRunAiGraph`, which persists every AI run to `ai_runs` (structured output, confidence/risk/automation recommendation, guardrails, latency, `trace_id`; deterministic ids for retry replay; failed runs persisted with a backfilled deterministic id) — materializing the Milestone 10 `approvals.ai_run_id`/`messages.ai_run_id` FK links. The API adds `GET /v1/ai-runs`(+`/{id}`) behind `ai_runs:read` and the QA review surface behind `qa_reviews:read`/`qa_reviews:write`: list/read/create/complete plus `GET /v1/qa-reviews/{id}/evidence`, the composite reviewer package (ticket, conversation, messages incl. the outbound final response, AI run with trace link, tool calls, approvals with original draft + human edit). The deterministic QA sampling job (`packages/workers/src/qa-sampling.ts`) queues completed AI runs per SOPS §10 (100% auto-send → `auto_send_candidate`, 100% high-risk → `high_risk`, hash-bucketed 25% default `random_sample`; deterministic `qa_review_id` + conflict-safe inserts make re-runs idempotent) and emits `support.qa.review_created.v1`. Infra: the otel-collector config gains a Prometheus exporter (`:8889`, suffix-free translation so scraped names match `SUPPORT_METRIC_NAMES` dot-for-underscore), and `infra/observability/` holds the Grafana dashboard definition, Prometheus alert rules for the critical failure modes, and the naming/tracing README. See ADR-0018.
- Milestone 12 security and pilot readiness is complete. RBAC is deny-by-default (the implicit `support_agent` role fallback was removed — a request without a parseable `x-user-roles` is `401`) and mechanically verified by a route×role matrix test that enumerates every registered route via a Fastify `onRoute` collector against a permission catalog (`packages/api/src/rbac-matrix.test.ts`; a new `reports:read` permission gates reporting). Integration secret handling is centralized in a validating `SecretResolver` (`packages/integrations/src/secrets.ts`; references must be env-var-shaped before the environment is consulted; both the webhook-signature and outbound-credential resolvers delegate to it). The observability logger adds content-level PII redaction (emails/phones/card-like digit runs scrubbed from string fields, arrays, and the message itself) on top of non-disableable secret-key redaction. `ai/evals/injection_suite.py` adds an 18-case prompt-injection suite (15 user-text injections + 3 KB-content injections against a poisoned corpus) with hard-fail gates. Inbound attachments are validated before any persistence (`validateInboundAttachments` in `packages/integrations`: 10 MiB cap, content-type allowlist, filename safety, per-message bound; rejected messages create nothing and report `rejected`/`rejection_reason` in the webhook 202). Audit actions are a closed taxonomy (`SupportAuditActionSchema`) typed at the workers boundary and validated in the API decide path, with an audit-completeness test driving every live producer. Data retention hooks: `tenants.retention_policy` (migration `0004`) + the workers retention job (`runTenantRetentionJob`) that clears expired raw-payload refs in bounded batches, audits `retention.applied`, reports attachment/AI-run purges as placeholders, and fails closed on missing/malformed config. Pilot tenant seed: `buildPilotSeedPlan`/`applyPilotSeed` (`pnpm db:seed:pilot`, idempotent, deterministic ids, secrets as env refs, auto-send disabled, seeds the six global first-party `tool_definitions` — closing a Milestone 8 follow-up). The weekly pilot report (`GET /v1/reports/pilot-weekly`) computes the SOPS §14 metrics in one RLS transaction. Auto-send allowlist controls: the tenant's `automation`-domain policy version (`AutomationPolicyContentSchema`: kill switch + topics constrained to the closed `faq|order_status` set), `GET /v1/policies/automation` resolving the effective controls (fail-closed), and the workers `evaluateAutoSendEligibility` gate any future auto-send branch must consult; a live workflow test proves an `auto_send` AI recommendation still cannot send without a human approval signal, and golden case `auto_2` proves a tenant-allowlisted `refund` topic still routes to human approval. SOPS gained §1.1 (pilot onboarding implementation) and §19 (production deployment checklist). See ADR-0019.
- All twelve build milestones are complete. The V1 launch plan (four phases, `TODO.md` Milestones 13-23 plus a user-owned non-code track) was designed and recorded on 2026-07-04, consolidating the accumulated follow-ups; the launch platform decisions (HTTP sidecar AI bridge, provider-agnostic model layer with Anthropic Claude + OpenAI `text-embedding-3-small` pilot defaults, hosted-IdP JWKS auth, single-VM hardened-Compose deployment) are recorded in ADR-0020. ADR-0026 (2026-07-08) supersedes ADR-0020's separate-console-repository clause: the reviewer console lives in this repository at `apps/console`, `packages/api` is its backend, and the console UI is Milestone 23.
- Milestone 13 production worker entrypoint and ticket persistence is complete (the first V1 launch milestone, Phase 1). The workflow now mutates real ticket state under RLS: production `createOrUpdateTicket` (create-or-load of the deterministic `tkt_{conversation_id}` row with SLA due dates from the tenant's active policy, initial-message linking, `ticket.created` audit + `ticket_events` row), `runInitialTriage` (deterministic keyword classifier `classifyInitialTriage` persisting topic/subtopic/priority/language and moving `new -> triaged`; hard-sensitive text routes to manual escalation), `recordInboundMessage` (reconciles workflow-signaled inbound messages onto the ticket with no duplicates; a customer reply moves `waiting_customer -> waiting_human`), plus the new explicit `applyTicketStateTransition` activity persisting every other workflow-owned transition (`waiting_ai`/`waiting_human`/`waiting_customer`/`closed`) with append-only `ticket_events` rows and closed-taxonomy audits, and `expireApproval` implementing BACKEND_SPEC §12 approval expiry (`APPROVAL_EXPIRY_MS`-configured wait recorded in workflow history via `createApproval.expires_in_ms`, pending-guarded `pending -> expired` with `approval.expired` audit, reviewer decisions win races, workflow ends in `approval_expired` with the ticket back in the human queue). `messages.send_status`/`sent_by_type` became PostgreSQL enums (migration `0005`). The workflow emits `support.ai_run.completed.v1` + `support.tool_call.completed.v1` domain events after every AI graph run (payload types exported from shared-schemas; new build/emit helpers). The production entrypoint (`packages/workers/src/main.ts`, `pnpm worker:start`) composes the database persistence store, the deterministic TypeScript `createDeterministicRunAiGraph` stand-in behind `createPersistedRunAiGraph` (the Milestone 14 sidecar seam), the HTTP outbound sender, NATS JetStream event emission with idempotent stream provisioning, and full activity instrumentation into `createTicketLifecycleWorker`, with fail-fast env validation and graceful SIGINT/SIGTERM shutdown. A committed live end-to-end test (`pnpm test:e2e`) drives a signed Mailgun webhook through the real API intake, the running worker, an API approval decision, and the stubbed-fetch outbound send — asserting the persisted ticket and triage fields, the ordered ticket-event trail, the deterministic AI run + approval FK link, follow-up-message reconciliation, intake dedup, the complete audit trail, JetStream domain events, and exactly one provider send across a worker restart mid-workflow. See ADR-0021.
- Milestone 14 AI runtime service bridge is complete (Phase 1, second launch milestone). The Python runtime ships as an HTTP sidecar: `ai/service/` (new uv `service` extra — fastapi/uvicorn/httpx) exposes `POST /internal/ai/run` taking the wire mirror of `RuntimeRequest` (strict stdlib parser; contract violations are 400, domain failures are 200 with the structured failed result) behind a constant-time bearer check (`SUPPORT_AI_SERVICE_TOKEN_REF` conventions, 401 otherwise) plus unauthenticated `GET /health`, logging one structured JSON line per run (correlation/trace/tenant/ticket/ai_run ids, outcomes only). In service mode the sidecar's `HttpToolExecutor` posts the Milestone 8 envelope to the API's new `POST /internal/tools/execute` — authenticated by a machine token that mints the reserved `internal_service` RBAC role (exactly `tools:execute_internal` + `kb:search`; header-claimed `internal_service` is rejected; no token configured = fail closed) and executed through the governed `createDatabaseToolExecutor` — and `HttpRetrieval` posts to `POST /v1/kb/search`; the registry anchors in-flight runs with `started` ai_runs skeletons (conversation resolved from the ticket) that the worker's `recordAiRunResult` completes, since tool calls now audit against a run that is still executing. On the worker side, `createHttpRunAiGraph` builds the request from DB context (`createDatabaseAiGraphContextStore`: messages/customer/tenant under RLS) plus the tenant automation policy (the Milestone 12 bridge into `policy`/`allow_auto_send`), posts with explicit timeout and correlation/trace headers, retries transient transport/5xx in-activity, and classifies every failure into structured `failed` results (`AI_SIDECAR_UNAVAILABLE`/`AI_SIDECAR_ERROR` retryable; `AI_SIDECAR_UNAUTHORIZED`/`AI_SIDECAR_REJECTED`/`AI_SIDECAR_CONTRACT_ERROR`/`AI_CONTEXT_UNAVAILABLE` permanent) behind the unchanged `createPersistedRunAiGraph` seam — enabled by `AI_RUNTIME_SERVICE_URL` (unset keeps the Milestone 13 deterministic stand-in). Local run path: `pnpm ai:service` or the Compose `ai-service` container (uv-based `ai/Dockerfile`, first Dockerfile in the repo). Service-path determinism is proven by `python -m service.eval_parity` (all golden cases byte-identical, gates green through the service), and the committed live drive (`pnpm --filter @support/workers test:e2e:service`) covers the sidecar happy path with retrieval/tools over the network plus sidecar-down/sidecar-500 degradation to human-routed audited failures. See ADR-0022.
- Milestone 15 provider-agnostic model layer is complete (Phase 1, third launch milestone). The real LLM is a config-selected LangChain adapter behind the unchanged `ModelProvider` port (`ai/runtime/llm.py`: `SUPPORT_LLM_PROVIDER`/`SUPPORT_LLM_MODEL`, deterministic offline default, structured outputs over closed vocabularies, timeout/retry, token+latency+cost capture, deterministic post-parse normalization of citations/confidences), with versioned prompt files behind a frontmatter-validated registry, runtime-reported model provenance/usage persisted onto `ai_runs` end to end, the platform priority unification (`p0`-`p3`), the env-selected TS `Embedder` factory (pilot default OpenAI `text-embedding-3-small`, 1536-dim allowlist) shared by ingestion+retrieval with `embedding_model_id` recording and fail-closed query-time mismatch enforcement (409), retrieval similarity floor + max-context cap, the `scripted` provider proving env-only provider swaps, and the opt-in live gate `evals.live_runner`. Closed live against real Claude: `claude-sonnet-5` golden 25 PASS (topic 0.960/routing 1.0) + injection 18 PASS (rate 1.0, zero unsafe auto-send/leaks), `claude-opus-4-8` both suites PASS; pilot default recorded as `claude-sonnet-5`; real-Claude citation-grounded e2e drive via the sidecar e2e's opt-in `E2E_AI_REAL_PROVIDER` mode. See ADR-0023.
- Milestone 16 real authentication and policy lifecycle is complete (Phase 1, fourth launch milestone). The API's default auth mode is production JWT verification (ADR-0024, IdP = Clerk): `jose`-based JWKS verification (issuer/audience/expiry with clock tolerance, cached keys with rotation refetch, RS256 only, uniform 401) at the `readAuthContext` choke point, verified subjects mapped to `users.idp_subject` (migration `0006`) with DB-sourced roles from `user_roles`, server-side tenant membership (tenant-bound users 403 on any other tenant; NULL-tenant platform users span tenants), and the trusted-header mode surviving only behind explicit `SUPPORT_AUTH_MODE=insecure-headers` (JWT mode missing issuer/audience fails the boot). The machine token (sidecar) is checked before user auth in every mode and internal endpoints reject user tokens. Policy lifecycle writes landed: `POST /v1/policies` (header + version-1 draft), `GET|POST /v1/policies/{id}/versions`, `POST /v1/policy-versions/{id}/activate` (single-shot activation, stale-draft rejection, same-domain predecessor archival — exactly one active policy per domain), `POST /v1/policies/{id}/archive`, all admin-only (`policies:write`), emitting the reserved `policy.created|activated|archived` audits transactionally, with `automation` content validated against the closed allowlist ceiling at write AND activation (auto-send controls fail closed after archive). `retention_policy` is surfaced read-only on the tenant contract. The RBAC matrix runs under real signed JWTs (per-suite RSA keys via a local JWKS server through the production verifier) with the full negative suites; a live-PostgreSQL auth+lifecycle integration suite and an opt-in live Clerk smoke (real session token minted via the Clerk Backend API, verified through the real JWKS with the dashboard `aud`/`email` token customization) close the loop. See ADR-0024.
- Milestone 17 scheduled jobs and retention execution is complete (Phase 1, fifth and final launch milestone of the phase). The QA sampling and retention jobs run unattended on per-tenant Temporal Schedules (ADR-0025): `support-qa-sampling-{tenant}` / `support-retention-{tenant}` fire daily at configurable UTC times (defaults 02:00/02:30, 5m jitter, overlap SKIP, 6h catch-up) and start `qaSamplingJobWorkflow`/`retentionJobWorkflow` — thin deterministic drivers looping one bounded-batch activity on the same task queue/worker as the ticket lifecycle. The worker entrypoint bootstraps the schedules create-if-missing on every start (existing schedules and operator edits untouched; bootstrap failure is fatal; `SUPPORT_JOB_SCHEDULES=disabled` opt-out). Retention now executes every configured class fail-closed: raw-payload blobs are deleted through the new `BlobSweeper` port (filesystem implementation scoped to `RAW_PAYLOAD_STORE_DIR`; sweep-before-clear — an undeletable blob keeps its row for retry and records the new `retention_sweep_failed` critical-failure mode), expired attachment metadata is purged (local `file://` object refs swept first; provider-side refs are metadata-only by design), and expired AI runs are anonymized in place (`structured_output` nulled, `guardrail_results` reset, `anonymized_at` stamped via migration `0007`; run metrics/provenance retained for reporting) — every applied run audits `retention.applied` with per-class counts. Job observability: `support.job.executions`/`support.job.duration_ms` + `support.retention.purged_items` on the `SupportMetrics` port, `job.*` spans, structured logs, `SupportScheduledJobFailures`/`SupportRetentionSweepFailures` alert rules, and two new dashboard panels. The committed opt-in live suite (`pnpm test:jobs`) proves the loop against real local Temporal/PostgreSQL/NATS including idempotent bootstrap and no-op re-runs. See ADR-0025.
- Milestone 18 staging environment on hardened Compose is complete as code + config (Phase 2, first Deploy milestone; ADR-0027). The production deployment lives under `infra/production/`: multi-stage Dockerfiles for the API/worker (pruned `pnpm deploy --prod` images running `tsx` on the TypeScript source — `tsx` promoted to a production dependency because the monorepo consumes its packages as source, so there is no compiled-JS path) and a hardened uv-locked AI sidecar image; a 15-service hardened Compose profile with restart policies, per-service resource limits, one internal bridge network, no dev mounts, a shared `RAW_PAYLOAD_STORE_DIR` volume for API+worker, and profile-gated migrate/seed one-shots; a Caddy TLS reverse proxy fronting only `/v1/*` + webhooks + `/health` (refusing `/internal/*`); Prometheus + Grafana + Alertmanager provisioned from `infra/observability/` (Grafana auto-loads the dashboard + datasource, Prometheus loads the nine `Support*` alert rules, Alertmanager routes to Slack via a webhook rendered from an env secret); git-ignored per-service env-file secrets with committed templates (shared machine tokens/passwords single-sourced so they cannot drift); a nightly `pg_dump` backup service with a tested restore drill; and a `DEPLOY_ENABLED`-gated CI deploy workflow (build+push GHCR on a `v*` tag) driving a health-gated `deploy.sh` with auto-rollback (`rollback.sh`). Only Caddy is publicly exposed — every datastore and operator UI is internal or `127.0.0.1`-bound (SSH tunnel). The whole stack was brought up and torn down locally to validate it end to end (all 15 services healthy, migrations + seed + RLS smoke, worker-through-sidecar with job schedules, TLS routing + internal-block, Prometheus/Grafana/Alertmanager, backup→restore, deploy→rollback, and a 19-test live DB suite against the production-compose database). What remains is user-owned and closed on the VM per SOPS §19: the actual VM/DNS deploy, public-domain TLS, real Slack delivery, and the full live suite over the network. See ADR-0027.
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

Frontend work was explicitly deferred. The backend should expose contracts that support a future agent console, but no UI should be built yet. Amended 2026-07-08 (ADR-0026): this was always a scope decision about sequencing, never about repository layout — the console lives at `apps/console` in this repository and is built at Milestone 23, after Milestone 20 publishes its contract.

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

### V1 launch plan after the build milestones

With Milestones 0-12 complete, the remaining gap to a real pilot was integration and operations, not subsystems: nothing composed the verified pieces into running processes, the AI runtime had no real providers, auth was a placeholder, and no deployed environment existed. On 2026-07-04 the launch was planned as four phases (`TODO.md` Milestones 13-22 with a user-owned non-code track), and four platform decisions were locked with the user in ADR-0020: an HTTP sidecar for the AI bridge, a config-driven provider-agnostic model/embedding layer (pilot defaults: Anthropic Claude + OpenAI `text-embedding-3-small`), hosted-IdP JWKS authentication, and single-VM hardened-Compose deployment. The reviewer console was confirmed as a separate repository, keeping this repo backend-only (ADR-0001) — a clause since superseded, see below.

### Console topology pivot

On 2026-07-08 the separate-console-repository clause of ADR-0020 was re-opened and reversed (ADR-0026): the reviewer console lives in this repository at `apps/console`, consuming `/v1/*` through a `packages/api-client` workspace dependency typed from `@support/shared-schemas`, with no backend-for-frontend. ADR-0020's four platform decisions were untouched.

Two facts drove it. First, ADR-0020's console clause was inherited from ADR-0001 rather than argued: ADR-0001 is a scope decision about not letting UI work distract from backend correctness, and says nothing about repositories. Second, `packages/api/src/openapi.ts` turned out to be a 3277-line hand-written object literal that imports nothing — it is not derived from the zod schemas, no test binds it to `routes.ts`, and it is served behind the `openapi:read` permission with no spec file on disk. Milestone 20 had planned to generate the console's typed client from that document, which would have made the console the first consumer to discover any drift, across a repository boundary, mid-build. Doc drift of exactly that kind already existed: `BACKEND_SPEC.md` §17 described approval decisions taking `reviewer_user_id` from the `x-user-id` header, which JWT mode ignores, while the code has used `context.actor.userId` since Milestone 16.

Consequences recorded at the time: the console UI became Milestone 23 (appended, not inserted — Milestones 21 and 22 are referenced by number inside accepted ADRs, so renumbering would falsify them), Milestone 20 gained a route↔spec drift test and a vertical slice to make its acceptance criterion falsifiable, and the console left `TODO.md`'s user-owned non-code track.

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
- Added event-name-specific payload validation for v1 domain events plus `SupportEventErrorRecordSchema` for structured worker error records.
- Added `buildDomainEventSubject`, which maps `support.ticket.created.v1` style event names to tenant-aware subjects such as `support.events.tenant.ten_test.ticket.created.v1`.
- Added subject-safe tenant token validation for event publishing.
- Added `packages/workers/src/domain-events.ts` with schema-validated emit helpers for message received, ticket created, and ticket state transition events.
- Added `packages/workers/src/event-publisher.ts` with `NatsJetStreamDomainEventPublisher`, which validates envelopes, JSON-encodes events, publishes to the derived tenant-aware subject, and uses `event_id` as the JetStream message ID for duplicate detection.
- Added `packages/workers/src/event-errors.ts` with structured error-record publishing to the `support.events.errors.>` subject namespace.
- Added `packages/workers/src/event-bus.ts` with NATS.js v3 connection wiring, `NATS_URL` config loading, `SUPPORT_EVENTS` and `SUPPORT_EVENT_ERRORS` stream setup, and publisher/error-publisher runtime construction.
- Added `packages/workers/src/event-consumer.ts` with durable pull-consumer config/setup helpers, one-message `processNext()` handling, payload/subject validation, ack/nak/term behavior, structured error-record publishing for invalid or failed messages, and an injected idempotency store contract with an in-memory implementation for deterministic tests.
- Added `infra/nats/server.conf` plus a Compose `nats-data` volume so local NATS runs JetStream from explicit config.
- Added shared event payload/error tests, worker event emit helper tests, worker event bus/error publisher unit tests, consumer idempotency/error strategy tests, and a live NATS publish/consume integration test that verifies domain event duplicate detection plus structured event error publish/consume behavior.
- Left current CRUD skeleton endpoints disconnected from event publication; the emit helpers are intended for future workflow/service-owned event side effects.

Latest Milestone 5 Temporal workflow foundation:

- Added Temporal TypeScript SDK dependencies to `@support/workers` and approved the required pnpm build scripts for `@swc/core` and `protobufjs`.
- Added `packages/workers/src/temporal-worker.ts` for Temporal worker config/runtime scaffolding with local defaults for `localhost:7233`, namespace `default`, and task queue `support-ticket-lifecycle`.
- Added `packages/workers/src/workflows/ticket-lifecycle-types.ts` and `packages/workers/src/workflows/ticket-lifecycle-workflow.ts`.
- The workflow shell defines message/customer-reply, approval-completed, manual-escalation, and close-request signals, a state query, ticket create/load and triage activity calls, a structured `runAiGraph` activity placeholder, workflow-owned domain event emission activity calls, first-response SLA timer wait/breach behavior, approval waiting/resume behavior, audit activity calls, and inbound message signal dedupe.
- The `runAiGraph` placeholder returns either structured AI success output for approval metadata or structured AI failure output; the workflow records `ai_graph.failed` audit and routes failures to human approval instead of failing the workflow.
- Added the `sendOutboundMessage` activity placeholder and deterministic approval-outcome routing: approved/edited send an outbound message once (with a deterministic `outbound:{tenant}:{ticket}:{approval_id}` idempotency key), emit `support.message.sent.v1`, and record `message.sent` audit before reaching the `responded` phase; rejected ends in `completed` without sending; escalated records `ticket.manual_escalated` audit and reaches the `manual_escalated` phase.
- Added `packages/workers/src/activities/ticket-lifecycle-activities.ts`, whose `emitDomainEvent` activity adapter reuses `emitTicketCreatedEvent`, `emitTicketStateTransitionEvent`, `emitTicketSlaBreachedEvent`, and `emitMessageSentEvent` through an injected `DomainEventPublisher`.
- Added explicit ticket lifecycle activity retry-policy constants, side-effect activity call-site retry options (including `sendOutboundMessage`), first-response SLA breach event/audit workflow handling, and live workflow history replay coverage.
- Added offline unit coverage for the activity adapter (including message-sent emission) and Temporal worker config.
- Added `pnpm --filter @support/workers test:workflow`, an opt-in live Temporal workflow test that runs against local Compose Temporal and covers approval wait/resume, duplicate inbound message signal handling, first-response SLA timer breach, AI success-to-approval routing, AI failure-to-human routing, approval-outcome routing (approved/edited/rejected/escalated), and workflow replay safety.
- CRUD skeleton endpoints still do not start or signal workflows.

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
- `DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration`
- `TEMPORAL_ADDRESS=localhost:7233 pnpm --filter @support/workers test:workflow`
- `pnpm --filter @support/observability test` (Milestone 11: telemetry bootstrap, metrics port, structured logger)
- `RUN_WORKER_INTEGRATION_TESTS=true DATABASE_URL=... pnpm --filter @support/workers test:integration` (Milestone 11: live NATS event bus + live PostgreSQL persistence store incl. AI-run persistence, approval FK linking, send-once replay, QA sampling)
- Live observability smoke drive: telemetry-enabled API against the Compose otel-collector — spans + metrics exported (collector debug log) and scraped from `http://localhost:8889/metrics` under the documented names
- `DATABASE_URL=... NATS_URL=nats://127.0.0.1:4222 pnpm test:e2e` (Milestone 13: live end-to-end drive — webhook → persisted ticket → deterministic AI draft → API approval → outbound send → complete audit/event trail, across a worker restart with no duplicates)
- `pnpm worker:start` smoke: the production worker entrypoint boots against Compose services (workflow bundle built from source, task queue polled) and drains cleanly on SIGTERM; missing `DATABASE_URL` fails fast with the aggregated config error
- `PYTHONPATH=ai uv run --frozen --project ai --extra service python -m service.eval_parity` (Milestones 14-15: 25 golden cases byte-identical between in-process and service-path execution, gates green — re-verified after the Milestone 15 `model` result section landed)
- `SUPPORT_LLM_PROVIDER=scripted PYTHONPATH=ai uv run --frozen --project ai --extra service python -m evals.live_runner` (Milestone 15: golden 25 + injection 18 through the real LangChain adapter path with env-only provider selection — every hard-fail gate green)
- `uv sync --frozen --project ai --extra llm --extra service` + `from langchain.chat_models import init_chat_model` (Milestone 15: the real provider stack installs from the committed lockfile)
- Live gates vs real Claude (2026-07-07, Anthropic key in local `.env`): `evals.live_runner` with `claude-sonnet-5` — golden 25 PASS (topic 0.960, routing 1.0, escalation 1.0, tool recall 1.0), injection 18 PASS (rate 1.0), zero unsafe auto-send/output/leaks; with `claude-opus-4-8` — golden 25 PASS (0.960 across topic/routing/escalation; conservatively human-routes the allowlisted auto-send case), injection 18 PASS (rate 1.0). Pilot default recorded as `claude-sonnet-5`.
- Real-Claude e2e (2026-07-07): sidecar e2e real-model mode (`E2E_AI_REAL_PROVIDER=anthropic E2E_AI_REAL_MODEL=claude-sonnet-5`) 3/3 PASS — persisted run carries anthropic/claude-sonnet-5 provenance, both prompt versions, real tokens+cost, citation-grounded draft, approval → exactly one send; deterministic-mode e2e also re-run 3/3 PASS.
- Milestone 16 (2026-07-07): full `pnpm typecheck`/`pnpm -r test`/`pnpm lint`/`pnpm build`/`pnpm test:py` green after the auth+policy work; RBAC matrix under real RSA-signed JWTs via local JWKS (all roles × all routes + absent/expired/forged/wrong-audience/wrong-issuer/unknown-subject 401 suites, non-member 403 suite, header-spoof and internal-endpoint rejections); `RUN_API_INTEGRATION_TESTS=true DATABASE_URL=... vitest run src/auth.integration.test.ts` 5/5 PASS (live DB user directory, membership, suspended/unprovisioned 401s, policy lifecycle with audits and fail-closed automation); `RUN_CLERK_LIVE_TESTS=true ... vitest run src/auth.clerk-live.integration.test.ts` 1/1 PASS against the real Clerk dev instance (real session token minted via the Backend API, verified through the real JWKS; decoded claims confirmed `aud`/`email` customization); full `pnpm test:integration` and `pnpm test:e2e` re-run green under the explicit insecure-header opt-in.
- Milestone 17 (2026-07-07): full `pnpm typecheck`/`pnpm lint`/`pnpm format:check`/`pnpm test`/`pnpm build` green after the scheduled-jobs work (workers 164 unit tests incl. the new job-schedules/blob-sweeper/scheduled-jobs-activities/reworked-retention suites); `pnpm test:integration` green (db 19, api 42, workers 6); `pnpm test:e2e` 1/1 green under the new runtime composition; `pnpm --filter @support/workers test:workflow` 11/11 green with the job workflows added to the bundle; committed live suite `pnpm test:jobs` 1/1 PASS against real local Temporal/PostgreSQL/NATS — idempotent per-tenant schedule bootstrap (second run reports both schedules existing), triggered schedules drive the production worker through both job workflows, the retention run cleared the raw-payload ref, deleted both blobs from disk, purged the expired attachments, anonymized the expired AI run (metadata retained), and audited `retention.applied` with per-class counts; QA sampling queued both mandatory reviews and the `support.qa.review_created.v1` envelope landed in JetStream; re-triggering both schedules completed as no-ops (no new audits/reviews/purges).
- Milestone 18 (2026-07-10): validated by a full local bring-up + teardown of the `infra/production/` stack (build + validate locally; no code behavior changed — the only source-tree change is `tsx` added to two `package.json` dependency lists, so the existing behavioral suites are unaffected). All three production images build under the legacy builder (api 329MB, worker 541MB, ai 433MB, non-root); `docker compose config` valid; all 15 services came up healthy; migrations 0001-0007 + pilot seed applied via the one-shots; RLS smoke PASS as `support_app` (unset tenant raises, cross-tenant read 0, cross-tenant insert rejected by WITH CHECK); the worker connected to Temporal via the real sidecar bridge and bootstrapped both per-tenant schedules; Caddy served `/health` 200 over TLS with `/v1/*` 401 and `/internal/*` 404; Prometheus scraped the collector + loaded 9 `Support*` rules; Grafana provisioned the datasource + `Support Platform Overview` dashboard; Alertmanager routed a synthetic critical alert to the `slack-notifications` receiver; the backup→restore drill PASSed (checksum OK, 7 migrations + tenant restored); `deploy.sh`→`rollback.sh` flipped the running image relA→relB→relA through the health gate; and the live DB integration suite (19/19) passed against the production-compose database. Fixes during validation: collector pinned to `0.154.0` (0.121 rejects the config's `translation_strategy`) and the Temporal healthcheck retargeted at `temporal:7233` (auto-setup binds the container IP). Not run: CI on the branch (runs on push); the VM-only SOPS §19 boxes (public-domain TLS, real Slack delivery, full live suite over the network).

## Current Architecture Follow-Ups

- Repository tenant filters remain mandatory even with PostgreSQL row-level security.
- API and worker database code must set transaction-local `app.current_tenant_id` before tenant-scoped operations. The DB package now provides `withTenantTransaction`, which also sets `support_app` as the transaction-local role before repository work.
- CI includes live PostgreSQL and NATS integration coverage, but the remote workflow result has not been observed yet.
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
- Python tooling is provisioned via `uv` (`ai/.python-version` pins CPython 3.12, `ai/uv.lock` committed, harness runs `uv run --frozen --project ai`); the AI runtime itself is still the dependency-free ADR-0016 implementation until the real model/graph adapters land.
- Docker image tags use `latest` for some services; pin known-good versions later.
- Database ORM/query builder is Drizzle.
- No real tenant/client data exists.
- No OpenAI/model credentials are configured.

## Next Recommended Task

Milestone 23 - Reviewer Console (`feat-milestone23-reviewer-console`, ADR-0028) is code-complete: a static Vite + React 19 SPA at `apps/console` over `@support/api-client` — Clerk login behind an auth-provider seam (dev token fallback), the queue → evidence → decide loop, the QA scorecard surface, permission-gated navigation, 13 jsdom component tests + a chromium Playwright walkthrough (`test:e2e:console`), and a `console` service in the hardened Compose (its image builds + serves the SPA with a history fallback — validated locally; the edge Caddy now proxies non-API paths to it). Building the console surfaced two backend gaps, both closed and recorded as Milestone 20 gaps (per the ADR-0026 acceptance rule): a tenant-optional `GET /v1/me` session endpoint behind a new `session:read` permission, and an `@support/api-client` browser fetch-binding fix (`Illegal invocation` when the default global fetch is invoked unbound — the Milestone 20 Node contract-proof test always injected a fetch, so the browser tier is what caught it). Milestone 20 - Console Enablement API landed earlier (merged, PR #39). Phase 1 (Milestones 13-17), the code half of Phase 2 (Milestone 18), and both of Phase 3's console milestones (20 + 23) are done.

Next: the two remaining milestones both wait on user-owned inputs. **Milestone 21 - Eval Expansion And Shadow Replay** is the most-unblocked — the golden-dataset expansion, the LLM-graded draft-quality rubric, and the injection re-run need no user input and can be done now; only the shadow-replay harness + report waits on the pilot client's historical tickets. **Milestone 19 - Live Providers And Go-Live Rehearsal** stays gated on a provisioned staging VM + DNS (to run the Milestone 18 + console stack), a Mailgun account + verified pilot domain, and Meta Business verification; once they exist, stand staging up per `infra/production/README.md` (now including the `console` service + `CONSOLE_*` build args), close the VM-only SOPS §19 boxes, configure Mailgun inbound, prove signature verification, round-trip a real approved reply, and run the staging rehearsal + load/chaos smoke.

Milestone 18 follow-ups (not blockers): the S3/MinIO `RawPayloadStore`/`BlobSweeper` behind the existing ports stays deferred — API and worker share the `RAW_PAYLOAD_STORE_DIR` volume for now (ADR-0027(3)); the `pg-backup` scheduler is an in-container sleep-loop (swap for host cron/systemd if preferred); the offsite backup hook (`BACKUP_UPLOAD_CMD`) + MinIO `mc mirror` target are user-owned; the edge Caddy now proxies non-API paths to the Milestone 23 `console` service (previously API + webhooks only); the collector is pinned to `0.154.0` (the version the config's `translation_strategy` targets).

Milestone 17 follow-ups (not blockers): the S3/MinIO object store + sweeper behind the `RawPayloadStore`/`BlobSweeper` ports was deferred by Milestone 18 (ADR-0027(3)) — API and worker share `RAW_PAYLOAD_STORE_DIR` (now a shared Compose volume); schedule coverage lags tenant onboarding by one worker restart (consider a reconciler if tenant creation becomes API-frequent); `audit_event_days` stays deliberately unenforced (append-only compliance ledger) until a tenant contract requires audit purging; the WhatsApp media-download slice will start writing local attachment blobs that the attachment class then actually sweeps.

Milestone 16 follow-ups (not blockers): the internal machine token stays a static shared secret until the sidecar leaves the internal trust boundary (rotation = env change + restart; Milestone 18 hardens delivery); consider per-request role caching alongside Milestone 20's rate limiting (auth currently costs two indexed DB lookups per request); the spec's separate policy-version `approve` step is folded into activation until the Milestone 20 console needs a two-person rule; `integration.credential_changed` and `permission.granted|revoked` remain reserved audit actions until a user/role management API exists.

Milestone 15 follow-ups (not blockers): Milestone 18 hardened Compose must inject the provider keys as real secrets; set `SUPPORT_KB_MIN_SIMILARITY` (suggested 0.25 for `text-embedding-3-small`) when real embeddings go live (Milestone 19); the workers' keyword triage still seeds pre-AI topic/priority — revisit with reopened-ticket semantics (Milestone 22); the LLM-graded draft-quality rubric that scripted runs cannot cover is Milestone 21.

Previous milestone: Milestone 14 - AI Runtime Service Bridge (`feat-milestone14-ai-runtime-service-bridge`) is complete; all eleven checklist items and three acceptance criteria are checked off in `TODO.md` (the FastAPI sidecar under `ai/service/` with bearer auth and structured logs, the production `createHttpRunAiGraph` activity with full failure classification behind the unchanged `createPersistedRunAiGraph` seam, `POST /internal/tools/execute` with machine-token auth into the governed registry, the Python `HttpToolExecutor`/`HttpRetrieval` adapters, the automation-policy bridge into the `RuntimeRequest`, the Compose `ai-service` container + `pnpm ai:service`, byte-identical eval parity via `service.eval_parity`, and the committed live drive `pnpm --filter @support/workers test:e2e:service` incl. sidecar-down/500 degradation — ADR-0022). Its plan was:

1. Implement the config-driven Python `ModelProvider` over LangChain's `init_chat_model` behind the existing port (`SUPPORT_LLM_PROVIDER`/`SUPPORT_LLM_MODEL`, structured outputs enforced, timeouts/retries, token + latency capture; `uv sync --project ai --extra llm`) — the swap happens inside the sidecar behind the unchanged `POST /internal/ai/run` contract; pilot default Anthropic Claude activates only by explicit config, the deterministic model stays the offline default.
2. Decide the real-LangGraph engine swap-or-defer (ADR-0016 seam) and add versioned prompt files with stable IDs recorded on every AI run.
3. Implement the production TypeScript `Embedder` factory (env-selected, pilot default OpenAI `text-embedding-3-small`, 1536-dim only), share one instance across ingestion and retrieval with model-id recording + match enforcement, and add the similarity-score floor / max-context cap.
4. Capture model id, prompt version, latency, tokens, and cost on `ai_runs` end to end (replace the `AI_SIDECAR_RUN_PROVENANCE` constants with runtime-reported metadata), then run the golden + injection suites against the real model (live, opt-in) with the hard-fail gates holding, and prove provider agnosticism with a second configured provider.

Milestone 14 follow-ups (not blockers): surface the runtime's `approval_package` past the activity boundary once the Milestone 20 console consumes it; harden the Compose `ai-service` defaults (non-dev tokens, internal-only network) in Milestone 18; unify the runtime `p1`-`p4` priority vocabulary with the platform's `p0`-`p3` when the real model lands; machine-token rotation remains env-change + restart until Milestone 16.

Milestone 11 follow-ups (not blockers): adopt `@temporalio/interceptors-opentelemetry` for strict parent-child span propagation across the API→Temporal boundary (v1 correlates by `support.correlation_id` attributes per ADR-0018); ship Prometheus/Grafana (or a hosted backend) in pilot infra and load `infra/observability/`; emit `support.ai_run.completed.v1`/`support.tool_call.completed.v1` domain events from the workflow; schedule the QA sampling job (currently invoked per tenant from a worker process/script); and wire the workers structured logger + telemetry bootstrap into the production worker entrypoint when it lands.

Milestone 10 follow-ups (not blockers): a production worker entrypoint composing `createTicketLifecyclePersistenceActivities` + `createDatabaseTicketLifecyclePersistenceStore` + `createHttpOutboundChannelSender` with the remaining placeholder activities into `createTicketLifecycleWorker` (now also composing `createPersistedRunAiGraph` + `instrumentTicketLifecycleActivities`); migrating `messages.send_status`/`sent_by_type` from free text to PostgreSQL enums; an email subject strategy for outbound replies (currently null — providers thread via the reply headers); and approval expiry (`expired` status) handling.

Milestone 9 follow-ups (not blockers): swap a real LLM `ModelProvider` and, if adopted, real LangGraph via `uv sync --project ai --extra llm` (ports are the seams, ADR-0016); call the live TypeScript tool registry and `POST /v1/kb/search` from the tool/retrieval nodes; wire the Python runtime behind the Temporal `RunAiGraphActivity` placeholder; expand the golden dataset to the TEST_STRATEGY §4 counts and add an LLM-graded draft rubric; add versioned prompt files.
