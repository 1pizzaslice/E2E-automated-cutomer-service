import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApprovalListResponseSchema,
  ApprovalResourceResponseSchema,
  ApiErrorResponseSchema,
  AuditEventListResponseSchema,
  AuditEventResourceResponseSchema,
  ConversationListResponseSchema,
  ConversationResourceResponseSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  HealthResponseSchema,
  KbDocumentListResponseSchema,
  KbDocumentResourceResponseSchema,
  KbIngestionResultSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
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
const integrationAdminHeaders = {
  ...authHeaders,
  "x-user-roles": "integration_admin",
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
    expect(body.paths).toHaveProperty("/v1/conversations");
    expect(body.paths).toHaveProperty("/v1/conversations/{conversation_id}");
    expect(body.paths).toHaveProperty(
      "/v1/conversations/{conversation_id}/messages",
    );
    expect(body.paths).toHaveProperty("/v1/policies");
    expect(body.paths).toHaveProperty("/v1/policies/{policy_id}");
    expect(body.paths).toHaveProperty("/v1/kb/documents");
    expect(body.paths).toHaveProperty("/v1/kb/documents/{kb_document_id}");
    expect(body.paths).toHaveProperty(
      "/v1/kb/documents/{kb_document_id}/ingest",
    );
    expect(body.paths).toHaveProperty("/v1/approvals");
    expect(body.paths).toHaveProperty("/v1/approvals/{approval_id}");
    expect(body.paths).toHaveProperty("/v1/audit-events");
    expect(body.paths).toHaveProperty("/v1/audit-events/{audit_event_id}");
    expect(body.paths).toHaveProperty("/v1/tickets/{ticket_id}/audit-events");
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

  it("lists conversation resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/conversations?status=open&limit=10",
      headers: authHeaders,
    });
    const body = ConversationListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]!.status).toBe("open");
  });

  it("returns conversation resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/conversations/cnv_test",
      headers: authHeaders,
    });
    const body = ConversationResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.conversation).toMatchObject({
      conversation_id: "cnv_test",
      tenant_id: "ten_test",
      customer_id: "cus_test",
      status: "open",
    });
  });

  it("rejects conversation reads for roles without conversation read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/conversations/cnv_test",
      headers: integrationAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lists message resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/conversations/cnv_test/messages?direction=inbound&limit=10",
      headers: authHeaders,
    });
    const body = MessageListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!).toMatchObject({
      message_id: "msg_test",
      direction: "inbound",
      created_by_type: "customer",
    });
  });

  it("returns message resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/conversations/cnv_test/messages/msg_test",
      headers: authHeaders,
    });
    const body = MessageResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.message).toMatchObject({
      message_id: "msg_test",
      conversation_id: "cnv_test",
      tenant_id: "ten_test",
      body_text: "Where is my order?",
    });
  });

  it("lists policy resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/policies?domain=shipping&status=active&limit=10",
      headers: authHeaders,
    });
    const body = PolicyListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0]!).toMatchObject({
      policy_id: "pol_test",
      domain: "shipping",
      status: "active",
    });
  });

  it("returns policy resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/policies/pol_test",
      headers: authHeaders,
    });
    const body = PolicyResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.policy).toMatchObject({
      policy_id: "pol_test",
      tenant_id: "ten_test",
      domain: "shipping",
      status: "active",
    });
  });

  it("rejects policy reads for roles without policy read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/policies/pol_test",
      headers: integrationAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lists KB document resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/kb/documents?source_type=manual&document_type=faq&status=active&limit=10",
      headers: authHeaders,
    });
    const body = KbDocumentListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.kb_documents).toHaveLength(1);
    expect(body.kb_documents[0]!).toMatchObject({
      kb_document_id: "kbd_test",
      source_type: "manual",
      document_type: "faq",
      status: "active",
    });
  });

  it("returns KB document resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/kb/documents/kbd_test",
      headers: authHeaders,
    });
    const body = KbDocumentResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.kb_document).toMatchObject({
      kb_document_id: "kbd_test",
      tenant_id: "ten_test",
      title: "Shipping FAQ",
      status: "active",
    });
  });

  it("rejects KB document reads for roles without KB document read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/kb/documents/kbd_test",
      headers: integrationAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("creates a KB document as a draft through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/documents",
      headers: authHeaders,
      payload: {
        title: "Returns policy",
        source_type: "manual",
        document_type: "policy",
        content: "Returns are accepted within 30 days of delivery.",
      },
    });
    const body = KbDocumentResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(201);
    expect(body.kb_document).toMatchObject({
      title: "Returns policy",
      source_type: "manual",
      document_type: "policy",
      status: "draft",
    });
  });

  it("rejects KB document creation without a body content field", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/documents",
      headers: authHeaders,
      payload: {
        title: "Returns policy",
        source_type: "manual",
        document_type: "policy",
      },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects KB document creation for roles without write permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/documents",
      headers: clientViewerHeaders,
      payload: {
        title: "Returns policy",
        source_type: "manual",
        document_type: "policy",
        content: "Returns are accepted within 30 days of delivery.",
      },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("updates KB document status through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/kb/documents/kbd_test",
      headers: authHeaders,
      payload: { status: "stale" },
    });
    const body = KbDocumentResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.kb_document.status).toBe("stale");
  });

  it("returns 404 when updating a missing KB document", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/kb/documents/kbd_missing",
      headers: authHeaders,
      payload: { status: "stale" },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("ingests a KB document and reports chunk/embedding counts", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/documents/kbd_test/ingest",
      headers: authHeaders,
    });
    const body = KbIngestionResultSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      kb_document_id: "kbd_test",
      status: "active",
      chunk_count: 3,
      embedded_count: 3,
    });
  });

  it("returns 404 when ingesting a missing KB document", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/documents/kbd_missing/ingest",
      headers: authHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists approval resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals?status=pending&approval_type=reply&limit=10",
      headers: authHeaders,
    });
    const body = ApprovalListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]!).toMatchObject({
      approval_id: "apr_test",
      approval_type: "reply",
      status: "pending",
    });
  });

  it("returns approval resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals/apr_test",
      headers: authHeaders,
    });
    const body = ApprovalResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approval).toMatchObject({
      approval_id: "apr_test",
      tenant_id: "ten_test",
      ticket_id: "ticket_test",
      status: "pending",
    });
  });

  it("rejects approval reads for roles without approval read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals/apr_test",
      headers: integrationAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lists audit event resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/audit-events?entity_type=ticket&entity_id=ticket_test&action=ticket.created&limit=10",
      headers: authHeaders,
    });
    const body = AuditEventListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.audit_events).toHaveLength(1);
    expect(body.audit_events[0]!).toMatchObject({
      audit_event_id: "aud_test",
      entity_type: "ticket",
      entity_id: "ticket_test",
      action: "ticket.created",
    });
  });

  it("returns audit event resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/audit-events/aud_test",
      headers: authHeaders,
    });
    const body = AuditEventResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.audit_event).toMatchObject({
      audit_event_id: "aud_test",
      tenant_id: "ten_test",
      actor_type: "system",
      action: "ticket.created",
    });
  });

  it("lists ticket audit events through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/ticket_test/audit-events?action=ticket.created&limit=10",
      headers: authHeaders,
    });
    const body = AuditEventListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.audit_events).toHaveLength(1);
    expect(body.audit_events[0]!).toMatchObject({
      audit_event_id: "aud_test",
      entity_type: "ticket",
      entity_id: "ticket_test",
    });
  });

  it("returns structured not found for missing ticket audit parents", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/missing_ticket/audit-events",
      headers: authHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("rejects audit event reads for roles without audit read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/audit-events/aud_test",
      headers: integrationAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
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
    conversations: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          conversations: [
            {
              conversation_id: "cnv_test",
              tenant_id: context.tenant.tenantId,
              customer_id: "cus_test",
              channel_id: "chn_test",
              external_thread_id: "thread_test",
              status: options.status ?? "open",
              last_message_at: now,
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
      async getById(context, conversationId) {
        expectTenantContext(context);

        if (conversationId !== "cnv_test") {
          return null;
        }

        return {
          conversation_id: "cnv_test",
          tenant_id: context.tenant.tenantId,
          customer_id: "cus_test",
          channel_id: "chn_test",
          external_thread_id: "thread_test",
          status: "open",
          last_message_at: now,
          created_at: now,
          updated_at: now,
        };
      },
    },
    messages: {
      async list(context, conversationId, options) {
        expectTenantContext(context);

        if (conversationId !== "cnv_test") {
          return null;
        }

        return {
          messages: [
            {
              message_id: "msg_test",
              tenant_id: context.tenant.tenantId,
              conversation_id: "cnv_test",
              ticket_id: "ticket_test",
              channel_id: "chn_test",
              direction: options.direction ?? "inbound",
              body_text: "Where is my order?",
              body_html_ref: null,
              attachments: [],
              external_message_id: "external_msg_test",
              external_thread_id: "thread_test",
              raw_payload_ref: "raw_payload_test",
              created_by_type: "customer",
              created_by_user_id: null,
              provider_message_id: null,
              send_status: null,
              sent_by_type: null,
              ai_run_id: null,
              approval_id: null,
              sent_at: null,
              idempotency_key: "idem_msg_test",
              created_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async getById(context, conversationId, messageId) {
        expectTenantContext(context);

        if (conversationId !== "cnv_test" || messageId !== "msg_test") {
          return null;
        }

        return {
          message_id: "msg_test",
          tenant_id: context.tenant.tenantId,
          conversation_id: "cnv_test",
          ticket_id: "ticket_test",
          channel_id: "chn_test",
          direction: "inbound",
          body_text: "Where is my order?",
          body_html_ref: null,
          attachments: [],
          external_message_id: "external_msg_test",
          external_thread_id: "thread_test",
          raw_payload_ref: "raw_payload_test",
          created_by_type: "customer",
          created_by_user_id: null,
          provider_message_id: null,
          send_status: null,
          sent_by_type: null,
          ai_run_id: null,
          approval_id: null,
          sent_at: null,
          idempotency_key: "idem_msg_test",
          created_at: now,
        };
      },
    },
    policies: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          policies: [
            {
              policy_id: "pol_test",
              tenant_id: context.tenant.tenantId,
              name: "Shipping Policy",
              domain: options.domain ?? "shipping",
              status: options.status ?? "active",
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
      async getById(context, policyId) {
        expectTenantContext(context);

        if (policyId !== "pol_test") {
          return null;
        }

        return {
          policy_id: "pol_test",
          tenant_id: context.tenant.tenantId,
          name: "Shipping Policy",
          domain: "shipping",
          status: "active",
          created_at: now,
          updated_at: now,
        };
      },
    },
    kbDocuments: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          kb_documents: [
            {
              kb_document_id: "kbd_test",
              tenant_id: context.tenant.tenantId,
              title: "Shipping FAQ",
              source_type: options.source_type ?? "manual",
              source_ref: null,
              document_type: options.document_type ?? "faq",
              status: options.status ?? "active",
              version: 1,
              content_hash: "hash_test",
              created_by_user_id: null,
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
      async getById(context, kbDocumentId) {
        expectTenantContext(context);

        if (kbDocumentId !== "kbd_test") {
          return null;
        }

        return {
          kb_document_id: "kbd_test",
          tenant_id: context.tenant.tenantId,
          title: "Shipping FAQ",
          source_type: "manual",
          source_ref: null,
          document_type: "faq",
          status: "active",
          version: 1,
          content_hash: "hash_test",
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
        };
      },
      async create(context, input) {
        expectTenantContext(context);

        return {
          kb_document_id: input.kb_document_id ?? "kbd_created",
          tenant_id: context.tenant.tenantId,
          title: input.title,
          source_type: input.source_type,
          source_ref: input.source_ref ?? null,
          document_type: input.document_type,
          status: "draft",
          version: 1,
          content_hash: "hash_created",
          created_by_user_id: context.actor.userId,
          created_at: now,
          updated_at: now,
        };
      },
      async update(context, kbDocumentId, input) {
        expectTenantContext(context);

        if (kbDocumentId !== "kbd_test") {
          return null;
        }

        return {
          kb_document_id: "kbd_test",
          tenant_id: context.tenant.tenantId,
          title: input.title ?? "Shipping FAQ",
          source_type: "manual",
          source_ref: input.source_ref ?? null,
          document_type: input.document_type ?? "faq",
          status: input.status ?? "active",
          version: 1,
          content_hash: "hash_test",
          created_by_user_id: null,
          created_at: now,
          updated_at: now,
        };
      },
      async ingest(context, kbDocumentId) {
        expectTenantContext(context);

        if (kbDocumentId !== "kbd_test") {
          return null;
        }

        return {
          kb_document_id: "kbd_test",
          status: "active",
          version: 1,
          content_hash: "hash_test",
          chunk_count: 3,
          embedded_count: 3,
        };
      },
    },
    approvals: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          approvals: [
            {
              approval_id: "apr_test",
              tenant_id: context.tenant.tenantId,
              ticket_id: options.ticket_id ?? "ticket_test",
              ai_run_id: null,
              approval_type: options.approval_type ?? "reply",
              status: options.status ?? "pending",
              requested_payload: {
                draft: "Where is my order response draft.",
                risk_reasons: ["v1_default_human_approval"],
              },
              approved_payload: null,
              reviewer_user_id: null,
              review_notes: null,
              created_at: now,
              resolved_at: null,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async getById(context, approvalId) {
        expectTenantContext(context);

        if (approvalId !== "apr_test") {
          return null;
        }

        return {
          approval_id: "apr_test",
          tenant_id: context.tenant.tenantId,
          ticket_id: "ticket_test",
          ai_run_id: null,
          approval_type: "reply",
          status: "pending",
          requested_payload: {
            draft: "Where is my order response draft.",
            risk_reasons: ["v1_default_human_approval"],
          },
          approved_payload: null,
          reviewer_user_id: null,
          review_notes: null,
          created_at: now,
          resolved_at: null,
        };
      },
    },
    auditEvents: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          audit_events: [
            {
              audit_event_id: "aud_test",
              tenant_id: context.tenant.tenantId,
              actor_type: options.actor_type ?? "system",
              actor_id: null,
              entity_type: options.entity_type ?? "ticket",
              entity_id: options.entity_id ?? "ticket_test",
              action: options.action ?? "ticket.created",
              metadata: {
                status: "new",
              },
              correlation_id: options.correlation_id ?? "corr_test",
              created_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async listForTicket(context, ticketId, options) {
        expectTenantContext(context);

        if (ticketId !== "ticket_test") {
          return null;
        }

        return {
          audit_events: [
            {
              audit_event_id: "aud_test",
              tenant_id: context.tenant.tenantId,
              actor_type: options.actor_type ?? "system",
              actor_id: null,
              entity_type: "ticket",
              entity_id: ticketId,
              action: options.action ?? "ticket.created",
              metadata: {
                status: "new",
              },
              correlation_id: options.correlation_id ?? "corr_test",
              created_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async getById(context, auditEventId) {
        expectTenantContext(context);

        if (auditEventId !== "aud_test") {
          return null;
        }

        return {
          audit_event_id: "aud_test",
          tenant_id: context.tenant.tenantId,
          actor_type: "system",
          actor_id: null,
          entity_type: "ticket",
          entity_id: "ticket_test",
          action: "ticket.created",
          metadata: {
            status: "new",
          },
          correlation_id: "corr_test",
          created_at: now,
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
