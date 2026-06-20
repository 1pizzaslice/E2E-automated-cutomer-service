import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApiErrorResponseSchema,
  CustomerResourceResponseSchema,
  TenantResourceResponseSchema,
  TicketResourceResponseSchema,
  type RoleName,
} from "@support/shared-schemas";
import {
  channels,
  conversations,
  createDatabase,
  createPostgresClient,
  customers,
  migrateDatabase,
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
  customerA: `${fixturePrefix}_cus_a`,
  customerB: `${fixturePrefix}_cus_b`,
  channelA: `${fixturePrefix}_chn_a`,
  channelB: `${fixturePrefix}_chn_b`,
  conversationA: `${fixturePrefix}_cnv_a`,
  conversationB: `${fixturePrefix}_cnv_b`,
  ticketA: `${fixturePrefix}_tic_a`,
  ticketB: `${fixturePrefix}_tic_b`,
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
}

async function cleanupFixtures(client: PostgresClient) {
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
