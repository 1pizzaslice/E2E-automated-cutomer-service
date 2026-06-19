create extension if not exists vector;

create type tenant_status as enum ('active', 'suspended', 'archived');
create type user_status as enum ('active', 'invited', 'suspended', 'archived');
create type role_name as enum (
  'platform_admin',
  'ops_admin',
  'support_agent',
  'qa_reviewer',
  'client_viewer',
  'integration_admin'
);
create type channel_type as enum ('email', 'whatsapp', 'chat_future');
create type channel_status as enum ('active', 'paused', 'disabled');
create type customer_identity_type as enum (
  'email',
  'phone',
  'whatsapp_id',
  'external_user_id'
);
create type conversation_status as enum ('open', 'archived');
create type message_direction as enum (
  'inbound',
  'outbound',
  'internal_note',
  'system'
);
create type message_creator_type as enum (
  'customer',
  'human',
  'ai',
  'system',
  'integration'
);
create type ticket_status as enum (
  'new',
  'triaged',
  'waiting_ai',
  'waiting_human',
  'waiting_customer',
  'resolved',
  'closed',
  'reopened',
  'failed'
);
create type ticket_priority as enum ('p0', 'p1', 'p2', 'p3');
create type automation_mode as enum (
  'auto_send',
  'human_approve',
  'human_only'
);
create type actor_type as enum ('system', 'ai', 'human', 'integration');
create type assignment_status as enum ('active', 'released', 'transferred');
create type sla_policy_status as enum ('draft', 'active', 'archived');
create type tenant_policy_domain as enum (
  'refunds',
  'cancellations',
  'shipping',
  'faq',
  'routing',
  'tone',
  'escalation',
  'automation'
);
create type tenant_policy_status as enum ('draft', 'active', 'archived');
create type kb_document_source_type as enum (
  'manual',
  'upload',
  'url',
  'integration'
);
create type kb_document_type as enum (
  'faq',
  'policy',
  'macro',
  'product_doc',
  'sop'
);
create type kb_status as enum ('draft', 'active', 'stale', 'archived');
create type integration_status as enum (
  'active',
  'paused',
  'disabled',
  'error'
);
create type tool_side_effect_class as enum (
  'read_only',
  'draft_side_effect',
  'reversible_write',
  'irreversible_write'
);
create type tool_status as enum ('active', 'disabled', 'archived');
create type tool_call_status as enum (
  'planned',
  'running',
  'succeeded',
  'failed',
  'blocked'
);
create type ai_run_type as enum (
  'classification',
  'routing',
  'draft',
  'full_graph',
  'critique',
  'eval'
);
create type ai_run_status as enum (
  'started',
  'succeeded',
  'failed',
  'canceled'
);
create type approval_type as enum (
  'reply',
  'tool_action',
  'escalation',
  'policy_exception'
);
create type approval_status as enum (
  'pending',
  'approved',
  'edited',
  'rejected',
  'escalated',
  'expired'
);
create type idempotency_status as enum ('started', 'completed', 'failed');

create table tenants (
  tenant_id text primary key,
  name text not null,
  status tenant_status not null default 'active',
  default_timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tenants_name_idx on tenants (name);
create index tenants_status_idx on tenants (status);

create table users (
  user_id text primary key,
  tenant_id text references tenants (tenant_id),
  email text not null,
  display_name text not null,
  status user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index users_email_idx on users (email);
create index users_tenant_id_idx on users (tenant_id);

create table roles (
  role_id text primary key,
  tenant_id text references tenants (tenant_id),
  name role_name not null,
  created_at timestamptz not null default now()
);

create index roles_tenant_id_idx on roles (tenant_id);
create unique index roles_tenant_name_idx on roles (tenant_id, name)
where tenant_id is not null;
create unique index roles_global_name_idx on roles (name)
where tenant_id is null;

create table user_roles (
  user_role_id text primary key,
  tenant_id text references tenants (tenant_id),
  user_id text not null references users (user_id),
  role_id text not null references roles (role_id),
  created_at timestamptz not null default now()
);

create unique index user_roles_user_role_idx on user_roles (user_id, role_id);
create index user_roles_tenant_id_idx on user_roles (tenant_id);

create table customers (
  customer_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  display_name text,
  email text,
  phone text,
  external_customer_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_tenant_id_idx on customers (tenant_id);
create unique index customers_tenant_external_ref_idx
on customers (tenant_id, external_customer_ref)
where external_customer_ref is not null;

create table customer_identities (
  customer_identity_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  customer_id text not null references customers (customer_id),
  channel channel_type not null,
  identity_type customer_identity_type not null,
  identity_value text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index customer_identities_tenant_id_idx on customer_identities (tenant_id);
create index customer_identities_customer_id_idx on customer_identities (customer_id);
create unique index customer_identities_unique_idx
on customer_identities (tenant_id, channel, identity_type, identity_value);

create table channels (
  channel_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  type channel_type not null,
  provider text not null,
  status channel_status not null default 'active',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index channels_tenant_id_idx on channels (tenant_id);
create index channels_tenant_type_status_idx on channels (tenant_id, type, status);

create table conversations (
  conversation_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  customer_id text not null references customers (customer_id),
  channel_id text not null references channels (channel_id),
  external_thread_id text,
  status conversation_status not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_tenant_id_idx on conversations (tenant_id);
create index conversations_tenant_customer_idx on conversations (tenant_id, customer_id);
create unique index conversations_external_thread_idx
on conversations (tenant_id, channel_id, external_thread_id)
where external_thread_id is not null;

create table sla_policies (
  sla_policy_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  name text not null,
  priority ticket_priority not null,
  first_response_minutes integer not null check (first_response_minutes > 0),
  next_response_minutes integer not null check (next_response_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  business_hours jsonb not null default '{}'::jsonb,
  pause_conditions jsonb not null default '{}'::jsonb,
  escalation_rules jsonb not null default '{}'::jsonb,
  status sla_policy_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sla_policies_tenant_id_idx on sla_policies (tenant_id);
create index sla_policies_tenant_priority_status_idx
on sla_policies (tenant_id, priority, status);

create table tenant_policies (
  policy_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  name text not null,
  domain tenant_policy_domain not null,
  status tenant_policy_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenant_policies_tenant_id_idx on tenant_policies (tenant_id);
create index tenant_policies_tenant_domain_status_idx
on tenant_policies (tenant_id, domain, status);

create table policy_versions (
  policy_version_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  policy_id text not null references tenant_policies (policy_id),
  version integer not null check (version > 0),
  content jsonb not null default '{}'::jsonb,
  schema_version text not null,
  created_by_user_id text references users (user_id),
  approved_by_user_id text references users (user_id),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index policy_versions_tenant_id_idx on policy_versions (tenant_id);
create unique index policy_versions_policy_version_idx
on policy_versions (policy_id, version);

create table tickets (
  ticket_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  conversation_id text not null references conversations (conversation_id),
  customer_id text not null references customers (customer_id),
  status ticket_status not null default 'new',
  priority ticket_priority not null default 'p2',
  topic text,
  subtopic text,
  language text,
  sentiment text,
  urgency_score integer,
  automation_mode automation_mode not null default 'human_approve',
  assigned_queue text,
  assigned_user_id text references users (user_id),
  sla_policy_id text references sla_policies (sla_policy_id),
  policy_version_id text references policy_versions (policy_version_id),
  opened_at timestamptz not null,
  first_response_due_at timestamptz,
  next_response_due_at timestamptz,
  resolution_due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_tenant_id_idx on tickets (tenant_id);
create index tickets_tenant_status_idx on tickets (tenant_id, status);
create index tickets_tenant_assigned_queue_idx on tickets (tenant_id, assigned_queue);
create index tickets_conversation_id_idx on tickets (conversation_id);
create index tickets_customer_id_idx on tickets (customer_id);

create table assignments (
  assignment_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  ticket_id text not null references tickets (ticket_id),
  assigned_queue text,
  assigned_user_id text references users (user_id),
  status assignment_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);

create index assignments_tenant_id_idx on assignments (tenant_id);
create index assignments_ticket_id_idx on assignments (ticket_id);
create index assignments_tenant_status_idx on assignments (tenant_id, status);

create table messages (
  message_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  conversation_id text not null references conversations (conversation_id),
  ticket_id text references tickets (ticket_id),
  channel_id text not null references channels (channel_id),
  direction message_direction not null,
  body_text text,
  body_html_ref text,
  attachments jsonb not null default '[]'::jsonb,
  external_message_id text,
  external_thread_id text,
  raw_payload_ref text,
  created_by_type message_creator_type not null,
  created_by_user_id text references users (user_id),
  provider_message_id text,
  send_status text,
  sent_by_type text,
  ai_run_id text,
  approval_id text,
  sent_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index messages_tenant_id_idx on messages (tenant_id);
create index messages_conversation_id_idx on messages (conversation_id);
create index messages_ticket_id_idx on messages (ticket_id);
create unique index messages_external_message_idx
on messages (tenant_id, channel_id, external_message_id)
where external_message_id is not null;
create unique index messages_idempotency_idx
on messages (tenant_id, idempotency_key)
where idempotency_key is not null;

create table ticket_events (
  ticket_event_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  ticket_id text not null references tickets (ticket_id),
  event_type text not null,
  from_status ticket_status,
  to_status ticket_status,
  actor_type actor_type not null,
  actor_id text,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ticket_events_tenant_id_idx on ticket_events (tenant_id);
create index ticket_events_ticket_id_idx on ticket_events (ticket_id);

create table kb_documents (
  kb_document_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  title text not null,
  source_type kb_document_source_type not null,
  source_ref text,
  document_type kb_document_type not null,
  status kb_status not null default 'draft',
  version integer not null default 1 check (version > 0),
  content_hash text not null,
  created_by_user_id text references users (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kb_documents_tenant_id_idx on kb_documents (tenant_id);
create index kb_documents_tenant_status_idx on kb_documents (tenant_id, status);

create table kb_chunks (
  kb_chunk_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  kb_document_id text not null references kb_documents (kb_document_id),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  status kb_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index kb_chunks_tenant_id_idx on kb_chunks (tenant_id);
create index kb_chunks_tenant_status_idx on kb_chunks (tenant_id, status);
create unique index kb_chunks_document_index_idx
on kb_chunks (kb_document_id, chunk_index);

create table integrations (
  integration_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  provider text not null,
  integration_type text not null,
  status integration_status not null default 'active',
  config jsonb not null default '{}'::jsonb,
  credential_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index integrations_tenant_id_idx on integrations (tenant_id);
create unique index integrations_tenant_provider_type_idx
on integrations (tenant_id, provider, integration_type);

create table tool_definitions (
  tool_definition_id text primary key,
  tenant_id text references tenants (tenant_id),
  name text not null,
  description text not null,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  permission text not null,
  side_effect_class tool_side_effect_class not null,
  requires_human_approval boolean not null,
  timeout_ms integer not null check (timeout_ms > 0),
  retry_policy jsonb not null default '{}'::jsonb,
  redaction_policy jsonb not null default '{}'::jsonb,
  status tool_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tool_definitions_tenant_id_idx on tool_definitions (tenant_id);
create unique index tool_definitions_tenant_name_idx
on tool_definitions (tenant_id, name)
where tenant_id is not null;
create unique index tool_definitions_global_name_idx
on tool_definitions (name)
where tenant_id is null;

create table ai_runs (
  ai_run_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  ticket_id text not null references tickets (ticket_id),
  conversation_id text not null references conversations (conversation_id),
  run_type ai_run_type not null,
  prompt_version text not null,
  model_provider text not null,
  model_id text not null,
  input_refs jsonb not null default '{}'::jsonb,
  retrieved_context_refs jsonb not null default '{}'::jsonb,
  structured_output jsonb,
  confidence numeric(4, 3) check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  risk_level text,
  automation_recommendation automation_mode,
  guardrail_results jsonb not null default '{}'::jsonb,
  status ai_run_status not null default 'started',
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_estimate numeric(12, 6) check (
    cost_estimate is null or cost_estimate >= 0
  ),
  trace_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_runs_tenant_id_idx on ai_runs (tenant_id);
create index ai_runs_ticket_id_idx on ai_runs (ticket_id);
create index ai_runs_trace_id_idx on ai_runs (trace_id);

create table tool_calls (
  tool_call_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  ticket_id text not null references tickets (ticket_id),
  ai_run_id text not null references ai_runs (ai_run_id),
  tool_definition_id text not null references tool_definitions (tool_definition_id),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status tool_call_status not null default 'planned',
  side_effect_class tool_side_effect_class not null,
  idempotency_key text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text
);

create index tool_calls_tenant_id_idx on tool_calls (tenant_id);
create index tool_calls_ticket_id_idx on tool_calls (ticket_id);
create index tool_calls_ai_run_id_idx on tool_calls (ai_run_id);
create unique index tool_calls_idempotency_idx
on tool_calls (tenant_id, tool_definition_id, idempotency_key)
where idempotency_key is not null;

create table approvals (
  approval_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  ticket_id text not null references tickets (ticket_id),
  ai_run_id text references ai_runs (ai_run_id),
  approval_type approval_type not null,
  status approval_status not null default 'pending',
  requested_payload jsonb not null default '{}'::jsonb,
  approved_payload jsonb,
  reviewer_user_id text references users (user_id),
  review_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index approvals_tenant_id_idx on approvals (tenant_id);
create index approvals_ticket_id_idx on approvals (ticket_id);
create index approvals_tenant_status_idx on approvals (tenant_id, status);

create table audit_events (
  audit_event_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  actor_type actor_type not null,
  actor_id text,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);

create index audit_events_tenant_id_idx on audit_events (tenant_id);
create index audit_events_entity_idx
on audit_events (tenant_id, entity_type, entity_id);
create index audit_events_correlation_id_idx on audit_events (correlation_id);

create table qa_reviews (
  qa_review_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  ticket_id text not null references tickets (ticket_id),
  ai_run_id text references ai_runs (ai_run_id),
  reviewer_user_id text references users (user_id),
  sample_reason text not null,
  scores jsonb not null default '{}'::jsonb,
  defects jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index qa_reviews_tenant_id_idx on qa_reviews (tenant_id);
create index qa_reviews_ticket_id_idx on qa_reviews (ticket_id);

create table idempotency_keys (
  idempotency_key_id text primary key,
  tenant_id text not null references tenants (tenant_id),
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_ref text,
  status idempotency_status not null default 'started',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idempotency_keys_tenant_id_idx on idempotency_keys (tenant_id);
create unique index idempotency_keys_tenant_operation_key_idx
on idempotency_keys (tenant_id, operation, idempotency_key);
