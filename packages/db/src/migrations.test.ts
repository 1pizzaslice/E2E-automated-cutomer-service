import { describe, expect, it } from "vitest";
import {
  loadSqlMigrations,
  migrationIdFromFilename,
  MIGRATIONS_TABLE,
} from "./migrations.js";

describe("sql migrations", () => {
  it("parses migration ids from filenames", () => {
    expect(migrationIdFromFilename("0001_initial_core.sql")).toBe(
      "0001_initial_core",
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
  });
});
