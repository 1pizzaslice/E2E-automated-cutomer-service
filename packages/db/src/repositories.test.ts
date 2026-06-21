import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDatabase, type PostgresClient } from "./client.js";
import {
  activeKbChunksForDocumentQuery,
  auditEventsForEntityQuery,
  conversationsListQuery,
  conversationByIdQuery,
  customersListQuery,
  customerByIdQuery,
  integrationByIdQuery,
  messageByIdQuery,
  messagesListQuery,
  policiesListQuery,
  policyByIdQuery,
  tenantsListQuery,
  tenantByIdQuery,
  ticketsListQuery,
  ticketByIdQuery,
  updateCustomerByIdQuery,
  updateTicketByIdQuery,
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
  it("builds tenant list reads with a bounded limit", () => {
    const query = tenantsListQuery(makeDb(), { limit: 25 });
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('from "tenants"');
    expect(compiled.sql).toContain("limit $1");
    expect(compiled.params).toEqual([25]);
  });

  it("scopes tenant reads by the current tenant", () => {
    const query = tenantByIdQuery(makeDb(), { tenantId: "ten_a" }, "ten_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tenants"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tenants"."tenant_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "ten_a", 1]);
  });

  it("scopes customer reads by tenant", () => {
    const query = customerByIdQuery(makeDb(), { tenantId: "ten_a" }, "cus_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customers"."customer_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "cus_a", 1]);
  });

  it("scopes customer list reads by tenant and filters", () => {
    const query = customersListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        email: "customer@example.test",
        externalCustomerRef: "external-a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $1');
    expect(compiled.sql).toContain('"customers"."email" = $2');
    expect(compiled.sql).toContain('"customers"."external_customer_ref" = $3');
    expect(compiled.params).toEqual([
      "ten_a",
      "customer@example.test",
      "external-a",
      10,
    ]);
  });

  it("scopes customer updates by tenant and id", () => {
    const query = updateCustomerByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "cus_a",
      { displayName: "Updated Customer" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"customers"."tenant_id" = $2');
    expect(compiled.sql).toContain('"customers"."customer_id" = $3');
    expect(compiled.params).toEqual(["Updated Customer", "ten_a", "cus_a"]);
  });

  it("scopes conversation list reads by tenant and filters", () => {
    const query = conversationsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        status: "open",
        customerId: "cus_a",
        channelId: "chn_a",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"conversations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"conversations"."status" = $2');
    expect(compiled.sql).toContain('"conversations"."customer_id" = $3');
    expect(compiled.sql).toContain('"conversations"."channel_id" = $4');
    expect(compiled.params).toEqual(["ten_a", "open", "cus_a", "chn_a", 10]);
  });

  it("scopes conversation reads by tenant", () => {
    const query = conversationByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "cnv_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"conversations"."tenant_id" = $1');
    expect(compiled.sql).toContain('"conversations"."conversation_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "cnv_a", 1]);
  });

  it("scopes message list reads by tenant, conversation, and filters", () => {
    const query = messagesListQuery(makeDb(), { tenantId: "ten_a" }, "cnv_a", {
      limit: 10,
      direction: "inbound",
      ticketId: "tic_a",
    });
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."tenant_id" = $1');
    expect(compiled.sql).toContain('"messages"."conversation_id" = $2');
    expect(compiled.sql).toContain('"messages"."direction" = $3');
    expect(compiled.sql).toContain('"messages"."ticket_id" = $4');
    expect(compiled.params).toEqual(["ten_a", "cnv_a", "inbound", "tic_a", 10]);
  });

  it("scopes message reads by tenant and conversation", () => {
    const query = messageByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "cnv_a",
      "msg_a",
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"messages"."tenant_id" = $1');
    expect(compiled.sql).toContain('"messages"."conversation_id" = $2');
    expect(compiled.sql).toContain('"messages"."message_id" = $3');
    expect(compiled.params).toEqual(["ten_a", "cnv_a", "msg_a", 1]);
  });

  it("scopes ticket reads by tenant", () => {
    const query = ticketByIdQuery(makeDb(), { tenantId: "ten_a" }, "tic_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tickets"."ticket_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "tic_a", 1]);
  });

  it("scopes ticket list reads by tenant and filters", () => {
    const query = ticketsListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        status: "new",
        customerId: "cus_a",
        assignedQueue: "tier-1",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tickets"."status" = $2');
    expect(compiled.sql).toContain('"tickets"."customer_id" = $3');
    expect(compiled.sql).toContain('"tickets"."assigned_queue" = $4');
    expect(compiled.params).toEqual(["ten_a", "new", "cus_a", "tier-1", 10]);
  });

  it("scopes ticket updates by tenant and id", () => {
    const query = updateTicketByIdQuery(
      makeDb(),
      { tenantId: "ten_a" },
      "tic_a",
      { priority: "p1" },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tickets"."tenant_id" = $2');
    expect(compiled.sql).toContain('"tickets"."ticket_id" = $3');
    expect(compiled.params).toEqual(["p1", "ten_a", "tic_a"]);
  });

  it("scopes policy reads by tenant", () => {
    const query = policyByIdQuery(makeDb(), { tenantId: "ten_a" }, "pol_a");
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tenant_policies"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tenant_policies"."policy_id" = $2');
    expect(compiled.params).toEqual(["ten_a", "pol_a", 1]);
  });

  it("scopes policy list reads by tenant and filters", () => {
    const query = policiesListQuery(
      makeDb(),
      { tenantId: "ten_a" },
      {
        limit: 10,
        domain: "shipping",
        status: "active",
      },
    );
    const compiled = query.toSQL();

    expect(compiled.sql).toContain('"tenant_policies"."tenant_id" = $1');
    expect(compiled.sql).toContain('"tenant_policies"."domain" = $2');
    expect(compiled.sql).toContain('"tenant_policies"."status" = $3');
    expect(compiled.params).toEqual(["ten_a", "shipping", "active", 10]);
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
