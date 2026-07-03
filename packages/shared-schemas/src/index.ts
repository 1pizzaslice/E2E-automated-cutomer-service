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

export const DomainEventActorSchema = z
  .object({
    type: DomainEventActorTypeSchema,
    id: z.string().min(1).nullable(),
  })
  .strict();

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
    actor: DomainEventActorSchema,
    payload: JsonObjectSchema,
  })
  .strict()
  .superRefine((event, ctx) => {
    const payloadSchema = getDomainEventPayloadSchema(event.event_name);
    const parsedPayload = payloadSchema.safeParse(event.payload);

    if (!parsedPayload.success) {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: `Invalid payload for ${event.event_name}: ${parsedPayload.error.message}`,
      });
    }
  });

export const SupportEventErrorKindSchema = z.enum([
  "invalid_envelope",
  "handler_failed",
]);

export const SupportEventErrorRecordSchema = z
  .object({
    error_id: z.string().min(1),
    error_kind: SupportEventErrorKindSchema,
    consumer_name: z.string().min(1),
    stream_name: z.string().min(1),
    original_subject: z.string().min(1),
    original_sequence: z.number().int().nonnegative(),
    event_id: z.string().min(1).nullable(),
    event_name: DomainEventNameSchema.nullable(),
    tenant_id: DomainEventSubjectTenantIdSchema.nullable(),
    correlation_id: z.string().min(1).nullable(),
    causation_id: z.string().min(1).nullable(),
    occurred_at: z.string().datetime(),
    redelivered: z.boolean(),
    delivery_count: z.number().int().positive().nullable(),
    will_retry: z.boolean(),
    error_name: z.string().min(1).nullable(),
    error_message: z.string().min(1),
  })
  .strict();

export type DomainEventName = z.infer<typeof DomainEventNameSchema>;
export type DomainEventSchemaVersion = z.infer<
  typeof DomainEventSchemaVersionSchema
>;
export type DomainEventActorType = z.infer<typeof DomainEventActorTypeSchema>;
export type DomainEventActor = z.infer<typeof DomainEventActorSchema>;
export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;
export type SupportEventErrorKind = z.infer<typeof SupportEventErrorKindSchema>;
export type SupportEventErrorRecord = z.infer<
  typeof SupportEventErrorRecordSchema
>;

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

export const ChannelTypeSchema = z.enum(["email", "whatsapp", "chat_future"]);

export const NormalizedInboundChannelSchema = z.enum(["email", "whatsapp"]);

export const CustomerIdentityTypeSchema = z.enum([
  "email",
  "phone",
  "whatsapp_id",
  "external_user_id",
]);

export const NormalizedInboundCustomerIdentitySchema = z
  .object({
    type: CustomerIdentityTypeSchema,
    value: z.string().min(1),
    display_name: OptionalNullableStringSchema,
  })
  .strict();

export const NormalizedInboundBodySchema = z
  .object({
    text: z.string().nullable(),
    html: z.string().nullable(),
  })
  .strict();

export const NormalizedInboundAttachmentSchema = z
  .object({
    filename: z.string().min(1),
    content_type: z.string().min(1),
    // `size_bytes` is null when the provider does not report a size at intake
    // (for example WhatsApp media that is resolved on later download).
    size_bytes: z.number().int().nonnegative().nullable(),
    object_ref: z.string().min(1),
  })
  .strict();

export const NormalizedInboundMessageSchema = z
  .object({
    tenant_id: z.string().min(1),
    channel_id: z.string().min(1),
    channel: NormalizedInboundChannelSchema,
    provider: z.string().min(1),
    external_thread_id: z.string().min(1).nullable(),
    external_message_id: z.string().min(1),
    customer_identity: NormalizedInboundCustomerIdentitySchema,
    direction: z.literal("inbound"),
    body: NormalizedInboundBodySchema,
    attachments: z.array(NormalizedInboundAttachmentSchema),
    raw_payload_ref: z.string().min(1),
    received_at: z.string().datetime(),
    idempotency_key: z.string().min(1),
  })
  .strict()
  .refine(
    (message) =>
      message.body.text !== null ||
      message.body.html !== null ||
      message.attachments.length > 0,
    {
      message:
        "Inbound message must include body text, body html, or at least one attachment.",
    },
  );

export type ChannelType = z.infer<typeof ChannelTypeSchema>;
export type NormalizedInboundChannel = z.infer<
  typeof NormalizedInboundChannelSchema
>;
export type CustomerIdentityType = z.infer<typeof CustomerIdentityTypeSchema>;
export type NormalizedInboundCustomerIdentity = z.infer<
  typeof NormalizedInboundCustomerIdentitySchema
>;
export type NormalizedInboundBody = z.infer<typeof NormalizedInboundBodySchema>;
export type NormalizedInboundAttachment = z.infer<
  typeof NormalizedInboundAttachmentSchema
>;
export type NormalizedInboundMessage = z.infer<
  typeof NormalizedInboundMessageSchema
>;

export const InboundWebhookMessageResultSchema = z
  .object({
    external_message_id: z.string(),
    message_id: z.string(),
    conversation_id: z.string(),
    ticket_id: z.string(),
    deduplicated: z.boolean(),
    workflow_id: z.string().nullable(),
  })
  .strict();

export const InboundWebhookAcceptedResponseSchema = z
  .object({
    channel_id: z.string().min(1),
    provider: z.string().min(1),
    received: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    deduplicated: z.number().int().nonnegative(),
    results: z.array(InboundWebhookMessageResultSchema),
  })
  .strict();

export type InboundWebhookMessageResult = z.infer<
  typeof InboundWebhookMessageResultSchema
>;
export type InboundWebhookAcceptedResponse = z.infer<
  typeof InboundWebhookAcceptedResponseSchema
>;

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

/**
 * Request to create a KB document. The raw `content` is stored by reference in
 * the KB content store (never inline in PostgreSQL) and chunked/embedded by the
 * ingestion pipeline; `content_hash` is derived server-side from it. A created
 * document starts in `draft` status and only becomes `active` after ingestion.
 */
export const KbDocumentCreateRequestSchema = z
  .object({
    kb_document_id: z.string().min(1).optional(),
    title: z.string().min(1),
    source_type: KbDocumentSourceTypeSchema,
    source_ref: OptionalNullableStringSchema,
    document_type: KbDocumentTypeSchema,
    content: z.string().min(1),
  })
  .strict();

/**
 * Partial update of KB document metadata and lifecycle status. Content is
 * immutable through PATCH in v1 (re-upload by creating a new document); status
 * transitions here drive stale/active handling for retrieval.
 */
export const KbDocumentUpdateRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    source_ref: OptionalNullableStringSchema,
    document_type: KbDocumentTypeSchema.optional(),
    status: KbStatusSchema.optional(),
  })
  .strict()
  .refine(hasDefinedValue, {
    message: "At least one KB document field must be provided.",
  });

/**
 * A single retrievable KB chunk. Embeddings are intentionally omitted from the
 * contract: they are an internal retrieval index detail, never returned to API
 * clients or exposed to the AI runtime as raw vectors.
 */
export const KbChunkResponseSchema = z.object({
  kb_chunk_id: z.string().min(1),
  tenant_id: z.string().min(1),
  kb_document_id: z.string().min(1),
  chunk_index: z.number().int().nonnegative(),
  content: z.string().min(1),
  status: KbStatusSchema,
  metadata: JsonObjectSchema,
  created_at: z.string().datetime(),
});

/**
 * Result of running the ingestion pipeline for a KB document: how many chunks
 * were produced and embedded, plus the document's resulting active status.
 */
export const KbIngestionResultSchema = z.object({
  kb_document_id: z.string().min(1),
  status: KbStatusSchema,
  version: z.number().int().positive(),
  content_hash: z.string().min(1),
  chunk_count: z.number().int().nonnegative(),
  embedded_count: z.number().int().nonnegative(),
});

export type KbDocumentCreateRequest = z.infer<
  typeof KbDocumentCreateRequestSchema
>;
export type KbDocumentUpdateRequest = z.infer<
  typeof KbDocumentUpdateRequestSchema
>;
export type KbChunkResponse = z.infer<typeof KbChunkResponseSchema>;
export type KbIngestionResult = z.infer<typeof KbIngestionResultSchema>;

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

export const MessageReceivedEventPayloadSchema = z
  .object({
    message_id: z.string().min(1),
    conversation_id: z.string().min(1),
    ticket_id: z.string().min(1).nullable(),
    channel_id: z.string().min(1),
    direction: z.literal("inbound"),
    external_message_id: z.string().min(1).nullable(),
    external_thread_id: z.string().min(1).nullable(),
    idempotency_key: z.string().min(1).nullable(),
    received_at: z.string().datetime(),
  })
  .strict();

export const ConversationUpdatedEventPayloadSchema = z
  .object({
    conversation_id: z.string().min(1),
    status: ConversationStatusSchema,
    last_message_at: z.string().datetime().nullable(),
    metadata: JsonObjectSchema,
  })
  .strict();

export const TicketCreatedEventPayloadSchema = z
  .object({
    ticket_id: z.string().min(1),
    conversation_id: z.string().min(1),
    customer_id: z.string().min(1),
    status: z.literal("new"),
    priority: TicketPrioritySchema,
    automation_mode: AutomationModeSchema,
    assigned_queue: z.string().min(1).nullable(),
    assigned_user_id: z.string().min(1).nullable(),
    opened_at: z.string().datetime(),
  })
  .strict();

export const TicketStateTransitionEventNameSchema = z.enum([
  "support.ticket.triaged.v1",
  "support.ticket.resolved.v1",
  "support.ticket.closed.v1",
]);

export const TicketStateTransitionEventPayloadSchema = z
  .object({
    ticket_id: z.string().min(1),
    from_status: TicketStatusSchema,
    to_status: TicketStatusSchema,
    reason_code: z.string().min(1).nullable(),
    metadata: JsonObjectSchema,
  })
  .strict();

export const TicketPriorityChangedEventPayloadSchema = z
  .object({
    ticket_id: z.string().min(1),
    previous_priority: TicketPrioritySchema,
    new_priority: TicketPrioritySchema,
    reason_code: z.string().min(1).nullable(),
    metadata: JsonObjectSchema,
  })
  .strict();

export const TicketAssignmentChangedEventPayloadSchema = z
  .object({
    ticket_id: z.string().min(1),
    previous_assigned_queue: z.string().min(1).nullable(),
    new_assigned_queue: z.string().min(1).nullable(),
    previous_assigned_user_id: z.string().min(1).nullable(),
    new_assigned_user_id: z.string().min(1).nullable(),
    reason_code: z.string().min(1).nullable(),
    metadata: JsonObjectSchema,
  })
  .strict();

export const TicketSlaBreachedEventPayloadSchema = z
  .object({
    ticket_id: z.string().min(1),
    breached_deadline: z.enum([
      "first_response",
      "next_response",
      "resolution",
    ]),
    due_at: z.string().datetime(),
    metadata: JsonObjectSchema,
  })
  .strict();

export const AiRunStartedEventPayloadSchema = z
  .object({
    ai_run_id: z.string().min(1),
    ticket_id: z.string().min(1),
  })
  .strict();

export const AiRunCompletedEventPayloadSchema = z
  .object({
    ai_run_id: z.string().min(1),
    ticket_id: z.string().min(1),
    status: z.string().min(1),
    metadata: JsonObjectSchema,
  })
  .strict();

export const ToolCallCompletedEventPayloadSchema = z
  .object({
    tool_call_id: z.string().min(1),
    ticket_id: z.string().min(1),
    tool_name: z.string().min(1),
    status: z.string().min(1),
    metadata: JsonObjectSchema,
  })
  .strict();

export const ApprovalRequestedEventPayloadSchema = z
  .object({
    approval_id: z.string().min(1),
    ticket_id: z.string().min(1),
    approval_type: ApprovalTypeSchema,
  })
  .strict();

export const ApprovalCompletedEventPayloadSchema = z
  .object({
    approval_id: z.string().min(1),
    ticket_id: z.string().min(1),
    status: ApprovalStatusSchema,
  })
  .strict();

export const MessageSentEventPayloadSchema = z
  .object({
    message_id: z.string().min(1),
    conversation_id: z.string().min(1),
    ticket_id: z.string().min(1).nullable(),
    channel_id: z.string().min(1),
    sent_at: z.string().datetime(),
  })
  .strict();

export const QaReviewCreatedEventPayloadSchema = z
  .object({
    qa_review_id: z.string().min(1),
    ticket_id: z.string().min(1),
  })
  .strict();

export type MessageReceivedEventPayload = z.infer<
  typeof MessageReceivedEventPayloadSchema
>;
export type TicketCreatedEventPayload = z.infer<
  typeof TicketCreatedEventPayloadSchema
>;
export type TicketStateTransitionEventName = z.infer<
  typeof TicketStateTransitionEventNameSchema
>;
export type TicketStateTransitionEventPayload = z.infer<
  typeof TicketStateTransitionEventPayloadSchema
>;
export type TicketSlaBreachedEventPayload = z.infer<
  typeof TicketSlaBreachedEventPayloadSchema
>;
export type MessageSentEventPayload = z.infer<
  typeof MessageSentEventPayloadSchema
>;

function getDomainEventPayloadSchema(
  eventName: DomainEventName,
): z.ZodType<unknown> {
  switch (eventName) {
    case "support.message.received.v1":
      return MessageReceivedEventPayloadSchema;
    case "support.conversation.updated.v1":
      return ConversationUpdatedEventPayloadSchema;
    case "support.ticket.created.v1":
      return TicketCreatedEventPayloadSchema;
    case "support.ticket.triaged.v1":
    case "support.ticket.resolved.v1":
    case "support.ticket.closed.v1":
      return TicketStateTransitionEventPayloadSchema;
    case "support.ticket.priority_changed.v1":
      return TicketPriorityChangedEventPayloadSchema;
    case "support.ticket.assignment_changed.v1":
      return TicketAssignmentChangedEventPayloadSchema;
    case "support.ticket.sla_breached.v1":
      return TicketSlaBreachedEventPayloadSchema;
    case "support.ai_run.started.v1":
      return AiRunStartedEventPayloadSchema;
    case "support.ai_run.completed.v1":
      return AiRunCompletedEventPayloadSchema;
    case "support.tool_call.completed.v1":
      return ToolCallCompletedEventPayloadSchema;
    case "support.approval.requested.v1":
      return ApprovalRequestedEventPayloadSchema;
    case "support.approval.completed.v1":
      return ApprovalCompletedEventPayloadSchema;
    case "support.message.sent.v1":
      return MessageSentEventPayloadSchema;
    case "support.qa.review_created.v1":
      return QaReviewCreatedEventPayloadSchema;
  }
}
