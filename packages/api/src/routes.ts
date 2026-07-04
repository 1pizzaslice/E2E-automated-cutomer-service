import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AiRunListResponseSchema,
  AiRunResourceResponseSchema,
  AiRunStatusSchema,
  AiRunTypeSchema,
  ApprovalApproveRequestSchema,
  ApprovalDecisionResponseSchema,
  ApprovalEditRequestSchema,
  ApprovalEscalateRequestSchema,
  ApprovalListResponseSchema,
  ApprovalRejectRequestSchema,
  ApprovalResourceResponseSchema,
  ApprovalStatusSchema,
  ApprovalTypeSchema,
  AuditActorTypeSchema,
  AuditEventListResponseSchema,
  AuditEventResourceResponseSchema,
  ConversationListResponseSchema,
  ConversationResourceResponseSchema,
  ConversationStatusSchema,
  EffectiveAutomationPolicyResponseSchema,
  CustomerCreateRequestSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  CustomerUpdateRequestSchema,
  KbDocumentCreateRequestSchema,
  KbDocumentListResponseSchema,
  KbDocumentResourceResponseSchema,
  KbDocumentSourceTypeSchema,
  KbDocumentTypeSchema,
  KbDocumentUpdateRequestSchema,
  KbIngestionResultSchema,
  KbSearchRequestSchema,
  KbSearchResponseSchema,
  KbStatusSchema,
  MessageDirectionSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  QaReviewCompleteRequestSchema,
  QaReviewCreateRequestSchema,
  QaReviewEvidenceResponseSchema,
  QaReviewListResponseSchema,
  QaReviewResourceResponseSchema,
  TenantResourceResponseSchema,
  TenantPolicyDomainSchema,
  TenantPolicyStatusSchema,
  TenantCreateRequestSchema,
  TenantListResponseSchema,
  TenantUpdateRequestSchema,
  TicketCreateRequestSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  TicketStatusSchema,
  TicketUpdateRequestSchema,
  WeeklyPilotReportResponseSchema,
  createHealthResponse,
} from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import { buildOpenApiDocument } from "./openapi.js";
import {
  requireAuthenticatedRequestContext,
  requireTenantRequestContext,
} from "./request-context.js";
import { requirePermission } from "./rbac.js";
import type { ApiServices, ApprovalDecisionInput } from "./services.js";

const TenantParamsSchema = z.object({
  tenant_id: z.string().min(1),
});

const CustomerParamsSchema = z.object({
  customer_id: z.string().min(1),
});

const ConversationParamsSchema = z.object({
  conversation_id: z.string().min(1),
});

const MessageParamsSchema = z.object({
  conversation_id: z.string().min(1),
  message_id: z.string().min(1),
});

const PolicyParamsSchema = z.object({
  policy_id: z.string().min(1),
});

const KbDocumentParamsSchema = z.object({
  kb_document_id: z.string().min(1),
});

const ApprovalParamsSchema = z.object({
  approval_id: z.string().min(1),
});

const AuditEventParamsSchema = z.object({
  audit_event_id: z.string().min(1),
});

const AiRunParamsSchema = z.object({
  ai_run_id: z.string().min(1),
});

const QaReviewParamsSchema = z.object({
  qa_review_id: z.string().min(1),
});

const TicketParamsSchema = z.object({
  ticket_id: z.string().min(1),
});

const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const CustomerListQuerySchema = ListQuerySchema.extend({
  email: z.string().email().optional(),
  external_customer_ref: z.string().min(1).optional(),
});

const ConversationListQuerySchema = ListQuerySchema.extend({
  status: ConversationStatusSchema.optional(),
  customer_id: z.string().min(1).optional(),
  channel_id: z.string().min(1).optional(),
});

const MessageListQuerySchema = ListQuerySchema.extend({
  direction: MessageDirectionSchema.optional(),
  ticket_id: z.string().min(1).optional(),
});

const PolicyListQuerySchema = ListQuerySchema.extend({
  domain: TenantPolicyDomainSchema.optional(),
  status: TenantPolicyStatusSchema.optional(),
});

const WeeklyReportQuerySchema = z
  .object({
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
  })
  .strict();

const KbDocumentListQuerySchema = ListQuerySchema.extend({
  source_type: KbDocumentSourceTypeSchema.optional(),
  document_type: KbDocumentTypeSchema.optional(),
  status: KbStatusSchema.optional(),
});

const ApprovalListQuerySchema = ListQuerySchema.extend({
  status: ApprovalStatusSchema.optional(),
  ticket_id: z.string().min(1).optional(),
  approval_type: ApprovalTypeSchema.optional(),
});

const AuditEventListQuerySchema = ListQuerySchema.extend({
  actor_type: AuditActorTypeSchema.optional(),
  entity_type: z.string().min(1).optional(),
  entity_id: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  correlation_id: z.string().min(1).optional(),
});

const TicketAuditEventListQuerySchema = ListQuerySchema.extend({
  actor_type: AuditActorTypeSchema.optional(),
  action: z.string().min(1).optional(),
  correlation_id: z.string().min(1).optional(),
});

const TicketListQuerySchema = ListQuerySchema.extend({
  status: TicketStatusSchema.optional(),
  customer_id: z.string().min(1).optional(),
  assigned_queue: z.string().min(1).optional(),
});

const AiRunListQuerySchema = ListQuerySchema.extend({
  ticket_id: z.string().min(1).optional(),
  status: AiRunStatusSchema.optional(),
  run_type: AiRunTypeSchema.optional(),
});

const QaReviewListQuerySchema = ListQuerySchema.extend({
  ticket_id: z.string().min(1).optional(),
  ai_run_id: z.string().min(1).optional(),
  // z.coerce.boolean() would treat "false" as true, so parse explicitly.
  completed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export function registerRoutes(
  app: FastifyInstance,
  services: ApiServices,
): void {
  app.get("/health", async () => createHealthResponse("api"));
  app.get("/ready", async () => createHealthResponse("api"));
  app.get("/openapi.json", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "openapi:read");

    return buildOpenApiDocument();
  });

  app.get("/v1/tenants", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tenants:list");

    const query = parseQuery(ListQuerySchema, request);
    const tenants = await services.tenants.list(context, query);

    return TenantListResponseSchema.parse(tenants);
  });

  app.post("/v1/tenants", async (request, reply) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tenants:create");

    const input = parseBody(TenantCreateRequestSchema, request);
    const tenant = await services.tenants.create(context, input);

    reply.status(201);
    return TenantResourceResponseSchema.parse({ tenant });
  });

  app.get("/v1/tenants/:tenant_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tenants:read");

    const { tenant_id: tenantId } = parseParams(TenantParamsSchema, request);

    if (tenantId !== context.tenant.tenantId) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Tenant path does not match request tenant context.",
      );
    }

    const tenant = await services.tenants.getById(context, tenantId);

    if (!tenant) {
      throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    return TenantResourceResponseSchema.parse({ tenant });
  });

  app.patch("/v1/tenants/:tenant_id", async (request) => {
    const context = requireAuthenticatedRequestContext(request);

    requirePermission(context.actor, "tenants:update");

    const { tenant_id: tenantId } = parseParams(TenantParamsSchema, request);

    if (!isPlatformAdmin(context.actor.roles)) {
      const tenantContext = requireTenantRequestContext(request);

      if (tenantId !== tenantContext.tenant.tenantId) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Tenant path does not match request tenant context.",
        );
      }
    }

    const input = parseBody(TenantUpdateRequestSchema, request);
    const tenant = await services.tenants.update(context, tenantId, input);

    if (!tenant) {
      throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant was not found.");
    }

    return TenantResourceResponseSchema.parse({ tenant });
  });

  app.get("/v1/customers", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:read");

    const query = parseQuery(CustomerListQuerySchema, request);
    const customers = await services.customers.list(context, query);

    return CustomerListResponseSchema.parse(customers);
  });

  app.post("/v1/customers", async (request, reply) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:create");

    const input = parseBody(CustomerCreateRequestSchema, request);
    const customer = await services.customers.create(context, input);

    reply.status(201);
    return CustomerResourceResponseSchema.parse({ customer });
  });

  app.get("/v1/customers/:customer_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:read");

    const { customer_id: customerId } = parseParams(
      CustomerParamsSchema,
      request,
    );
    const customer = await services.customers.getById(context, customerId);

    if (!customer) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Customer was not found.");
    }

    return CustomerResourceResponseSchema.parse({ customer });
  });

  app.patch("/v1/customers/:customer_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "customers:update");

    const { customer_id: customerId } = parseParams(
      CustomerParamsSchema,
      request,
    );
    const input = parseBody(CustomerUpdateRequestSchema, request);
    const customer = await services.customers.update(
      context,
      customerId,
      input,
    );

    if (!customer) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Customer was not found.");
    }

    return CustomerResourceResponseSchema.parse({ customer });
  });

  app.get("/v1/conversations", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "conversations:read");

    const query = parseQuery(ConversationListQuerySchema, request);
    const conversations = await services.conversations.list(context, query);

    return ConversationListResponseSchema.parse(conversations);
  });

  app.get("/v1/conversations/:conversation_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "conversations:read");

    const { conversation_id: conversationId } = parseParams(
      ConversationParamsSchema,
      request,
    );
    const conversation = await services.conversations.getById(
      context,
      conversationId,
    );

    if (!conversation) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "Conversation was not found.",
      );
    }

    return ConversationResourceResponseSchema.parse({ conversation });
  });

  app.get("/v1/conversations/:conversation_id/messages", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "messages:read");

    const { conversation_id: conversationId } = parseParams(
      ConversationParamsSchema,
      request,
    );
    const query = parseQuery(MessageListQuerySchema, request);
    const messages = await services.messages.list(
      context,
      conversationId,
      query,
    );

    if (!messages) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "Conversation was not found.",
      );
    }

    return MessageListResponseSchema.parse(messages);
  });

  app.get(
    "/v1/conversations/:conversation_id/messages/:message_id",
    async (request) => {
      const context = requireTenantRequestContext(request);

      requirePermission(context.actor, "messages:read");

      const { conversation_id: conversationId, message_id: messageId } =
        parseParams(MessageParamsSchema, request);
      const message = await services.messages.getById(
        context,
        conversationId,
        messageId,
      );

      if (!message) {
        throw new HttpError(
          404,
          "RESOURCE_NOT_FOUND",
          "Message was not found.",
        );
      }

      return MessageResourceResponseSchema.parse({ message });
    },
  );

  app.get("/v1/policies", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "policies:read");

    const query = parseQuery(PolicyListQuerySchema, request);
    const policies = await services.policies.list(context, query);

    return PolicyListResponseSchema.parse(policies);
  });

  app.get("/v1/policies/automation", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "policies:read");

    const policy =
      await services.policies.getEffectiveAutomationPolicy(context);

    return EffectiveAutomationPolicyResponseSchema.parse(policy);
  });

  app.get("/v1/policies/:policy_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "policies:read");

    const { policy_id: policyId } = parseParams(PolicyParamsSchema, request);
    const policy = await services.policies.getById(context, policyId);

    if (!policy) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Policy was not found.");
    }

    return PolicyResourceResponseSchema.parse({ policy });
  });

  app.get("/v1/reports/pilot-weekly", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "reports:read");

    const query = parseQuery(WeeklyReportQuerySchema, request);
    const until = query.until ? new Date(query.until) : new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (since.getTime() >= until.getTime()) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "The report window start must be before its end.",
      );
    }

    const report = await services.reports.weekly(context, { since, until });

    return WeeklyPilotReportResponseSchema.parse({ report });
  });

  app.get("/v1/kb/documents", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "kb_documents:read");

    const query = parseQuery(KbDocumentListQuerySchema, request);
    const kbDocuments = await services.kbDocuments.list(context, query);

    return KbDocumentListResponseSchema.parse(kbDocuments);
  });

  app.post("/v1/kb/documents", async (request, reply) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "kb_documents:write");

    const input = parseBody(KbDocumentCreateRequestSchema, request);
    const kbDocument = await services.kbDocuments.create(context, input);

    reply.status(201);
    return KbDocumentResourceResponseSchema.parse({ kb_document: kbDocument });
  });

  app.get("/v1/kb/documents/:kb_document_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "kb_documents:read");

    const { kb_document_id: kbDocumentId } = parseParams(
      KbDocumentParamsSchema,
      request,
    );
    const kbDocument = await services.kbDocuments.getById(
      context,
      kbDocumentId,
    );

    if (!kbDocument) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "KB document was not found.",
      );
    }

    return KbDocumentResourceResponseSchema.parse({
      kb_document: kbDocument,
    });
  });

  app.patch("/v1/kb/documents/:kb_document_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "kb_documents:write");

    const { kb_document_id: kbDocumentId } = parseParams(
      KbDocumentParamsSchema,
      request,
    );
    const input = parseBody(KbDocumentUpdateRequestSchema, request);
    const kbDocument = await services.kbDocuments.update(
      context,
      kbDocumentId,
      input,
    );

    if (!kbDocument) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "KB document was not found.",
      );
    }

    return KbDocumentResourceResponseSchema.parse({
      kb_document: kbDocument,
    });
  });

  app.post("/v1/kb/documents/:kb_document_id/ingest", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "kb_documents:write");

    const { kb_document_id: kbDocumentId } = parseParams(
      KbDocumentParamsSchema,
      request,
    );
    const result = await services.kbDocuments.ingest(context, kbDocumentId);

    if (!result) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "KB document was not found.",
      );
    }

    return KbIngestionResultSchema.parse(result);
  });

  app.post("/v1/kb/search", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "kb:search");

    const input = parseBody(KbSearchRequestSchema, request);
    const results = await services.kbDocuments.search(context, input);

    return KbSearchResponseSchema.parse(results);
  });

  app.get("/v1/approvals", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "approvals:read");

    const query = parseQuery(ApprovalListQuerySchema, request);
    const approvals = await services.approvals.list(context, query);

    return ApprovalListResponseSchema.parse(approvals);
  });

  app.get("/v1/approvals/:approval_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "approvals:read");

    const { approval_id: approvalId } = parseParams(
      ApprovalParamsSchema,
      request,
    );
    const approval = await services.approvals.getById(context, approvalId);

    if (!approval) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Approval was not found.");
    }

    return ApprovalResourceResponseSchema.parse({ approval });
  });

  app.post("/v1/approvals/:approval_id/approve", async (request) =>
    handleApprovalDecision(services, request, () => {
      const input = parseOptionalBody(ApprovalApproveRequestSchema, request);

      return {
        status: "approved",
        review_notes: input.review_notes ?? null,
      };
    }),
  );

  app.post("/v1/approvals/:approval_id/edit", async (request) =>
    handleApprovalDecision(services, request, () => {
      const input = parseBody(ApprovalEditRequestSchema, request);

      return {
        status: "edited",
        approved_payload: input.approved_payload,
        review_notes: input.review_notes ?? null,
      };
    }),
  );

  app.post("/v1/approvals/:approval_id/reject", async (request) =>
    handleApprovalDecision(services, request, () => {
      const input = parseOptionalBody(ApprovalRejectRequestSchema, request);

      return {
        status: "rejected",
        review_notes: input.review_notes ?? null,
      };
    }),
  );

  app.post("/v1/approvals/:approval_id/escalate", async (request) =>
    handleApprovalDecision(services, request, () => {
      const input = parseOptionalBody(ApprovalEscalateRequestSchema, request);

      return {
        status: "escalated",
        review_notes: input.review_notes ?? null,
      };
    }),
  );

  app.get("/v1/ai-runs", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "ai_runs:read");

    const query = parseQuery(AiRunListQuerySchema, request);
    const aiRuns = await services.aiRuns.list(context, query);

    return AiRunListResponseSchema.parse(aiRuns);
  });

  app.get("/v1/ai-runs/:ai_run_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "ai_runs:read");

    const { ai_run_id: aiRunId } = parseParams(AiRunParamsSchema, request);
    const aiRun = await services.aiRuns.getById(context, aiRunId);

    if (!aiRun) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "AI run was not found.");
    }

    return AiRunResourceResponseSchema.parse({ ai_run: aiRun });
  });

  app.get("/v1/qa-reviews", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "qa_reviews:read");

    const query = parseQuery(QaReviewListQuerySchema, request);
    const qaReviews = await services.qaReviews.list(context, query);

    return QaReviewListResponseSchema.parse(qaReviews);
  });

  app.post("/v1/qa-reviews", async (request, reply) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "qa_reviews:write");

    const input = parseBody(QaReviewCreateRequestSchema, request);
    const result = await services.qaReviews.create(context, input);

    if (result.outcome === "ticket_not_found") {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Ticket was not found.");
    }

    if (result.outcome === "ai_run_not_found") {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "AI run was not found.");
    }

    reply.status(201);
    return QaReviewResourceResponseSchema.parse({ qa_review: result.review });
  });

  app.get("/v1/qa-reviews/:qa_review_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "qa_reviews:read");

    const { qa_review_id: qaReviewId } = parseParams(
      QaReviewParamsSchema,
      request,
    );
    const qaReview = await services.qaReviews.getById(context, qaReviewId);

    if (!qaReview) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "QA review was not found.",
      );
    }

    return QaReviewResourceResponseSchema.parse({ qa_review: qaReview });
  });

  app.post("/v1/qa-reviews/:qa_review_id/complete", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "qa_reviews:write");

    const { qa_review_id: qaReviewId } = parseParams(
      QaReviewParamsSchema,
      request,
    );
    const input = parseBody(QaReviewCompleteRequestSchema, request);
    const result = await services.qaReviews.complete(
      context,
      qaReviewId,
      input,
    );

    if (result.outcome === "not_found") {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "QA review was not found.",
      );
    }

    if (result.outcome === "conflict") {
      throw new HttpError(
        409,
        "CONFLICT",
        "QA review has already been completed.",
      );
    }

    return QaReviewResourceResponseSchema.parse({ qa_review: result.review });
  });

  app.get("/v1/qa-reviews/:qa_review_id/evidence", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "qa_reviews:read");

    const { qa_review_id: qaReviewId } = parseParams(
      QaReviewParamsSchema,
      request,
    );
    const evidence = await services.qaReviews.evidence(context, qaReviewId);

    if (!evidence) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "QA review was not found.",
      );
    }

    return QaReviewEvidenceResponseSchema.parse(evidence);
  });

  app.get("/v1/audit-events", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "audit_events:read");

    const query = parseQuery(AuditEventListQuerySchema, request);
    const auditEvents = await services.auditEvents.list(context, query);

    return AuditEventListResponseSchema.parse(auditEvents);
  });

  app.get("/v1/audit-events/:audit_event_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "audit_events:read");

    const { audit_event_id: auditEventId } = parseParams(
      AuditEventParamsSchema,
      request,
    );
    const auditEvent = await services.auditEvents.getById(
      context,
      auditEventId,
    );

    if (!auditEvent) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "Audit event was not found.",
      );
    }

    return AuditEventResourceResponseSchema.parse({
      audit_event: auditEvent,
    });
  });

  app.get("/v1/tickets", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:read");

    const query = parseQuery(TicketListQuerySchema, request);
    const tickets = await services.tickets.list(context, query);

    return TicketListResponseSchema.parse(tickets);
  });

  app.post("/v1/tickets", async (request, reply) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:create");

    const input = parseBody(TicketCreateRequestSchema, request);
    const ticket = await services.tickets.create(context, input);

    if (!ticket) {
      throw new HttpError(
        404,
        "RESOURCE_NOT_FOUND",
        "Related customer or conversation was not found for this tenant.",
      );
    }

    reply.status(201);
    return TicketResourceResponseSchema.parse({ ticket });
  });

  app.get("/v1/tickets/:ticket_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:read");

    const { ticket_id: ticketId } = parseParams(TicketParamsSchema, request);
    const ticket = await services.tickets.getById(context, ticketId);

    if (!ticket) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Ticket was not found.");
    }

    return TicketResourceResponseSchema.parse({ ticket });
  });

  app.get("/v1/tickets/:ticket_id/audit-events", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "audit_events:read");

    const { ticket_id: ticketId } = parseParams(TicketParamsSchema, request);
    const query = parseQuery(TicketAuditEventListQuerySchema, request);
    const auditEvents = await services.auditEvents.listForTicket(
      context,
      ticketId,
      query,
    );

    if (!auditEvents) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Ticket was not found.");
    }

    return AuditEventListResponseSchema.parse(auditEvents);
  });

  app.patch("/v1/tickets/:ticket_id", async (request) => {
    const context = requireTenantRequestContext(request);

    requirePermission(context.actor, "tickets:update");

    const { ticket_id: ticketId } = parseParams(TicketParamsSchema, request);
    const input = parseBody(TicketUpdateRequestSchema, request);
    const ticket = await services.tickets.update(context, ticketId, input);

    if (!ticket) {
      throw new HttpError(404, "RESOURCE_NOT_FOUND", "Ticket was not found.");
    }

    return TicketResourceResponseSchema.parse({ ticket });
  });
}

function parseParams<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.params);

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request parameters are invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

function parseQuery<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.query);

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request query is invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

function parseBody<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.body);

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request body is invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

/** Like {@link parseBody}, but treats an absent request body as `{}`. */
function parseOptionalBody<T extends z.ZodType>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const parsed = schema.safeParse(request.body ?? {});

  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request body is invalid.",
      parsed.error.issues,
    );
  }

  return parsed.data;
}

/**
 * Shared approve/edit/reject/escalate handling: authorize, resolve the pending
 * approval through the service (which persists the decision, appends the audit
 * event, and signals the waiting Temporal workflow), and map the not-found and
 * already-resolved outcomes onto the structured API errors.
 */
async function handleApprovalDecision(
  services: ApiServices,
  request: FastifyRequest,
  buildDecision: () => ApprovalDecisionInput,
) {
  const context = requireTenantRequestContext(request);

  requirePermission(context.actor, "approvals:review");

  const { approval_id: approvalId } = parseParams(
    ApprovalParamsSchema,
    request,
  );
  const decision = buildDecision();
  const result = await services.approvals.decide(context, approvalId, decision);

  if (result.outcome === "not_found") {
    throw new HttpError(404, "RESOURCE_NOT_FOUND", "Approval was not found.");
  }

  if (result.outcome === "conflict") {
    throw new HttpError(409, "CONFLICT", "Approval has already been resolved.");
  }

  return ApprovalDecisionResponseSchema.parse(result.decision);
}

function isPlatformAdmin(roles: readonly string[]): boolean {
  return roles.includes("platform_admin");
}
