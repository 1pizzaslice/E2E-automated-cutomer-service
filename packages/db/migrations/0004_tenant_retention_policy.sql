-- Milestone 12: per-tenant data retention configuration (BACKEND_SPEC section 22).
-- Keys follow the shared TenantRetentionPolicySchema contract
-- (raw_payload_days, attachment_days, ai_run_days, audit_event_days);
-- an empty object means retain everything indefinitely.
alter table tenants
  add column if not exists retention_policy jsonb not null default '{}'::jsonb;
