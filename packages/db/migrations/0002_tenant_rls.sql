create or replace function support_current_tenant_id()
returns text
language plpgsql
stable
as $$
declare
  tenant_id text;
begin
  tenant_id := nullif(current_setting('app.current_tenant_id', true), '');

  if tenant_id is null then
    raise exception 'app.current_tenant_id must be set for tenant-scoped database access'
      using errcode = '42501';
  end if;

  return tenant_id;
end;
$$;

comment on function support_current_tenant_id() is
  'Returns the transaction-local tenant id used by PostgreSQL row-level security policies.';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'support_app') then
    create role support_app nologin;
  end if;
end;
$$;

grant support_app to current_user;
grant usage on schema public to support_app;
grant execute on function support_current_tenant_id() to support_app;

grant select, insert, update, delete on
  tenants,
  users,
  roles,
  user_roles,
  customers,
  customer_identities,
  channels,
  conversations,
  sla_policies,
  tenant_policies,
  policy_versions,
  tickets,
  assignments,
  messages,
  ticket_events,
  kb_documents,
  kb_chunks,
  integrations,
  tool_definitions,
  ai_runs,
  tool_calls,
  approvals,
  audit_events,
  qa_reviews,
  idempotency_keys
to support_app;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenants',
    'users',
    'user_roles',
    'customers',
    'customer_identities',
    'channels',
    'conversations',
    'sla_policies',
    'tenant_policies',
    'policy_versions',
    'tickets',
    'assignments',
    'messages',
    'ticket_events',
    'kb_documents',
    'kb_chunks',
    'integrations',
    'ai_runs',
    'tool_calls',
    'approvals',
    'audit_events',
    'qa_reviews',
    'idempotency_keys'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format(
      'drop policy if exists %I on %I',
      table_name || '_tenant_isolation',
      table_name
    );
    execute format(
      'create policy %I on %I for all using (tenant_id = support_current_tenant_id()) with check (tenant_id = support_current_tenant_id())',
      table_name || '_tenant_isolation',
      table_name
    );
  end loop;
end;
$$;

alter table roles enable row level security;
drop policy if exists roles_tenant_select on roles;
drop policy if exists roles_tenant_insert on roles;
drop policy if exists roles_tenant_update on roles;
drop policy if exists roles_tenant_delete on roles;
create policy roles_tenant_select on roles
for select
using (
  support_current_tenant_id() is not null
  and (tenant_id is null or tenant_id = support_current_tenant_id())
);
create policy roles_tenant_insert on roles
for insert
with check (tenant_id = support_current_tenant_id());
create policy roles_tenant_update on roles
for update
using (tenant_id = support_current_tenant_id())
with check (tenant_id = support_current_tenant_id());
create policy roles_tenant_delete on roles
for delete
using (tenant_id = support_current_tenant_id());

alter table tool_definitions enable row level security;
drop policy if exists tool_definitions_tenant_select on tool_definitions;
drop policy if exists tool_definitions_tenant_insert on tool_definitions;
drop policy if exists tool_definitions_tenant_update on tool_definitions;
drop policy if exists tool_definitions_tenant_delete on tool_definitions;
create policy tool_definitions_tenant_select on tool_definitions
for select
using (
  support_current_tenant_id() is not null
  and (tenant_id is null or tenant_id = support_current_tenant_id())
);
create policy tool_definitions_tenant_insert on tool_definitions
for insert
with check (tenant_id = support_current_tenant_id());
create policy tool_definitions_tenant_update on tool_definitions
for update
using (tenant_id = support_current_tenant_id())
with check (tenant_id = support_current_tenant_id());
create policy tool_definitions_tenant_delete on tool_definitions
for delete
using (tenant_id = support_current_tenant_id());
