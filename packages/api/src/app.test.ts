import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApiErrorResponseSchema,
  CustomerResourceResponseSchema,
  HealthResponseSchema,
  TenantResourceResponseSchema,
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
    expect(body.paths).toHaveProperty("/v1/customers/{customer_id}");
    expect(body.paths).toHaveProperty("/v1/tickets/{ticket_id}");
  });
});

describe("api tenant-scoped resource contracts", () => {
  it("returns the current tenant resource", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants/ten_test",
      headers: authHeaders,
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_test");
    expect(body.tenant.tenant_id).toBe("ten_test");
  });

  it("rejects tenant path mismatches before data access", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants/ten_other",
      headers: authHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
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
    },
    customers: {
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
    },
    tickets: {
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
    },
  };
}

function expectTenantContext(context: TenantRequestContext): void {
  expect(context.requestId).toBe("req_test");
  expect(context.tenant.tenantId).toBe("ten_test");
  expect(context.actor.userId).toBe("usr_test");
}
