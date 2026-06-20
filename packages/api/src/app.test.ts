import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApiErrorResponseSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  HealthResponseSchema,
  TenantListResponseSchema,
  TenantResourceResponseSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
} from "@support/shared-schemas";
import { buildApp } from "./app.js";
import type { TenantRequestContext } from "./request-context.js";
import type { ApiServices } from "./services.js";

const now = "2026-06-19T00:00:00.000Z";
const authHeaders = {
  authorization: "Bearer test-token",
  "x-user-id": "usr_test",
  "x-user-email": "agent@example.test",
  "x-user-roles": "support_agent",
  "x-tenant-id": "ten_test",
  "x-request-id": "req_test",
};
const tenantAdminHeaders = {
  ...authHeaders,
  "x-user-roles": "ops_admin",
};
const platformAdminHeaders = {
  authorization: "Bearer test-token",
  "x-user-id": "usr_platform",
  "x-user-email": "platform@example.test",
  "x-user-roles": "platform_admin",
  "x-request-id": "req_test",
};
const clientViewerHeaders = {
  ...authHeaders,
  "x-user-roles": "client_viewer",
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("api health endpoints", () => {
  it("returns health without auth", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).service).toBe("api");
  });

  it("returns readiness without auth", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).status).toBe("ok");
  });
});

describe("api request context and contract errors", () => {
  it("requires auth outside health endpoints", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/customers/cus_test",
      headers: { "x-request-id": "req_missing_auth" },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(401);
    expect(body.error).toMatchObject({
      code: "AUTH_REQUIRED",
      request_id: "req_missing_auth",
    });
  });

  it("requires tenant context for v1 endpoints", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/customers/cus_test",
      headers: {
        authorization: "Bearer test-token",
        "x-user-id": "usr_test",
        "x-request-id": "req_missing_tenant",
      },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error).toMatchObject({
      code: "TENANT_CONTEXT_REQUIRED",
      request_id: "req_missing_tenant",
    });
  });

  it("serves the OpenAPI document behind auth", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/openapi.json",
      headers: {
        authorization: "Bearer test-token",
        "x-user-id": "usr_test",
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths).toHaveProperty("/v1/customers");
    expect(body.paths).toHaveProperty("/v1/customers/{customer_id}");
    expect(body.paths).toHaveProperty("/v1/tickets");
    expect(body.paths).toHaveProperty("/v1/tickets/{ticket_id}");
  });
});

describe("api tenant-scoped resource contracts", () => {
  it("lists tenants for platform admins without tenant context", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants?limit=10",
      headers: platformAdminHeaders,
    });
    const body = TenantListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tenants).toHaveLength(1);
    expect(body.page).toMatchObject({ count: 1, limit: 10 });
  });

  it("creates tenants for platform admins", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: platformAdminHeaders,
      payload: {
        tenant_id: "ten_created",
        name: "Created Tenant",
        default_timezone: "UTC",
      },
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(201);
    expect(body.tenant).toMatchObject({
      tenant_id: "ten_created",
      name: "Created Tenant",
    });
  });

  it("returns the current tenant resource", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants/ten_test",
      headers: tenantAdminHeaders,
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_test");
    expect(body.tenant.tenant_id).toBe("ten_test");
  });

  it("rejects tenant reads for roles without tenant read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants/ten_test",
      headers: authHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects tenant path mismatches before data access", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants/ten_other",
      headers: tenantAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("updates the current tenant for tenant admins", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/tenants/ten_test",
      headers: tenantAdminHeaders,
      payload: { name: "Updated Tenant" },
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tenant.name).toBe("Updated Tenant");
  });

  it("lists customer resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/customers?limit=10",
      headers: authHeaders,
    });
    const body = CustomerListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.customers).toHaveLength(1);
    expect(body.page.limit).toBe(10);
  });

  it("returns customer resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/customers/cus_test",
      headers: authHeaders,
    });
    const body = CustomerResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.customer).toMatchObject({
      customer_id: "cus_test",
      tenant_id: "ten_test",
      email: "customer@example.test",
    });
  });

  it("creates customer resources for write-capable roles", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: authHeaders,
      payload: {
        customer_id: "cus_created",
        email: "created@example.test",
        metadata: { source: "contract-test" },
      },
    });
    const body = CustomerResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(201);
    expect(body.customer).toMatchObject({
      customer_id: "cus_created",
      tenant_id: "ten_test",
      email: "created@example.test",
    });
  });

  it("rejects customer writes for read-only roles", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: clientViewerHeaders,
      payload: { email: "created@example.test" },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("updates customer resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/customers/cus_test",
      headers: authHeaders,
      payload: { display_name: "Updated Customer" },
    });
    const body = CustomerResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.customer.display_name).toBe("Updated Customer");
  });

  it("lists ticket resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets?status=new&limit=10",
      headers: authHeaders,
    });
    const body = TicketListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0]!.status).toBe("new");
  });

  it("returns ticket resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/ticket_test",
      headers: authHeaders,
    });
    const body = TicketResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.ticket).toMatchObject({
      ticket_id: "ticket_test",
      tenant_id: "ten_test",
      customer_id: "cus_test",
      status: "new",
      automation_mode: "human_approve",
    });
  });

  it("creates ticket resources for write-capable roles", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: authHeaders,
      payload: {
        ticket_id: "ticket_created",
        conversation_id: "cnv_test",
        customer_id: "cus_test",
        priority: "p1",
      },
    });
    const body = TicketResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(201);
    expect(body.ticket).toMatchObject({
      ticket_id: "ticket_created",
      tenant_id: "ten_test",
      priority: "p1",
    });
  });

  it("updates ticket triage fields without lifecycle transitions", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/tickets/ticket_test",
      headers: authHeaders,
      payload: { priority: "p1", topic: "shipping" },
    });
    const body = TicketResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.ticket).toMatchObject({
      ticket_id: "ticket_test",
      priority: "p1",
      topic: "shipping",
      status: "new",
    });
  });

  it("rejects empty update bodies", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/tickets/ticket_test",
      headers: authHeaders,
      payload: {},
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns structured not-found errors", async () => {
    app = buildApp({ services: makeServices({ customerMissing: true }) });
    const response = await app.inject({
      method: "GET",
      url: "/v1/customers/missing",
      headers: authHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });
});

function makeServices(
  options: { readonly customerMissing?: boolean } = {},
): ApiServices {
  return {
    tenants: {
      async list(context, options) {
        expect(context.actor.userId).toBe("usr_platform");

        return {
          tenants: [
            {
              tenant_id: "ten_test",
              name: "Test Tenant",
              status: "active",
              default_timezone: "UTC",
              created_at: now,
              updated_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async create(_context, input) {
        return {
          tenant_id: input.tenant_id ?? "ten_created",
          name: input.name,
          status: input.status ?? "active",
          default_timezone: input.default_timezone ?? "UTC",
          created_at: now,
          updated_at: now,
        };
      },
      async getById(context, tenantId) {
        expectTenantContext(context);

        if (tenantId !== "ten_test") {
          return null;
        }

        return {
          tenant_id: "ten_test",
          name: "Test Tenant",
          status: "active",
          default_timezone: "UTC",
          created_at: now,
          updated_at: now,
        };
      },
      async update(context, tenantId, input) {
        expectTenantContext(context as TenantRequestContext);

        if (tenantId !== "ten_test") {
          return null;
        }

        return {
          tenant_id: "ten_test",
          name: input.name ?? "Test Tenant",
          status: input.status ?? "active",
          default_timezone: input.default_timezone ?? "UTC",
          created_at: now,
          updated_at: now,
        };
      },
    },
    customers: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          customers: [
            {
              customer_id: "cus_test",
              tenant_id: context.tenant.tenantId,
              display_name: "Test Customer",
              email: "customer@example.test",
              phone: null,
              external_customer_ref: null,
              metadata: {},
              created_at: now,
              updated_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async create(context, input) {
        expectTenantContext(context);

        return {
          customer_id: input.customer_id ?? "cus_created",
          tenant_id: context.tenant.tenantId,
          display_name: input.display_name ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          external_customer_ref: input.external_customer_ref ?? null,
          metadata: input.metadata ?? {},
          created_at: now,
          updated_at: now,
        };
      },
      async getById(context, customerId) {
        expectTenantContext(context);

        if (options.customerMissing || customerId !== "cus_test") {
          return null;
        }

        return {
          customer_id: "cus_test",
          tenant_id: context.tenant.tenantId,
          display_name: "Test Customer",
          email: "customer@example.test",
          phone: null,
          external_customer_ref: null,
          metadata: {},
          created_at: now,
          updated_at: now,
        };
      },
      async update(context, customerId, input) {
        expectTenantContext(context);

        if (customerId !== "cus_test") {
          return null;
        }

        return {
          customer_id: "cus_test",
          tenant_id: context.tenant.tenantId,
          display_name: input.display_name ?? "Test Customer",
          email: input.email ?? "customer@example.test",
          phone: input.phone ?? null,
          external_customer_ref: input.external_customer_ref ?? null,
          metadata: input.metadata ?? {},
          created_at: now,
          updated_at: now,
        };
      },
    },
    tickets: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          tickets: [
            {
              ticket_id: "ticket_test",
              tenant_id: context.tenant.tenantId,
              conversation_id: "cnv_test",
              customer_id: "cus_test",
              status: options.status ?? "new",
              priority: "p2",
              topic: null,
              subtopic: null,
              language: null,
              sentiment: null,
              urgency_score: null,
              automation_mode: "human_approve",
              assigned_queue: null,
              assigned_user_id: null,
              sla_policy_id: null,
              policy_version_id: null,
              opened_at: now,
              first_response_due_at: null,
              next_response_due_at: null,
              resolution_due_at: null,
              resolved_at: null,
              closed_at: null,
              created_at: now,
              updated_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async create(context, input) {
        expectTenantContext(context);

        return {
          ticket_id: input.ticket_id ?? "ticket_created",
          tenant_id: context.tenant.tenantId,
          conversation_id: input.conversation_id,
          customer_id: input.customer_id,
          status: "new",
          priority: input.priority ?? "p2",
          topic: input.topic ?? null,
          subtopic: input.subtopic ?? null,
          language: input.language ?? null,
          sentiment: input.sentiment ?? null,
          urgency_score: input.urgency_score ?? null,
          automation_mode: input.automation_mode ?? "human_approve",
          assigned_queue: input.assigned_queue ?? null,
          assigned_user_id: input.assigned_user_id ?? null,
          sla_policy_id: input.sla_policy_id ?? null,
          policy_version_id: input.policy_version_id ?? null,
          opened_at: input.opened_at ?? now,
          first_response_due_at: input.first_response_due_at ?? null,
          next_response_due_at: input.next_response_due_at ?? null,
          resolution_due_at: input.resolution_due_at ?? null,
          resolved_at: null,
          closed_at: null,
          created_at: now,
          updated_at: now,
        };
      },
      async getById(context, ticketId) {
        expectTenantContext(context);

        if (ticketId !== "ticket_test") {
          return null;
        }

        return {
          ticket_id: "ticket_test",
          tenant_id: context.tenant.tenantId,
          conversation_id: "cnv_test",
          customer_id: "cus_test",
          status: "new",
          priority: "p2",
          topic: null,
          subtopic: null,
          language: null,
          sentiment: null,
          urgency_score: null,
          automation_mode: "human_approve",
          assigned_queue: null,
          assigned_user_id: null,
          sla_policy_id: null,
          policy_version_id: null,
          opened_at: now,
          first_response_due_at: null,
          next_response_due_at: null,
          resolution_due_at: null,
          resolved_at: null,
          closed_at: null,
          created_at: now,
          updated_at: now,
        };
      },
      async update(context, ticketId, input) {
        expectTenantContext(context);

        if (ticketId !== "ticket_test") {
          return null;
        }

        return {
          ticket_id: "ticket_test",
          tenant_id: context.tenant.tenantId,
          conversation_id: "cnv_test",
          customer_id: "cus_test",
          status: "new",
          priority: input.priority ?? "p2",
          topic: input.topic ?? null,
          subtopic: input.subtopic ?? null,
          language: input.language ?? null,
          sentiment: input.sentiment ?? null,
          urgency_score: input.urgency_score ?? null,
          automation_mode: input.automation_mode ?? "human_approve",
          assigned_queue: input.assigned_queue ?? null,
          assigned_user_id: input.assigned_user_id ?? null,
          sla_policy_id: input.sla_policy_id ?? null,
          policy_version_id: input.policy_version_id ?? null,
          opened_at: now,
          first_response_due_at: input.first_response_due_at ?? null,
          next_response_due_at: input.next_response_due_at ?? null,
          resolution_due_at: input.resolution_due_at ?? null,
          resolved_at: null,
          closed_at: null,
          created_at: now,
          updated_at: now,
        };
      },
    },
  };
}

function expectTenantContext(context: TenantRequestContext): void {
  expect(context.requestId).toBe("req_test");
  expect(context.tenant.tenantId).toBe("ten_test");
  expect(context.actor.userId).toBe("usr_test");
}
