import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createRecordingSupportMetrics } from "@support/observability";
import {
  AiRunListResponseSchema,
  AiRunResourceResponseSchema,
  ApprovalDecisionResponseSchema,
  ApprovalListResponseSchema,
  ApprovalResourceResponseSchema,
  ApiErrorResponseSchema,
  AuditEventListResponseSchema,
  AuditEventResourceResponseSchema,
  ConversationListResponseSchema,
  ConversationResourceResponseSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  KbDocumentListResponseSchema,
  KbDocumentResourceResponseSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  QaReviewEvidenceResponseSchema,
  QaReviewListResponseSchema,
  QaReviewResourceResponseSchema,
  TenantListResponseSchema,
  TenantResourceResponseSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  type RoleName,
} from "@support/shared-schemas";
import {
  aiRuns,
  approvals,
  auditEvents,
  channels,
  conversations,
  createDatabase,
  createPostgresClient,
  customers,
  kbDocuments,
  messages,
  migrateDatabase,
  tenantPolicies,
  tenants,
  tickets,
  users,
  type PostgresClient,
} from "@support/db";
import { buildApp } from "./app.js";
import { createRecordingApprovalWorkflowSignaler } from "./approval-workflow-signaler.js";
import { createDatabaseApiServices } from "./services.js";

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
  kbDocumentA: `${fixturePrefix}_kbd_a`,
  kbDocumentB: `${fixturePrefix}_kbd_b`,
  approvalA: `${fixturePrefix}_apr_a`,
  approvalB: `${fixturePrefix}_apr_b`,
  approvalApprove: `${fixturePrefix}_apr_approve`,
  approvalEdit: `${fixturePrefix}_apr_edit`,
  approvalReject: `${fixturePrefix}_apr_reject`,
  approvalEscalate: `${fixturePrefix}_apr_escalate`,
  reviewerUser: `${fixturePrefix}_usr`,
  auditA: `${fixturePrefix}_aud_a`,
  auditB: `${fixturePrefix}_aud_b`,
  ticketA: `${fixturePrefix}_tic_a`,
  ticketB: `${fixturePrefix}_tic_b`,
  ticketCreated: `${fixturePrefix}_tic_created`,
  aiRunA: `${fixturePrefix}_air_a`,
  aiRunB: `${fixturePrefix}_air_b`,
};

describeLive("live PostgreSQL-backed API resource reads", () => {
  let app: FastifyInstance | undefined;
  let client: PostgresClient | undefined;
  let db: ReturnType<typeof createDatabase>;
  const approvalSignaler = createRecordingApprovalWorkflowSignaler();
  const metrics = createRecordingSupportMetrics();

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

    app = buildApp({
      services: createDatabaseApiServices({ approvalSignaler, metrics }),
      metrics,
    });
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

  it("lists tenant-scoped KB documents without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/kb/documents?source_type=manual&document_type=faq&status=active&limit=100",
      headers: authHeaders("support_agent"),
    });
    const body = KbDocumentListResponseSchema.parse(response.json());
    const kbDocumentIds = body.kb_documents.map(
      (kbDocument) => kbDocument.kb_document_id,
    );

    expect(response.statusCode).toBe(200);
    expect(kbDocumentIds).toContain(ids.kbDocumentA);
    expect(kbDocumentIds).not.toContain(ids.kbDocumentB);
  });

  it("reads tenant-scoped KB documents without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/kb/documents/${ids.kbDocumentA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/kb/documents/${ids.kbDocumentB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = KbDocumentResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.kb_document).toMatchObject({
      kb_document_id: ids.kbDocumentA,
      tenant_id: ids.tenantA,
      source_type: "manual",
      document_type: "faq",
      status: "active",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists tenant-scoped approvals without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: `/v1/approvals?status=pending&approval_type=reply&ticket_id=${ids.ticketA}&limit=100`,
      headers: authHeaders("support_agent"),
    });
    const body = ApprovalListResponseSchema.parse(response.json());
    const approvalIds = body.approvals.map((approval) => approval.approval_id);

    expect(response.statusCode).toBe(200);
    expect(approvalIds).toContain(ids.approvalA);
    expect(approvalIds).not.toContain(ids.approvalB);
  });

  it("reads tenant-scoped approvals without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/approvals/${ids.approvalA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/approvals/${ids.approvalB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = ApprovalResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.approval).toMatchObject({
      approval_id: ids.approvalA,
      tenant_id: ids.tenantA,
      ticket_id: ids.ticketA,
      status: "pending",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists tenant-scoped audit events without crossing tenants", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/audit-events?entity_type=ticket&action=ticket.created&limit=100",
      headers: authHeaders("support_agent"),
    });
    const body = AuditEventListResponseSchema.parse(response.json());
    const auditEventIds = body.audit_events.map(
      (auditEvent) => auditEvent.audit_event_id,
    );

    expect(response.statusCode).toBe(200);
    expect(auditEventIds).toContain(ids.auditA);
    expect(auditEventIds).not.toContain(ids.auditB);
  });

  it("reads tenant-scoped audit events without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/audit-events/${ids.auditA}`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/audit-events/${ids.auditB}`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = AuditEventResourceResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(ownBody.audit_event).toMatchObject({
      audit_event_id: ids.auditA,
      tenant_id: ids.tenantA,
      entity_type: "ticket",
      entity_id: ids.ticketA,
      action: "ticket.created",
    });
    expect(otherTenantResponse.statusCode).toBe(404);
    expect(otherTenantBody.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("lists tenant-scoped ticket audit events without crossing tenants", async () => {
    const ownResponse = await app!.inject({
      method: "GET",
      url: `/v1/tickets/${ids.ticketA}/audit-events?action=ticket.created&limit=100`,
      headers: authHeaders("support_agent"),
    });
    const otherTenantResponse = await app!.inject({
      method: "GET",
      url: `/v1/tickets/${ids.ticketB}/audit-events?action=ticket.created&limit=100`,
      headers: authHeaders("support_agent"),
    });
    const ownBody = AuditEventListResponseSchema.parse(ownResponse.json());
    const otherTenantBody = ApiErrorResponseSchema.parse(
      otherTenantResponse.json(),
    );
    const auditEventIds = ownBody.audit_events.map(
      (auditEvent) => auditEvent.audit_event_id,
    );

    expect(ownResponse.statusCode).toBe(200);
    expect(auditEventIds).toEqual([ids.auditA]);
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

  it("approves a pending approval, audits the decision, and signals the workflow", async () => {
    const response = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalApprove}/approve`,
      headers: authHeaders("support_agent"),
      payload: { review_notes: "Verified against the order record." },
    });
    const body = ApprovalDecisionResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approval).toMatchObject({
      approval_id: ids.approvalApprove,
      tenant_id: ids.tenantA,
      status: "approved",
      reviewer_user_id: ids.reviewerUser,
      review_notes: "Verified against the order record.",
    });
    expect(body.approval.approved_payload).toEqual(
      body.approval.requested_payload,
    );
    expect(body.approval.resolved_at).not.toBeNull();
    expect(body.workflow_signal).toEqual({
      delivered: true,
      workflow_id: `ticket-lifecycle:${ids.tenantA}:${ids.conversationA}`,
      reason: null,
    });
    expect(approvalSignaler.calls.at(-1)).toMatchObject({
      workflowId: `ticket-lifecycle:${ids.tenantA}:${ids.conversationA}`,
      signal: {
        approval_id: ids.approvalApprove,
        status: "approved",
        actor_id: ids.reviewerUser,
        notes: "Verified against the order record.",
      },
    });

    const auditResponse = await app!.inject({
      method: "GET",
      url: `/v1/audit-events?entity_type=approval&entity_id=${ids.approvalApprove}&action=approval.approved&limit=10`,
      headers: authHeaders("support_agent"),
    });
    const auditBody = AuditEventListResponseSchema.parse(auditResponse.json());

    expect(auditBody.audit_events).toHaveLength(1);
    expect(auditBody.audit_events[0]!).toMatchObject({
      actor_type: "human",
      actor_id: ids.reviewerUser,
      entity_type: "approval",
      entity_id: ids.approvalApprove,
      action: "approval.approved",
    });
  });

  it("conflicts on double-deciding an already-resolved approval", async () => {
    const response = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalApprove}/reject`,
      headers: authHeaders("support_agent"),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(409);
    expect(body.error.code).toBe("CONFLICT");

    const readBack = await app!.inject({
      method: "GET",
      url: `/v1/approvals/${ids.approvalApprove}`,
      headers: authHeaders("support_agent"),
    });

    expect(
      ApprovalResourceResponseSchema.parse(readBack.json()).approval.status,
    ).toBe("approved");
  });

  it("stores the human edit alongside the preserved AI draft for eval and QA", async () => {
    const response = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalEdit}/edit`,
      headers: authHeaders("support_agent"),
      payload: {
        approved_payload: { draft_text: "Softer, corrected response." },
        review_notes: "Fixed the refund window wording.",
      },
    });
    const body = ApprovalDecisionResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.approval.status).toBe("edited");
    expect(body.approval.approved_payload).toEqual({
      draft_text: "Softer, corrected response.",
    });
    expect(body.approval.requested_payload).toMatchObject({
      draft: "Tenant A API approval decision draft.",
    });

    const auditResponse = await app!.inject({
      method: "GET",
      url: `/v1/audit-events?entity_type=approval&entity_id=${ids.approvalEdit}&action=approval.edited&limit=10`,
      headers: authHeaders("support_agent"),
    });
    const auditBody = AuditEventListResponseSchema.parse(auditResponse.json());

    expect(auditBody.audit_events).toHaveLength(1);
    expect(auditBody.audit_events[0]!.metadata).toMatchObject({
      requested_payload: {
        draft: "Tenant A API approval decision draft.",
        risk_reasons: ["v1_default_human_approval"],
      },
      approved_payload: { draft_text: "Softer, corrected response." },
      review_notes: "Fixed the refund window wording.",
    });
  });

  it("rejects and escalates pending approvals with matching workflow signals", async () => {
    const rejected = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalReject}/reject`,
      headers: authHeaders("support_agent"),
      payload: { review_notes: "Draft is wrong; do not send." },
    });
    const rejectedBody = ApprovalDecisionResponseSchema.parse(rejected.json());

    expect(rejected.statusCode).toBe(200);
    expect(rejectedBody.approval).toMatchObject({
      status: "rejected",
      approved_payload: null,
    });
    expect(approvalSignaler.calls.at(-1)?.signal.status).toBe("rejected");

    const escalated = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalEscalate}/escalate`,
      headers: authHeaders("support_agent"),
    });

    expect(escalated.statusCode).toBe(200);
    expect(
      ApprovalDecisionResponseSchema.parse(escalated.json()).approval.status,
    ).toBe("escalated");
    expect(approvalSignaler.calls.at(-1)?.signal.status).toBe("escalated");
  });

  it("returns 404 for cross-tenant approval decisions", async () => {
    const response = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalB}/approve`,
      headers: authHeaders("support_agent"),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("denies approval decisions to read-only roles", async () => {
    const response = await app!.inject({
      method: "POST",
      url: `/v1/approvals/${ids.approvalA}/approve`,
      headers: authHeaders("qa_reviewer"),
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lists and reads tenant-scoped AI runs with trace links, without crossing tenants", async () => {
    const list = await app!.inject({
      method: "GET",
      url: `/v1/ai-runs?ticket_id=${ids.ticketA}&limit=10`,
      headers: authHeaders("qa_reviewer"),
    });
    const listBody = AiRunListResponseSchema.parse(list.json());

    expect(list.statusCode).toBe(200);
    expect(listBody.ai_runs.map((run) => run.ai_run_id)).toEqual([ids.aiRunA]);
    expect(listBody.ai_runs[0]?.trace_id).toBe(`${fixturePrefix}_trace_a`);

    const read = await app!.inject({
      method: "GET",
      url: `/v1/ai-runs/${ids.aiRunA}`,
      headers: authHeaders("qa_reviewer"),
    });

    expect(read.statusCode).toBe(200);
    expect(AiRunResourceResponseSchema.parse(read.json()).ai_run.trace_id).toBe(
      `${fixturePrefix}_trace_a`,
    );

    const crossTenant = await app!.inject({
      method: "GET",
      url: `/v1/ai-runs/${ids.aiRunB}`,
      headers: authHeaders("qa_reviewer"),
    });

    expect(crossTenant.statusCode).toBe(404);
  });

  it("rejects AI run reads for roles without the ai_runs:read permission", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v1/ai-runs",
      headers: authHeaders("client_viewer"),
    });

    expect(response.statusCode).toBe(403);
  });

  it("runs the QA review lifecycle: create, list, evidence, complete, conflict", async () => {
    const created = await app!.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: authHeaders("qa_reviewer"),
      payload: {
        ticket_id: ids.ticketA,
        ai_run_id: ids.aiRunA,
        sample_reason: "manual",
        notes: "Milestone 11 integration spot check.",
      },
    });

    expect(created.statusCode).toBe(201);
    const review = QaReviewResourceResponseSchema.parse(
      created.json(),
    ).qa_review;
    expect(review).toMatchObject({
      tenant_id: ids.tenantA,
      ticket_id: ids.ticketA,
      ai_run_id: ids.aiRunA,
      sample_reason: "manual",
      completed_at: null,
    });

    const list = await app!.inject({
      method: "GET",
      url: `/v1/qa-reviews?ticket_id=${ids.ticketA}&completed=false&limit=10`,
      headers: authHeaders("qa_reviewer"),
    });
    const listBody = QaReviewListResponseSchema.parse(list.json());

    expect(list.statusCode).toBe(200);
    expect(listBody.qa_reviews.map((entry) => entry.qa_review_id)).toContain(
      review.qa_review_id,
    );

    // Acceptance: QA review sees conversation, evidence, tool calls, AI
    // output, human edits, and the final response in one package.
    const evidence = await app!.inject({
      method: "GET",
      url: `/v1/qa-reviews/${review.qa_review_id}/evidence`,
      headers: authHeaders("qa_reviewer"),
    });

    expect(evidence.statusCode).toBe(200);
    const evidenceBody = QaReviewEvidenceResponseSchema.parse(evidence.json());
    expect(evidenceBody.conversation.conversation_id).toBe(ids.conversationA);
    expect(evidenceBody.messages.length).toBeGreaterThan(0);
    expect(evidenceBody.ai_run?.ai_run_id).toBe(ids.aiRunA);
    expect(evidenceBody.ai_run?.trace_id).toBe(`${fixturePrefix}_trace_a`);
    expect(evidenceBody.ai_run?.structured_output).toMatchObject({
      draft: { draft_text: "Tenant A AI draft." },
    });
    // The edited approval decided earlier in this suite preserves the AI
    // draft alongside the human edit.
    const editedApproval = evidenceBody.approvals.find(
      (approval) => approval.status === "edited",
    );
    expect(editedApproval?.requested_payload).toBeDefined();
    expect(editedApproval?.approved_payload).not.toBeNull();

    const completed = await app!.inject({
      method: "POST",
      url: `/v1/qa-reviews/${review.qa_review_id}/complete`,
      headers: authHeaders("qa_reviewer"),
      payload: {
        scores: { draft_quality: 4, safety: 5, evidence: 4 },
        defects: [{ category: "bad_tone", severity: "low" }],
        notes: "Draft was safe; tone slightly curt.",
      },
    });

    expect(completed.statusCode).toBe(200);
    const completedReview = QaReviewResourceResponseSchema.parse(
      completed.json(),
    ).qa_review;
    expect(completedReview.completed_at).not.toBeNull();
    expect(completedReview.reviewer_user_id).toBe(ids.reviewerUser);
    expect(completedReview.defects).toEqual([
      { category: "bad_tone", severity: "low" },
    ]);

    const conflict = await app!.inject({
      method: "POST",
      url: `/v1/qa-reviews/${review.qa_review_id}/complete`,
      headers: authHeaders("qa_reviewer"),
      payload: { scores: {}, defects: [] },
    });

    expect(conflict.statusCode).toBe(409);
  });

  it("returns 404 for QA reviews created against other tenants' resources", async () => {
    const crossTenantTicket = await app!.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: authHeaders("qa_reviewer"),
      payload: { ticket_id: ids.ticketB, sample_reason: "manual" },
    });

    expect(crossTenantTicket.statusCode).toBe(404);

    const crossTenantAiRun = await app!.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: authHeaders("qa_reviewer"),
      payload: {
        ticket_id: ids.ticketA,
        ai_run_id: ids.aiRunB,
        sample_reason: "manual",
      },
    });

    expect(crossTenantAiRun.statusCode).toBe(404);
  });

  it("denies QA review writes to roles without the write permission", async () => {
    const response = await app!.inject({
      method: "POST",
      url: "/v1/qa-reviews",
      headers: authHeaders("client_viewer"),
      payload: { ticket_id: ids.ticketA, sample_reason: "manual" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("records approval decision and API request metrics", async () => {
    // Decisions were made earlier in this suite (approve/edit/reject/
    // escalate); the shared recording metrics captured them.
    const decisions = metrics.approvalDecisions.map((entry) => entry.decision);

    expect(decisions).toEqual(
      expect.arrayContaining(["approved", "edited", "rejected", "escalated"]),
    );
    expect(
      metrics.approvalDecisions.every(
        (entry) => entry.latencyMs !== null && entry.latencyMs >= 0,
      ),
    ).toBe(true);
    expect(
      metrics.apiRequests.some(
        (request) =>
          request.route === "/v1/approvals/:approval_id/approve" &&
          request.statusCode === 200,
      ),
    ).toBe(true);
    expect(metrics.criticalFailures).toEqual([]);
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

  await db.insert(users).values([
    {
      userId: ids.reviewerUser,
      tenantId: ids.tenantA,
      email: `${fixturePrefix}.reviewer@example.test`,
      displayName: "Tenant A Reviewer",
    },
  ]);

  await db.insert(aiRuns).values([
    {
      aiRunId: ids.aiRunA,
      tenantId: ids.tenantA,
      ticketId: ids.ticketA,
      conversationId: ids.conversationA,
      runType: "full_graph",
      promptVersion: "support_graph.v1",
      modelProvider: "deterministic",
      modelId: "deterministic-support-model.v1",
      structuredOutput: {
        draft: { draft_text: "Tenant A AI draft." },
        final_recommendation: { automation_mode: "human_approve" },
      },
      confidence: 0.91,
      riskLevel: "low",
      automationRecommendation: "human_approve",
      status: "succeeded",
      latencyMs: 240,
      traceId: `${fixturePrefix}_trace_a`,
      completedAt: new Date("2026-06-19T00:00:01.000Z"),
    },
    {
      aiRunId: ids.aiRunB,
      tenantId: ids.tenantB,
      ticketId: ids.ticketB,
      conversationId: ids.conversationB,
      runType: "full_graph",
      promptVersion: "support_graph.v1",
      modelProvider: "deterministic",
      modelId: "deterministic-support-model.v1",
      status: "succeeded",
      traceId: `${fixturePrefix}_trace_b`,
      completedAt: new Date("2026-06-19T00:00:01.000Z"),
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
        draft: "Tenant A API approval draft.",
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
        draft: "Tenant B API approval draft.",
        risk_reasons: ["v1_default_human_approval"],
      },
    },
    ...[
      ids.approvalApprove,
      ids.approvalEdit,
      ids.approvalReject,
      ids.approvalEscalate,
    ].map((approvalId) => ({
      approvalId,
      tenantId: ids.tenantA,
      ticketId: ids.ticketA,
      approvalType: "reply" as const,
      status: "pending" as const,
      requestedPayload: {
        draft: "Tenant A API approval decision draft.",
        risk_reasons: ["v1_default_human_approval"],
      },
    })),
  ]);

  await db.insert(auditEvents).values([
    {
      auditEventId: ids.auditA,
      tenantId: ids.tenantA,
      actorType: "system",
      entityType: "ticket",
      entityId: ids.ticketA,
      action: "ticket.created",
      metadata: { status: "new" },
      correlationId: `${fixturePrefix}_corr_a`,
    },
    {
      auditEventId: ids.auditB,
      tenantId: ids.tenantB,
      actorType: "system",
      entityType: "ticket",
      entityId: ids.ticketB,
      action: "ticket.created",
      metadata: { status: "new" },
      correlationId: `${fixturePrefix}_corr_b`,
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

  await db.insert(kbDocuments).values([
    {
      kbDocumentId: ids.kbDocumentA,
      tenantId: ids.tenantA,
      title: "Tenant A Shipping FAQ",
      sourceType: "manual",
      documentType: "faq",
      status: "active",
      contentHash: `${fixturePrefix}_kb_hash_a`,
    },
    {
      kbDocumentId: ids.kbDocumentB,
      tenantId: ids.tenantB,
      title: "Tenant B Shipping FAQ",
      sourceType: "manual",
      documentType: "faq",
      status: "active",
      contentHash: `${fixturePrefix}_kb_hash_b`,
    },
  ]);
}

async function cleanupFixtures(client: PostgresClient) {
  await client`
    delete from audit_events
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from qa_reviews
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from approvals
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from ai_runs
    where tenant_id in (${ids.tenantA}, ${ids.tenantB})
  `;
  await client`
    delete from users
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
