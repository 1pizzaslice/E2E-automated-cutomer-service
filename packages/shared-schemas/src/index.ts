import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.unknown());
const JsonArraySchema = z.array(JsonObjectSchema);
const OptionalNullableStringSchema = z.string().min(1).nullable().optional();

function hasDefinedValue(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => item !== undefined);
}

export const ServiceNameSchema = z.enum([
  "api",
  "workers",
  "ai-runtime",
  "db",
  "integrations",
]);

export const HealthStatusSchema = z.enum(["ok", "degraded", "down"]);

export const HealthResponseSchema = z.object({
  service: ServiceNameSchema,
  status: HealthStatusSchema,
  timestamp: z.string().datetime(),
  version: z.string(),
});

export type ServiceName = z.infer<typeof ServiceNameSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createHealthResponse(
  service: ServiceName,
  status: HealthStatus = "ok",
  version = "0.1.0",
): HealthResponse {
  return HealthResponseSchema.parse({
    service,
    status,
    timestamp: new Date().toISOString(),
    version,
  });
}

export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "TENANT_CONTEXT_REQUIRED",
  "TENANT_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "WORKFLOW_ERROR",
  "AI_RUNTIME_ERROR",
  "TOOL_EXECUTION_ERROR",
  "INTERNAL_ERROR",
]);

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    details: z.array(z.unknown()).default([]),
    request_id: z.string().min(1),
  }),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const RoleNameSchema = z.enum([
  "platform_admin",
  "ops_admin",
  "support_agent",
  "qa_reviewer",
  "client_viewer",
  "integration_admin",
]);

export type RoleName = z.infer<typeof RoleNameSchema>;

export const DomainEventNameSchema = z.enum([
  "support.message.received.v1",
  "support.conversation.updated.v1",
  "support.ticket.created.v1",
  "support.ticket.triaged.v1",
  "support.ticket.priority_changed.v1",
  "support.ticket.assignment_changed.v1",
  "support.ticket.sla_breached.v1",
  "support.ai_run.started.v1",
  "support.ai_run.completed.v1",
  "support.tool_call.completed.v1",
  "support.approval.requested.v1",
  "support.approval.completed.v1",
  "support.message.sent.v1",
  "support.ticket.resolved.v1",
  "support.ticket.closed.v1",
  "support.qa.review_created.v1",
]);

export const DomainEventSchemaVersionSchema = z.literal("1");

export const DomainEventActorTypeSchema = z.enum([
  "system",
  "ai",
  "human",
  "integration",
]);

export const DomainEventSubjectTenantIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, {
    message:
      "Event tenant IDs used in NATS subjects may only contain letters, numbers, underscores, and hyphens.",
  });

export const DomainEventEnvelopeSchema = z
  .object({
    event_id: z.string().min(1),
    event_name: DomainEventNameSchema,
    schema_version: DomainEventSchemaVersionSchema,
    tenant_id: DomainEventSubjectTenantIdSchema,
    correlation_id: z.string().min(1),
    causation_id: z.string().min(1),
    occurred_at: z.string().datetime(),
    actor: z
      .object({
        type: DomainEventActorTypeSchema,
        id: z.string().min(1).nullable(),
      })
      .strict(),
    payload: JsonObjectSchema,
  })
  .strict();

export type DomainEventName = z.infer<typeof DomainEventNameSchema>;
export type DomainEventSchemaVersion = z.infer<
  typeof DomainEventSchemaVersionSchema
>;
export type DomainEventActorType = z.infer<typeof DomainEventActorTypeSchema>;
export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;

export function buildDomainEventSubject(
  event: Pick<DomainEventEnvelope, "event_name" | "tenant_id">,
): string {
  const tenantId = DomainEventSubjectTenantIdSchema.parse(event.tenant_id);
  const eventName = DomainEventNameSchema.parse(event.event_name);
  const eventNameWithoutNamespace = eventName.replace(/^support\./, "");

  return `support.events.tenant.${tenantId}.${eventNameWithoutNamespace}`;
}

export const TenantResponseSchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "suspended", "archived"]),
  default_timezone: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const TenantResourceResponseSchema = z.object({
  tenant: TenantResponseSchema,
});

export const ListResponsePageSchema = z.object({
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const TenantListResponseSchema = z.object({
  tenants: z.array(TenantResponseSchema),
  page: ListResponsePageSchema,
});

export const TenantCreateRequestSchema = z
  .object({
    tenant_id: z.string().min(1).optional(),
    name: z.string().min(1),
    status: z.enum(["active", "suspended", "archived"]).optional(),
    default_timezone: z.string().min(1).optional(),
  })
  .strict();

export const TenantUpdateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(["active", "suspended", "archived"]).optional(),
    default_timezone: z.string().min(1).optional(),
  })
  .strict()
  .refine(hasDefinedValue, {
    message: "At least one tenant field must be provided.",
  });

export type TenantResponse = z.infer<typeof TenantResponseSchema>;
export type TenantResourceResponse = z.infer<
  typeof TenantResourceResponseSchema
>;
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;
export type TenantCreateRequest = z.infer<typeof TenantCreateRequestSchema>;
export type TenantUpdateRequest = z.infer<typeof TenantUpdateRequestSchema>;

export const CustomerResponseSchema = z.object({
  customer_id: z.string().min(1),
  tenant_id: z.string().min(1),
  display_name: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  external_customer_ref: z.string().nullable(),
  metadata: JsonObjectSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CustomerResourceResponseSchema = z.object({
  customer: CustomerResponseSchema,
});

export const CustomerListResponseSchema = z.object({
  customers: z.array(CustomerResponseSchema),
  page: ListResponsePageSchema,
});

export const CustomerCreateRequestSchema = z
  .object({
    customer_id: z.string().min(1).optional(),
    display_name: OptionalNullableStringSchema,
    email: z.string().email().nullable().optional(),
    phone: OptionalNullableStringSchema,
    external_customer_ref: OptionalNullableStringSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export const CustomerUpdateRequestSchema = z
  .object({
    display_name: OptionalNullableStringSchema,
    email: z.string().email().nullable().optional(),
    phone: OptionalNullableStringSchema,
    external_customer_ref: OptionalNullableStringSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .refine(hasDefinedValue, {
    message: "At least one customer field must be provided.",
  });

export type CustomerResponse = z.infer<typeof CustomerResponseSchema>;
export type CustomerResourceResponse = z.infer<
  typeof CustomerResourceResponseSchema
>;
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;
export type CustomerCreateRequest = z.infer<typeof CustomerCreateRequestSchema>;
export type CustomerUpdateRequest = z.infer<typeof CustomerUpdateRequestSchema>;

export const ConversationStatusSchema = z.enum(["open", "archived"]);

export const ConversationResponseSchema = z.object({
  conversation_id: z.string().min(1),
  tenant_id: z.string().min(1),
  customer_id: z.string().min(1),
  channel_id: z.string().min(1),
  external_thread_id: z.string().nullable(),
  status: ConversationStatusSchema,
  last_message_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ConversationResourceResponseSchema = z.object({
  conversation: ConversationResponseSchema,
});

export const ConversationListResponseSchema = z.object({
  conversations: z.array(ConversationResponseSchema),
  page: ListResponsePageSchema,
});

export const MessageDirectionSchema = z.enum([
  "inbound",
  "outbound",
  "internal_note",
  "system",
]);

export const MessageCreatorTypeSchema = z.enum([
  "customer",
  "human",
  "ai",
  "system",
  "integration",
]);

export const MessageResponseSchema = z.object({
  message_id: z.string().min(1),
  tenant_id: z.string().min(1),
  conversation_id: z.string().min(1),
  ticket_id: z.string().nullable(),
  channel_id: z.string().min(1),
  direction: MessageDirectionSchema,
  body_text: z.string().nullable(),
  body_html_ref: z.string().nullable(),
  attachments: JsonArraySchema,
  external_message_id: z.string().nullable(),
  external_thread_id: z.string().nullable(),
  raw_payload_ref: z.string().nullable(),
  created_by_type: MessageCreatorTypeSchema,
  created_by_user_id: z.string().nullable(),
  provider_message_id: z.string().nullable(),
  send_status: z.string().nullable(),
  sent_by_type: z.string().nullable(),
  ai_run_id: z.string().nullable(),
  approval_id: z.string().nullable(),
  sent_at: z.string().datetime().nullable(),
  idempotency_key: z.string().nullable(),
  created_at: z.string().datetime(),
});

export const MessageResourceResponseSchema = z.object({
  message: MessageResponseSchema,
});

export const MessageListResponseSchema = z.object({
  messages: z.array(MessageResponseSchema),
  page: ListResponsePageSchema,
});

export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
export type ConversationResourceResponse = z.infer<
  typeof ConversationResourceResponseSchema
>;
export type ConversationListResponse = z.infer<
  typeof ConversationListResponseSchema
>;
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;
export type MessageCreatorType = z.infer<typeof MessageCreatorTypeSchema>;
export type MessageResponse = z.infer<typeof MessageResponseSchema>;
export type MessageResourceResponse = z.infer<
  typeof MessageResourceResponseSchema
>;
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;

export const TenantPolicyDomainSchema = z.enum([
  "refunds",
  "cancellations",
  "shipping",
  "faq",
  "routing",
  "tone",
  "escalation",
  "automation",
]);

export const TenantPolicyStatusSchema = z.enum(["draft", "active", "archived"]);

export const PolicyResponseSchema = z.object({
  policy_id: z.string().min(1),
  tenant_id: z.string().min(1),
  name: z.string().min(1),
  domain: TenantPolicyDomainSchema,
  status: TenantPolicyStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const PolicyResourceResponseSchema = z.object({
  policy: PolicyResponseSchema,
});

export const PolicyListResponseSchema = z.object({
  policies: z.array(PolicyResponseSchema),
  page: ListResponsePageSchema,
});

export type TenantPolicyDomain = z.infer<typeof TenantPolicyDomainSchema>;
export type TenantPolicyStatus = z.infer<typeof TenantPolicyStatusSchema>;
export type PolicyResponse = z.infer<typeof PolicyResponseSchema>;
export type PolicyResourceResponse = z.infer<
  typeof PolicyResourceResponseSchema
>;
export type PolicyListResponse = z.infer<typeof PolicyListResponseSchema>;

export const KbDocumentSourceTypeSchema = z.enum([
  "manual",
  "upload",
  "url",
  "integration",
]);

export const KbDocumentTypeSchema = z.enum([
  "faq",
  "policy",
  "macro",
  "product_doc",
  "sop",
]);

export const KbStatusSchema = z.enum(["draft", "active", "stale", "archived"]);

export const KbDocumentResponseSchema = z.object({
  kb_document_id: z.string().min(1),
  tenant_id: z.string().min(1),
  title: z.string().min(1),
  source_type: KbDocumentSourceTypeSchema,
  source_ref: z.string().nullable(),
  document_type: KbDocumentTypeSchema,
  status: KbStatusSchema,
  version: z.number().int().positive(),
  content_hash: z.string().min(1),
  created_by_user_id: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const KbDocumentResourceResponseSchema = z.object({
  kb_document: KbDocumentResponseSchema,
});

export const KbDocumentListResponseSchema = z.object({
  kb_documents: z.array(KbDocumentResponseSchema),
  page: ListResponsePageSchema,
});

export type KbDocumentSourceType = z.infer<typeof KbDocumentSourceTypeSchema>;
export type KbDocumentType = z.infer<typeof KbDocumentTypeSchema>;
export type KbStatus = z.infer<typeof KbStatusSchema>;
export type KbDocumentResponse = z.infer<typeof KbDocumentResponseSchema>;
export type KbDocumentResourceResponse = z.infer<
  typeof KbDocumentResourceResponseSchema
>;
export type KbDocumentListResponse = z.infer<
  typeof KbDocumentListResponseSchema
>;

export const ApprovalTypeSchema = z.enum([
  "reply",
  "tool_action",
  "escalation",
  "policy_exception",
]);

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "edited",
  "rejected",
  "escalated",
  "expired",
]);

export const ApprovalResponseSchema = z.object({
  approval_id: z.string().min(1),
  tenant_id: z.string().min(1),
  ticket_id: z.string().min(1),
  ai_run_id: z.string().nullable(),
  approval_type: ApprovalTypeSchema,
  status: ApprovalStatusSchema,
  requested_payload: JsonObjectSchema,
  approved_payload: JsonObjectSchema.nullable(),
  reviewer_user_id: z.string().nullable(),
  review_notes: z.string().nullable(),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable(),
});

export const ApprovalResourceResponseSchema = z.object({
  approval: ApprovalResponseSchema,
});

export const ApprovalListResponseSchema = z.object({
  approvals: z.array(ApprovalResponseSchema),
  page: ListResponsePageSchema,
});

export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;
export type ApprovalResourceResponse = z.infer<
  typeof ApprovalResourceResponseSchema
>;
export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>;

export const AuditActorTypeSchema = z.enum([
  "system",
  "ai",
  "human",
  "integration",
]);

export const AuditEventResponseSchema = z.object({
  audit_event_id: z.string().min(1),
  tenant_id: z.string().min(1),
  actor_type: AuditActorTypeSchema,
  actor_id: z.string().nullable(),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  action: z.string().min(1),
  metadata: JsonObjectSchema,
  correlation_id: z.string().nullable(),
  created_at: z.string().datetime(),
});

export const AuditEventResourceResponseSchema = z.object({
  audit_event: AuditEventResponseSchema,
});

export const AuditEventListResponseSchema = z.object({
  audit_events: z.array(AuditEventResponseSchema),
  page: ListResponsePageSchema,
});

export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;
export type AuditEventResponse = z.infer<typeof AuditEventResponseSchema>;
export type AuditEventResourceResponse = z.infer<
  typeof AuditEventResourceResponseSchema
>;
export type AuditEventListResponse = z.infer<
  typeof AuditEventListResponseSchema
>;

export const TicketStatusSchema = z.enum([
  "new",
  "triaged",
  "waiting_ai",
  "waiting_human",
  "waiting_customer",
  "resolved",
  "closed",
  "reopened",
  "failed",
]);

export const TicketPrioritySchema = z.enum(["p0", "p1", "p2", "p3"]);

export const AutomationModeSchema = z.enum([
  "auto_send",
  "human_approve",
  "human_only",
]);

export const TicketResponseSchema = z.object({
  ticket_id: z.string().min(1),
  tenant_id: z.string().min(1),
  conversation_id: z.string().min(1),
  customer_id: z.string().min(1),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  topic: z.string().nullable(),
  subtopic: z.string().nullable(),
  language: z.string().nullable(),
  sentiment: z.string().nullable(),
  urgency_score: z.number().int().nullable(),
  automation_mode: AutomationModeSchema,
  assigned_queue: z.string().nullable(),
  assigned_user_id: z.string().nullable(),
  sla_policy_id: z.string().nullable(),
  policy_version_id: z.string().nullable(),
  opened_at: z.string().datetime(),
  first_response_due_at: z.string().datetime().nullable(),
  next_response_due_at: z.string().datetime().nullable(),
  resolution_due_at: z.string().datetime().nullable(),
  resolved_at: z.string().datetime().nullable(),
  closed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const TicketResourceResponseSchema = z.object({
  ticket: TicketResponseSchema,
});

export const TicketListResponseSchema = z.object({
  tickets: z.array(TicketResponseSchema),
  page: ListResponsePageSchema,
});

export const TicketCreateRequestSchema = z
  .object({
    ticket_id: z.string().min(1).optional(),
    conversation_id: z.string().min(1),
    customer_id: z.string().min(1),
    priority: TicketPrioritySchema.optional(),
    topic: OptionalNullableStringSchema,
    subtopic: OptionalNullableStringSchema,
    language: OptionalNullableStringSchema,
    sentiment: OptionalNullableStringSchema,
    urgency_score: z.number().int().nullable().optional(),
    automation_mode: AutomationModeSchema.optional(),
    assigned_queue: OptionalNullableStringSchema,
    assigned_user_id: OptionalNullableStringSchema,
    sla_policy_id: OptionalNullableStringSchema,
    policy_version_id: OptionalNullableStringSchema,
    opened_at: z.string().datetime().optional(),
    first_response_due_at: z.string().datetime().nullable().optional(),
    next_response_due_at: z.string().datetime().nullable().optional(),
    resolution_due_at: z.string().datetime().nullable().optional(),
  })
  .strict();

export const TicketUpdateRequestSchema = z
  .object({
    priority: TicketPrioritySchema.optional(),
    topic: OptionalNullableStringSchema,
    subtopic: OptionalNullableStringSchema,
    language: OptionalNullableStringSchema,
    sentiment: OptionalNullableStringSchema,
    urgency_score: z.number().int().nullable().optional(),
    automation_mode: AutomationModeSchema.optional(),
    assigned_queue: OptionalNullableStringSchema,
    assigned_user_id: OptionalNullableStringSchema,
    sla_policy_id: OptionalNullableStringSchema,
    policy_version_id: OptionalNullableStringSchema,
    first_response_due_at: z.string().datetime().nullable().optional(),
    next_response_due_at: z.string().datetime().nullable().optional(),
    resolution_due_at: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine(hasDefinedValue, {
    message: "At least one ticket field must be provided.",
  });

export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;
export type AutomationMode = z.infer<typeof AutomationModeSchema>;
export type TicketResponse = z.infer<typeof TicketResponseSchema>;
export type TicketResourceResponse = z.infer<
  typeof TicketResourceResponseSchema
>;
export type TicketListResponse = z.infer<typeof TicketListResponseSchema>;
export type TicketCreateRequest = z.infer<typeof TicketCreateRequestSchema>;
export type TicketUpdateRequest = z.infer<typeof TicketUpdateRequestSchema>;
