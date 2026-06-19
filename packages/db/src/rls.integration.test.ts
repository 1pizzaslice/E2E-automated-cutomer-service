import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDatabase, type PostgresClient } from "./client.js";
import { migrateDatabase } from "./migrations.js";
import { APPLICATION_DATABASE_ROLE, setLocalTenantContext } from "./rls.js";
import {
  auditEvents,
  channels,
  conversations,
  customers,
  integrations,
  kbChunks,
  kbDocuments,
  tenants,
  tickets,
  toolDefinitions,
} from "./schema.js";

const describeLive =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

const fixturePrefix = `rls_it_${process.pid}_${Date.now()}`;
const ids = {
  tenantA: `${fixturePrefix}_ten_a`,
  tenantB: `${fixturePrefix}_ten_b`,
  customerA: `${fixturePrefix}_cus_a`,
  customerB: `${fixturePrefix}_cus_b`,
  blockedCustomer: `${fixturePrefix}_cus_blocked`,
  channelA: `${fixturePrefix}_chn_a`,
  channelB: `${fixturePrefix}_chn_b`,
  conversationA: `${fixturePrefix}_cnv_a`,
  conversationB: `${fixturePrefix}_cnv_b`,
  ticketA: `${fixturePrefix}_tic_a`,
  ticketB: `${fixturePrefix}_tic_b`,
  kbDocumentA: `${fixturePrefix}_kbd_a`,
  kbDocumentB: `${fixturePrefix}_kbd_b`,
  kbChunkA: `${fixturePrefix}_kbc_a`,
  kbChunkB: `${fixturePrefix}_kbc_b`,
  integrationA: `${fixturePrefix}_int_a`,
  integrationB: `${fixturePrefix}_int_b`,
  toolGlobal: `${fixturePrefix}_tool_global`,
  toolTenantA: `${fixturePrefix}_tool_a`,
  toolTenantB: `${fixturePrefix}_tool_b`,
  auditA: `${fixturePrefix}_aud_a`,
  auditB: `${fixturePrefix}_aud_b`,
};

describeLive("PostgreSQL row-level security", () => {
  let client: PostgresClient | undefined;
  let db: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=true",
      );
    }

    client = postgres(databaseUrl, { max: 1 });
    db = createDatabase(client);

    await migrateDatabase(client);
    await seedFixtures(db);
  });

  afterAll(async () => {
    if (!client) {
      return;
    }

    try {
      await cleanupFixtures(client);
    } finally {
      await client.end();
    }
  });

  it("rejects raw tenant-scoped reads when tenant context is missing", async () => {
    await expect(
      withApplicationRole(async (transaction) => {
        await transaction<{ customer_id: string }[]>`
          select customer_id
          from customers
          where customer_id = ${ids.customerA}
        `;
      }),
    ).rejects.toThrow(/app\.current_tenant_id/);
  });

  it("filters raw reads to the current tenant across core scoped tables", async () => {
    const rows = await withTenantContext(ids.tenantA, async (transaction) => ({
      tenants: await transaction<{ tenant_id: string }[]>`
        select tenant_id
        from tenants
        where tenant_id in (${ids.tenantA}, ${ids.tenantB})
        order by tenant_id
      `,
      customers: await transaction<{ customer_id: string }[]>`
        select customer_id
        from customers
        where customer_id in (${ids.customerA}, ${ids.customerB})
        order by customer_id
      `,
      tickets: await transaction<{ ticket_id: string }[]>`
        select ticket_id
        from tickets
        where ticket_id in (${ids.ticketA}, ${ids.ticketB})
        order by ticket_id
      `,
      kbChunks: await transaction<{ kb_chunk_id: string }[]>`
        select kb_chunk_id
        from kb_chunks
        where kb_chunk_id in (${ids.kbChunkA}, ${ids.kbChunkB})
        order by kb_chunk_id
      `,
      integrations: await transaction<{ integration_id: string }[]>`
        select integration_id
        from integrations
        where integration_id in (${ids.integrationA}, ${ids.integrationB})
        order by integration_id
      `,
      auditEvents: await transaction<{ audit_event_id: string }[]>`
        select audit_event_id
        from audit_events
        where audit_event_id in (${ids.auditA}, ${ids.auditB})
        order by audit_event_id
      `,
    }));

    expect(rows.tenants.map((row) => row.tenant_id)).toEqual([ids.tenantA]);
    expect(rows.customers.map((row) => row.customer_id)).toEqual([
      ids.customerA,
    ]);
    expect(rows.tickets.map((row) => row.ticket_id)).toEqual([ids.ticketA]);
    expect(rows.kbChunks.map((row) => row.kb_chunk_id)).toEqual([ids.kbChunkA]);
    expect(rows.integrations.map((row) => row.integration_id)).toEqual([
      ids.integrationA,
    ]);
    expect(rows.auditEvents.map((row) => row.audit_event_id)).toEqual([
      ids.auditA,
    ]);
  });

  it("keeps global tool definitions visible while hiding other tenants", async () => {
    const rows = await withTenantContext(
      ids.tenantA,
      async (transaction) =>
        await transaction<{ tool_definition_id: string }[]>`
        select tool_definition_id
        from tool_definitions
        where tool_definition_id in (${ids.toolGlobal}, ${ids.toolTenantA}, ${ids.toolTenantB})
      `,
    );

    expect(rows.map((row) => row.tool_definition_id).sort()).toEqual(
      [ids.toolGlobal, ids.toolTenantA].sort(),
    );
  });

  it("blocks cross-tenant writes under the current tenant context", async () => {
    await expect(
      withTenantContext(ids.tenantA, async (transaction) => {
        await transaction`
          insert into customers (customer_id, tenant_id, display_name)
          values (${ids.blockedCustomer}, ${ids.tenantB}, 'Blocked Cross Tenant Customer')
        `;
      }),
    ).rejects.toThrow(/row-level security/);

    const rows = await client!<{ customer_id: string }[]>`
      select customer_id
      from customers
      where customer_id = ${ids.blockedCustomer}
    `;

    expect(rows).toEqual([]);
  });

  async function withApplicationRole<T>(
    callback: (transaction: PostgresClient) => Promise<T>,
  ): Promise<T> {
    if (!client) {
      throw new Error("PostgreSQL client was not initialized");
    }

    return client.begin(async (transaction) => {
      await transaction.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
      return callback(transaction as unknown as PostgresClient);
    }) as Promise<T>;
  }

  async function withTenantContext<T>(
    tenantId: string,
    callback: (transaction: PostgresClient) => Promise<T>,
  ): Promise<T> {
    return withApplicationRole(async (transaction) => {
      await setLocalTenantContext(transaction, tenantId);
      return callback(transaction);
    });
  }
});

async function seedFixtures(db: ReturnType<typeof createDatabase>) {
  await db.insert(tenants).values([
    {
      tenantId: ids.tenantA,
      name: `${fixturePrefix} Tenant A`,
    },
    {
      tenantId: ids.tenantB,
      name: `${fixturePrefix} Tenant B`,
    },
  ]);

  await db.insert(customers).values([
    {
      customerId: ids.customerA,
      tenantId: ids.tenantA,
      displayName: "Tenant A Customer",
      email: `${fixturePrefix}.a@example.test`,
    },
    {
      customerId: ids.customerB,
      tenantId: ids.tenantB,
      displayName: "Tenant B Customer",
      email: `${fixturePrefix}.b@example.test`,
    },
  ]);

  await db.insert(channels).values([
    {
      channelId: ids.channelA,
      tenantId: ids.tenantA,
      type: "email",
      provider: "fixture-mail",
      status: "active",
    },
    {
      channelId: ids.channelB,
      tenantId: ids.tenantB,
      type: "email",
      provider: "fixture-mail",
      status: "active",
    },
  ]);

  await db.insert(conversations).values([
    {
      conversationId: ids.conversationA,
      tenantId: ids.tenantA,
      customerId: ids.customerA,
      channelId: ids.channelA,
      status: "open",
    },
    {
      conversationId: ids.conversationB,
      tenantId: ids.tenantB,
      customerId: ids.customerB,
      channelId: ids.channelB,
      status: "open",
    },
  ]);

  await db.insert(tickets).values([
    {
      ticketId: ids.ticketA,
      tenantId: ids.tenantA,
      conversationId: ids.conversationA,
      customerId: ids.customerA,
      status: "new",
      priority: "p2",
      openedAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    {
      ticketId: ids.ticketB,
      tenantId: ids.tenantB,
      conversationId: ids.conversationB,
      customerId: ids.customerB,
      status: "new",
      priority: "p2",
      openedAt: new Date("2026-06-19T00:00:00.000Z"),
    },
  ]);

  await db.insert(kbDocuments).values([
    {
      kbDocumentId: ids.kbDocumentA,
      tenantId: ids.tenantA,
      title: "Tenant A Shipping Policy",
      sourceType: "manual",
      documentType: "policy",
      status: "active",
      contentHash: `${fixturePrefix}_hash_a`,
    },
    {
      kbDocumentId: ids.kbDocumentB,
      tenantId: ids.tenantB,
      title: "Tenant B Shipping Policy",
      sourceType: "manual",
      documentType: "policy",
      status: "active",
      contentHash: `${fixturePrefix}_hash_b`,
    },
  ]);

  await db.insert(kbChunks).values([
    {
      kbChunkId: ids.kbChunkA,
      tenantId: ids.tenantA,
      kbDocumentId: ids.kbDocumentA,
      chunkIndex: 0,
      content: "Tenant A ships refunds after carrier scan.",
      status: "active",
    },
    {
      kbChunkId: ids.kbChunkB,
      tenantId: ids.tenantB,
      kbDocumentId: ids.kbDocumentB,
      chunkIndex: 0,
      content: "Tenant B ships replacements only.",
      status: "active",
    },
  ]);

  await db.insert(integrations).values([
    {
      integrationId: ids.integrationA,
      tenantId: ids.tenantA,
      provider: "shopify",
      integrationType: `${fixturePrefix}_orders`,
      status: "active",
      credentialRef: `${fixturePrefix}/tenant-a/shopify`,
    },
    {
      integrationId: ids.integrationB,
      tenantId: ids.tenantB,
      provider: "shopify",
      integrationType: `${fixturePrefix}_orders`,
      status: "active",
      credentialRef: `${fixturePrefix}/tenant-b/shopify`,
    },
  ]);

  await db.insert(toolDefinitions).values([
    {
      toolDefinitionId: ids.toolGlobal,
      tenantId: null,
      name: `${fixturePrefix}_global_lookup`,
      description: "Global read-only order lookup fixture.",
      permission: "orders:read",
      sideEffectClass: "read_only",
      requiresHumanApproval: false,
      timeoutMs: 1000,
    },
    {
      toolDefinitionId: ids.toolTenantA,
      tenantId: ids.tenantA,
      name: `${fixturePrefix}_tenant_lookup`,
      description: "Tenant A read-only order lookup fixture.",
      permission: "orders:read",
      sideEffectClass: "read_only",
      requiresHumanApproval: false,
      timeoutMs: 1000,
    },
    {
      toolDefinitionId: ids.toolTenantB,
      tenantId: ids.tenantB,
      name: `${fixturePrefix}_other_lookup`,
      description: "Tenant B read-only order lookup fixture.",
      permission: "orders:read",
      sideEffectClass: "read_only",
      requiresHumanApproval: false,
      timeoutMs: 1000,
    },
  ]);

  await db.insert(auditEvents).values([
    {
      auditEventId: ids.auditA,
      tenantId: ids.tenantA,
      actorType: "system",
      entityType: "ticket",
      entityId: ids.ticketA,
      action: "ticket.updated",
    },
    {
      auditEventId: ids.auditB,
      tenantId: ids.tenantB,
      actorType: "system",
      entityType: "ticket",
      entityId: ids.ticketB,
      action: "ticket.closed",
    },
  ]);
}

async function cleanupFixtures(client: PostgresClient) {
  await client`
    delete from audit_events
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from tool_definitions
    where tool_definition_id in (${ids.toolGlobal}, ${ids.toolTenantA}, ${ids.toolTenantB})
  `;
  await client`
    delete from integrations
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from kb_chunks
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from kb_documents
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from tickets
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from conversations
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from channels
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from customers
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from tenants
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
}
