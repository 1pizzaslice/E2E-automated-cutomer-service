import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDatabase, type PostgresClient } from "./client.js";
import {
  activeKbChunksForDocumentQuery,
  auditEventsForEntityQuery,
  customerByIdQuery,
  integrationByIdQuery,
  ticketByIdQuery,
  visibleToolDefinitionByNameQuery,
} from "./repositories.js";

const clients: PostgresClient[] = [];

function makeDb() {
  const client = postgres(
    "postgres://support:support@localhost:65535/support",
    {
      max: 1,
      connect_timeout: 1,
    },
  );
  clients.push(client);
  return createDatabase(client);
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end()));
});

describe("tenant-scoped repository queries", () => {
  it("scopes customer reads by tenant", () => {
    const query = customerByIdQuery(makeDb(), { tenantId: "ten_a" }, "cus_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customers"."customer_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "cus_a", 1]);
  });

  it("scopes ticket reads by tenant", () => {
    const query = ticketByIdQuery(makeDb(), { tenantId: "ten_a" }, "tic_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tickets"."ticket_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "tic_a", 1]);
  });

  it("scopes active KB chunk retrieval by tenant and document", () => {
    const query = activeKbChunksForDocumentQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "kbd_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"kb_chunks"."tenant_id" = $1');
    expect(compiled.sql).toContain('"kb_chunks"."kb_document_id" = $2');
    expect(compiled.sql).toContain('"kb_chunks"."status" = $3');
    expect(compiled.params).toEqual(["ten_a", "kbd_a", "active"]);
  });

  it("scopes audit reads by tenant and entity", () => {
    const query = auditEventsForEntityQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "ticket",
      "tic_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"audit_events"."tenant_id" = $1');
    expect(compiled.sql).toContain('"audit_events"."entity_type" = $2');
    expect(compiled.sql).toContain('"audit_events"."entity_id" = $3');
    expect(compiled.params).toEqual(["ten_a", "ticket", "tic_a"]);
  });

  it("scopes integration reads by tenant", () => {
    const query = integrationByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "int_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"integrations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"integrations"."integration_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "int_a", 1]);
  });

  it("allows active global tool definitions but excludes other tenants", () => {
    const query = visibleToolDefinitionByNameQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "order_lookup",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tool_definitions"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tool_definitions"."tenant_id" is null');
    expect(compiled.sql).toContain('"tool_definitions"."name" = $2');
    expect(compiled.sql).toContain('"tool_definitions"."status" = $3');
    expect(compiled.params).toEqual(["ten_a", "order_lookup", "active", 1]);
  });
});
