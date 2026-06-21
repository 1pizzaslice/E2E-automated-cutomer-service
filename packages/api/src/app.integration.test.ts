import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApiErrorResponseSchema,
  ConversationListResponseSchema,
  ConversationResourceResponseSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  TenantListResponseSchema,
  TenantResourceResponseSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  type RoleName,
} from "@support/shared-schemas";
import {
  channels,
  conversations,
  createDatabase,
  createPostgresClient,
  customers,
  messages,
  migrateDatabase,
  tenantPolicies,
  tenants,
  tickets,
  type PostgresClient,
} from "@support/db";
import { buildApp } from "./app.js";

const describeLive =
  process.env.RUN_API_INTEGRATION_TESTS === "true" ? describe : describe.skip;

const fixturePrefix = `api_it_${process.pid}_${Date.now()}`;
const ids = {
  tenantA: `${fixturePrefix}_ten_a`,
  tenantB: `${fixturePrefix}_ten_b`,
  tenantCreated: `${fixturePrefix}_ten_created`,
  customerA: `${fixturePrefix}_cus_a`,
  customerB: `${fixturePrefix}_cus_b`,
  customerCreated: `${fixturePrefix}_cus_created`,
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
  ticketCreated: `${fixturePrefix}_tic_created`,
};

describeLive("live PostgreSQL-backed API resource reads", () => {
  let app: FastifyInstance | undefined;
  let client: PostgresClient | undefined;
  let db: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required when RUN_API_INTEGRATION_TESTS=true",
      );
    }

    client = createPostgresClient(undefined, { max: 1 });
    db = createDatabase(client);

    await migrateDatabase(client);
    await seedFixtures(db);

    app = buildApp();
  });

  afterAll(async () => {
    try {
      await app?.close();

      if (client) {
        await cleanupFixtures(client);
      }
    } finally {
      await client?.end();
    }
  });

  it("reads the current tenant through PostgreSQL", async () => {
    const response = await app!.inject({
      method: "GET",
      url: `/v1/tenants/${ids.tenantA}`,
      headers: authHeaders("ops_admin"),
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tenant).toMatchObject({
      tenant_id: ids.tenantA,
      name: `${fixturePrefix} Tenant A`,
      status: "active",
    });
  });

  it("lists tenants and creates tenant records for platform admins", async () => {
    const listResponse = await app!.inject({
      method: "GET",
      url: "/v1/tenants?limit=100",
      headers: platformAuthHeaders(),
    });
    const createResponse = await app!.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: platformAuthHeaders(),
      payload: {
        tenant_id: ids.tenantCreated,
        name: `${fixturePrefix} Created Tenant`,
        default_timezone: "UTC",
      },
    });
    const patchResponse = await app!.inject({
      method: "PATCH",
      url: `/v1/tenants/${ids.tenantCreated}`,
      headers: platformAuthHeaders(),
      payload: {
        status: "suspended",
      },
    });
    const listBody = TenantListResponseSchema.parse(listResponse.json());
    const createBody = TenantResourceResponseSchema.parse(
      createResponse.json(),
    );
    const patchBody = TenantResourceResponseSchema.parse(patchResponse.json());

    expect(listResponse.statusCode).toBe(200);
    expect(listBody.tenants.map((tenant) => tenant.tenant_id)).toContain(
      ids.tenantA,
    );
    expect(createResponse.statusCode).toBe(201);
    expect(createBody.tenant.tenant_id).toBe(ids.tenantCreated);
    expect(patchResponse.statusCode).toBe(200);
    expect(patchBody.tenant).toMatchObject({
      tenant_id: ids.tenantCreated,
      status: "suspended",
    });
  });

  it("rejects tenant reads for roles without tenant read permission", async () => {
    const response = await app!.inject({
      method: "GET",
      url: `/v1/tenants/${ids.tenantA}`,
      headers: authHeaders("support_agent"),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lists tenant-scoped customers without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/customers?limit=100",
      headers: authHeaders("support_agent"),
    });
    const body = CustomerListResponseSchema.parse(response.json());
    const customerIds = body.customers.map((customer) => customer.customer_id);

    expect(response.statusCode).toBe(200);
    expect(customerIds).toContain(ids.customerA);
    expect(customerIds).not.toContain(ids.customerB);
  });

  it("reads tenant-scoped customers without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/customers/${ids.customerA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/customers/${ids.customerB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = CustomerResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.customer).toMatchObject({
      customer_id: ids.customerA,
      tenant_id: ids.tenantA,
      email: `${fixturePrefix}.a@example.test`,
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("creates and updates tenant-scoped customers through PostgreSQL", async () => {
    const createResponse = await app!.inject({
      method: "POST",
      url: "/v1/customers",
      headers: authHeaders("support_agent"),
      payload: {
        customer_id: ids.customerCreated,
        display_name: "Created API Customer",
        email: `${fixturePrefix}.created@example.test`,
        metadata: { source: "api-integration" },
      },
    });
    const patchResponse = await app!.inject({
      method: "PATCH",
      url: `/v1/customers/${ids.customerCreated}`,
      headers: authHeaders("support_agent"),
      payload: {
        display_name: "Updated API Customer",
      },
    });
    const createBody = CustomerResourceResponseSchema.parse(
      createResponse.json(),
    );
    const patchBody = CustomerResourceResponseSchema.parse(
      patchResponse.json(),
    );

    expect(createResponse.statusCode).toBe(201);
    expect(createBody.customer).toMatchObject({
      customer_id: ids.customerCreated,
      tenant_id: ids.tenantA,
      email: `${fixturePrefix}.created@example.test`,
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchBody.customer.display_name).toBe("Updated API Customer");
  });

  it("lists tenant-scoped conversations without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/conversations?limit=100",
      headers: authHeaders("support_agent"),
    });
    const body = ConversationListResponseSchema.parse(response.json());
    const conversationIds = body.conversations.map(
      (conversation) => conversation.conversation_id,
    );

    expect(response.statusCode).toBe(200);
    expect(conversationIds).toContain(ids.conversationA);
    expect(conversationIds).not.toContain(ids.conversationB);
  });

  it("reads tenant-scoped conversations without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/conversations/${ids.conversationA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/conversations/${ids.conversationB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = ConversationResourceResponseSchema.parse(
      ownResponse.json(),
    );
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.conversation).toMatchObject({
      conversation_id: ids.conversationA,
      tenant_id: ids.tenantA,
      customer_id: ids.customerA,
      status: "open",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists tenant-scoped messages without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/conversations/${ids.conversationA}/messages?limit=100`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/conversations/${ids.conversationB}/messages?limit=100`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = MessageListResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );
    const messageIds = ownBody.messages.map((message) => message.message_id);

    expect(ownResponse.statusCode).toBe(200);
    expect(messageIds).toContain(ids.messageA);
    expect(messageIds).not.toContain(ids.messageB);
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("reads tenant-scoped messages without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/conversations/${ids.conversationA}/messages/${ids.messageA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/conversations/${ids.conversationB}/messages/${ids.messageB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = MessageResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.message).toMatchObject({
      message_id: ids.messageA,
      tenant_id: ids.tenantA,
      conversation_id: ids.conversationA,
      direction: "inbound",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists tenant-scoped policies without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/policies?domain=shipping&status=active&limit=100",
      headers: authHeaders("support_agent"),
    });
    const body = PolicyListResponseSchema.parse(response.json());
    const policyIds = body.policies.map((policy) => policy.policy_id);

    expect(response.statusCode).toBe(200);
    expect(policyIds).toContain(ids.policyA);
    expect(policyIds).not.toContain(ids.policyB);
  });

  it("reads tenant-scoped policies without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/policies/${ids.policyA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/policies/${ids.policyB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = PolicyResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.policy).toMatchObject({
      policy_id: ids.policyA,
      tenant_id: ids.tenantA,
      domain: "shipping",
      status: "active",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists tenant-scoped tickets without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/tickets?limit=100",
      headers: authHeaders("support_agent"),
    });
    const body = TicketListResponseSchema.parse(response.json());
    const ticketIds = body.tickets.map((ticket) => ticket.ticket_id);

    expect(response.statusCode).toBe(200);
    expect(ticketIds).toContain(ids.ticketA);
    expect(ticketIds).not.toContain(ids.ticketB);
  });

  it("reads tenant-scoped tickets without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/tickets/${ids.ticketA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/tickets/${ids.ticketB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = TicketResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.ticket).toMatchObject({
      ticket_id: ids.ticketA,
      tenant_id: ids.tenantA,
      customer_id: ids.customerA,
      status: "new",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("creates and updates tenant-scoped tickets through PostgreSQL", async () => {
    const createResponse = await app!.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: authHeaders("support_agent"),
      payload: {
        ticket_id: ids.ticketCreated,
        conversation_id: ids.conversationA,
        customer_id: ids.customerA,
        priority: "p1",
        topic: "shipping",
        opened_at: "2026-06-19T01:00:00.000Z",
      },
    });
    const patchResponse = await app!.inject({
      method: "PATCH",
      url: `/v1/tickets/${ids.ticketCreated}`,
      headers: authHeaders("support_agent"),
      payload: {
        assigned_queue: "tier-1",
      },
    });
    const createBody = TicketResourceResponseSchema.parse(
      createResponse.json(),
    );
    const patchBody = TicketResourceResponseSchema.parse(patchResponse.json());

    expect(createResponse.statusCode).toBe(201);
    expect(createBody.ticket).toMatchObject({
      ticket_id: ids.ticketCreated,
      tenant_id: ids.tenantA,
      conversation_id: ids.conversationA,
      customer_id: ids.customerA,
      priority: "p1",
      status: "new",
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchBody.ticket).toMatchObject({
      ticket_id: ids.ticketCreated,
      assigned_queue: "tier-1",
      status: "new",
    });
  });
});

function authHeaders(role: RoleName) {
  return {
    authorization: "Bearer api-integration-test-token",
    "x-user-id": `${fixturePrefix}_usr`,
    "x-user-email": `${fixturePrefix}@example.test`,
    "x-user-roles": role,
    "x-tenant-id": ids.tenantA,
    "x-request-id": `${fixturePrefix}_req`,
  };
}

function platformAuthHeaders() {
  return {
    authorization: "Bearer api-integration-test-token",
    "x-user-id": `${fixturePrefix}_platform_usr`,
    "x-user-email": `${fixturePrefix}.platform@example.test`,
    "x-user-roles": "platform_admin",
    "x-request-id": `${fixturePrefix}_platform_req`,
  };
}

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
      displayName: "Tenant A API Customer",
      email: `${fixturePrefix}.a@example.test`,
    },
    {
      customerId: ids.customerB,
      tenantId: ids.tenantB,
      displayName: "Tenant B API Customer",
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
      bodyText: "Where is my order?",
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
      bodyText: "Tenant B message",
      externalMessageId: `${fixturePrefix}_external_msg_b`,
      externalThreadId: `${fixturePrefix}_thread_b`,
      rawPayloadRef: `${fixturePrefix}/raw/b.json`,
      createdByType: "customer",
      idempotencyKey: `${fixturePrefix}_idem_msg_b`,
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
}

async function cleanupFixtures(client: PostgresClient) {
  await client`
    delete from tenant_policies
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
    where tenant_id in (${ids.tenantA}, ${ids.tenantB}, ${ids.tenantCreated})
  `;
}
