import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDatabase, type PostgresClient } from "./client.js";
import { migrateDatabase } from "./migrations.js";
import {
  activeKbChunksForDocumentQuery,
  approvalByIdQuery,
  approvalsListQuery,
  auditEventByIdQuery,
  auditEventsForEntityQuery,
  auditEventsListQuery,
  conversationByIdQuery,
  conversationsListQuery,
  customerByIdQuery,
  integrationByIdQuery,
  kbDocumentByIdQuery,
  kbDocumentsListQuery,
  messageByIdQuery,
  messagesListQuery,
  policiesListQuery,
  policyByIdQuery,
  searchKbChunksQuery,
  ticketByIdQuery,
  visibleToolDefinitionByNameQuery,
} from "./repositories.js";
import {
  approvals,
  auditEvents,
  channels,
  conversations,
  customers,
  integrations,
  kbChunks,
  kbDocuments,
  messages,
  tenantPolicies,
  tenants,
  tickets,
  toolDefinitions,
} from "./schema.js";

const describeLive =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

const fixturePrefix = `repo_it_${process.pid}_${Date.now()}`;
const ids = {
  tenantA: `${fixturePrefix}_ten_a`,
  tenantB: `${fixturePrefix}_ten_b`,
  customerA: `${fixturePrefix}_cus_a`,
  customerB: `${fixturePrefix}_cus_b`,
  channelA: `${fixturePrefix}_chn_a`,
  channelB: `${fixturePrefix}_chn_b`,
  conversationA: `${fixturePrefix}_cnv_a`,
  conversationB: `${fixturePrefix}_cnv_b`,
  messageA: `${fixturePrefix}_msg_a`,
  messageB: `${fixturePrefix}_msg_b`,
  policyA: `${fixturePrefix}_pol_a`,
  policyB: `${fixturePrefix}_pol_b`,
  ticketA: `${fixturePrefix}_tic_a`,
  ticketB: `${fixturePrefix}_tic_b`,
  approvalA: `${fixturePrefix}_apr_a`,
  approvalB: `${fixturePrefix}_apr_b`,
  kbDocumentA: `${fixturePrefix}_kbd_a`,
  kbDocumentB: `${fixturePrefix}_kbd_b`,
  kbDocumentStale: `${fixturePrefix}_kbd_stale`,
  kbChunkA: `${fixturePrefix}_kbc_a`,
  kbChunkAStale: `${fixturePrefix}_kbc_a_stale`,
  kbChunkB: `${fixturePrefix}_kbc_b`,
  kbChunkInStaleDoc: `${fixturePrefix}_kbc_stale_doc`,
  integrationA: `${fixturePrefix}_int_a`,
  integrationB: `${fixturePrefix}_int_b`,
  toolGlobal: `${fixturePrefix}_tool_global`,
  toolTenantA: `${fixturePrefix}_tool_a`,
  toolTenantB: `${fixturePrefix}_tool_b`,
  auditA: `${fixturePrefix}_aud_a`,
  auditB: `${fixturePrefix}_aud_b`,
  sharedAuditEntity: `${fixturePrefix}_shared_entity`,
};

const EMBEDDING_DIMENSIONS = 1536;

/**
 * A unit vector with a single non-zero component. Cosine distance between two
 * one-hot vectors sharing the same index is 0 (identical direction), which makes
 * the retrieval fixtures' ranking and filtering deterministic without depending
 * on the production embedder.
 */
function oneHot(index: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[index] = 1;
  return vector;
}

describeLive("live tenant-scoped repository queries", () => {
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

  it("executes customer reads without returning another tenant customer", async () => {
    const ownRows = await customerByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.customerA,
    );
    const otherTenantRows = await customerByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.customerB,
    );

    expect(ownRows.map((row) => row.customerId)).toEqual([ids.customerA]);
    expect(otherTenantRows).toEqual([]);
  });

  it("executes ticket reads without returning another tenant ticket", async () => {
    const ownRows = await ticketByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.ticketA,
    );
    const otherTenantRows = await ticketByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.ticketB,
    );

    expect(ownRows.map((row) => row.ticketId)).toEqual([ids.ticketA]);
    expect(otherTenantRows).toEqual([]);
  });

  it("executes conversation reads and lists without returning another tenant conversation", async () => {
    const ownReadRows = await conversationByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.conversationA,
    );
    const otherTenantReadRows = await conversationByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.conversationB,
    );
    const listRows = await conversationsListQuery(
      db,
      { tenantId: ids.tenantA },
      { limit: 10, status: "open" },
    );

    expect(ownReadRows.map((row) => row.conversationId)).toEqual([
      ids.conversationA,
    ]);
    expect(otherTenantReadRows).toEqual([]);
    expect(listRows.map((row) => row.conversationId)).toContain(
      ids.conversationA,
    );
    expect(listRows.map((row) => row.conversationId)).not.toContain(
      ids.conversationB,
    );
  });

  it("executes message reads and lists without returning another tenant message", async () => {
    const ownReadRows = await messageByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.conversationA,
      ids.messageA,
    );
    const otherTenantReadRows = await messageByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.conversationB,
      ids.messageB,
    );
    const listRows = await messagesListQuery(
      db,
      { tenantId: ids.tenantA },
      ids.conversationA,
      { limit: 10, direction: "inbound" },
    );

    expect(ownReadRows.map((row) => row.messageId)).toEqual([ids.messageA]);
    expect(otherTenantReadRows).toEqual([]);
    expect(listRows.map((row) => row.messageId)).toContain(ids.messageA);
    expect(listRows.map((row) => row.messageId)).not.toContain(ids.messageB);
  });

  it("executes policy reads and lists without returning another tenant policy", async () => {
    const ownReadRows = await policyByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.policyA,
    );
    const otherTenantReadRows = await policyByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.policyB,
    );
    const listRows = await policiesListQuery(
      db,
      { tenantId: ids.tenantA },
      { limit: 10, domain: "shipping", status: "active" },
    );

    expect(ownReadRows.map((row) => row.policyId)).toEqual([ids.policyA]);
    expect(otherTenantReadRows).toEqual([]);
    expect(listRows.map((row) => row.policyId)).toContain(ids.policyA);
    expect(listRows.map((row) => row.policyId)).not.toContain(ids.policyB);
  });

  it("executes KB chunk reads with tenant and active-status filters", async () => {
    const ownRows = await activeKbChunksForDocumentQuery(
      db,
      { tenantId: ids.tenantA },
      ids.kbDocumentA,
    );
    const otherTenantRows = await activeKbChunksForDocumentQuery(
      db,
      { tenantId: ids.tenantA },
      ids.kbDocumentB,
    );

    expect(ownRows.map((row) => row.kbChunkId)).toEqual([ids.kbChunkA]);
    expect(otherTenantRows).toEqual([]);
  });

  it("runs tenant-scoped vector retrieval that excludes stale chunks, stale documents, and other tenants", async () => {
    const hits = await searchKbChunksQuery(
      db,
      { tenantId: ids.tenantA },
      { embedding: oneHot(5), limit: 10 },
    );

    // Only the active chunk of the active tenant-A document is returned:
    // the stale chunk (kbChunkAStale), the active chunk of the retired/stale
    // document (kbChunkInStaleDoc), and tenant B's chunk (kbChunkB) are all
    // excluded even though every fixture embedding is identical.
    expect(hits.map((hit) => hit.kbChunkId)).toEqual([ids.kbChunkA]);

    const [hit] = hits;
    // Citation metadata travels with the hit via the document join.
    expect(hit?.kbDocumentId).toBe(ids.kbDocumentA);
    expect(hit?.documentTitle).toBe("Tenant A Shipping Policy");
    expect(hit?.documentType).toBe("policy");
    expect(hit?.sourceType).toBe("manual");
    // Identical direction ⇒ cosine distance 0.
    expect(Number(hit?.distance)).toBeCloseTo(0, 5);
  });

  it("excludes documents whose type does not match the retrieval filter", async () => {
    const hits = await searchKbChunksQuery(
      db,
      { tenantId: ids.tenantA },
      { embedding: oneHot(5), limit: 10, documentType: "faq" },
    );

    // The only matching tenant-A chunk belongs to a `policy` document.
    expect(hits).toEqual([]);
  });

  it("executes KB document reads and lists without returning another tenant document", async () => {
    const ownReadRows = await kbDocumentByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.kbDocumentA,
    );
    const otherTenantReadRows = await kbDocumentByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.kbDocumentB,
    );
    const listRows = await kbDocumentsListQuery(
      db,
      { tenantId: ids.tenantA },
      {
        limit: 10,
        sourceType: "manual",
        documentType: "policy",
        status: "active",
      },
    );

    expect(ownReadRows.map((row) => row.kbDocumentId)).toEqual([
      ids.kbDocumentA,
    ]);
    expect(otherTenantReadRows).toEqual([]);
    expect(listRows.map((row) => row.kbDocumentId)).toContain(ids.kbDocumentA);
    expect(listRows.map((row) => row.kbDocumentId)).not.toContain(
      ids.kbDocumentB,
    );
  });

  it("executes approval reads and lists without returning another tenant approval", async () => {
    const ownReadRows = await approvalByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.approvalA,
    );
    const otherTenantReadRows = await approvalByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.approvalB,
    );
    const listRows = await approvalsListQuery(
      db,
      { tenantId: ids.tenantA },
      {
        limit: 10,
        status: "pending",
        ticketId: ids.ticketA,
        approvalType: "reply",
      },
    );

    expect(ownReadRows.map((row) => row.approvalId)).toEqual([ids.approvalA]);
    expect(otherTenantReadRows).toEqual([]);
    expect(listRows.map((row) => row.approvalId)).toContain(ids.approvalA);
    expect(listRows.map((row) => row.approvalId)).not.toContain(ids.approvalB);
  });

  it("executes integration reads without returning another tenant integration", async () => {
    const ownRows = await integrationByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.integrationA,
    );
    const otherTenantRows = await integrationByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.integrationB,
    );

    expect(ownRows.map((row) => row.integrationId)).toEqual([ids.integrationA]);
    expect(otherTenantRows).toEqual([]);
  });

  it("executes tool-definition reads with global visibility and tenant isolation", async () => {
    const globalRows = await visibleToolDefinitionByNameQuery(
      db,
      { tenantId: ids.tenantA },
      `${fixturePrefix}_global_lookup`,
    );
    const tenantRows = await visibleToolDefinitionByNameQuery(
      db,
      { tenantId: ids.tenantA },
      `${fixturePrefix}_tenant_lookup`,
    );
    const otherTenantRows = await visibleToolDefinitionByNameQuery(
      db,
      { tenantId: ids.tenantA },
      `${fixturePrefix}_other_lookup`,
    );

    expect(globalRows.map((row) => row.toolDefinitionId)).toEqual([
      ids.toolGlobal,
    ]);
    expect(tenantRows.map((row) => row.toolDefinitionId)).toEqual([
      ids.toolTenantA,
    ]);
    expect(otherTenantRows).toEqual([]);
  });

  it("executes audit reads without returning another tenant event for the same entity", async () => {
    const rows = await auditEventsForEntityQuery(
      db,
      { tenantId: ids.tenantA },
      "ticket",
      ids.sharedAuditEntity,
    );

    expect(rows.map((row) => row.auditEventId)).toEqual([ids.auditA]);
    expect(rows.map((row) => row.action)).toEqual(["ticket.updated"]);
  });

  it("executes audit list and ID reads without crossing tenants", async () => {
    const ownReadRows = await auditEventByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.auditA,
    );
    const otherTenantReadRows = await auditEventByIdQuery(
      db,
      { tenantId: ids.tenantA },
      ids.auditB,
    );
    const listRows = await auditEventsListQuery(
      db,
      { tenantId: ids.tenantA },
      {
        limit: 100,
        actorType: "system",
        entityType: "ticket",
        entityId: ids.sharedAuditEntity,
        action: "ticket.updated",
        correlationId: `${fixturePrefix}_correlation`,
      },
    );

    expect(ownReadRows.map((row) => row.auditEventId)).toEqual([ids.auditA]);
    expect(otherTenantReadRows).toEqual([]);
    expect(listRows.map((row) => row.auditEventId)).toEqual([ids.auditA]);
  });
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
      externalCustomerRef: `${fixturePrefix}_external_a`,
    },
    {
      customerId: ids.customerB,
      tenantId: ids.tenantB,
      displayName: "Tenant B Customer",
      email: `${fixturePrefix}.b@example.test`,
      externalCustomerRef: `${fixturePrefix}_external_b`,
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
      externalThreadId: `${fixturePrefix}_thread_a`,
      status: "open",
    },
    {
      conversationId: ids.conversationB,
      tenantId: ids.tenantB,
      customerId: ids.customerB,
      channelId: ids.channelB,
      externalThreadId: `${fixturePrefix}_thread_b`,
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

  await db.insert(messages).values([
    {
      messageId: ids.messageA,
      tenantId: ids.tenantA,
      conversationId: ids.conversationA,
      ticketId: ids.ticketA,
      channelId: ids.channelA,
      direction: "inbound",
      bodyText: "Tenant A repository message.",
      externalMessageId: `${fixturePrefix}_external_msg_a`,
      externalThreadId: `${fixturePrefix}_thread_a`,
      rawPayloadRef: `${fixturePrefix}/raw/a.json`,
      createdByType: "customer",
      idempotencyKey: `${fixturePrefix}_idem_msg_a`,
    },
    {
      messageId: ids.messageB,
      tenantId: ids.tenantB,
      conversationId: ids.conversationB,
      ticketId: ids.ticketB,
      channelId: ids.channelB,
      direction: "inbound",
      bodyText: "Tenant B repository message.",
      externalMessageId: `${fixturePrefix}_external_msg_b`,
      externalThreadId: `${fixturePrefix}_thread_b`,
      rawPayloadRef: `${fixturePrefix}/raw/b.json`,
      createdByType: "customer",
      idempotencyKey: `${fixturePrefix}_idem_msg_b`,
    },
  ]);

  await db.insert(approvals).values([
    {
      approvalId: ids.approvalA,
      tenantId: ids.tenantA,
      ticketId: ids.ticketA,
      approvalType: "reply",
      status: "pending",
      requestedPayload: {
        draft: "Tenant A approval draft.",
        risk_reasons: ["v1_default_human_approval"],
      },
    },
    {
      approvalId: ids.approvalB,
      tenantId: ids.tenantB,
      ticketId: ids.ticketB,
      approvalType: "reply",
      status: "pending",
      requestedPayload: {
        draft: "Tenant B approval draft.",
        risk_reasons: ["v1_default_human_approval"],
      },
    },
  ]);

  await db.insert(tenantPolicies).values([
    {
      policyId: ids.policyA,
      tenantId: ids.tenantA,
      name: "Tenant A Shipping Policy",
      domain: "shipping",
      status: "active",
    },
    {
      policyId: ids.policyB,
      tenantId: ids.tenantB,
      name: "Tenant B Shipping Policy",
      domain: "shipping",
      status: "active",
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
    {
      // An active-chunk document that has been retired to `stale`: its chunks
      // must be excluded from retrieval even though they are still `active`.
      kbDocumentId: ids.kbDocumentStale,
      tenantId: ids.tenantA,
      title: "Tenant A Retired Policy",
      sourceType: "manual",
      documentType: "policy",
      status: "stale",
      contentHash: `${fixturePrefix}_hash_stale`,
    },
  ]);

  await db.insert(kbChunks).values([
    {
      kbChunkId: ids.kbChunkA,
      tenantId: ids.tenantA,
      kbDocumentId: ids.kbDocumentA,
      chunkIndex: 0,
      content: "Tenant A ships refunds after carrier scan.",
      embedding: oneHot(5),
      status: "active",
    },
    {
      kbChunkId: ids.kbChunkAStale,
      tenantId: ids.tenantA,
      kbDocumentId: ids.kbDocumentA,
      chunkIndex: 1,
      content: "Tenant A stale policy chunk.",
      embedding: oneHot(5),
      status: "stale",
    },
    {
      kbChunkId: ids.kbChunkB,
      tenantId: ids.tenantB,
      kbDocumentId: ids.kbDocumentB,
      chunkIndex: 0,
      content: "Tenant B ships replacements only.",
      embedding: oneHot(5),
      status: "active",
    },
    {
      kbChunkId: ids.kbChunkInStaleDoc,
      tenantId: ids.tenantA,
      kbDocumentId: ids.kbDocumentStale,
      chunkIndex: 0,
      content: "Tenant A retired policy chunk.",
      embedding: oneHot(5),
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
      entityId: ids.sharedAuditEntity,
      action: "ticket.updated",
      correlationId: `${fixturePrefix}_correlation`,
    },
    {
      auditEventId: ids.auditB,
      tenantId: ids.tenantB,
      actorType: "system",
      entityType: "ticket",
      entityId: ids.sharedAuditEntity,
      action: "ticket.closed",
      correlationId: `${fixturePrefix}_correlation`,
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
    delete from tenant_policies
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from approvals
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from messages
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
