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
- `GET /v1/policies/{policy_id}`
- `GET /v1/kb/documents`
- `GET /v1/kb/documents/{kb_document_id}`
- `GET /v1/approvals`
- `GET /v1/approvals/{approval_id}`
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
below; conversations, messages, policies, KB documents, approvals, and audit events currently support read/list only. They validate
headers, path params, query params, request bodies, and response bodies, then use
the DB package tenant transaction helper for tenant-scoped data access. They
enforce the current role-to-permission matrix before service/data access. They do
not yet implement workflow side effects, idempotency, audit behavior, customer
identity merge logic, message ingestion, outbound sending, internal-note writes,
policy version mutation/approval/activation, or ticket lifecycle transitions.
They also do not yet implement KB document creation/update, ingestion, chunking,
embedding, retrieval search, KB audit side effects, or approval actions.

Endpoint families below include current implementation notes where available; otherwise they are target contracts for future milestones.

### 17.0 Common API Contract

Required on every non-health endpoint:

- `Authorization: Bearer <token>` placeholder auth header.
- `x-user-id` placeholder actor identifier.
- `x-user-email` optional actor email.
- `x-user-roles` optional comma-separated role list, defaulting to `support_agent`.
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
- `audit_events:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `tickets:read`: `platform_admin`, `ops_admin`, `support_agent`, `qa_reviewer`, `client_viewer`.
- `tickets:create`: `platform_admin`, `ops_admin`, `support_agent`.
- `tickets:update`: `platform_admin`, `ops_admin`, `support_agent`.
- `integration_admin` currently has only `openapi:read` until integration endpoints are implemented.

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
- `GET /v1/policies/{policy_id}` reads a tenant-scoped policy.
- Policy create, policy version creation, approval, activation, immutable active-version enforcement, audit events, and workflow side effects remain future endpoints.

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
- KB document creation, update, ingestion, chunking, embedding, active/stale retrieval behavior, search, audit events, and workflow side effects remain future endpoints.

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

Current implementation:

- `GET /v1/approvals` lists tenant-scoped approval records with `limit`, `status`, `ticket_id`, and `approval_type` query filters.
- `GET /v1/approvals/{approval_id}` reads a tenant-scoped approval record, including requested and approved payload metadata.
- Approval approve/edit/reject/escalate actions, Temporal signals, audit events, outbound side effects, and workflow resume behavior remain future endpoints.

### 17.13 Audit

- `GET /v1/audit-events`
- `GET /v1/audit-events/{audit_event_id}`
- `GET /v1/tickets/{ticket_id}/audit-events`

Current implementation:

- `GET /v1/audit-events` lists tenant-scoped audit events with `limit`, `actor_type`, `entity_type`, `entity_id`, `action`, and `correlation_id` query filters.
- `GET /v1/audit-events/{audit_event_id}` reads a tenant-scoped audit event.
- `GET /v1/tickets/{ticket_id}/audit-events` lists tenant-scoped audit events for an existing tenant-scoped ticket with `limit`, `actor_type`, `action`, and `correlation_id` query filters. Missing or cross-tenant parent tickets return structured `RESOURCE_NOT_FOUND`.
- Audit event creation remains workflow/service-owned future behavior; current ticket/customer/approval skeleton endpoints do not emit audit events yet.

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
- NATS JetStream subjects use `support.events.tenant.{tenant_id}.{domain}.{fact}.v1`, for example `support.events.tenant.ten_test.ticket.created.v1`.
- Event `tenant_id` values used in subjects may contain letters, numbers, underscores, and hyphens only. This keeps tenant tokens safe for NATS subject routing.
- `packages/workers/src/event-publisher.ts` provides the first `NatsJetStreamDomainEventPublisher` scaffold. It validates the envelope, publishes the JSON-encoded event to the tenant-aware subject, and passes `event_id` as the JetStream message ID for duplicate detection.
- Current CRUD skeleton endpoints do not emit domain events yet. Event publication remains workflow/service-owned future behavior.

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
- Run live PostgreSQL integration tests for DB/RLS and API tenant/customer/conversation/message/policy/KB document/approval/audit event/ticket endpoints: `DATABASE_URL=postgres://support:support@localhost:5432/support pnpm test:integration`.

Initial schema choices:

- Domain IDs are application-generated text IDs, matching the contract style such as `ten_...`, `ticket_...`, and `kb_chunk_...`.
- PostgreSQL remains the source of truth.
- The first KB embedding column is `vector(1536)` using `pgvector`; choose and document a production embedding model before relying on this dimension for real client data.
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
