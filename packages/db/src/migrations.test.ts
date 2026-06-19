import { describe, expect, it } from "vitest";
import {
  MIGRATIONS_ADVISORY_LOCK_ID,
  loadSqlMigrations,
  migrationIdFromFilename,
  MIGRATIONS_TABLE,
} from "./migrations.js";

describe("sql migrations", () => {
  it("parses migration ids from filenames", () => {
    expect(migrationIdFromFilename("0001_initial_core.sql")).toBe(
      "0001_initial_core",
    );
    expect(migrationIdFromFilename("0002_tenant_rls.sql")).toBe(
      "0002_tenant_rls",
    );
  });

  it("rejects invalid migration filenames", () => {
    expect(() => migrationIdFromFilename("initial-core.sql")).toThrow(
      "Invalid migration filename",
    );
  });

  it("loads migrations in filename order", async () => {
    const migrations = await loadSqlMigrations();

    expect(migrations.map((migration) => migration.id)).toEqual([
      "0001_initial_core",
      "0002_tenant_rls",
    ]);
    expect(migrations[0]?.sql).toContain(
      "create extension if not exists vector",
    );
  });

  it("contains the core milestone tables and tenant indexes", async () => {
    const [migration] = await loadSqlMigrations();
    expect(migration).toBeDefined();

    const sql = migration?.sql ?? "";
    const expectedTables = [
      "tenants",
      "users",
      "roles",
      "user_roles",
      "customers",
      "customer_identities",
      "channels",
      "conversations",
      "messages",
      "tickets",
      "ticket_events",
      "assignments",
      "sla_policies",
      "tenant_policies",
      "policy_versions",
      "kb_documents",
      "kb_chunks",
      "integrations",
      "tool_definitions",
      "tool_calls",
      "ai_runs",
      "approvals",
      "audit_events",
      "qa_reviews",
      "idempotency_keys",
    ];

    for (const table of expectedTables) {
      expect(sql).toContain(`create table ${table}`);
    }

    expect(sql).toContain("embedding vector(1536)");
    expect(sql).toContain(
      "create unique index idempotency_keys_tenant_operation_key_idx",
    );
    expect(MIGRATIONS_TABLE).toBe("schema_migrations");
    expect(MIGRATIONS_ADVISORY_LOCK_ID).toBe(513248771777);
  });

  it("contains row-level security policies for tenant-scoped tables", async () => {
    const migrations = await loadSqlMigrations();
    const migration = migrations.find(
      (candidate) => candidate.id === "0002_tenant_rls",
    );

    expect(migration).toBeDefined();

    const sql = migration?.sql ?? "";
    const tenantScopedTables = [
      "tenants",
      "users",
      "user_roles",
      "customers",
      "customer_identities",
      "channels",
      "conversations",
      "sla_policies",
      "tenant_policies",
      "policy_versions",
      "tickets",
      "assignments",
      "messages",
      "ticket_events",
      "kb_documents",
      "kb_chunks",
      "integrations",
      "ai_runs",
      "tool_calls",
      "approvals",
      "audit_events",
      "qa_reviews",
      "idempotency_keys",
    ];

    expect(sql).toContain(
      "create or replace function support_current_tenant_id",
    );
    expect(sql).toContain("create role support_app nologin");
    expect(sql).toContain("alter table %I enable row level security");
    expect(sql).toContain("tenant_id = support_current_tenant_id()");
    expect(sql).toContain(
      "tenant_id is null or tenant_id = support_current_tenant_id()",
    );

    for (const table of tenantScopedTables) {
      expect(sql).toContain(`'${table}'`);
    }
  });
});
