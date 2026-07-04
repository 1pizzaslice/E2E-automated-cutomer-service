# Backend Specification

## Purpose

This document is the source of truth for backend contracts, service boundaries, domain models, APIs, events, workflows, and invariants. Future implementation should keep this file updated whenever behavior changes.

V1 scope is backend only.

## 1. Backend Goals

The backend must support:

- Multi-tenant support operations.
- Email and WhatsApp inbound messages.
- Ticket and conversation lifecycle.
- SLA-aware workflow orchestration.
- Tenant-specific policies.
- KB ingestion and retrieval.
- AI triage/drafting through a Python AI runtime.
- Governed tool execution.
- Human approval loops.
- Outbound message sending.
- Audit logs.
- QA/eval capture.
- Observability and security.

## 2. Service Map

### 2.1 API Service

Responsibilities:

- HTTP APIs.
- Auth and tenant context.
- Webhook ingress.
- Admin/configuration endpoints.
- Ticket/conversation/message endpoints.
- Approval endpoints.
- Audit and AI-run read endpoints.
- OpenAPI generation.

Non-responsibilities:

- Long-running workflows.
- Direct LLM calls.
- Direct integration side effects outside tool registry.

### 2.2 Workflow Worker Service

Responsibilities:

- Temporal workflow definitions.
- Temporal activities.
- Ticket lifecycle orchestration.
- SLA timers.
- Approval waits.
- Retries and compensation.

Non-responsibilities:

- Direct nondeterministic operations in workflow definitions.
- Tenant policy hardcoding.

Implementation note (Milestone 13): the production worker entrypoint is
`packages/workers/src/main.ts` (`pnpm worker:start` /
`pnpm --filter @support/workers start`). It starts telemetry first, validates
configuration fail-fast (`loadTicketLifecycleWorkerRuntimeConfig`: required
`DATABASE_URL`, Temporal connection overrides, `APPROVAL_EXPIRY_MS`), then
`startTicketLifecycleWorkerRuntime` composes the database persistence store,
the production ticket/approval/outbound/audit activities, the deterministic
in-process AI graph behind `createPersistedRunAiGraph` (the Milestone 14
sidecar replaces the inner implementation only), the HTTP outbound sender,
NATS JetStream domain event emission (idempotent stream provisioning), and
`instrumentTicketLifecycleActivities` into `createTicketLifecycleWorker` on
the `support-ticket-lifecycle` task queue, with graceful SIGINT/SIGTERM
drain-and-close shutdown.

### 2.3 AI Runtime Service

Responsibilities:

- LangGraph support agent graph.
- Classification.
- Retrieval planning.
- Tool planning.
- Drafting.
- Critique/guardrails.
- Structured AI outputs.
- Eval capture.

Non-responsibilities:

- Durable ticket state.
- Direct tool calls outside registry.
- Direct outbound customer sends.

Current implementation (Milestone 14, ADR-0020): the Python runtime under
`ai/` runs as an HTTP sidecar — a FastAPI service (`ai/service/`) exposing
`POST /internal/ai/run` (bearer-token authenticated) and `GET /health`. The
Temporal `runAiGraph` activity calls it over HTTP
(`packages/workers/src/activities/http-ai-graph.ts`); in service mode the
sidecar executes tools through `POST /internal/tools/execute` (§17.16) and
retrieval through `POST /v1/kb/search`, both service-to-service authenticated
against the API. Sidecar failure produces a structured `failed` AI run routed
to human approval — never a failed workflow. The model is still the
deterministic support model; the real-provider swap is Milestone 15.

### 2.4 Integration/Tool Service

Responsibilities:

- Typed tool definitions.
- Tool execution.
- Permission enforcement.
- Tenant credential scoping.
- Tool audit logs.
- Provider normalization.

### 2.5 KB/RAG Service

Responsibilities:

- Document ingestion.
- Chunking.
- Embeddings.
- Retrieval.
- Citation metadata.
- Tenant isolation.

This may initially live inside the API/AI runtime but should have a clear module boundary.

## 3. Core Identity And Tenancy Model

### 3.1 Tenant

A tenant is a client business.

Fields:

- `tenant_id`
- `name`
- `status`: `active | suspended | archived`
- `default_timezone`
- `created_at`
- `updated_at`

Rules:

- Almost every operational record is tenant-scoped.
- Tenant status gates channel ingestion and outbound sends.

### 3.2 User

A user is an internal operator or future client user.

Fields:

- `user_id`
- `tenant_id` nullable for platform admins
- `email`
- `display_name`
- `status`
- `created_at`
- `updated_at`

Roles:

- `platform_admin`
- `ops_admin`
- `support_agent`
- `qa_reviewer`
- `client_viewer`
- `integration_admin`

### 3.3 Customer

A customer is an end user contacting support.

Fields:

- `customer_id`
- `tenant_id`
- `display_name`
- `email`
- `phone`
- `external_customer_ref`
- `metadata`
- `created_at`
- `updated_at`

Rules:

- Customer identity can be incomplete at first contact.
- Identity resolution can improve over time.
- Never merge customers automatically unless confidence is high and rules are explicit.

### 3.4 Customer Identity

Maps channel identities to a customer.

Fields:

- `customer_identity_id`
- `tenant_id`
- `customer_id`
- `channel`
- `identity_type`: `email | phone | whatsapp_id | external_user_id`
- `identity_value`
- `verified`
- `created_at`

Uniqueness:

- Unique per `tenant_id`, `channel`, `identity_type`, `identity_value`.

## 4. Channel Model

### 4.1 Channel

Fields:

- `channel_id`
- `tenant_id`
- `type`: `email | whatsapp | chat_future`
- `provider`
- `status`: `active | paused | disabled`
- `config`
- `created_at`
- `updated_at`

Sensitive provider credentials must not be stored in plain config. Store secrets in a secret manager and reference by key.

### 4.2 Normalized Inbound Message

Canonical shape:

```json
{
  "tenant_id": "ten_...",
  "channel_id": "chn_...",
  "channel": "email",
  "provider": "gmail",
  "external_thread_id": "provider-thread-id",
  "external_message_id": "provider-message-id",
  "customer_identity": {
    "type": "email",
    "value": "customer@example.com",
    "display_name": "Customer Name"
  },
  "direction": "inbound",
  "body": {
    "text": "Where is my order?",
    "html": "<p>Where is my order?</p>"
  },
  "attachments": [
    {
      "filename": "receipt.pdf",
      "content_type": "application/pdf",
      "size_bytes": 12345,
      "object_ref": "s3://..."
    }
  ],
  "raw_payload_ref": "s3://...",
  "received_at": "2026-06-18T00:00:00.000Z",
  "idempotency_key": "provider-message-id"
}
```

Rules:

- `external_message_id` plus tenant/channel must deduplicate inbound messages.
- Raw provider payload is stored by reference.
- Attachments are validated before storage.
- HTML must be sanitized before display or AI consumption.

Current implementation:

- `packages/shared-schemas` exports `NormalizedInboundMessageSchema` as the canonical inbound contract, with `NormalizedInboundChannelSchema` (`email | whatsapp`), `CustomerIdentityTypeSchema`, `NormalizedInboundCustomerIdentitySchema`, `NormalizedInboundBodySchema`, and `NormalizedInboundAttachmentSchema` sub-schemas plus inferred types.
- The schema is `.strict()`; `external_message_id`, `raw_payload_ref`, and `idempotency_key` are required (raw payload stored by reference), `attachments` is an explicit array, and a message-level refinement requires body `text`, body `html`, or at least one attachment. Attachment `size_bytes` is nullable because some providers (for example WhatsApp media) do not report size until download.
- `packages/integrations/src/channels` provides pure provider adapters: `parseInboundEmailMessage` maps a provider-neutral inbound email payload (`RawInboundEmailSchema`, Mailgun/SendGrid-style) into one normalized message, and `parseInboundWhatsAppMessages` maps a WhatsApp Cloud webhook (`RawInboundWhatsAppSchema`) into one normalized message per batched inbound message. Raw provider schemas are non-strict (unknown provider fields are ignored); normalized output is validated with the strict contract. Adapters perform no network or storage side effects — a webhook handler resolves tenant/channel, stores the raw payload, and passes an `InboundAdapterContext` (`tenant_id`, `channel_id`, `provider`, `raw_payload_ref`).
- Email threading prefers an explicit provider thread id, then `In-Reply-To`, then the first `References` entry. WhatsApp threads on the sender `wa_id`; media messages become attachment metadata (`whatsapp-media:{media_id}` reference, null pending size).
- `packages/integrations/src/channels/signature.ts` provides timing-safe HMAC-SHA256 verification: `verifyWhatsAppCloudSignature` (Meta `X-Hub-Signature-256`) and `verifyMailgunSignature` (`timestamp`+`token` signed with the account key), on a shared `verifyHmacSha256Signature` primitive. Malformed, empty, wrong-length, or mismatched signatures return false so webhook handlers can reject bad payloads.
- `packages/api` exposes the webhook ingress endpoints `POST /v1/webhooks/email/{provider}` and `POST /v1/webhooks/whatsapp/{provider}` (see §17.4). They are unauthenticated (no bearer token) and exempt from the actor/tenant middleware; the request is authenticated by verifying the provider signature over the raw request body. A raw-JSON body parser preserves the exact bytes on `request.rawBody` for signature verification. The handler resolves the channel by `channel_id` (owner-connection read, since tenant context is not yet known), verifies the signature (WhatsApp Cloud `X-Hub-Signature-256`; email Mailgun `timestamp`+`token`; a generic `X-Webhook-Signature-256: sha256=<hex>` HMAC over the raw body for other email providers), stores the raw payload by reference, runs the pure adapter, and hands each normalized message to the intake service.
- The signing secret is resolved from an opaque `signature_secret_ref` on the channel `config` via a `WebhookSecretResolver` (default: environment lookup), keeping the secret out of the config row.
- Raw payloads are stored by reference through a `RawPayloadStore` port (default: filesystem, returning a `file://` ref; swap for an object store in production). The ref is persisted on the message `raw_payload_ref`; bytes are never stored inline in PostgreSQL.
- Inbound intake persistence (`packages/api` `InboundIntakeStore`, PostgreSQL-backed) runs tenant-scoped under RLS: it dedups on `external_message_id` within tenant/channel (backed by the `messages_external_message_idx` unique index plus a conflict-safe insert, and the `messages_idempotency_idx` idempotency key), resolves or creates the customer via `customer_identities`, threads the conversation on `external_thread_id` (`conversations_external_thread_idx`), inserts the inbound message, and updates `conversations.last_message_at`. Duplicate provider events do not create duplicate messages or re-signal the workflow.
- Normalized inbound intake is wired to the ready ticket lifecycle workflow start/signal boundary via an `InboundWorkflowLauncher` port. The default uses Temporal `signalWithStart` with a per-conversation workflow id (`ticket-lifecycle:{tenant}:{conversation}`): the first message starts `ticketLifecycleWorkflow`; later messages are delivered as `message_received` signals to the running workflow. Milestone 6 models one lifecycle workflow per conversation (deterministic ticket id `tkt_{conversation_id}`), a placeholder to revisit when the full ticketing milestone lands.
- An email polling placeholder (`pollInboundEmailPlaceholder`) marks where scheduled IMAP/pull-API polling will feed the same normalized intake path; it currently performs no fetch.
- Attachment validation (Milestone 12): the intake service validates every message's attachment metadata before any persistence or workflow signal, via the pure `validateInboundAttachments` in `packages/integrations` (`DEFAULT_ATTACHMENT_VALIDATION_POLICY`: 10 MiB size cap, a content-type allowlist that excludes executables/HTML/octet-stream, filename safety checks, and a 10-attachment-per-message bound; the policy is injectable per deployment). A `null` size (WhatsApp reports size only on download) passes metadata validation and is re-checked when binaries are fetched. Rejected messages create nothing — no customer, conversation, message, or workflow signal — and are reported per message in the webhook `202` response (`rejected: true` + `rejection_reason`, with a top-level `rejected` count) so providers do not retry.
- The signing-secret and send-credential resolvers now share the validating `SecretResolver` in `packages/integrations/src/secrets.ts`: a reference must match `^[A-Z][A-Z0-9_]*$` (an environment variable name) before the environment is consulted, so tenant-influenced config cannot address arbitrary process state.
- Attachment binary storage (media download) with post-download size re-checks, HTML sanitization to `body_html_ref`, and multi-ticket-per-conversation lifecycle remain later slices.

### 4.3 Outbound Message

Fields:

- `message_id`
- `tenant_id`
- `conversation_id`
- `ticket_id`
- `channel_id`
- `direction`: `outbound`
- `body_text`
- `body_html`
- `provider_message_id`
- `send_status`: `queued | sent | failed | canceled`
- `sent_by_type`: `human | ai_auto | system`
- `sent_by_user_id`
- `ai_run_id`
- `approval_id`
- `created_at`
- `sent_at`

Rules:

- Outbound sends must be idempotent.
- Human approval is required unless policy allows auto-send.
- Outbound failure should keep ticket in actionable state.

Current implementation (Milestone 10):

- Outbound messages are rows in the shared `messages` table with `direction: "outbound"`; the partial unique index on `(tenant_id, idempotency_key)` enforces send idempotency for the workflow's `outbound:{tenant}:{ticket}:{approval_id}` key. The shared `NormalizedOutboundMessageSchema` is the validated contract between the send activity, the channel adapters, and persistence; `OutboundSendStatusSchema`/`OutboundSentByTypeSchema` encode the `send_status`/`sent_by_type` enums (the columns remain free text in PostgreSQL — an enum migration is a follow-up).
- The worker `sendOutboundMessage` activity implementation (`packages/workers/src/activities/ticket-lifecycle-persistence.ts`) replays an already-`sent` idempotency key without contacting the provider, otherwise resolves conversation → channel → recipient identity → approval in one tenant transaction, extracts the approved draft (`approved_payload` first, falling back to the preserved AI draft), inserts the row as `queued`, sends through the `OutboundChannelSender` port, and records the terminal `sent`/`failed` outcome plus a `message.send_failed` audit event on failure. Retryable provider failures re-use the same message row on the next Temporal attempt; permanent failures raise `NonRetryableActivityError`.
- `packages/integrations/src/channels` provides the pure outbound adapters (`buildOutboundEmailProviderRequest` with RFC 5322 reply-threading headers, `buildOutboundWhatsAppProviderRequest` for Cloud API text sends) and `createHttpOutboundChannelSender` for the `mailgun`/`whatsapp_cloud` providers with an injectable `fetch`. Provider credentials are resolved from the channel config's `send_credential_ref` through an env-backed `OutboundCredentialResolver` (secrets stay out of channel rows, §4.1).

## 5. Conversation Model

### 5.1 Conversation

Fields:

- `conversation_id`
- `tenant_id`
- `customer_id`
- `channel_id`
- `external_thread_id`
- `status`: `open | archived`
- `last_message_at`
- `created_at`
- `updated_at`

Rules:

- Conversation is the message thread.
- Tickets are support work items attached to conversations.
- A conversation may have multiple tickets over time.

### 5.2 Message

Fields:

- `message_id`
- `tenant_id`
- `conversation_id`
- `ticket_id` nullable
- `channel_id`
- `direction`: `inbound | outbound | internal_note | system`
- `body_text`
- `body_html_ref` nullable
- `attachments`
- `external_message_id`
- `external_thread_id`
- `raw_payload_ref`
- `created_by_type`
- `created_by_user_id`
- `created_at`

Rules:

- Messages are append-only except redaction metadata.
- Internal notes must never be sent to customers.

Implementation note (Milestone 13): `messages.send_status`
(`queued | sent | failed | canceled`) and `messages.sent_by_type`
(`human | ai_auto | system`) are PostgreSQL enums (migration
`0005_message_send_status_enums`), closing the Milestone 10 free-text
follow-up; the value sets mirror the shared-schemas
`OutboundSendStatusSchema`/`OutboundSentByTypeSchema` contracts that have
governed every write since Milestone 10.

## 6. Ticket Model

### 6.1 Ticket

Fields:

- `ticket_id`
- `tenant_id`
- `conversation_id`
- `customer_id`
- `status`
- `priority`: `p0 | p1 | p2 | p3`
- `topic`
- `subtopic`
- `language`
- `sentiment`
- `urgency_score`
- `automation_mode`: `auto_send | human_approve | human_only`
- `assigned_queue`
- `assigned_user_id`
- `sla_policy_id`
- `policy_version_id`
- `opened_at`
- `first_response_due_at`
- `next_response_due_at`
- `resolution_due_at`
- `resolved_at`
- `closed_at`
- `created_at`
- `updated_at`

### 6.2 Ticket Statuses

Allowed statuses:

- `new`
- `triaged`
- `waiting_ai`
- `waiting_human`
- `waiting_customer`
- `resolved`
- `closed`
- `reopened`
- `failed`

Transition rules:

- `new -> triaged`
- `triaged -> waiting_ai`
- `triaged -> waiting_human`
- `waiting_ai -> waiting_human`
- `waiting_ai -> waiting_customer`
- `waiting_ai -> resolved`
- `waiting_human -> waiting_customer`
- `waiting_human -> resolved`
- `waiting_customer -> waiting_ai`
- `waiting_customer -> waiting_human`
- `resolved -> closed`
- `closed -> reopened`
- `reopened -> triaged`
- Any active state may transition to `failed` with reason.
- `failed -> waiting_human` for recovery.

Every transition creates a ticket event and audit event.

### 6.3 Ticket Event

Fields:

- `ticket_event_id`
- `tenant_id`
- `ticket_id`
- `event_type`
- `from_status`
- `to_status`
- `actor_type`: `system | ai | human`
- `actor_id`
- `reason_code`
- `metadata`
- `created_at`

Implementation note (Milestone 13): ticket state is workflow-owned and
persisted through the production ticket lifecycle activities in
`packages/workers`. `createOrUpdateTicket` creates-or-loads the deterministic
`tkt_{conversation_id}` row under RLS (linking the intake-persisted initial
message and stamping SLA due dates from the tenant's active SLA policy),
`runInitialTriage` persists first-pass topic/subtopic/priority/language and
moves `new -> triaged` (hard-sensitive keyword hits route to manual
escalation), `recordInboundMessage` reconciles workflow-signaled inbound
messages onto the ticket with no duplicate rows (a customer reply moves
`waiting_customer -> waiting_human`), and the explicit
`applyTicketStateTransition` activity applies every other workflow-owned
transition (`waiting_ai` before the AI graph, `waiting_human` on approval
request, `waiting_customer` after the outbound send, `closed` on close
request). Every applied transition writes one append-only `ticket_events` row
(deterministic `tev_` ids so Temporal activity retries replay instead of
duplicating) plus a canonical audit event (`ticket.created`, `ticket.updated`,
or `ticket.closed`), and the triaged/resolved/closed transitions additionally
emit their `support.ticket.*.v1` domain events. Transitions are visible
through the existing read APIs (`GET /v1/tickets/{id}`,
`GET /v1/tickets/{id}/audit-events`).

## 7. SLA Model

### 7.1 SLA Policy

Fields:

- `sla_policy_id`
- `tenant_id`
- `name`
- `priority`
- `first_response_minutes`
- `next_response_minutes`
- `resolution_minutes`
- `business_hours`
- `pause_conditions`
- `escalation_rules`
- `status`
- `created_at`
- `updated_at`

Rules:

- SLA timers are managed by Temporal.
- SLA deadlines are stored on the ticket for query/reporting.
- SLA breach emits event and audit.

Implementation note (Milestone 13): `createOrUpdateTicket` resolves the
tenant's active SLA policy at ticket creation, stamps
`first_response_due_at`/`next_response_due_at`/`resolution_due_at` onto the
ticket row, and returns activity-clock-relative timers to the workflow; the
first-response timer races the approval wait exactly as before (v1 arms only
the first-response deadline). Tenants without an active policy get no due
dates and no timer.

## 8. Policy Model

### 8.1 Tenant Policy

Policies are versioned.

Fields:

- `policy_id`
- `tenant_id`
- `name`
- `domain`: `refunds | cancellations | shipping | faq | routing | tone | escalation | automation`
- `status`: `draft | active | archived`
- `created_at`
- `updated_at`

### 8.2 Policy Version

Fields:

- `policy_version_id`
- `tenant_id`
- `policy_id`
- `version`
- `content`
- `schema_version`
- `created_by_user_id`
- `approved_by_user_id`
- `activated_at`
- `created_at`

Rules:

- Active policy versions are immutable.
- Ticket records the policy version used for decisions.
- AI must cite policy evidence for policy-based answers.

## 9. KB/RAG Model

### 9.1 KB Document

Fields:

- `kb_document_id`
- `tenant_id`
- `title`
- `source_type`: `manual | upload | url | integration`
- `source_ref`
- `document_type`: `faq | policy | macro | product_doc | sop`
- `status`: `draft | active | stale | archived`
- `version`
- `content_hash`
- `created_by_user_id`
- `created_at`
- `updated_at`

### 9.2 KB Chunk

Fields:

- `kb_chunk_id`
- `tenant_id`
- `kb_document_id`
- `chunk_index`
- `content`
- `embedding`
- `metadata`
- `status`
- `created_at`

Rules:

- Retrieval filters by tenant and active status.
- Retrieval returns chunk IDs and document metadata.
- Stale chunks are excluded unless explicitly requested for audit.

Implementation note (Milestone 7, ingestion): raw document content is stored by reference in the `KbContentStore` (filesystem default), never inline in PostgreSQL; the `kb_documents` row keeps only metadata plus `content_hash`. Ingestion chunks content with `chunkDocument` and embeds each chunk through the `Embedder` port (`vector(1536)`), writing an active chunk set atomically (re-ingest replaces the prior set). Chunk `metadata` carries the source/document type for downstream citation.

Implementation note (Milestone 7, retrieval): `POST /v1/kb/search` embeds the query with the same `Embedder` and runs a tenant-scoped cosine (`<=>`) nearest-neighbour search (`searchKbChunksQuery`, HNSW index) that inner-joins `kb_documents` and requires `status = 'active'` on both the chunk and the document. This applies the stale/active exclusion above at query time: a document PATCHed to `stale`/`archived`/`draft` is excluded from active answers even though its chunk rows remain. Each result carries the chunk citation IDs (`kb_chunk_id`, `kb_document_id`), the document citation metadata (`document_title`, `document_type`, `source_type`, `source_ref`), and a relevance `score`; raw embeddings are never returned. Retrieval is read-only and treats chunk content as untrusted data — adversarial ("prompt injection") text is returned verbatim as evidence and never interpreted, and ranking is relevance-only so it cannot be hijacked.

## 10. Tool Model

### 10.1 Tool Definition

Fields:

- `tool_definition_id`
- `tenant_id` nullable for global tools
- `name`
- `description`
- `input_schema`
- `output_schema`
- `permission`
- `side_effect_class`
- `requires_human_approval`
- `timeout_ms`
- `retry_policy`
- `redaction_policy`
- `status`
- `created_at`
- `updated_at`

### 10.2 Tool Call

Fields:

- `tool_call_id`
- `tenant_id`
- `ticket_id`
- `ai_run_id`
- `tool_definition_id`
- `input`
- `output`
- `status`: `planned | running | succeeded | failed | blocked`
- `side_effect_class`
- `idempotency_key`
- `started_at`
- `completed_at`
- `error_code`
- `error_message`

Rules:

- Tool input and output must validate against schemas.
- Tool calls are audited.
- AI never calls provider APIs directly.

## 11. AI Run Model

Fields:

- `ai_run_id`
- `tenant_id`
- `ticket_id`
- `conversation_id`
- `run_type`: `classification | routing | draft | full_graph | critique | eval`
- `prompt_version`
- `model_provider`
- `model_id`
- `input_refs`
- `retrieved_context_refs`
- `structured_output`
- `confidence`
- `risk_level`
- `automation_recommendation`
- `guardrail_results`
- `status`: `started | succeeded | failed | canceled`
- `latency_ms`
- `input_tokens`
- `output_tokens`
- `cost_estimate`
- `trace_id`
- `created_at`
- `completed_at`

Rules:

- AI run records are append-only operational evidence.
- Do not store secrets in AI run records.
- Prompt content storage must follow redaction policy.

Implementation note (Milestone 11): `ai_runs` rows are persisted by the
worker-side `createPersistedRunAiGraph` wrapper
(`packages/workers/src/activities/ticket-lifecycle-persistence.ts`), which
wraps any `runAiGraph` activity implementation and records the run's
structured output, confidence/risk/automation recommendation, guardrail
results, latency, and `trace_id` after the graph completes (failed runs
included, with a deterministic backfilled `ai_run_id` when the runtime could
not produce one). Deterministic run ids make Temporal activity retries
replay instead of duplicating rows, and a missing owning ticket row skips
persistence rather than failing the workflow. Because the row now exists
before `createApproval`/`sendOutboundMessage` run, the Milestone 10
`approvals.ai_run_id`/`messages.ai_run_id` FK guards link automatically.
`trace_id` is the observability join key: it connects the row to the OTel
spans exported to the collector and to the runtime's redacted trace export
(AI_RUNTIME_HARNESS §15). Tenant-scoped reads are served by
`GET /v1/ai-runs` and `GET /v1/ai-runs/{ai_run_id}` (§17.11).

## 12. Approval Model

Fields:

- `approval_id`
- `tenant_id`
- `ticket_id`
- `ai_run_id`
- `approval_type`: `reply | tool_action | escalation | policy_exception`
- `status`: `pending | approved | edited | rejected | escalated | expired`
- `requested_payload`
- `approved_payload`
- `reviewer_user_id`
- `review_notes`
- `created_at`
- `resolved_at`

Rules:

- Approval payloads must include evidence, draft, risk reasons, and requested action.
- Edited approvals preserve original AI draft and human edit.
- Expired approvals return ticket to human queue.

Implementation note (Milestone 13): approval expiry is timer-driven inside
the ticket lifecycle workflow. `createApproval` returns the configured
reviewer-decision window (`expires_in_ms`, from the worker's
`APPROVAL_EXPIRY_MS`, default 24h, non-positive disables) so the value is
recorded in workflow history and replays deterministically; the approval wait
races the decision signals against the first-response SLA timer and the
expiry deadline. On expiry the `expireApproval` activity resolves the
approval `pending -> expired` behind the same pending-status guard the API
decide path uses (a reviewer decision that wins the race is honored and the
workflow keeps waiting for its signal), audits `approval.expired`, and the
workflow ends in the `approval_expired` phase with the ticket remaining in
`waiting_human` — the human queue.

## 13. Audit Event Model

Fields:

- `audit_event_id`
- `tenant_id`
- `actor_type`: `system | ai | human | integration`
- `actor_id`
- `entity_type`
- `entity_id`
- `action`
- `metadata`
- `correlation_id`
- `created_at`

Rules:

- Audit events are append-only.
- Audit events must exist for ticket transitions, AI runs, tool calls, approvals, outbound sends, policy changes, integration credential changes, and permission changes.

Implementation note (Milestone 12): audit `action` values are constrained to
the canonical closed taxonomy `SupportAuditActionSchema` in
`@support/shared-schemas` — the workers audit boundary
(`RecordAuditEventActivityInput.action`, `AppendAuditEventInput.action`) is
typed to it at compile time and the API's approval-decision audit write
validates against it at runtime. Live producers: the ticket lifecycle
workflow (`ticket.manual_escalated`, `ai_graph.failed`, `ticket.sla_breached`,
`ticket.close_requested`, `approval.completed`, `message.sent`), the
persistence activities (`ticket.created` on workflow ticket creation,
`ticket.updated`/`ticket.closed` on persisted state transitions,
`approval.requested`, `approval.expired`, `message.send_failed` — Milestone
13 added the ticket-transition and expiry producers), the API decide service
(`approval.approved|edited|rejected|escalated`), and the retention job
(`retention.applied`). Tool calls are audited in the `tool_calls` table
(§10.2), not in `audit_events`. The taxonomy reserves
`policy.created|activated|archived`, `integration.credential_changed`, and
`permission.granted|revoked` for the corresponding write paths when they
land; an audit-completeness test drives every live producer and asserts all
emitted actions are canonical.

## 14. QA Review Model

Fields:

- `qa_review_id`
- `tenant_id`
- `ticket_id`
- `ai_run_id`
- `reviewer_user_id`
- `sample_reason`
- `scores`
- `defects`
- `notes`
- `created_at`
- `completed_at`

Defect categories:

- `wrong_policy`
- `wrong_tool_use`
- `missing_evidence`
- `hallucination`
- `bad_tone`
- `missed_escalation`
- `privacy_issue`
- `tenant_leakage`
- `unsafe_auto_send`

Implementation note (Milestone 11): QA reviews are queued two ways — the
deterministic QA sampling job (`packages/workers/src/qa-sampling.ts`,
SOPS §10 rules: 100% of auto-send recommendations as
`auto_send_candidate`, 100% of high-risk runs as `high_risk`, a
hash-bucketed random share of the rest as `random_sample`, default 25%)
and manual `POST /v1/qa-reviews` (`sample_reason: manual`). Reviewers
complete a review through `POST /v1/qa-reviews/{qa_review_id}/complete`
with 0-5 `scores` per SOP dimension and `defects` drawn from the taxonomy
above; completion is guarded (`completed_at is null`) so double
completion returns `409`. `GET /v1/qa-reviews/{qa_review_id}/evidence`
returns the composite evidence package (ticket, conversation, messages
including the outbound final response, the AI run with its trace link,
tool calls, and approvals carrying the original AI draft plus the human
edit) so a reviewer sees everything in one read (§17.14).

## 15. Routing Decision Contract

Structured output:

```json
{
  "topic": "order_status",
  "subtopic": "shipment_tracking",
  "language": "en",
  "sentiment": "neutral",
  "urgency": "normal",
  "priority": "p2",
  "risk_level": "low",
  "confidence": 0.91,
  "automation_mode": "human_approve",
  "assigned_queue": "ai_draft_queue",
  "reason_codes": ["order_lookup_needed"],
  "required_tools": ["order_lookup"],
  "required_evidence": ["order", "shipping_policy"]
}
```

Rules:

- Low confidence routes to human.
- High-risk topic routes to human.
- VIP route defaults to human approval.
- Legal/chargeback/fraud routes to human-only.

## 16. Draft Response Contract

Structured output:

```json
{
  "draft_text": "Thanks for reaching out. Your order ...",
  "customer_language": "en",
  "tone": "helpful_professional",
  "evidence": [
    {
      "type": "order",
      "ref_id": "order_123",
      "summary": "Order shipped on ..."
    },
    {
      "type": "kb_chunk",
      "ref_id": "kb_chunk_456",
      "summary": "Shipping policy ..."
    }
  ],
  "actions": [],
  "risk_level": "low",
  "confidence": 0.89,
  "needs_human": true,
  "human_review_reasons": ["v1_default_human_approval"]
}
```

Rules:

- No evidence means no customer-facing draft, except a clarifying question.
- Draft cannot promise refunds, credits, or exceptions unless policy supports it.
- Draft cannot mention internal tool names or confidence scores.

## 17. API Endpoint Families

Current API skeleton implements:

- `GET /health`
- `GET /ready`
- `GET /openapi.json`
- `GET /v1/tenants`
- `POST /v1/tenants`
- `GET /v1/tenants/{tenant_id}`
- `PATCH /v1/tenants/{tenant_id}`
- `GET /v1/customers`
- `POST /v1/customers`
- `GET /v1/customers/{customer_id}`
- `PATCH /v1/customers/{customer_id}`
- `GET /v1/conversations`
- `GET /v1/conversations/{conversation_id}`
- `GET /v1/conversations/{conversation_id}/messages`
- `GET /v1/conversations/{conversation_id}/messages/{message_id}`
- `GET /v1/policies`
- `GET /v1/policies/automation`
- `GET /v1/policies/{policy_id}`
- `GET /v1/reports/pilot-weekly`
- `GET /v1/kb/documents`
- `GET /v1/kb/documents/{kb_document_id}`
- `GET /v1/approvals`
- `GET /v1/approvals/{approval_id}`
- `GET /v1/ai-runs`
- `GET /v1/ai-runs/{ai_run_id}`
- `GET /v1/qa-reviews`
- `POST /v1/qa-reviews`
- `GET /v1/qa-reviews/{qa_review_id}`
- `POST /v1/qa-reviews/{qa_review_id}/complete`
- `GET /v1/qa-reviews/{qa_review_id}/evidence`
- `GET /v1/audit-events`
- `GET /v1/audit-events/{audit_event_id}`
- `GET /v1/tickets`
- `POST /v1/tickets`
- `GET /v1/tickets/{ticket_id}`
- `GET /v1/tickets/{ticket_id}/audit-events`
- `PATCH /v1/tickets/{ticket_id}`

The current tenant, customer, ticket, conversation, message, policy, KB document, approval, and audit event endpoints are
skeleton contracts where the database schema already supports those operations.
Tenant/customer/ticket currently support list-create-read-update as documented
below; conversations, messages, policies, audit events, and AI runs currently support read/list only, approvals support read/list plus the approve/edit/reject/escalate decision endpoints (§17.12), and QA reviews support list/read/create/complete plus the composite evidence read (§17.14). They validate
headers, path params, query params, request bodies, and response bodies, then use
the DB package tenant transaction helper for tenant-scoped data access. They
enforce the current role-to-permission matrix before service/data access. They do
not yet implement customer
identity merge logic, internal-note writes,
policy version mutation/approval/activation, or ticket lifecycle transitions.
Approval decision endpoints write audit events, signal the Temporal workflow,
and (through the workflow's send activity) trigger idempotent outbound sends;
other write endpoints still have no workflow side effects or audit behavior.

Endpoint families below include current implementation notes where available; otherwise they are target contracts for future milestones.

### 17.0 Common API Contract

Required on every non-health endpoint:

- `Authorization: Bearer <token>` placeholder auth header.
- `x-user-id` placeholder actor identifier.
- `x-user-email` optional actor email.
- `x-user-roles` required comma-separated role list. There is no default role: a request without a parseable role is rejected with `401 AUTH_REQUIRED` (deny-by-default, Milestone 12 — an implicit role would let a misconfigured gateway mint access).
- `x-request-id` optional request ID. If omitted, the API generates one.
- `x-correlation-id` optional correlation ID. If omitted, it defaults to the request ID.

Required on `/v1/*` tenant-scoped endpoints:

- `x-tenant-id`

Response rules:

- `x-request-id` and `x-correlation-id` are echoed on responses.
- Health and readiness do not require auth.
- `GET /openapi.json` requires auth but no tenant context because it is a global contract document.
- Global tenant administration endpoints (`GET /v1/tenants`, `POST /v1/tenants`, and platform-admin `PATCH /v1/tenants/{tenant_id}`) require auth but do not require `x-tenant-id`.
- `/v1/tenants/{tenant_id}` read currently requires `{tenant_id}` to match `x-tenant-id`.
- Non-platform-admin tenant updates require `{tenant_id}` to match `x-tenant-id`; platform admins may patch a tenant without tenant context.

Current skeleton permissions:

- `openapi:read`: all current roles.
- `tenants:list`: `platform_admin`.
- `tenants:read`: `platform_admin`, `ops_admin`.
- `tenants:create`: `platform_admin`.
- `tenants:update`: `platform_admin`, `ops_admin`.
- `customers:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `customers:create`: `platform_admin`, `ops_admin`, `support_agent`.
- `customers:update`: `platform_admin`, `ops_admin`, `support_agent`.
- `conversations:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `messages:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `policies:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `kb_documents:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `approvals:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `approvals:review`: `platform_admin`, `ops_admin`, `support_agent`. Grants the approve/edit/reject/escalate decision endpoints; `qa_reviewer`/`client_viewer` stay read-only.
- `audit_events:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `ai_runs:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`. AI run records are internal operational evidence, so `client_viewer` has no access.
- `qa_reviews:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`.
- `qa_reviews:write`: `platform_admin`, `ops_admin`, `qa_reviewer`. Grants QA review creation and completion; support agents can read reviews of their tickets but not author them.
- `reports:read`: `platform_admin`, `ops_admin`, `qa_reviewer`, `client_viewer`. Grants the weekly pilot report; support agents work tickets, not reporting.
- `tickets:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `tickets:create`: `platform_admin`, `ops_admin`, `support_agent`.
- `tickets:update`: `platform_admin`, `ops_admin`, `support_agent`.
- `integration_admin` currently has only `openapi:read` until integration endpoints are implemented.

The role→permission matrix (`packages/api/src/rbac.ts` `ROLE_PERMISSIONS`) is
the single source of truth; an RBAC matrix test enumerates every registered
route via a Fastify `onRoute` collector and asserts each enforces exactly its
documented permission for all six roles (plus `401` with no role), so a new
endpoint fails the suite until it is added to the catalog with an explicit
permission decision.

### 17.1 Health

- `GET /health`
- `GET /ready`

No auth required.

### 17.1.1 OpenAPI

- `GET /openapi.json`

Auth required. Tenant context not required.

### 17.2 Tenants

- `GET /v1/tenants`
- `POST /v1/tenants`
- `GET /v1/tenants/{tenant_id}`
- `PATCH /v1/tenants/{tenant_id}`

Current implementation:

- `GET /v1/tenants` lists tenants with a bounded `limit` query parameter and is platform-admin only.
- `POST /v1/tenants` creates a tenant from `tenant_id` (optional), `name`, `status` (optional), and `default_timezone` (optional). It is platform-admin only.
- `GET /v1/tenants/{tenant_id}` reads the current tenant and requires the path tenant to match `x-tenant-id`.
- `PATCH /v1/tenants/{tenant_id}` updates `name`, `status`, and `default_timezone`. Platform admins may update any tenant; ops admins may update only the tenant in `x-tenant-id`.

### 17.3 Channels

- `GET /v1/channels`
- `POST /v1/channels`
- `GET /v1/channels/{channel_id}`
- `PATCH /v1/channels/{channel_id}`
- `POST /v1/channels/{channel_id}/test`

### 17.4 Webhooks

- `POST /v1/webhooks/email/{provider}`
- `POST /v1/webhooks/whatsapp/{provider}`

Webhook endpoints verify signatures before processing.

Implementation notes (Milestone 6):

- Both endpoints require a `channel_id` query parameter identifying the target channel; the channel row determines the tenant and holds the `signature_secret_ref`.
- Endpoints are unauthenticated (signature-authenticated) and exempt from the bearer-token/tenant middleware. The signature is verified over the raw request body before any persistence side effect.
- On success they return `202 Accepted` with an `InboundWebhookAccepted` body: `channel_id`, `provider`, `received`, `accepted`, `deduplicated`, and a `results[]` array (`external_message_id`, `message_id`, `conversation_id`, `ticket_id`, `deduplicated`, `workflow_id`). A single WhatsApp webhook may batch multiple messages, so `results` can contain more than one entry.
- Failures use the standard structured error contract: unknown/inactive channel → `404 RESOURCE_NOT_FOUND`; bad/missing signature → `403 FORBIDDEN`; unparseable body or payload that fails normalization → `400 VALIDATION_ERROR`.

### 17.5 Customers

- `GET /v1/customers`
- `POST /v1/customers`
- `GET /v1/customers/{customer_id}`
- `PATCH /v1/customers/{customer_id}`
- `GET /v1/customers/{customer_id}/conversations`
- `GET /v1/customers/{customer_id}/tickets`

Current implementation:

- `GET /v1/customers` lists tenant-scoped customers with `limit`, `email`, and `external_customer_ref` query filters.
- `POST /v1/customers` creates a tenant-scoped customer. `customer_id` is optional; the API generates one when omitted. Supported fields are `display_name`, `email`, `phone`, `external_customer_ref`, and `metadata`.
- `GET /v1/customers/{customer_id}` reads a tenant-scoped customer.
- `PATCH /v1/customers/{customer_id}` updates `display_name`, `email`, `phone`, `external_customer_ref`, and `metadata`; empty patch bodies are rejected.
- Customer identity resolution, merge behavior, and customer conversation/ticket subresources are not implemented yet.

### 17.6 Conversations

- `GET /v1/conversations`
- `GET /v1/conversations/{conversation_id}`
- `GET /v1/conversations/{conversation_id}/messages`
- `GET /v1/conversations/{conversation_id}/messages/{message_id}`
- `POST /v1/conversations/{conversation_id}/internal-notes`

Current implementation:

- `GET /v1/conversations` lists tenant-scoped conversations with `limit`, `status`, `customer_id`, and `channel_id` query filters.
- `GET /v1/conversations/{conversation_id}` reads a tenant-scoped conversation.
- `GET /v1/conversations/{conversation_id}/messages` lists messages for a tenant-scoped conversation with `limit`, `direction`, and `ticket_id` query filters. Missing or cross-tenant parent conversations return structured not-found errors.
- `GET /v1/conversations/{conversation_id}/messages/{message_id}` reads a message under a tenant-scoped conversation.
- Message creation, inbound idempotency, outbound sending, internal-note creation, attachment validation, and HTML sanitization enforcement remain future workflow/channel tasks.

### 17.7 Tickets

- `GET /v1/tickets`
- `POST /v1/tickets`
- `GET /v1/tickets/{ticket_id}`
- `PATCH /v1/tickets/{ticket_id}`
- `POST /v1/tickets/{ticket_id}/assign`
- `POST /v1/tickets/{ticket_id}/escalate`
- `POST /v1/tickets/{ticket_id}/resolve`
- `POST /v1/tickets/{ticket_id}/close`
- `POST /v1/tickets/{ticket_id}/reopen`

Current implementation:

- `GET /v1/tickets` lists tenant-scoped tickets with `limit`, `status`, `customer_id`, and `assigned_queue` query filters.
- `POST /v1/tickets` creates a tenant-scoped ticket attached to an existing tenant-scoped `conversation_id` and `customer_id`; `ticket_id` is optional and generated when omitted. The create contract supports priority, triage metadata, assignment fields, policy/SLA references, opened time, and due timestamps.
- `GET /v1/tickets/{ticket_id}` reads a tenant-scoped ticket.
- `PATCH /v1/tickets/{ticket_id}` updates triage, priority, assignment, policy/SLA references, and due timestamps only. It intentionally does not update `status`, `resolved_at`, or `closed_at`; lifecycle transitions remain dedicated workflow-backed endpoints.
- Ticket create/update currently does not emit ticket events, audit events, workflow starts, or idempotency records.

### 17.8 Policies

- `GET /v1/policies`
- `POST /v1/policies`
- `GET /v1/policies/{policy_id}`
- `POST /v1/policies/{policy_id}/versions`
- `POST /v1/policy-versions/{policy_version_id}/approve`
- `POST /v1/policy-versions/{policy_version_id}/activate`

Current implementation:

- `GET /v1/policies` lists tenant-scoped policies with `limit`, `domain`, and `status` query filters.
- `GET /v1/policies/automation` (permission `policies:read`) resolves the tenant's effective auto-send controls: the highest activated version of an active `automation`-domain policy, with `policy_versions.content` validated against the shared `AutomationPolicyContentSchema` (`auto_send_enabled` kill switch + `auto_send_allowed_topics` constrained to the closed low-risk set `faq | order_status`). No policy, an inactive policy, or malformed content resolves to `configured: false` with the safe defaults (auto-send disabled, empty allowlist) — the controls fail closed. In v1 allowlist changes are an ops action (seed/SQL on `policy_versions`); the policy write/approve/activate endpoints remain future work.
- `GET /v1/policies/{policy_id}` reads a tenant-scoped policy.
- Policy create, policy version creation, approval, activation, immutable active-version enforcement, audit events, and workflow side effects remain future endpoints (the audit taxonomy already reserves `policy.created|activated|archived` for them).

### 17.9 KB

- `GET /v1/kb/documents`
- `POST /v1/kb/documents`
- `GET /v1/kb/documents/{kb_document_id}`
- `PATCH /v1/kb/documents/{kb_document_id}`
- `POST /v1/kb/documents/{kb_document_id}/ingest`
- `POST /v1/kb/search`

Current implementation:

- `GET /v1/kb/documents` lists tenant-scoped KB document metadata with `limit`, `source_type`, `document_type`, and `status` query filters. It returns document metadata only, not chunk content or embeddings.
- `GET /v1/kb/documents/{kb_document_id}` reads tenant-scoped KB document metadata.
- `POST /v1/kb/documents` creates a tenant-scoped KB document from `{title, source_type, document_type, source_ref?, content}`. The raw `content` is stored by reference in the `KbContentStore` (never inline in PostgreSQL), `content_hash` is derived server-side, and the document starts in `draft` status. Requires the `kb_documents:write` permission.
- `PATCH /v1/kb/documents/{kb_document_id}` updates document metadata (`title`, `source_ref`, `document_type`) and lifecycle `status` (for example `draft`/`active`/`stale`/`archived`). Content is immutable through PATCH in v1. Requires `kb_documents:write`.
- `POST /v1/kb/documents/{kb_document_id}/ingest` runs the ingestion pipeline: it reads the stored content, chunks it (`chunkDocument`), embeds each chunk (deterministic `Embedder` port, `vector(1536)`), atomically replaces the document's chunk set with the freshly embedded active chunks, and marks the document `active`. It returns `{kb_document_id, status, version, content_hash, chunk_count, embedded_count}`. Ingestion is idempotent by replacement (re-ingest deletes prior chunks first). Requires `kb_documents:write`.
- Chunking and embedding are pure/deterministic (`@support/integrations/kb`) so ingestion is reproducible and replay-safe when a Temporal `KbIngestionWorkflow` later drives these steps as activities. `0003_kb_vector_index.sql` adds a pgvector HNSW `vector_cosine_ops` index over `kb_chunks.embedding` for retrieval.
- `POST /v1/kb/search` runs tenant-scoped retrieval from `{query, limit?, document_type?, source_type?}`: it embeds the query with the same `Embedder` and returns the closest `active` chunks of `active` documents (cosine `<=>` over the HNSW index, stale/inactive/draft documents excluded via a `kb_documents` join). Each result is a `KbChunkResponse`-shaped chunk plus a relevance `score` and document citation metadata (`document_title`, `document_type`, `source_type`, `source_ref`); embeddings are never returned. Requires the `kb:search` permission (granted to the KB-read roles). KB audit events and workflow side effects remain future endpoints.

### 17.10 Tools

- `GET /v1/tools`
- `POST /v1/tools/{tool_name}/dry-run`
- `GET /v1/tool-calls`
- `GET /v1/tool-calls/{tool_call_id}`

### 17.11 AI Runs

- `GET /v1/ai-runs`
- `GET /v1/ai-runs/{ai_run_id}`
- `POST /v1/tickets/{ticket_id}/ai/draft`
- `POST /v1/tickets/{ticket_id}/ai/retry`

Current implementation:

- `GET /v1/ai-runs` (permission `ai_runs:read`) lists tenant-scoped AI run
  records with `limit`, `ticket_id`, `status`, and `run_type` query filters.
- `GET /v1/ai-runs/{ai_run_id}` reads a tenant-scoped AI run including its
  structured output, guardrail results, and the `trace_id` observability
  link. Missing or cross-tenant runs return `404 RESOURCE_NOT_FOUND`.
- The draft/retry trigger endpoints remain target contracts (the workflow
  currently owns AI runs end to end).

### 17.12 Approvals

- `GET /v1/approvals`
- `GET /v1/approvals/{approval_id}`
- `POST /v1/approvals/{approval_id}/approve`
- `POST /v1/approvals/{approval_id}/edit`
- `POST /v1/approvals/{approval_id}/reject`
- `POST /v1/approvals/{approval_id}/escalate`

Current implementation:

- `GET /v1/approvals` lists tenant-scoped approval records with `limit`, `status`, `ticket_id`, and `approval_type` query filters.
- `GET /v1/approvals/{approval_id}` reads a tenant-scoped approval record, including requested and approved payload metadata.
- `POST /v1/approvals/{approval_id}/approve|edit|reject|escalate` (permission `approvals:review`) resolve a `pending` approval with a terminal status. Each decision, in one tenant transaction, updates the approval (`status`, `reviewer_user_id` from `x-user-id`, `review_notes`, `resolved_at`, `approved_payload`) and appends an `approval.{approved|edited|rejected|escalated}` audit event whose metadata carries both `requested_payload` and `approved_payload` (the edited-draft audit trail). `approve` mirrors `requested_payload` into `approved_payload`; `edit` requires the human-edited `approved_payload` in the request body while `requested_payload` preserves the original AI draft (§12); `reject`/`escalate` approve nothing.
- After the decision commits, the API signals the ticket lifecycle workflow (`approval_completed` on workflow id `ticket-lifecycle:{tenant_id}:{conversation_id}`, conversation resolved through the approval's ticket) via an injectable `ApprovalWorkflowSignaler` (Temporal-backed default, lazy connection). The response is `{ approval, workflow_signal }`; a missing workflow (`workflow_not_found`) or missing ticket (`ticket_not_found`) is reported in `workflow_signal` rather than failing, because manually seeded approvals have no waiting workflow. Transport-level signal failures return `502 WORKFLOW_ERROR` after the decision has been persisted.
- Deciding a non-pending approval returns `409 CONFLICT` (the `pending`-guarded update makes concurrent double-decides safe); missing or cross-tenant approvals return `404 RESOURCE_NOT_FOUND`.

### 17.13 Audit

- `GET /v1/audit-events`
- `GET /v1/audit-events/{audit_event_id}`
- `GET /v1/tickets/{ticket_id}/audit-events`

Current implementation:

- `GET /v1/audit-events` lists tenant-scoped audit events with `limit`, `actor_type`, `entity_type`, `entity_id`, `action`, and `correlation_id` query filters.
- `GET /v1/audit-events/{audit_event_id}` reads a tenant-scoped audit event.
- `GET /v1/tickets/{ticket_id}/audit-events` lists tenant-scoped audit events for an existing tenant-scoped ticket with `limit`, `actor_type`, `action`, and `correlation_id` query filters. Missing or cross-tenant parent tickets return structured `RESOURCE_NOT_FOUND`.
- Audit event writes now exist in two places: the approval decision endpoints append `approval.*` audit rows in the same transaction as the decision, and the worker `recordAuditEvent`/`createApproval`/`sendOutboundMessage` activity implementations persist workflow-owned audit rows (with deterministic ids so Temporal activity retries do not duplicate them). Ticket/customer and other skeleton write endpoints still do not emit audit events.

### 17.14 QA Reviews

- `GET /v1/qa-reviews`
- `POST /v1/qa-reviews`
- `GET /v1/qa-reviews/{qa_review_id}`
- `POST /v1/qa-reviews/{qa_review_id}/complete`
- `GET /v1/qa-reviews/{qa_review_id}/evidence`

Current implementation:

- `GET /v1/qa-reviews` (permission `qa_reviews:read`) lists tenant-scoped QA
  reviews with `limit`, `ticket_id`, `ai_run_id`, and `completed`
  (`true`/`false`) query filters.
- `POST /v1/qa-reviews` (permission `qa_reviews:write`) queues a review for a
  tenant ticket with an enum `sample_reason`
  (`random_sample | auto_send_candidate | high_risk | manual`) and an
  optional `ai_run_id`; a missing/cross-tenant ticket or AI run returns
  `404 RESOURCE_NOT_FOUND`. The QA sampling job creates reviews through the
  same data model with deterministic ids (§14).
- `POST /v1/qa-reviews/{qa_review_id}/complete` (permission
  `qa_reviews:write`) records reviewer `scores` (0-5 per SOP dimension),
  `defects` (taxonomy of §14, each with optional severity and note), and
  optional `notes`, stamping `reviewer_user_id` and `completed_at`.
  Completing an already-completed review returns `409 CONFLICT`.
- `GET /v1/qa-reviews/{qa_review_id}/evidence` (permission
  `qa_reviews:read`) returns the composite evidence package: the review,
  ticket, conversation, messages (inbound and outbound final response), the
  linked AI run (structured output, guardrails, `trace_id`), the run's tool
  calls, and the ticket's approvals with `requested_payload` (original AI
  draft) and `approved_payload` (human edit).

### 17.15 Reports

- `GET /v1/reports/pilot-weekly`

Current implementation:

- `GET /v1/reports/pilot-weekly` (permission `reports:read`) computes the
  weekly pilot review report (SOPS §14) for the tenant over an optional
  `since`/`until` ISO window (default: the trailing seven days; an inverted
  window is a `400`). Aggregates run in one RLS transaction: ticket volume,
  resolutions with average resolution minutes, average first-response
  minutes (creation → first sent outbound message), manual escalations and
  SLA breaches (from audit events), AI run counts and draft rate (distinct
  tickets with a succeeded run / tickets created), approval decision counts
  and approval rate, outbound send/failure counts with auto-send rate
  (`sent_by_type = 'ai_auto'`), QA review counts with defect rate, and the
  top ticket topics. Rates are `null` when the denominator is zero.

### 17.16 Internal Service Endpoints (Milestone 14)

Internal endpoints live under `/internal/` (not `/v1/`) and are
service-to-service surfaces for the AI runtime sidecar — they are never
exposed to end users or the console.

Authentication: a machine bearer token, distinct from user tokens
(ADR-0020). The API resolves it at boot from an env reference per the
SecretResolver conventions (`SUPPORT_INTERNAL_API_TOKEN_REF`, default ref
`SUPPORT_INTERNAL_API_TOKEN`; `packages/api/src/internal-auth.ts`). A request
presenting the token (constant-time comparison) is minted the
`internal_service` actor (`svc:ai-runtime`), whose deny-by-default RBAC grant
is exactly `tools:execute_internal` + `kb:search`. The `internal_service`
role is reserved: claiming it via the `x-user-roles` header is rejected as
unauthenticated, and with no token configured the internal surface is
unreachable (fail closed).

- `POST /internal/tools/execute` — executes one tool call through the
  governed registry (`createDatabaseToolExecutor`: tenant visibility,
  permission classes, argument/output schemas, timeouts, bounded output,
  idempotency, `tool_calls` audit rows). Request
  (`InternalToolExecuteRequestSchema`): `tenant_id`, `ticket_id`,
  `ai_run_id`, `granted_permissions` (the permission-class set the runtime's
  policy node derived from tenant policy — re-enforced server-side per tool
  definition), and `request`, the unchanged Milestone 8 `ToolCallRequest`
  envelope. Response: the Milestone 8 `ToolCallResult` envelope. All tool
  outcomes (`succeeded`/`failed`/`blocked`) are HTTP 200 — the envelope
  carries the outcome; HTTP errors are reserved for auth (401/403) and body
  validation (400). Tenant scope comes from the validated body (internal
  paths read no `x-tenant-id` header) and is enforced by RLS in the
  executor's transactions.
- The sidecar's retrieval adapter calls the existing `POST /v1/kb/search`
  (§17.9) with the same machine token plus `x-tenant-id`, so retrieval stays
  behind the `kb:search` permission and tenant-scoped RLS.

The sidecar itself exposes `POST /internal/ai/run` (the wire mirror of the
runtime request/result, `AiRuntimeRunRequestSchema` /
`AiRuntimeRunResultSchema` in shared-schemas) and `GET /health`; see
AI_RUNTIME_HARNESS §20 for the bridge contract and failure semantics.

## 18. Event Envelope

```json
{
  "event_id": "evt_...",
  "event_name": "support.ticket.created.v1",
  "schema_version": "1",
  "tenant_id": "ten_...",
  "correlation_id": "corr_...",
  "causation_id": "evt_or_request_...",
  "occurred_at": "2026-06-18T00:00:00.000Z",
  "actor": {
    "type": "system",
    "id": "workflow"
  },
  "payload": {}
}
```

Required event names are listed in `PLAN.md`.

Current implementation:

- `packages/shared-schemas` exports `DomainEventEnvelopeSchema`, `DomainEventNameSchema`, and `buildDomainEventSubject` for the v1 domain event contract.
- The allowed v1 event names are the `support.*.v1` names listed in `PLAN.md`.
- `DomainEventEnvelopeSchema` validates `payload` by `event_name`. The current typed payload schemas cover message received, conversation updated, ticket created, ticket triaged/resolved/closed transitions, ticket priority changed, ticket assignment changed, ticket SLA breached, AI run started/completed, tool call completed, approval requested/completed, message sent, and QA review created events.
- NATS JetStream subjects use `support.events.tenant.{tenant_id}.{domain}.{fact}.v1`, for example `support.events.tenant.ten_test.ticket.created.v1`.
- Event `tenant_id` values used in subjects may contain letters, numbers, underscores, and hyphens only. This keeps tenant tokens safe for NATS subject routing.
- `packages/workers/src/domain-events.ts` provides worker-side emit helpers for `support.message.received.v1`, `support.ticket.created.v1`, ticket state transition events, `support.ticket.sla_breached.v1`, and `support.message.sent.v1`. These helpers build schema-validated envelopes and publish through an injected `DomainEventPublisher`; they are intended for Temporal workflow/activity code, not direct CRUD route side effects.
- `packages/workers/src/event-publisher.ts` provides the first `NatsJetStreamDomainEventPublisher` scaffold. It validates the envelope, publishes the JSON-encoded event to the tenant-aware subject, and passes `event_id` as the JetStream message ID for duplicate detection.
- `packages/workers/src/event-errors.ts` provides a structured event-error publisher for invalid envelopes and failed consumer handling. Error records use `SupportEventErrorRecordSchema`, are routed under `support.events.errors.>`, and intentionally avoid copying raw message payloads into the error stream.
- `packages/workers/src/event-bus.ts` provides local NATS connection and stream setup wiring using the official NATS.js v3 modules. It reads `NATS_URL`, connects to NATS, ensures the `SUPPORT_EVENTS` stream with `support.events.tenant.*.*.*.v1`, ensures the `SUPPORT_EVENT_ERRORS` stream with `support.events.errors.>`, and exposes both domain event and error publishers.
- The `SUPPORT_EVENTS` stream uses limits retention, file storage, one replica for local development, direct reads enabled, and a 10 minute duplicate window so `event_id` based publish de-dupe works in JetStream.
- The `SUPPORT_EVENT_ERRORS` stream also uses limits retention, file storage, one replica for local development, direct reads enabled, and the same 10 minute duplicate window for error-record message IDs.
- `packages/workers/src/event-consumer.ts` provides the worker-side consumer base. It builds and ensures durable pull consumers, validates JSON payloads with `DomainEventEnvelopeSchema`, rejects subject/envelope mismatches, and exposes `processNext()` for one-message-at-a-time worker loops.
- Consumer idempotency is storage-agnostic through `DomainEventConsumerIdempotencyStore`. The current in-memory implementation is used for deterministic tests; future side-effecting consumers can replace it with a PostgreSQL-backed adapter. Completed duplicate events are acked without re-running handlers, in-progress duplicates are nacked for later redelivery, handler failures are marked failed and nacked while delivery attempts remain, handler failures at the configured max delivery count are published to the error stream and termed, and invalid envelopes are published to the error stream and termed.
- `infra/nats/server.conf` enables local JetStream with a persisted Compose `nats-data` volume.
- `packages/workers/src/event-bus.integration.test.ts` verifies live local NATS domain event publish/consume/duplicate detection behavior and structured event-error publish/consume behavior.
- Current CRUD skeleton endpoints do not emit domain events. Event publication remains workflow/service-owned future behavior.

## 19. Temporal Workflows

### 19.1 TicketLifecycleWorkflow

Inputs:

- `tenant_id`
- `ticket_id`
- `initial_message_id`
- `correlation_id`

Signals:

- `message_received`
- `approval_completed`
- `manual_escalation_requested`
- `customer_replied`
- `close_requested`

Activities:

- `load_ticket_context`
- `create_or_update_ticket`
- `run_ai_graph`
- `create_approval`
- `send_outbound_message`
- `record_audit_event`
- `schedule_qa_review`
- `emit_domain_event`

Workflow outline:

1. Load or create ticket.
2. Set SLA timers.
3. Run triage/classification.
4. Determine route.
5. If AI eligible, run AI graph.
6. If auto-send allowed, send outbound.
7. Otherwise create human approval and wait.
8. Process approval result.
9. Update ticket state.
10. Schedule follow-up or QA.

Current implementation:

- `packages/workers/src/workflows/ticket-lifecycle-types.ts` defines the ticket lifecycle workflow input, signal, SLA timer, AI graph placeholder, activity, event-emission, result, and query-state contracts plus explicit activity retry-policy constants.
- `packages/workers/src/workflows/ticket-lifecycle-workflow.ts` defines `ticketLifecycleWorkflow` and the `message_received`, `customer_replied`, `approval_completed`, `manual_escalation_requested`, and `close_requested` signals plus the `ticket_lifecycle_state` query.
- The workflow definition is intentionally deterministic: it does not import Node APIs, NATS clients, DB clients, schema validators, or AI/runtime code; all side effects run through Temporal activities.
- The current workflow shell calls `createOrUpdateTicket`, records activity-provided first-response SLA timer data, emits ticket-created and ticket-triaged domain events through `emitDomainEvent`, runs `runInitialTriage`, calls `runAiGraph` through an activity placeholder for the human-approval route, creates a pending approval from successful AI output metadata, routes structured AI failures to human approval after recording `ai_graph.failed` audit through an activity, waits for approval/manual-escalation/close signals or a first-response SLA timer breach, emits `support.ticket.sla_breached.v1` and records `ticket.sla_breached` audit through activities on breach, records other audit actions through `recordAuditEvent`, and deduplicates repeated inbound message/customer-reply signals by `message_id`.
- Approval outcomes are routed deterministically once `approval_completed` resolves the wait. The workflow records `approval.completed` audit for every outcome, then: `approved`/`edited` call `sendOutboundMessage` with a deterministic `outbound:{tenant}:{ticket}:{approval_id}` idempotency key, emit `support.message.sent.v1`, record `message.sent` audit, and end in the `responded` phase; `rejected` ends in the `completed` phase without sending; `escalated` records `ticket.manual_escalated` audit and ends in the `manual_escalated` phase. `sendOutboundMessage` and the side-effect emit/audit activities run with the explicit side-effect retry policy.
- `packages/workers/src/activities/ticket-lifecycle-activities.ts` provides the first activity adapter for `emitDomainEvent`; it reuses `emitTicketCreatedEvent`, `emitTicketStateTransitionEvent`, `emitTicketSlaBreachedEvent`, and `emitMessageSentEvent` from the Milestone 4 domain-event helpers through an injected `DomainEventPublisher`.
- `packages/workers/src/temporal-worker.ts` provides worker config/runtime scaffolding for local Temporal at `localhost:7233`, namespace `default`, and task queue `support-ticket-lifecycle`.
- Inbound channel intake owns workflow start/`message_received` signals; the Milestone 10 approval decision endpoints own the `approval_completed` signal through the API `ApprovalWorkflowSignaler`.
- `packages/workers/src/activities/ticket-lifecycle-persistence.ts` provides the production `createApproval`, `sendOutboundMessage`, and `recordAuditEvent` activity implementations over a `TicketLifecyclePersistenceStore` port (database implementation under `withTenantTransaction`/RLS, in-memory implementation for offline tests). `createApproval` derives a deterministic approval id from (tenant, ticket, correlation) so activity retries replay instead of duplicating, links `ai_run_id` only when the `ai_runs` row exists, and audits `approval.requested`; `recordAuditEvent` hashes its input into a deterministic audit id so retried writes dedupe; outbound send/idempotency behavior is documented in §4.3.
- Ticket DB mutation, real LangGraph execution behind `runAiGraph`, inbound-message recording, and next-response/resolution SLA timers remain activity contracts/placeholders; a production worker entrypoint composes the persistence activities with those remaining placeholders when it lands.

### 19.2 KbIngestionWorkflow

Inputs:

- `tenant_id`
- `kb_document_id`

Activities:

- `load_document`
- `chunk_document`
- `embed_chunks`
- `write_chunks`
- `mark_document_active`
- `emit_domain_event`

### 19.3 SlaMonitorWorkflow

Can be part of ticket workflow or separate child workflow.

Responsibilities:

- Wait until first response deadline.
- Wait until next response deadline.
- Wait until resolution deadline.
- Emit breach events and escalation tasks.

## 20. Error Model

Structured error shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid.",
    "details": [],
    "request_id": "req_..."
  }
}
```

Error codes:

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`
- `FORBIDDEN`
- `TENANT_CONTEXT_REQUIRED`
- `TENANT_NOT_FOUND`
- `RESOURCE_NOT_FOUND`
- `CONFLICT`
- `IDEMPOTENCY_CONFLICT`
- `RATE_LIMITED`
- `PROVIDER_ERROR`
- `WORKFLOW_ERROR`
- `AI_RUNTIME_ERROR`
- `TOOL_EXECUTION_ERROR`
- `INTERNAL_ERROR`

## 21. Idempotency

Required for:

- Inbound webhook processing.
- Outbound sends.
- Tool side effects.
- Approval actions.
- Ticket state mutation from workflows.

Idempotency strategy:

- Store idempotency key with tenant and operation.
- Return previous result for identical retry.
- Return conflict if same key used with different payload.

## 22. Data Retention

V1 placeholders:

- Raw webhook payload retention configurable per tenant.
- Attachments retention configurable per tenant.
- AI traces retention configurable per tenant.
- Audit events retained longer than operational traces.
- PII deletion/export workflow to be designed before enterprise customers.

Current implementation (Milestone 12): `tenants.retention_policy` (jsonb,
migration `0004`) holds the per-tenant configuration validated by the shared
`TenantRetentionPolicySchema` (`raw_payload_days`, `attachment_days`,
`ai_run_days`, `audit_event_days`; absent/null = retain indefinitely — the
default). The workers retention job (`runTenantRetentionJob` +
`createDatabaseRetentionStore`, all under RLS) computes per-class cutoffs and
applies the safe subset: it clears expired `messages.raw_payload_ref`
references in bounded batches, returns the cleared refs for the storage
sweeper, and appends a `retention.applied` audit event. Attachment metadata
and AI-run traces are counted and reported as planned-but-not-executed
placeholders until the blob-deletion and anonymization strategies land.
Missing or malformed retention configuration fails closed (nothing is
purged). Changing a tenant's retention policy is an ops action; it is not
exposed on the tenant API contract yet.

## 23. Backend Acceptance Criteria For V1 Pilot

- Email and WhatsApp messages create conversations and tickets.
- Ticket workflow runs through triage, AI draft, approval, outbound, and audit.
- AI uses KB and tools with evidence.
- Human approval is required by default.
- All tool calls and AI runs are audited.
- Tenant isolation tests pass.
- Prompt-injection eval cases exist.
- SLA timers can breach and escalate.
- Pilot metrics can be queried.

## 24. Current Database Implementation

Milestone 2 starts with `@support/db` as the TypeScript database package.

Implemented artifacts:

- Drizzle schema: `packages/db/src/schema.ts`.
- Reviewed SQL migration: `packages/db/migrations/0001_initial_core.sql`.
- Row-level security migration: `packages/db/migrations/0002_tenant_rls.sql`.
- Migration runner: `packages/db/src/migrations.ts` and `packages/db/src/migrate.ts`.
- Repository query helpers: `packages/db/src/repositories.ts`.
- Tenant context helper: `packages/db/src/rls.ts`.
- Tenant transaction helper: `packages/db/src/rls.ts`.
- Live repository execution tests: `packages/db/src/repositories.integration.test.ts`.
- Live RLS negative tests: `packages/db/src/rls.integration.test.ts`.
- Drizzle config for future migration drafts: `packages/db/drizzle.config.ts`.
- API skeleton, RBAC, and tests: `packages/api/src/app.ts`, `packages/api/src/rbac.ts`, `packages/api/src/app.test.ts`, and `packages/api/src/app.integration.test.ts`.

Commands:

- Apply local migrations: `pnpm db:migrate`.
- Generate future migration drafts: `pnpm --filter @support/db generate:migration`.
- Run live integration tests for DB/RLS, API tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket endpoints, and NATS publish/consume behavior: `DATABASE_URL=postgres://support:support@localhost:5432/support NATS_URL=nats://localhost:4222 pnpm test:integration`.

Initial schema choices:

- Domain IDs are application-generated text IDs, matching the contract style such as `ten_...`, `ticket_...`, and `kb_chunk_...`.
- PostgreSQL remains the source of truth.
- The first KB embedding column is `vector(1536)` using `pgvector`, indexed with an HNSW `vector_cosine_ops` index (`0003_kb_vector_index.sql`). The Milestone 7 default embedder (`createDeterministicEmbedder`) is a deterministic token-hash unit-vector embedder used behind the `Embedder` port for reproducible, network-free ingestion and tests; it produces lexical (not semantic) similarity. Choose and document a production embedding model behind the same port before relying on this for real client data, and keep its dimension and metric aligned with the column (1536) and index (cosine) or re-embed.
- Tenant-scoped entities have `tenant_id` columns and tenant indexes. Repository query helpers currently enforce tenant filters for customer and ticket reads/lists/updates/writes, conversation, message, policy, KB document, approval, and audit event reads/lists, plus KB chunks, integrations, and tool definitions.
- Tool definitions may be global when `tenant_id is null`; tenant query helpers allow global active tools while excluding other tenants.
- Idempotency support starts with the `idempotency_keys` table and operation/key uniqueness per tenant.
- Live repository execution tests seed two synthetic tenants and prove the tenant-scoped helpers execute against PostgreSQL without returning cross-tenant customers, conversations, messages, policies, tickets, KB documents, approvals, audit events, KB chunks, integrations, or tool definitions.
- PostgreSQL row-level security is enabled for tenant-scoped tables before tenant-scoped API endpoints are exposed.
- Runtime tenant access uses the `app.current_tenant_id` PostgreSQL setting. API and worker code must set it transaction-locally through the DB package helper before tenant-scoped reads or writes.
- The `support_app` database role is the non-owner application role used for RLS enforcement. The local migration grants it DML access to current domain tables for runtime and test verification.
- `withTenantTransaction` sets `set local role support_app`, sets `app.current_tenant_id`, and exposes a transaction-bound Drizzle database to the caller before tenant-scoped repository work runs.
- RLS rejects missing tenant context, hides cross-tenant rows from raw SQL reads, blocks cross-tenant writes, and still allows global `tool_definitions` where `tenant_id is null`.
- The migration runner takes a PostgreSQL advisory lock before applying migrations so parallel live integration suites do not race schema changes.

Rollback and compatibility:

- The initial and RLS migrations are intended for empty development and pilot databases.
- There is no automated down migration yet. Before production data exists, rollback is drop-and-recreate. After production data exists, every schema change must include a compatibility or data migration plan.
