import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createInMemoryTelemetry,
  createRecordingSupportMetrics,
  SUPPORT_ATTR,
  type InMemoryTelemetry,
} from "@support/observability";
import {
  AiRunListResponseSchema,
  AiRunResourceResponseSchema,
  ApprovalDecisionResponseSchema,
  ApprovalListResponseSchema,
  ApprovalResourceResponseSchema,
  ApiErrorResponseSchema,
  EffectiveAutomationPolicyResponseSchema,
  WeeklyPilotReportResponseSchema,
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
  KbSearchResponseSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyActivationResponseSchema,
  PolicyCreateResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  PolicyVersionListResponseSchema,
  PolicyVersionResourceResponseSchema,
  QaReviewEvidenceResponseSchema,
  QaReviewListResponseSchema,
  QaReviewResourceResponseSchema,
  TenantListResponseSchema,
  TenantResourceResponseSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
} from "@support/shared-schemas";
import { buildApp } from "./app.js";
import type { TenantRequestContext } from "./request-context.js";
import type { ApiServices } from "./services.js";

// These suites exercise route/service behavior, not user authentication, so
// they opt into the explicit insecure header mode (Milestone 16). Production
// JWT verification is covered by auth.test.ts and rbac-matrix.test.ts under
// real signed-token fixtures.
process.env.SUPPORT_AUTH_MODE = "insecure-headers";

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
        "x-user-roles": "support_agent",
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

  it("denies requests without any role instead of defaulting one", async () => {
    app = buildApp({ services: makeServices() });

    for (const headers of [
      {
        authorization: "Bearer test-token",
        "x-user-id": "usr_test",
        "x-tenant-id": "ten_test",
      },
      {
        authorization: "Bearer test-token",
        "x-user-id": "usr_test",
        "x-tenant-id": "ten_test",
        "x-user-roles": " , ",
      },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/customers/cus_test",
        headers,
      });
      const body = ApiErrorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(401);
      expect(body.error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("serves the OpenAPI document behind auth", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/openapi.json",
      headers: {
        authorization: "Bearer test-token",
        "x-user-id": "usr_test",
        "x-user-roles": "support_agent",
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
    expect(body.paths).toHaveProperty("/v1/policies/{policy_id}/versions");
    expect(body.paths).toHaveProperty("/v1/policies/{policy_id}/archive");
    expect(body.paths).toHaveProperty(
      "/v1/policy-versions/{policy_version_id}/activate",
    );
    expect(body.paths).toHaveProperty("/v1/kb/documents");
    expect(body.paths).toHaveProperty("/v1/kb/documents/{kb_document_id}");
    expect(body.paths).toHaveProperty(
      "/v1/kb/documents/{kb_document_id}/ingest",
    );
    expect(body.paths).toHaveProperty("/v1/kb/search");
    expect(body.paths).toHaveProperty("/v1/approvals");
    expect(body.paths).toHaveProperty("/v1/approvals/{approval_id}");
    expect(body.paths).toHaveProperty("/v1/approvals/{approval_id}/approve");
    expect(body.paths).toHaveProperty("/v1/approvals/{approval_id}/edit");
    expect(body.paths).toHaveProperty("/v1/approvals/{approval_id}/reject");
    expect(body.paths).toHaveProperty("/v1/approvals/{approval_id}/escalate");
    expect(body.paths).toHaveProperty("/v1/audit-events");
    expect(body.paths).toHaveProperty("/v1/audit-events/{audit_event_id}");
    expect(body.paths).toHaveProperty("/v1/tickets/{ticket_id}/audit-events");
    expect(body.paths).toHaveProperty("/v1/tickets");
    expect(body.paths).toHaveProperty("/v1/tickets/{ticket_id}");
    expect(body.paths).toHaveProperty("/internal/tools/execute");
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

  it("creates a policy with its version-1 draft", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: tenantAdminHeaders,
      payload: {
        name: "Refund Policy",
        domain: "refunds",
        content: { refund_window_days: 30 },
      },
    });
    const body = PolicyCreateResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(201);
    expect(body.policy).toMatchObject({
      policy_id: "pol_created",
      status: "draft",
      domain: "refunds",
    });
    expect(body.policy_version).toMatchObject({
      version: 1,
      activated_at: null,
      schema_version: "refunds.v1",
    });
  });

  it("rejects policy writes for non-admin roles", async () => {
    app = buildApp({ services: makeServices() });

    for (const headers of [authHeaders, clientViewerHeaders]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/policies",
        headers,
        payload: {
          name: "Refund Policy",
          domain: "refunds",
          content: {},
        },
      });
      const body = ApiErrorResponseSchema.parse(response.json());

      expect(response.statusCode).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("lists policy versions through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/policies/pol_test/versions",
      headers: authHeaders,
    });
    const body = PolicyVersionListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.policy_versions).toHaveLength(1);
    expect(body.policy_versions[0]!).toMatchObject({
      policy_version_id: "polv_test_1",
      version: 1,
    });
  });

  it("creates a draft policy version and 409s on archived policies", async () => {
    app = buildApp({ services: makeServices() });
    const created = await app.inject({
      method: "POST",
      url: "/v1/policies/pol_test/versions",
      headers: tenantAdminHeaders,
      payload: { content: { rules: "ship within 2 days" } },
    });
    const createdBody = PolicyVersionResourceResponseSchema.parse(
      created.json(),
    );

    expect(created.statusCode).toBe(201);
    expect(createdBody.policy_version).toMatchObject({
      version: 2,
      activated_at: null,
    });

    const archived = await app.inject({
      method: "POST",
      url: "/v1/policies/pol_archived/versions",
      headers: tenantAdminHeaders,
      payload: { content: {} },
    });
    const archivedBody = ApiErrorResponseSchema.parse(archived.json());

    expect(archived.statusCode).toBe(409);
    expect(archivedBody.error.code).toBe("CONFLICT");
  });

  it("activates a policy version and reports archived predecessors", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/policy-versions/polv_test_2/activate",
      headers: tenantAdminHeaders,
    });
    const body = PolicyActivationResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.policy.status).toBe("active");
    expect(body.policy_version.activated_at).toBe(now);
    expect(body.archived_policy_ids).toEqual(["pol_predecessor"]);
  });

  it("409s when re-activating an already-activated version", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/policy-versions/polv_already_active/activate",
      headers: tenantAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("archives a policy and 409s when it is already archived", async () => {
    app = buildApp({ services: makeServices() });
    const archived = await app.inject({
      method: "POST",
      url: "/v1/policies/pol_test/archive",
      headers: tenantAdminHeaders,
    });
    const archivedBody = PolicyResourceResponseSchema.parse(archived.json());

    expect(archived.statusCode).toBe(200);
    expect(archivedBody.policy.status).toBe("archived");

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/policies/pol_archived/archive",
      headers: tenantAdminHeaders,
    });
    const conflictBody = ApiErrorResponseSchema.parse(conflict.json());

    expect(conflict.statusCode).toBe(409);
    expect(conflictBody.error.code).toBe("CONFLICT");
  });

  it("surfaces retention_policy on the tenant contract", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/tenants/ten_test",
      headers: tenantAdminHeaders,
    });
    const body = TenantResourceResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tenant.retention_policy).toEqual({
      raw_payload_days: 90,
      ai_run_days: 365,
    });
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

  it("retrieves KB chunk citations through the shared search response schema", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/search",
      headers: authHeaders,
      payload: { query: "how long do I have to return an item?", limit: 5 },
    });
    const body = KbSearchResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!).toMatchObject({
      kb_chunk_id: "kbc_test",
      kb_document_id: "kbd_test",
      document_title: "Returns policy",
    });
    expect(body.results[0]!.score).toBeGreaterThan(0);
    expect(body.page).toMatchObject({ count: 1, limit: 5 });
  });

  it("rejects KB search with an empty query", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/search",
      headers: authHeaders,
      payload: { query: "" },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects KB search for roles without the kb:search permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/kb/search",
      headers: integrationAdminHeaders,
      payload: { query: "refund policy" },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
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

  it("approves a pending approval and reports the workflow signal", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/approve",
      headers: authHeaders,
      payload: { review_notes: "Looks right." },
    });
    const body = ApprovalDecisionResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approval).toMatchObject({
      approval_id: "apr_test",
      status: "approved",
      reviewer_user_id: "usr_test",
      review_notes: "Looks right.",
    });
    expect(body.approval.approved_payload).toEqual(
      body.approval.requested_payload,
    );
    expect(body.workflow_signal).toEqual({
      delivered: true,
      workflow_id: "ticket-lifecycle:ten_test:con_test",
      reason: null,
    });
  });

  it("approves without a request body", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/approve",
      headers: authHeaders,
    });
    const body = ApprovalDecisionResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approval.status).toBe("approved");
    expect(body.approval.review_notes).toBeNull();
  });

  it("edits an approval with the human payload preserved separately from the AI draft", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/edit",
      headers: authHeaders,
      payload: {
        approved_payload: { draft_text: "Softer edited response." },
        review_notes: "Softened the tone.",
      },
    });
    const body = ApprovalDecisionResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approval.status).toBe("edited");
    expect(body.approval.approved_payload).toEqual({
      draft_text: "Softer edited response.",
    });
    expect(body.approval.requested_payload).toMatchObject({
      draft: "Where is my order response draft.",
    });
  });

  it("rejects an edit without the edited payload", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/edit",
      headers: authHeaders,
      payload: { review_notes: "Missing payload." },
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects and escalates pending approvals", async () => {
    app = buildApp({ services: makeServices() });
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/reject",
      headers: authHeaders,
      payload: { review_notes: "Not accurate." },
    });
    const escalated = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/escalate",
      headers: authHeaders,
    });

    expect(rejected.statusCode).toBe(200);
    expect(
      ApprovalDecisionResponseSchema.parse(rejected.json()).approval,
    ).toMatchObject({ status: "rejected", approved_payload: null });
    expect(escalated.statusCode).toBe(200);
    expect(
      ApprovalDecisionResponseSchema.parse(escalated.json()).approval.status,
    ).toBe("escalated");
  });

  it("returns structured not-found and conflict decision errors", async () => {
    app = buildApp({ services: makeServices() });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_missing/approve",
      headers: authHeaders,
    });
    const resolved = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_resolved/approve",
      headers: authHeaders,
    });

    expect(missing.statusCode).toBe(404);
    expect(ApiErrorResponseSchema.parse(missing.json()).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
    expect(resolved.statusCode).toBe(409);
    expect(ApiErrorResponseSchema.parse(resolved.json()).error.code).toBe(
      "CONFLICT",
    );
  });

  it("rejects approval decisions for read-only roles", async () => {
    app = buildApp({ services: makeServices() });
    const qaHeaders = { ...authHeaders, "x-user-roles": "qa_reviewer" };
    const response = await app.inject({
      method: "POST",
      url: "/v1/approvals/apr_test/approve",
      headers: qaHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lists AI run resources with observability trace links", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/ai-runs?ticket_id=ticket_test&status=succeeded&limit=10",
      headers: authHeaders,
    });
    const body = AiRunListResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.ai_runs[0]?.ai_run_id).toBe("air_test");
    expect(body.ai_runs[0]?.trace_id).toBe("trace_test");
  });

  it("returns AI run resources and structured not-found errors", async () => {
    app = buildApp({ services: makeServices() });
    const found = await app.inject({
      method: "GET",
      url: "/v1/ai-runs/air_test",
      headers: authHeaders,
    });
    const missing = await app.inject({
      method: "GET",
      url: "/v1/ai-runs/air_missing",
      headers: authHeaders,
    });

    expect(found.statusCode).toBe(200);
    expect(
      AiRunResourceResponseSchema.parse(found.json()).ai_run.trace_id,
    ).toBe("trace_test");
    expect(missing.statusCode).toBe(404);
    expect(ApiErrorResponseSchema.parse(missing.json()).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("rejects AI run reads for roles without the ai_runs:read permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/ai-runs",
      headers: clientViewerHeaders,
    });

    expect(response.statusCode).toBe(403);
  });

  it("lists and reads QA review resources through the shared response schema", async () => {
    app = buildApp({ services: makeServices() });
    const qaHeaders = { ...authHeaders, "x-user-roles": "qa_reviewer" };
    const list = await app.inject({
      method: "GET",
      url: "/v1/qa-reviews?ticket_id=ticket_test&completed=false&limit=10",
      headers: qaHeaders,
    });
    const single = await app.inject({
      method: "GET",
      url: "/v1/qa-reviews/qa_test",
      headers: qaHeaders,
    });
    const missing = await app.inject({
      method: "GET",
      url: "/v1/qa-reviews/qa_missing",
      headers: qaHeaders,
    });

    expect(list.statusCode).toBe(200);
    expect(
      QaReviewListResponseSchema.parse(list.json()).qa_reviews[0]?.qa_review_id,
    ).toBe("qa_test");
    expect(single.statusCode).toBe(200);
    expect(
      QaReviewResourceResponseSchema.parse(single.json()).qa_review
        .sample_reason,
    ).toBe("auto_send_candidate");
    expect(missing.statusCode).toBe(404);
  });

  it("creates QA reviews for reviewer roles", async () => {
    app = buildApp({ services: makeServices() });
    const qaHeaders = { ...authHeaders, "x-user-roles": "qa_reviewer" };
    const created = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: qaHeaders,
      payload: {
        ticket_id: "ticket_test",
        ai_run_id: "air_test",
        sample_reason: "manual",
        notes: "Spot check.",
      },
    });
    const missingTicket = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: qaHeaders,
      payload: { ticket_id: "ticket_missing", sample_reason: "manual" },
    });
    const missingAiRun = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: qaHeaders,
      payload: {
        ticket_id: "ticket_test",
        ai_run_id: "air_missing",
        sample_reason: "manual",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(
      QaReviewResourceResponseSchema.parse(created.json()).qa_review
        .sample_reason,
    ).toBe("manual");
    expect(missingTicket.statusCode).toBe(404);
    expect(missingAiRun.statusCode).toBe(404);
  });

  it("rejects QA review writes for roles without the write permission", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: clientViewerHeaders,
      payload: { ticket_id: "ticket_test", sample_reason: "manual" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("completes QA reviews with scores and the defect taxonomy", async () => {
    app = buildApp({ services: makeServices() });
    const qaHeaders = { ...authHeaders, "x-user-roles": "qa_reviewer" };
    const completed = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews/qa_test/complete",
      headers: qaHeaders,
      payload: {
        scores: { draft_quality: 4, safety: 5 },
        defects: [{ category: "bad_tone", severity: "low" }],
        notes: "Tone was curt but accurate.",
      },
    });
    const invalidDefect = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews/qa_test/complete",
      headers: qaHeaders,
      payload: {
        scores: {},
        defects: [{ category: "made_up_defect" }],
      },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews/qa_completed/complete",
      headers: qaHeaders,
      payload: { scores: {}, defects: [] },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/qa-reviews/qa_missing/complete",
      headers: qaHeaders,
      payload: { scores: {}, defects: [] },
    });

    expect(completed.statusCode).toBe(200);
    const review = QaReviewResourceResponseSchema.parse(
      completed.json(),
    ).qa_review;
    expect(review.completed_at).not.toBeNull();
    expect(review.scores).toEqual({ draft_quality: 4, safety: 5 });
    expect(invalidDefect.statusCode).toBe(400);
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorResponseSchema.parse(conflict.json()).error.code).toBe(
      "CONFLICT",
    );
    expect(missing.statusCode).toBe(404);
  });

  it("returns the composite QA evidence package for reviewers", async () => {
    app = buildApp({ services: makeServices() });
    const qaHeaders = { ...authHeaders, "x-user-roles": "qa_reviewer" };
    const response = await app.inject({
      method: "GET",
      url: "/v1/qa-reviews/qa_test/evidence",
      headers: qaHeaders,
    });

    expect(response.statusCode).toBe(200);
    const evidence = QaReviewEvidenceResponseSchema.parse(response.json());

    // The acceptance criterion: conversation, evidence, tool calls, AI
    // output, human edits, and the final response are all visible.
    expect(evidence.conversation.conversation_id).toBe("con_test");
    expect(
      evidence.messages.some((message) => message.direction === "inbound"),
    ).toBe(true);
    expect(evidence.ai_run?.structured_output).toEqual({
      draft: { draft_text: "Draft reply." },
    });
    expect(evidence.ai_run?.trace_id).toBe("trace_test");
    expect(evidence.tool_calls[0]?.tool_definition_id).toBe(
      "tool_order_lookup",
    );
    expect(evidence.approvals[0]?.requested_payload).toEqual({
      draft_text: "Original AI draft.",
    });
    expect(evidence.approvals[0]?.approved_payload).toEqual({
      draft_text: "Human-edited reply.",
    });
    const finalResponse = evidence.messages.find(
      (message) => message.direction === "outbound",
    );
    expect(finalResponse?.send_status).toBe("sent");
    expect(finalResponse?.body_text).toBe("Your order shipped yesterday.");
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

  it("resolves the effective automation policy for the tenant", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/policies/automation",
      headers: authHeaders,
    });
    const body = EffectiveAutomationPolicyResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.tenant_id).toBe("ten_test");
    expect(body.configured).toBe(true);
    expect(body.auto_send_enabled).toBe(false);
    expect(body.auto_send_allowed_topics).toEqual([]);
  });

  it("serves the weekly pilot report with an explicit window", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/reports/pilot-weekly?since=2026-06-27T00:00:00.000Z&until=2026-07-04T00:00:00.000Z",
      headers: tenantAdminHeaders,
    });
    const body = WeeklyPilotReportResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.report.window.since).toBe("2026-06-27T00:00:00.000Z");
    expect(body.report.tickets.created).toBe(3);
    expect(body.report.outbound_messages.auto_sent).toBe(0);
  });

  it("rejects an inverted weekly report window", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/reports/pilot-weekly?since=2026-07-04T00:00:00.000Z&until=2026-06-27T00:00:00.000Z",
      headers: tenantAdminHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("denies the weekly pilot report to roles without reports:read", async () => {
    app = buildApp({ services: makeServices() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/reports/pilot-weekly",
      headers: authHeaders,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("api observability", () => {
  let telemetry: InMemoryTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.shutdown();
    telemetry = undefined;
  });

  it("records API request metrics with route templates and status codes", async () => {
    const metrics = createRecordingSupportMetrics();
    app = buildApp({ services: makeServices(), metrics });

    await app.inject({
      method: "GET",
      url: "/v1/tickets/ticket_test",
      headers: authHeaders,
    });
    await app.inject({
      method: "GET",
      url: "/v1/customers/missing",
      headers: authHeaders,
    });

    expect(metrics.apiRequests).toHaveLength(2);
    expect(metrics.apiRequests[0]).toMatchObject({
      method: "GET",
      route: "/v1/tickets/:ticket_id",
      statusCode: 200,
    });
    expect(metrics.apiRequests[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(metrics.apiRequests[1]).toMatchObject({
      route: "/v1/customers/:customer_id",
      statusCode: 404,
    });
  });

  it("emits a request span carrying the correlation attributes", async () => {
    telemetry = createInMemoryTelemetry();
    const metrics = createRecordingSupportMetrics();
    app = buildApp({ services: makeServices(), metrics });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/ticket_test",
      headers: { ...authHeaders, "x-correlation-id": "corr_trace_test" },
    });

    expect(response.statusCode).toBe(200);
    const spans = telemetry.getFinishedSpans();
    const requestSpan = spans.find((span) => span.name === "http.request");
    expect(requestSpan).toBeDefined();
    expect(requestSpan?.attributes[SUPPORT_ATTR.requestId]).toBe("req_test");
    expect(requestSpan?.attributes[SUPPORT_ATTR.correlationId]).toBe(
      "corr_trace_test",
    );
    expect(requestSpan?.attributes[SUPPORT_ATTR.tenantId]).toBe("ten_test");
    expect(requestSpan?.attributes["http.route"]).toBe(
      "/v1/tickets/:ticket_id",
    );
    expect(requestSpan?.attributes["http.response.status_code"]).toBe(200);
  });

  it("marks server-error request spans as errors", async () => {
    telemetry = createInMemoryTelemetry();
    const failing = makeServices();
    const services: ApiServices = {
      ...failing,
      tickets: {
        ...failing.tickets,
        async getById() {
          throw new Error("boom");
        },
      },
    };
    const metrics = createRecordingSupportMetrics();
    app = buildApp({ services, metrics });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/ticket_test",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(500);
    const requestSpan = telemetry
      .getFinishedSpans()
      .find((span) => span.name === "http.request");
    expect(requestSpan?.status.code).toBe(2);
    expect(metrics.apiRequests[0]?.statusCode).toBe(500);
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
              retention_policy: { raw_payload_days: 90 },
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
          retention_policy: {},
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
          retention_policy: { raw_payload_days: 90, ai_run_days: 365 },
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
          retention_policy: {},
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
      async getEffectiveAutomationPolicy(context) {
        expectTenantContext(context);

        return {
          tenant_id: context.tenant.tenantId,
          configured: true,
          policy_id: "pol_automation_test",
          policy_version_id: "polv_automation_test_1",
          version: 1,
          activated_at: now,
          auto_send_enabled: false,
          auto_send_allowed_topics: [],
        };
      },
      async create(context, input) {
        expectTenantContext(context);

        return {
          policy: {
            policy_id: input.policy_id ?? "pol_created",
            tenant_id: context.tenant.tenantId,
            name: input.name,
            domain: input.domain,
            status: "draft",
            created_at: now,
            updated_at: now,
          },
          policy_version: {
            policy_version_id: input.policy_version_id ?? "polv_created_1",
            tenant_id: context.tenant.tenantId,
            policy_id: input.policy_id ?? "pol_created",
            version: 1,
            content: input.content,
            schema_version: input.schema_version ?? `${input.domain}.v1`,
            created_by_user_id: context.actor.userId,
            approved_by_user_id: null,
            activated_at: null,
            created_at: now,
          },
        };
      },
      async listVersions(context, policyId, options) {
        expectTenantContext(context);

        if (policyId !== "pol_test") {
          return null;
        }

        return {
          policy_versions: [
            {
              policy_version_id: "polv_test_1",
              tenant_id: context.tenant.tenantId,
              policy_id: policyId,
              version: 1,
              content: { rules: "ship within 3 days" },
              schema_version: "shipping.v1",
              created_by_user_id: "usr_test",
              approved_by_user_id: "usr_test",
              activated_at: now,
              created_at: now,
            },
          ],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async createVersion(context, policyId, input) {
        expectTenantContext(context);

        if (policyId === "pol_missing") {
          return { outcome: "not_found" };
        }

        if (policyId === "pol_archived") {
          return { outcome: "archived" };
        }

        return {
          outcome: "created",
          policyVersion: {
            policy_version_id: input.policy_version_id ?? "polv_test_2",
            tenant_id: context.tenant.tenantId,
            policy_id: policyId,
            version: 2,
            content: input.content,
            schema_version: input.schema_version ?? "shipping.v1",
            created_by_user_id: context.actor.userId,
            approved_by_user_id: null,
            activated_at: null,
            created_at: now,
          },
        };
      },
      async activateVersion(context, policyVersionId) {
        expectTenantContext(context);

        if (policyVersionId === "polv_missing") {
          return { outcome: "not_found" };
        }

        if (policyVersionId === "polv_already_active") {
          return {
            outcome: "conflict",
            reason: "Policy version has already been activated.",
          };
        }

        return {
          outcome: "activated",
          result: {
            policy: {
              policy_id: "pol_test",
              tenant_id: context.tenant.tenantId,
              name: "Shipping Policy",
              domain: "shipping",
              status: "active",
              created_at: now,
              updated_at: now,
            },
            policy_version: {
              policy_version_id: policyVersionId,
              tenant_id: context.tenant.tenantId,
              policy_id: "pol_test",
              version: 2,
              content: { rules: "ship within 2 days" },
              schema_version: "shipping.v1",
              created_by_user_id: "usr_test",
              approved_by_user_id: context.actor.userId,
              activated_at: now,
              created_at: now,
            },
            archived_policy_ids: ["pol_predecessor"],
          },
        };
      },
      async archive(context, policyId) {
        expectTenantContext(context);

        if (policyId === "pol_missing") {
          return { outcome: "not_found" };
        }

        if (policyId === "pol_archived") {
          return { outcome: "conflict" };
        }

        return {
          outcome: "archived",
          policy: {
            policy_id: policyId,
            tenant_id: context.tenant.tenantId,
            name: "Shipping Policy",
            domain: "shipping",
            status: "archived",
            created_at: now,
            updated_at: now,
          },
        };
      },
    },
    reports: {
      async weekly(context, window) {
        expectTenantContext(context);

        return {
          tenant_id: context.tenant.tenantId,
          window: {
            since: window.since.toISOString(),
            until: window.until.toISOString(),
          },
          tickets: {
            created: 3,
            resolved: 2,
            manual_escalations: 1,
            sla_breaches: 1,
            first_response_minutes_avg: 42,
            resolution_minutes_avg: 240,
            escalation_rate: 1 / 3,
          },
          ai_runs: { total: 3, succeeded: 2, failed: 1, draft_rate: 2 / 3 },
          approvals: {
            requested: 2,
            approved: 1,
            edited: 1,
            rejected: 0,
            escalated: 0,
            approval_rate: 1,
          },
          outbound_messages: {
            sent: 2,
            failed: 0,
            auto_sent: 0,
            auto_send_rate: 0,
          },
          qa_reviews: {
            created: 1,
            completed: 1,
            with_defects: 0,
            defect_rate: 0,
          },
          top_topics: [{ topic: "order_status", count: 2 }],
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
      async search(context, input) {
        expectTenantContext(context);

        return {
          results: [
            {
              kb_chunk_id: "kbc_test",
              tenant_id: context.tenant.tenantId,
              kb_document_id: "kbd_test",
              chunk_index: 0,
              content: "Returns are accepted within 30 days of delivery.",
              status: "active",
              metadata: { document_type: "policy", source_type: "manual" },
              created_at: now,
              score: 0.92,
              document_title: "Returns policy",
              document_type: input.document_type ?? "policy",
              source_type: input.source_type ?? "manual",
              source_ref: null,
            },
          ],
          page: { count: 1, limit: input.limit ?? 8 },
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
      async decide(context, approvalId, decision) {
        expectTenantContext(context);

        if (approvalId === "apr_missing") {
          return { outcome: "not_found" };
        }

        const requestedPayload = {
          draft: "Where is my order response draft.",
          risk_reasons: ["v1_default_human_approval"],
        };

        if (approvalId === "apr_resolved") {
          return {
            outcome: "conflict",
            approval: {
              approval_id: approvalId,
              tenant_id: context.tenant.tenantId,
              ticket_id: "ticket_test",
              ai_run_id: null,
              approval_type: "reply",
              status: "approved",
              requested_payload: requestedPayload,
              approved_payload: requestedPayload,
              reviewer_user_id: "usr_other",
              review_notes: null,
              created_at: now,
              resolved_at: now,
            },
          };
        }

        return {
          outcome: "resolved",
          decision: {
            approval: {
              approval_id: approvalId,
              tenant_id: context.tenant.tenantId,
              ticket_id: "ticket_test",
              ai_run_id: null,
              approval_type: "reply",
              status: decision.status,
              requested_payload: requestedPayload,
              approved_payload:
                decision.status === "edited"
                  ? (decision.approved_payload ?? {})
                  : decision.status === "approved"
                    ? requestedPayload
                    : null,
              reviewer_user_id: context.actor.userId,
              review_notes: decision.review_notes ?? null,
              created_at: now,
              resolved_at: now,
            },
            workflow_signal: {
              delivered: true,
              workflow_id: `ticket-lifecycle:${context.tenant.tenantId}:con_test`,
              reason: null,
            },
          },
        };
      },
    },
    aiRuns: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          ai_runs: [makeAiRunResponse(context.tenant.tenantId)],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async getById(context, aiRunId) {
        expectTenantContext(context);

        if (aiRunId !== "air_test") {
          return null;
        }

        return makeAiRunResponse(context.tenant.tenantId);
      },
    },
    qaReviews: {
      async list(context, options) {
        expectTenantContext(context);

        return {
          qa_reviews: [makeQaReviewResponse(context.tenant.tenantId)],
          page: {
            count: 1,
            limit: options.limit,
          },
        };
      },
      async getById(context, qaReviewId) {
        expectTenantContext(context);

        if (qaReviewId !== "qa_test") {
          return null;
        }

        return makeQaReviewResponse(context.tenant.tenantId);
      },
      async create(context, input) {
        expectTenantContext(context);

        if (input.ticket_id === "ticket_missing") {
          return { outcome: "ticket_not_found" };
        }

        if (input.ai_run_id === "air_missing") {
          return { outcome: "ai_run_not_found" };
        }

        return {
          outcome: "created",
          review: {
            ...makeQaReviewResponse(context.tenant.tenantId),
            sample_reason: input.sample_reason,
            notes: input.notes ?? null,
          },
        };
      },
      async complete(context, qaReviewId, input) {
        expectTenantContext(context);

        if (qaReviewId === "qa_missing") {
          return { outcome: "not_found" };
        }

        const review = {
          ...makeQaReviewResponse(context.tenant.tenantId),
          qa_review_id: qaReviewId,
        };

        if (qaReviewId === "qa_completed") {
          return {
            outcome: "conflict",
            review: { ...review, completed_at: now },
          };
        }

        return {
          outcome: "completed",
          review: {
            ...review,
            reviewer_user_id: context.actor.userId,
            scores: input.scores,
            defects: input.defects.map((defect) => ({ ...defect })),
            notes: input.notes ?? null,
            completed_at: now,
          },
        };
      },
      async evidence(context, qaReviewId) {
        expectTenantContext(context);

        if (qaReviewId !== "qa_test") {
          return null;
        }

        const tenantId = context.tenant.tenantId;

        return {
          qa_review: makeQaReviewResponse(tenantId),
          ticket: makeTicketResponse(tenantId),
          conversation: {
            conversation_id: "con_test",
            tenant_id: tenantId,
            customer_id: "cus_test",
            channel_id: "chn_test",
            external_thread_id: "thread-1",
            status: "open",
            last_message_at: now,
            created_at: now,
            updated_at: now,
          },
          messages: [
            {
              message_id: "msg_in_test",
              tenant_id: tenantId,
              conversation_id: "con_test",
              ticket_id: "ticket_test",
              channel_id: "chn_test",
              direction: "inbound",
              body_text: "Where is my order?",
              body_html_ref: null,
              attachments: [],
              external_message_id: "ext-1",
              external_thread_id: "thread-1",
              raw_payload_ref: "file:///raw/1",
              created_by_type: "customer",
              created_by_user_id: null,
              provider_message_id: null,
              send_status: null,
              sent_by_type: null,
              ai_run_id: null,
              approval_id: null,
              sent_at: null,
              idempotency_key: "in-1",
              created_at: now,
            },
            {
              message_id: "msg_out_test",
              tenant_id: tenantId,
              conversation_id: "con_test",
              ticket_id: "ticket_test",
              channel_id: "chn_test",
              direction: "outbound",
              body_text: "Your order shipped yesterday.",
              body_html_ref: null,
              attachments: [],
              external_message_id: null,
              external_thread_id: "thread-1",
              raw_payload_ref: null,
              created_by_type: "human",
              created_by_user_id: "usr_agent",
              provider_message_id: "prov-1",
              send_status: "sent",
              sent_by_type: "human",
              ai_run_id: "air_test",
              approval_id: "apr_test",
              sent_at: now,
              idempotency_key: "out-1",
              created_at: now,
            },
          ],
          ai_run: makeAiRunResponse(tenantId),
          tool_calls: [
            {
              tool_call_id: "tc_test",
              tenant_id: tenantId,
              ticket_id: "ticket_test",
              ai_run_id: "air_test",
              tool_definition_id: "tool_order_lookup",
              input: { order_number: "ORD-1" },
              output: { order: { status: "shipped" } },
              status: "succeeded",
              side_effect_class: "read_only",
              idempotency_key: null,
              started_at: now,
              completed_at: now,
              error_code: null,
              error_message: null,
            },
          ],
          approvals: [
            {
              approval_id: "apr_test",
              tenant_id: tenantId,
              ticket_id: "ticket_test",
              ai_run_id: "air_test",
              approval_type: "reply",
              status: "edited",
              requested_payload: { draft_text: "Original AI draft." },
              approved_payload: { draft_text: "Human-edited reply." },
              reviewer_user_id: "usr_agent",
              review_notes: null,
              created_at: now,
              resolved_at: now,
            },
          ],
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

function makeAiRunResponse(tenantId: string) {
  return {
    ai_run_id: "air_test",
    tenant_id: tenantId,
    ticket_id: "ticket_test",
    conversation_id: "con_test",
    run_type: "full_graph" as const,
    prompt_version: "support_graph.v1",
    model_provider: "deterministic",
    model_id: "deterministic-support-model.v1",
    input_refs: { correlation_id: "corr_test" },
    retrieved_context_refs: { evidence_ids: ["kb_chunk_1"] },
    structured_output: { draft: { draft_text: "Draft reply." } },
    confidence: 0.9,
    risk_level: "low",
    automation_recommendation: "human_approve" as const,
    guardrail_results: { passed: true },
    status: "succeeded" as const,
    latency_ms: 120,
    input_tokens: null,
    output_tokens: null,
    cost_estimate: null,
    trace_id: "trace_test",
    created_at: now,
    completed_at: now,
  };
}

function makeQaReviewResponse(tenantId: string) {
  return {
    qa_review_id: "qa_test",
    tenant_id: tenantId,
    ticket_id: "ticket_test",
    ai_run_id: "air_test",
    reviewer_user_id: null,
    sample_reason: "auto_send_candidate",
    scores: {},
    defects: [],
    notes: null,
    created_at: now,
    completed_at: null,
  };
}

function makeTicketResponse(tenantId: string) {
  return {
    ticket_id: "ticket_test",
    tenant_id: tenantId,
    conversation_id: "con_test",
    customer_id: "cus_test",
    status: "waiting_human" as const,
    priority: "p2" as const,
    topic: null,
    subtopic: null,
    language: null,
    sentiment: null,
    urgency_score: null,
    automation_mode: "human_approve" as const,
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
}
