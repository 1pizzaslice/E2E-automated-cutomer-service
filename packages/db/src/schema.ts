import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export type JsonObject = Record<string, unknown>;
export type JsonArray = JsonObject[];

const id = (name: string) => text(name).notNull();
const nullableId = (name: string) => text(name);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const jsonObject = (name: string) =>
  jsonb(name).$type<JsonObject>().notNull().default({});
const nullableJsonObject = (name: string) => jsonb(name).$type<JsonObject>();
const jsonArray = (name: string) =>
  jsonb(name).$type<JsonArray>().notNull().default([]);

export const tenantStatusEnum = pgEnum("tenant_status", [
  "active",
  "suspended",
  "archived",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "suspended",
  "archived",
]);

export const roleNameEnum = pgEnum("role_name", [
  "platform_admin",
  "ops_admin",
  "support_agent",
  "qa_reviewer",
  "client_viewer",
  "integration_admin",
]);

export const channelTypeEnum = pgEnum("channel_type", [
  "email",
  "whatsapp",
  "chat_future",
]);

export const channelStatusEnum = pgEnum("channel_status", [
  "active",
  "paused",
  "disabled",
]);

export const customerIdentityTypeEnum = pgEnum("customer_identity_type", [
  "email",
  "phone",
  "whatsapp_id",
  "external_user_id",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "archived",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
  "internal_note",
  "system",
]);

export const messageCreatorTypeEnum = pgEnum("message_creator_type", [
  "customer",
  "human",
  "ai",
  "system",
  "integration",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
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

export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "p0",
  "p1",
  "p2",
  "p3",
]);

export const automationModeEnum = pgEnum("automation_mode", [
  "auto_send",
  "human_approve",
  "human_only",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "system",
  "ai",
  "human",
  "integration",
]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "active",
  "released",
  "transferred",
]);

export const slaPolicyStatusEnum = pgEnum("sla_policy_status", [
  "draft",
  "active",
  "archived",
]);

export const tenantPolicyDomainEnum = pgEnum("tenant_policy_domain", [
  "refunds",
  "cancellations",
  "shipping",
  "faq",
  "routing",
  "tone",
  "escalation",
  "automation",
]);

export const tenantPolicyStatusEnum = pgEnum("tenant_policy_status", [
  "draft",
  "active",
  "archived",
]);

export const kbDocumentSourceTypeEnum = pgEnum("kb_document_source_type", [
  "manual",
  "upload",
  "url",
  "integration",
]);

export const kbDocumentTypeEnum = pgEnum("kb_document_type", [
  "faq",
  "policy",
  "macro",
  "product_doc",
  "sop",
]);

export const kbStatusEnum = pgEnum("kb_status", [
  "draft",
  "active",
  "stale",
  "archived",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "active",
  "paused",
  "disabled",
  "error",
]);

export const toolSideEffectClassEnum = pgEnum("tool_side_effect_class", [
  "read_only",
  "draft_side_effect",
  "reversible_write",
  "irreversible_write",
]);

export const toolStatusEnum = pgEnum("tool_status", [
  "active",
  "disabled",
  "archived",
]);

export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "planned",
  "running",
  "succeeded",
  "failed",
  "blocked",
]);

export const aiRunTypeEnum = pgEnum("ai_run_type", [
  "classification",
  "routing",
  "draft",
  "full_graph",
  "critique",
  "eval",
]);

export const aiRunStatusEnum = pgEnum("ai_run_status", [
  "started",
  "succeeded",
  "failed",
  "canceled",
]);

export const approvalTypeEnum = pgEnum("approval_type", [
  "reply",
  "tool_action",
  "escalation",
  "policy_exception",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "edited",
  "rejected",
  "escalated",
  "expired",
]);

export const idempotencyStatusEnum = pgEnum("idempotency_status", [
  "started",
  "completed",
  "failed",
]);

export const tenants = pgTable(
  "tenants",
  {
    tenantId: id("tenant_id").primaryKey(),
    name: text("name").notNull(),
    status: tenantStatusEnum("status").notNull().default("active"),
    defaultTimezone: text("default_timezone").notNull().default("UTC"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("tenants_status_idx").on(table.status),
    uniqueIndex("tenants_name_idx").on(table.name),
  ],
);

export const users = pgTable(
  "users",
  {
    userId: id("user_id").primaryKey(),
    tenantId: nullableId("tenant_id").references(() => tenants.tenantId),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("users_tenant_id_idx").on(table.tenantId),
    uniqueIndex("users_email_idx").on(table.email),
  ],
);

export const roles = pgTable(
  "roles",
  {
    roleId: id("role_id").primaryKey(),
    tenantId: nullableId("tenant_id").references(() => tenants.tenantId),
    name: roleNameEnum("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("roles_tenant_id_idx").on(table.tenantId),
    uniqueIndex("roles_tenant_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.tenantId} is not null`),
    uniqueIndex("roles_global_name_idx")
      .on(table.name)
      .where(sql`${table.tenantId} is null`),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userRoleId: id("user_role_id").primaryKey(),
    tenantId: nullableId("tenant_id").references(() => tenants.tenantId),
    userId: id("user_id").references(() => users.userId),
    roleId: id("role_id").references(() => roles.roleId),
    createdAt: createdAt(),
  },
  (table) => [
    index("user_roles_tenant_id_idx").on(table.tenantId),
    uniqueIndex("user_roles_user_role_idx").on(table.userId, table.roleId),
  ],
);

export const customers = pgTable(
  "customers",
  {
    customerId: id("customer_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    externalCustomerRef: text("external_customer_ref"),
    metadata: jsonObject("metadata"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("customers_tenant_id_idx").on(table.tenantId),
    uniqueIndex("customers_tenant_external_ref_idx")
      .on(table.tenantId, table.externalCustomerRef)
      .where(sql`${table.externalCustomerRef} is not null`),
  ],
);

export const customerIdentities = pgTable(
  "customer_identities",
  {
    customerIdentityId: id("customer_identity_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    customerId: id("customer_id").references(() => customers.customerId),
    channel: channelTypeEnum("channel").notNull(),
    identityType: customerIdentityTypeEnum("identity_type").notNull(),
    identityValue: text("identity_value").notNull(),
    verified: boolean("verified").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index("customer_identities_tenant_id_idx").on(table.tenantId),
    index("customer_identities_customer_id_idx").on(table.customerId),
    uniqueIndex("customer_identities_unique_idx").on(
      table.tenantId,
      table.channel,
      table.identityType,
      table.identityValue,
    ),
  ],
);

export const channels = pgTable(
  "channels",
  {
    channelId: id("channel_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    type: channelTypeEnum("type").notNull(),
    provider: text("provider").notNull(),
    status: channelStatusEnum("status").notNull().default("active"),
    config: jsonObject("config"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("channels_tenant_id_idx").on(table.tenantId),
    index("channels_tenant_type_status_idx").on(
      table.tenantId,
      table.type,
      table.status,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    conversationId: id("conversation_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    customerId: id("customer_id").references(() => customers.customerId),
    channelId: id("channel_id").references(() => channels.channelId),
    externalThreadId: text("external_thread_id"),
    status: conversationStatusEnum("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("conversations_tenant_id_idx").on(table.tenantId),
    index("conversations_tenant_customer_idx").on(
      table.tenantId,
      table.customerId,
    ),
    uniqueIndex("conversations_external_thread_idx")
      .on(table.tenantId, table.channelId, table.externalThreadId)
      .where(sql`${table.externalThreadId} is not null`),
  ],
);

export const slaPolicies = pgTable(
  "sla_policies",
  {
    slaPolicyId: id("sla_policy_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    name: text("name").notNull(),
    priority: ticketPriorityEnum("priority").notNull(),
    firstResponseMinutes: integer("first_response_minutes").notNull(),
    nextResponseMinutes: integer("next_response_minutes").notNull(),
    resolutionMinutes: integer("resolution_minutes").notNull(),
    businessHours: jsonObject("business_hours"),
    pauseConditions: jsonObject("pause_conditions"),
    escalationRules: jsonObject("escalation_rules"),
    status: slaPolicyStatusEnum("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("sla_policies_tenant_id_idx").on(table.tenantId),
    index("sla_policies_tenant_priority_status_idx").on(
      table.tenantId,
      table.priority,
      table.status,
    ),
  ],
);

export const tenantPolicies = pgTable(
  "tenant_policies",
  {
    policyId: id("policy_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    name: text("name").notNull(),
    domain: tenantPolicyDomainEnum("domain").notNull(),
    status: tenantPolicyStatusEnum("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("tenant_policies_tenant_id_idx").on(table.tenantId),
    index("tenant_policies_tenant_domain_status_idx").on(
      table.tenantId,
      table.domain,
      table.status,
    ),
  ],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    policyVersionId: id("policy_version_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    policyId: id("policy_id").references(() => tenantPolicies.policyId),
    version: integer("version").notNull(),
    content: jsonObject("content"),
    schemaVersion: text("schema_version").notNull(),
    createdByUserId: nullableId("created_by_user_id").references(
      () => users.userId,
    ),
    approvedByUserId: nullableId("approved_by_user_id").references(
      () => users.userId,
    ),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("policy_versions_tenant_id_idx").on(table.tenantId),
    uniqueIndex("policy_versions_policy_version_idx").on(
      table.policyId,
      table.version,
    ),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    ticketId: id("ticket_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    conversationId: id("conversation_id").references(
      () => conversations.conversationId,
    ),
    customerId: id("customer_id").references(() => customers.customerId),
    status: ticketStatusEnum("status").notNull().default("new"),
    priority: ticketPriorityEnum("priority").notNull().default("p2"),
    topic: text("topic"),
    subtopic: text("subtopic"),
    language: text("language"),
    sentiment: text("sentiment"),
    urgencyScore: integer("urgency_score"),
    automationMode: automationModeEnum("automation_mode")
      .notNull()
      .default("human_approve"),
    assignedQueue: text("assigned_queue"),
    assignedUserId: nullableId("assigned_user_id").references(
      () => users.userId,
    ),
    slaPolicyId: nullableId("sla_policy_id").references(
      () => slaPolicies.slaPolicyId,
    ),
    policyVersionId: nullableId("policy_version_id").references(
      () => policyVersions.policyVersionId,
    ),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    firstResponseDueAt: timestamp("first_response_due_at", {
      withTimezone: true,
    }),
    nextResponseDueAt: timestamp("next_response_due_at", {
      withTimezone: true,
    }),
    resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("tickets_tenant_id_idx").on(table.tenantId),
    index("tickets_tenant_status_idx").on(table.tenantId, table.status),
    index("tickets_tenant_assigned_queue_idx").on(
      table.tenantId,
      table.assignedQueue,
    ),
    index("tickets_conversation_id_idx").on(table.conversationId),
    index("tickets_customer_id_idx").on(table.customerId),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    assignmentId: id("assignment_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    ticketId: id("ticket_id").references(() => tickets.ticketId),
    assignedQueue: text("assigned_queue"),
    assignedUserId: nullableId("assigned_user_id").references(
      () => users.userId,
    ),
    status: assignmentStatusEnum("status").notNull().default("active"),
    metadata: jsonObject("metadata"),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    index("assignments_tenant_id_idx").on(table.tenantId),
    index("assignments_ticket_id_idx").on(table.ticketId),
    index("assignments_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const messages = pgTable(
  "messages",
  {
    messageId: id("message_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    conversationId: id("conversation_id").references(
      () => conversations.conversationId,
    ),
    ticketId: nullableId("ticket_id").references(() => tickets.ticketId),
    channelId: id("channel_id").references(() => channels.channelId),
    direction: messageDirectionEnum("direction").notNull(),
    bodyText: text("body_text"),
    bodyHtmlRef: text("body_html_ref"),
    attachments: jsonArray("attachments"),
    externalMessageId: text("external_message_id"),
    externalThreadId: text("external_thread_id"),
    rawPayloadRef: text("raw_payload_ref"),
    createdByType: messageCreatorTypeEnum("created_by_type").notNull(),
    createdByUserId: nullableId("created_by_user_id").references(
      () => users.userId,
    ),
    providerMessageId: text("provider_message_id"),
    sendStatus: text("send_status"),
    sentByType: text("sent_by_type"),
    aiRunId: nullableId("ai_run_id"),
    approvalId: nullableId("approval_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_tenant_id_idx").on(table.tenantId),
    index("messages_conversation_id_idx").on(table.conversationId),
    index("messages_ticket_id_idx").on(table.ticketId),
    uniqueIndex("messages_external_message_idx")
      .on(table.tenantId, table.channelId, table.externalMessageId)
      .where(sql`${table.externalMessageId} is not null`),
    uniqueIndex("messages_idempotency_idx")
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    ticketEventId: id("ticket_event_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    ticketId: id("ticket_id").references(() => tickets.ticketId),
    eventType: text("event_type").notNull(),
    fromStatus: ticketStatusEnum("from_status"),
    toStatus: ticketStatusEnum("to_status"),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    reasonCode: text("reason_code"),
    metadata: jsonObject("metadata"),
    createdAt: createdAt(),
  },
  (table) => [
    index("ticket_events_tenant_id_idx").on(table.tenantId),
    index("ticket_events_ticket_id_idx").on(table.ticketId),
  ],
);

export const kbDocuments = pgTable(
  "kb_documents",
  {
    kbDocumentId: id("kb_document_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    title: text("title").notNull(),
    sourceType: kbDocumentSourceTypeEnum("source_type").notNull(),
    sourceRef: text("source_ref"),
    documentType: kbDocumentTypeEnum("document_type").notNull(),
    status: kbStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    contentHash: text("content_hash").notNull(),
    createdByUserId: nullableId("created_by_user_id").references(
      () => users.userId,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("kb_documents_tenant_id_idx").on(table.tenantId),
    index("kb_documents_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    kbChunkId: id("kb_chunk_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    kbDocumentId: id("kb_document_id").references(
      () => kbDocuments.kbDocumentId,
    ),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonObject("metadata"),
    status: kbStatusEnum("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (table) => [
    index("kb_chunks_tenant_id_idx").on(table.tenantId),
    index("kb_chunks_tenant_status_idx").on(table.tenantId, table.status),
    uniqueIndex("kb_chunks_document_index_idx").on(
      table.kbDocumentId,
      table.chunkIndex,
    ),
  ],
);

export const integrations = pgTable(
  "integrations",
  {
    integrationId: id("integration_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    provider: text("provider").notNull(),
    integrationType: text("integration_type").notNull(),
    status: integrationStatusEnum("status").notNull().default("active"),
    config: jsonObject("config"),
    credentialRef: text("credential_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("integrations_tenant_id_idx").on(table.tenantId),
    uniqueIndex("integrations_tenant_provider_type_idx").on(
      table.tenantId,
      table.provider,
      table.integrationType,
    ),
  ],
);

export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    toolDefinitionId: id("tool_definition_id").primaryKey(),
    tenantId: nullableId("tenant_id").references(() => tenants.tenantId),
    name: text("name").notNull(),
    description: text("description").notNull(),
    inputSchema: jsonObject("input_schema"),
    outputSchema: jsonObject("output_schema"),
    permission: text("permission").notNull(),
    sideEffectClass: toolSideEffectClassEnum("side_effect_class").notNull(),
    requiresHumanApproval: boolean("requires_human_approval").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    retryPolicy: jsonObject("retry_policy"),
    redactionPolicy: jsonObject("redaction_policy"),
    status: toolStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("tool_definitions_tenant_id_idx").on(table.tenantId),
    uniqueIndex("tool_definitions_tenant_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.tenantId} is not null`),
    uniqueIndex("tool_definitions_global_name_idx")
      .on(table.name)
      .where(sql`${table.tenantId} is null`),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    aiRunId: id("ai_run_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    ticketId: id("ticket_id").references(() => tickets.ticketId),
    conversationId: id("conversation_id").references(
      () => conversations.conversationId,
    ),
    runType: aiRunTypeEnum("run_type").notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelProvider: text("model_provider").notNull(),
    modelId: text("model_id").notNull(),
    inputRefs: jsonObject("input_refs"),
    retrievedContextRefs: jsonObject("retrieved_context_refs"),
    structuredOutput: nullableJsonObject("structured_output"),
    confidence: numeric("confidence", {
      precision: 4,
      scale: 3,
      mode: "number",
    }),
    riskLevel: text("risk_level"),
    automationRecommendation: automationModeEnum("automation_recommendation"),
    guardrailResults: jsonObject("guardrail_results"),
    status: aiRunStatusEnum("status").notNull().default("started"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costEstimate: numeric("cost_estimate", {
      precision: 12,
      scale: 6,
      mode: "number",
    }),
    traceId: text("trace_id"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("ai_runs_tenant_id_idx").on(table.tenantId),
    index("ai_runs_ticket_id_idx").on(table.ticketId),
    index("ai_runs_trace_id_idx").on(table.traceId),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    toolCallId: id("tool_call_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    ticketId: id("ticket_id").references(() => tickets.ticketId),
    aiRunId: id("ai_run_id").references(() => aiRuns.aiRunId),
    toolDefinitionId: id("tool_definition_id").references(
      () => toolDefinitions.toolDefinitionId,
    ),
    input: jsonObject("input"),
    output: nullableJsonObject("output"),
    status: toolCallStatusEnum("status").notNull().default("planned"),
    sideEffectClass: toolSideEffectClassEnum("side_effect_class").notNull(),
    idempotencyKey: text("idempotency_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("tool_calls_tenant_id_idx").on(table.tenantId),
    index("tool_calls_ticket_id_idx").on(table.ticketId),
    index("tool_calls_ai_run_id_idx").on(table.aiRunId),
    uniqueIndex("tool_calls_idempotency_idx")
      .on(table.tenantId, table.toolDefinitionId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    approvalId: id("approval_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    ticketId: id("ticket_id").references(() => tickets.ticketId),
    aiRunId: nullableId("ai_run_id").references(() => aiRuns.aiRunId),
    approvalType: approvalTypeEnum("approval_type").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    requestedPayload: jsonObject("requested_payload"),
    approvedPayload: nullableJsonObject("approved_payload"),
    reviewerUserId: nullableId("reviewer_user_id").references(
      () => users.userId,
    ),
    reviewNotes: text("review_notes"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("approvals_tenant_id_idx").on(table.tenantId),
    index("approvals_ticket_id_idx").on(table.ticketId),
    index("approvals_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    auditEventId: id("audit_event_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    metadata: jsonObject("metadata"),
    correlationId: text("correlation_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_events_tenant_id_idx").on(table.tenantId),
    index("audit_events_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
    index("audit_events_correlation_id_idx").on(table.correlationId),
  ],
);

export const qaReviews = pgTable(
  "qa_reviews",
  {
    qaReviewId: id("qa_review_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    ticketId: id("ticket_id").references(() => tickets.ticketId),
    aiRunId: nullableId("ai_run_id").references(() => aiRuns.aiRunId),
    reviewerUserId: nullableId("reviewer_user_id").references(
      () => users.userId,
    ),
    sampleReason: text("sample_reason").notNull(),
    scores: jsonObject("scores"),
    defects: jsonArray("defects"),
    notes: text("notes"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("qa_reviews_tenant_id_idx").on(table.tenantId),
    index("qa_reviews_ticket_id_idx").on(table.ticketId),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    idempotencyKeyId: id("idempotency_key_id").primaryKey(),
    tenantId: id("tenant_id").references(() => tenants.tenantId),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseRef: text("response_ref"),
    status: idempotencyStatusEnum("status").notNull().default("started"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idempotency_keys_tenant_id_idx").on(table.tenantId),
    uniqueIndex("idempotency_keys_tenant_operation_key_idx").on(
      table.tenantId,
      table.operation,
      table.idempotencyKey,
    ),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type KbDocument = typeof kbDocuments.$inferSelect;
export type NewKbDocument = typeof kbDocuments.$inferInsert;
export type KbChunk = typeof kbChunks.$inferSelect;
export type NewKbChunk = typeof kbChunks.$inferInsert;
export type ToolDefinition = typeof toolDefinitions.$inferSelect;
export type NewToolDefinition = typeof toolDefinitions.$inferInsert;
export type AiRun = typeof aiRuns.$inferSelect;
export type NewAiRun = typeof aiRuns.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
