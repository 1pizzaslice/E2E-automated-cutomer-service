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

Current scaffold implements only:

- `GET /health`
- `GET /ready`

The remaining endpoint families below are the target contract for future milestones.

### 17.1 Health

- `GET /health`
- `GET /ready`

No auth required.

### 17.2 Tenants

- `GET /v1/tenants`
- `POST /v1/tenants`
- `GET /v1/tenants/{tenant_id}`
- `PATCH /v1/tenants/{tenant_id}`

Platform/admin only.

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

### 17.5 Customers

- `GET /v1/customers`
- `POST /v1/customers`
- `GET /v1/customers/{customer_id}`
- `PATCH /v1/customers/{customer_id}`
- `GET /v1/customers/{customer_id}/conversations`
- `GET /v1/customers/{customer_id}/tickets`

### 17.6 Conversations

- `GET /v1/conversations`
- `GET /v1/conversations/{conversation_id}`
- `GET /v1/conversations/{conversation_id}/messages`
- `POST /v1/conversations/{conversation_id}/internal-notes`

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

### 17.8 Policies

- `GET /v1/policies`
- `POST /v1/policies`
- `GET /v1/policies/{policy_id}`
- `POST /v1/policies/{policy_id}/versions`
- `POST /v1/policy-versions/{policy_version_id}/approve`
- `POST /v1/policy-versions/{policy_version_id}/activate`

### 17.9 KB

- `GET /v1/kb/documents`
- `POST /v1/kb/documents`
- `GET /v1/kb/documents/{kb_document_id}`
- `PATCH /v1/kb/documents/{kb_document_id}`
- `POST /v1/kb/documents/{kb_document_id}/ingest`
- `POST /v1/kb/search`

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

### 17.12 Approvals

- `GET /v1/approvals`
- `GET /v1/approvals/{approval_id}`
- `POST /v1/approvals/{approval_id}/approve`
- `POST /v1/approvals/{approval_id}/edit`
- `POST /v1/approvals/{approval_id}/reject`
- `POST /v1/approvals/{approval_id}/escalate`

### 17.13 Audit

- `GET /v1/audit-events`
- `GET /v1/tickets/{ticket_id}/audit-events`

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
- Migration runner: `packages/db/src/migrations.ts` and `packages/db/src/migrate.ts`.
- Repository query helpers: `packages/db/src/repositories.ts`.
- Live repository execution tests: `packages/db/src/repositories.integration.test.ts`.
- Drizzle config for future migration drafts: `packages/db/drizzle.config.ts`.

Commands:

- Apply local migrations: `pnpm db:migrate`.
- Generate future migration drafts: `pnpm --filter @support/db generate:migration`.
- Run live repository integration tests: `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration`.

Initial schema choices:

- Domain IDs are application-generated text IDs, matching the contract style such as `ten_...`, `ticket_...`, and `kb_chunk_...`.
- PostgreSQL remains the source of truth.
- The first KB embedding column is `vector(1536)` using `pgvector`; choose and document a production embedding model before relying on this dimension for real client data.
- Tenant-scoped entities have `tenant_id` columns and tenant indexes. Repository query helpers currently enforce tenant filters for customers, tickets, KB chunks, integrations, audit events, and tool definitions.
- Tool definitions may be global when `tenant_id is null`; tenant query helpers allow global active tools while excluding other tenants.
- Idempotency support starts with the `idempotency_keys` table and operation/key uniqueness per tenant.
- Live repository execution tests seed two synthetic tenants and prove the tenant-scoped helpers execute against PostgreSQL without returning cross-tenant customers, tickets, KB chunks, integrations, tool definitions, or audit events.
- PostgreSQL row-level security is not implemented yet. Per ADR-0013, add RLS policies before exposing tenant-scoped API endpoints.

Rollback and compatibility:

- The initial migration is intended for empty development and pilot databases.
- There is no automated down migration yet. Before production data exists, rollback is drop-and-recreate. After production data exists, every schema change must include a compatibility or data migration plan.
