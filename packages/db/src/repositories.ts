import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SupportDatabase } from "./client.js";
import {
  approvals,
  auditEvents,
  channels,
  conversations,
  customerIdentities,
  customers,
  integrations,
  kbChunks,
  kbDocuments,
  messages,
  type Approval,
  type AuditEvent,
  type Channel,
  type Conversation,
  type CustomerIdentity,
  type KbDocument,
  type Message,
  type NewConversation,
  type NewCustomer,
  type NewCustomerIdentity,
  type NewKbChunk,
  type NewKbDocument,
  type NewMessage,
  type NewTenant,
  type NewTicket,
  type NewToolCall,
  type TenantPolicy,
  type Ticket,
  type ToolCall,
  tenantPolicies,
  tenants,
  tickets,
  toolCalls,
  toolDefinitions,
} from "./schema.js";

type ChannelType = Channel["type"];
type CustomerIdentityType = CustomerIdentity["identityType"];

export interface TenantScope {
  readonly tenantId: string;
}

export interface ListQueryOptions {
  readonly limit: number;
}

export interface CustomerListQueryOptions extends ListQueryOptions {
  readonly email?: string;
  readonly externalCustomerRef?: string;
}

export interface ConversationListQueryOptions extends ListQueryOptions {
  readonly status?: Conversation["status"];
  readonly customerId?: string;
  readonly channelId?: string;
}

export interface MessageListQueryOptions extends ListQueryOptions {
  readonly direction?: Message["direction"];
  readonly ticketId?: string;
}

export interface TicketListQueryOptions extends ListQueryOptions {
  readonly status?: Ticket["status"];
  readonly customerId?: string;
  readonly assignedQueue?: string;
}

export interface PolicyListQueryOptions extends ListQueryOptions {
  readonly domain?: TenantPolicy["domain"];
  readonly status?: TenantPolicy["status"];
}

export interface KbDocumentListQueryOptions extends ListQueryOptions {
  readonly sourceType?: KbDocument["sourceType"];
  readonly documentType?: KbDocument["documentType"];
  readonly status?: KbDocument["status"];
}

export interface ApprovalListQueryOptions extends ListQueryOptions {
  readonly status?: Approval["status"];
  readonly ticketId?: string;
  readonly approvalType?: Approval["approvalType"];
}

export interface AuditEventListQueryOptions extends ListQueryOptions {
  readonly actorType?: AuditEvent["actorType"];
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: string;
  readonly correlationId?: string;
}

export function tenantsListQuery(
  db: SupportDatabase,
  options: ListQueryOptions,
) {
  return db
    .select()
    .from(tenants)
    .orderBy(desc(tenants.createdAt), desc(tenants.tenantId))
    .limit(options.limit);
}

export function createTenantQuery(db: SupportDatabase, values: NewTenant) {
  return db.insert(tenants).values(values).returning();
}

export function updateTenantByIdQuery(
  db: SupportDatabase,
  tenantId: string,
  values: Partial<NewTenant>,
) {
  return db
    .update(tenants)
    .set(values)
    .where(eq(tenants.tenantId, tenantId))
    .returning();
}

export function tenantByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  tenantId: string,
) {
  return db
    .select()
    .from(tenants)
    .where(
      and(eq(tenants.tenantId, scope.tenantId), eq(tenants.tenantId, tenantId)),
    )
    .limit(1);
}

export function customersListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: CustomerListQueryOptions,
) {
  const filters: SQL[] = [eq(customers.tenantId, scope.tenantId)];

  if (options.email) {
    filters.push(eq(customers.email, options.email));
  }

  if (options.externalCustomerRef) {
    filters.push(
      eq(customers.externalCustomerRef, options.externalCustomerRef),
    );
  }

  return db
    .select()
    .from(customers)
    .where(and(...filters))
    .orderBy(desc(customers.createdAt), desc(customers.customerId))
    .limit(options.limit);
}

export function customerByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  customerId: string,
) {
  return db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, scope.tenantId),
        eq(customers.customerId, customerId),
      ),
    )
    .limit(1);
}

export function createCustomerQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewCustomer, "tenantId">,
) {
  return db
    .insert(customers)
    .values({ ...values, tenantId: scope.tenantId })
    .returning();
}

export function updateCustomerByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  customerId: string,
  values: Partial<NewCustomer>,
) {
  return db
    .update(customers)
    .set(values)
    .where(
      and(
        eq(customers.tenantId, scope.tenantId),
        eq(customers.customerId, customerId),
      ),
    )
    .returning();
}

export function conversationsListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: ConversationListQueryOptions,
) {
  const filters: SQL[] = [eq(conversations.tenantId, scope.tenantId)];

  if (options.status) {
    filters.push(eq(conversations.status, options.status));
  }

  if (options.customerId) {
    filters.push(eq(conversations.customerId, options.customerId));
  }

  if (options.channelId) {
    filters.push(eq(conversations.channelId, options.channelId));
  }

  return db
    .select()
    .from(conversations)
    .where(and(...filters))
    .orderBy(desc(conversations.createdAt), desc(conversations.conversationId))
    .limit(options.limit);
}

export function conversationByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  conversationId: string,
) {
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, scope.tenantId),
        eq(conversations.conversationId, conversationId),
      ),
    )
    .limit(1);
}

export function messagesListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  conversationId: string,
  options: MessageListQueryOptions,
) {
  const filters: SQL[] = [
    eq(messages.tenantId, scope.tenantId),
    eq(messages.conversationId, conversationId),
  ];

  if (options.direction) {
    filters.push(eq(messages.direction, options.direction));
  }

  if (options.ticketId) {
    filters.push(eq(messages.ticketId, options.ticketId));
  }

  return db
    .select()
    .from(messages)
    .where(and(...filters))
    .orderBy(desc(messages.createdAt), desc(messages.messageId))
    .limit(options.limit);
}

export function messageByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  conversationId: string,
  messageId: string,
) {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, scope.tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.messageId, messageId),
      ),
    )
    .limit(1);
}

export function ticketsListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: TicketListQueryOptions,
) {
  const filters: SQL[] = [eq(tickets.tenantId, scope.tenantId)];

  if (options.status) {
    filters.push(eq(tickets.status, options.status));
  }

  if (options.customerId) {
    filters.push(eq(tickets.customerId, options.customerId));
  }

  if (options.assignedQueue) {
    filters.push(eq(tickets.assignedQueue, options.assignedQueue));
  }

  return db
    .select()
    .from(tickets)
    .where(and(...filters))
    .orderBy(desc(tickets.createdAt), desc(tickets.ticketId))
    .limit(options.limit);
}

export function ticketByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  ticketId: string,
) {
  return db
    .select()
    .from(tickets)
    .where(
      and(eq(tickets.tenantId, scope.tenantId), eq(tickets.ticketId, ticketId)),
    )
    .limit(1);
}

export function createTicketQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewTicket, "tenantId">,
) {
  return db
    .insert(tickets)
    .values({ ...values, tenantId: scope.tenantId })
    .returning();
}

export function updateTicketByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  ticketId: string,
  values: Partial<NewTicket>,
) {
  return db
    .update(tickets)
    .set(values)
    .where(
      and(eq(tickets.tenantId, scope.tenantId), eq(tickets.ticketId, ticketId)),
    )
    .returning();
}

export function policiesListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: PolicyListQueryOptions,
) {
  const filters: SQL[] = [eq(tenantPolicies.tenantId, scope.tenantId)];

  if (options.domain) {
    filters.push(eq(tenantPolicies.domain, options.domain));
  }

  if (options.status) {
    filters.push(eq(tenantPolicies.status, options.status));
  }

  return db
    .select()
    .from(tenantPolicies)
    .where(and(...filters))
    .orderBy(desc(tenantPolicies.createdAt), desc(tenantPolicies.policyId))
    .limit(options.limit);
}

export function policyByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  policyId: string,
) {
  return db
    .select()
    .from(tenantPolicies)
    .where(
      and(
        eq(tenantPolicies.tenantId, scope.tenantId),
        eq(tenantPolicies.policyId, policyId),
      ),
    )
    .limit(1);
}

export function kbDocumentsListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: KbDocumentListQueryOptions,
) {
  const filters: SQL[] = [eq(kbDocuments.tenantId, scope.tenantId)];

  if (options.sourceType) {
    filters.push(eq(kbDocuments.sourceType, options.sourceType));
  }

  if (options.documentType) {
    filters.push(eq(kbDocuments.documentType, options.documentType));
  }

  if (options.status) {
    filters.push(eq(kbDocuments.status, options.status));
  }

  return db
    .select()
    .from(kbDocuments)
    .where(and(...filters))
    .orderBy(desc(kbDocuments.createdAt), desc(kbDocuments.kbDocumentId))
    .limit(options.limit);
}

export function kbDocumentByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  kbDocumentId: string,
) {
  return db
    .select()
    .from(kbDocuments)
    .where(
      and(
        eq(kbDocuments.tenantId, scope.tenantId),
        eq(kbDocuments.kbDocumentId, kbDocumentId),
      ),
    )
    .limit(1);
}

export function createKbDocumentQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewKbDocument, "tenantId">,
) {
  return db
    .insert(kbDocuments)
    .values({ ...values, tenantId: scope.tenantId })
    .returning();
}

export function updateKbDocumentByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  kbDocumentId: string,
  values: Partial<NewKbDocument>,
) {
  return db
    .update(kbDocuments)
    .set(values)
    .where(
      and(
        eq(kbDocuments.tenantId, scope.tenantId),
        eq(kbDocuments.kbDocumentId, kbDocumentId),
      ),
    )
    .returning();
}

/**
 * Remove all chunks for a KB document within the tenant scope. Ingestion is
 * idempotent by replacement: a re-ingest deletes the prior chunk set before
 * writing the freshly chunked/embedded rows, so stale chunk indexes never
 * linger.
 */
export function deleteKbChunksForDocumentQuery(
  db: SupportDatabase,
  scope: TenantScope,
  kbDocumentId: string,
) {
  return db
    .delete(kbChunks)
    .where(
      and(
        eq(kbChunks.tenantId, scope.tenantId),
        eq(kbChunks.kbDocumentId, kbDocumentId),
      ),
    )
    .returning();
}

export function insertKbChunksQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: readonly Omit<NewKbChunk, "tenantId">[],
) {
  return db
    .insert(kbChunks)
    .values(values.map((value) => ({ ...value, tenantId: scope.tenantId })))
    .returning();
}

export function approvalsListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: ApprovalListQueryOptions,
) {
  const filters: SQL[] = [eq(approvals.tenantId, scope.tenantId)];

  if (options.status) {
    filters.push(eq(approvals.status, options.status));
  }

  if (options.ticketId) {
    filters.push(eq(approvals.ticketId, options.ticketId));
  }

  if (options.approvalType) {
    filters.push(eq(approvals.approvalType, options.approvalType));
  }

  return db
    .select()
    .from(approvals)
    .where(and(...filters))
    .orderBy(desc(approvals.createdAt), desc(approvals.approvalId))
    .limit(options.limit);
}

export function approvalByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  approvalId: string,
) {
  return db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.tenantId, scope.tenantId),
        eq(approvals.approvalId, approvalId),
      ),
    )
    .limit(1);
}

export function auditEventsListQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: AuditEventListQueryOptions,
) {
  const filters: SQL[] = [eq(auditEvents.tenantId, scope.tenantId)];

  if (options.actorType) {
    filters.push(eq(auditEvents.actorType, options.actorType));
  }

  if (options.entityType) {
    filters.push(eq(auditEvents.entityType, options.entityType));
  }

  if (options.entityId) {
    filters.push(eq(auditEvents.entityId, options.entityId));
  }

  if (options.action) {
    filters.push(eq(auditEvents.action, options.action));
  }

  if (options.correlationId) {
    filters.push(eq(auditEvents.correlationId, options.correlationId));
  }

  return db
    .select()
    .from(auditEvents)
    .where(and(...filters))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.auditEventId))
    .limit(options.limit);
}

export function auditEventByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  auditEventId: string,
) {
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, scope.tenantId),
        eq(auditEvents.auditEventId, auditEventId),
      ),
    )
    .limit(1);
}

export function activeKbChunksForDocumentQuery(
  db: SupportDatabase,
  scope: TenantScope,
  kbDocumentId: string,
) {
  return db
    .select()
    .from(kbChunks)
    .where(
      and(
        eq(kbChunks.tenantId, scope.tenantId),
        eq(kbChunks.kbDocumentId, kbDocumentId),
        eq(kbChunks.status, "active"),
      ),
    );
}

export interface KbChunkSearchQueryOptions {
  /** Query embedding; must match the `kb_chunks.embedding` dimensionality. */
  readonly embedding: number[];
  readonly limit: number;
  readonly documentType?: KbDocument["documentType"];
  readonly sourceType?: KbDocument["sourceType"];
}

/**
 * Tenant-scoped approximate-nearest-neighbour retrieval over KB chunk
 * embeddings. Results are the closest `active` chunks (by cosine distance,
 * matched by the `kb_chunks_embedding_hnsw_idx` HNSW index) belonging to
 * `active` documents only — so documents PATCHed to `stale`/`archived`/`draft`
 * are excluded at query time even though their chunk rows remain. The join to
 * `kb_documents` also supplies the citation metadata (title, type, source). RLS
 * enforces the tenant boundary; the explicit `tenant_id` predicates make the
 * scope defense-in-depth and keep the helper correct off the owner connection.
 */
export function searchKbChunksQuery(
  db: SupportDatabase,
  scope: TenantScope,
  options: KbChunkSearchQueryOptions,
) {
  const distance = cosineDistance(kbChunks.embedding, options.embedding);
  const filters: SQL[] = [
    eq(kbChunks.tenantId, scope.tenantId),
    eq(kbChunks.status, "active"),
    eq(kbDocuments.tenantId, scope.tenantId),
    eq(kbDocuments.status, "active"),
  ];

  if (options.documentType) {
    filters.push(eq(kbDocuments.documentType, options.documentType));
  }

  if (options.sourceType) {
    filters.push(eq(kbDocuments.sourceType, options.sourceType));
  }

  return db
    .select({
      kbChunkId: kbChunks.kbChunkId,
      tenantId: kbChunks.tenantId,
      kbDocumentId: kbChunks.kbDocumentId,
      chunkIndex: kbChunks.chunkIndex,
      content: kbChunks.content,
      status: kbChunks.status,
      metadata: kbChunks.metadata,
      createdAt: kbChunks.createdAt,
      distance: sql<number>`${distance}`,
      documentTitle: kbDocuments.title,
      documentType: kbDocuments.documentType,
      sourceType: kbDocuments.sourceType,
      sourceRef: kbDocuments.sourceRef,
    })
    .from(kbChunks)
    .innerJoin(kbDocuments, eq(kbChunks.kbDocumentId, kbDocuments.kbDocumentId))
    .where(and(...filters))
    .orderBy(asc(distance))
    .limit(options.limit);
}

export function auditEventsForEntityQuery(
  db: SupportDatabase,
  scope: TenantScope,
  entityType: string,
  entityId: string,
) {
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, scope.tenantId),
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
      ),
    );
}

export function integrationByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  integrationId: string,
) {
  return db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.tenantId, scope.tenantId),
        eq(integrations.integrationId, integrationId),
      ),
    )
    .limit(1);
}

export function visibleToolDefinitionByNameQuery(
  db: SupportDatabase,
  scope: TenantScope,
  toolName: string,
) {
  return db
    .select()
    .from(toolDefinitions)
    .where(
      and(
        or(
          eq(toolDefinitions.tenantId, scope.tenantId),
          isNull(toolDefinitions.tenantId),
        ),
        eq(toolDefinitions.name, toolName),
        eq(toolDefinitions.status, "active"),
      ),
    )
    .limit(1);
}

// --- Milestone 8 tool registry ----------------------------------------------

/**
 * Persist a tool call audit row. Every attempt to execute a tool — successful,
 * failed, or blocked — is recorded here; the executor writes the terminal
 * outcome via {@link updateToolCallByIdQuery}. The row is tenant-scoped so RLS
 * confines it to the owning tenant.
 */
export function insertToolCallQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewToolCall, "tenantId">,
) {
  return db
    .insert(toolCalls)
    .values({ ...values, tenantId: scope.tenantId })
    .returning();
}

export function updateToolCallByIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  toolCallId: string,
  values: Partial<NewToolCall>,
) {
  return db
    .update(toolCalls)
    .set(values)
    .where(
      and(
        eq(toolCalls.tenantId, scope.tenantId),
        eq(toolCalls.toolCallId, toolCallId),
      ),
    )
    .returning();
}

/**
 * Look up a prior tool call by idempotency key for a given tool definition.
 * Backs idempotent replay for side-effect-capable tools: a repeated key returns
 * the earlier call so the side effect is not applied twice. Mirrors the
 * `tool_calls_idempotency_idx` unique key on (tenant, tool definition, key).
 */
export function toolCallByIdempotencyKeyQuery(
  db: SupportDatabase,
  scope: TenantScope,
  params: {
    readonly toolDefinitionId: string;
    readonly idempotencyKey: string;
  },
) {
  return db
    .select()
    .from(toolCalls)
    .where(
      and(
        eq(toolCalls.tenantId, scope.tenantId),
        eq(toolCalls.toolDefinitionId, params.toolDefinitionId),
        eq(toolCalls.idempotencyKey, params.idempotencyKey),
      ),
    )
    .limit(1);
}

export type ToolCallRow = ToolCall;

// --- Milestone 6 channel intake ---------------------------------------------

/**
 * Resolve a channel by id without a tenant scope. Channel resolution happens
 * before a webhook has established tenant context, so this read runs on the
 * owner/service connection (RLS is not forced) to learn the owning tenant,
 * provider, type, status, and config. Tenant-scoped ingestion writes run under
 * `withTenantTransaction` once the tenant is known.
 */
export function channelByIdQuery(db: SupportDatabase, channelId: string) {
  return db
    .select()
    .from(channels)
    .where(eq(channels.channelId, channelId))
    .limit(1);
}

export function customerIdentityByValueQuery(
  db: SupportDatabase,
  scope: TenantScope,
  params: {
    readonly channel: ChannelType;
    readonly identityType: CustomerIdentityType;
    readonly identityValue: string;
  },
) {
  return db
    .select()
    .from(customerIdentities)
    .where(
      and(
        eq(customerIdentities.tenantId, scope.tenantId),
        eq(customerIdentities.channel, params.channel),
        eq(customerIdentities.identityType, params.identityType),
        eq(customerIdentities.identityValue, params.identityValue),
      ),
    )
    .limit(1);
}

export function createCustomerIdentityQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewCustomerIdentity, "tenantId">,
) {
  return db
    .insert(customerIdentities)
    .values({ ...values, tenantId: scope.tenantId })
    .onConflictDoNothing()
    .returning();
}

export function conversationByExternalThreadQuery(
  db: SupportDatabase,
  scope: TenantScope,
  channelId: string,
  externalThreadId: string,
) {
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, scope.tenantId),
        eq(conversations.channelId, channelId),
        eq(conversations.externalThreadId, externalThreadId),
      ),
    )
    .limit(1);
}

export function createConversationQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewConversation, "tenantId">,
) {
  return db
    .insert(conversations)
    .values({ ...values, tenantId: scope.tenantId })
    .onConflictDoNothing()
    .returning();
}

export function updateConversationLastMessageAtQuery(
  db: SupportDatabase,
  scope: TenantScope,
  conversationId: string,
  lastMessageAt: Date,
) {
  return db
    .update(conversations)
    .set({ lastMessageAt, updatedAt: new Date() })
    .where(
      and(
        eq(conversations.tenantId, scope.tenantId),
        eq(conversations.conversationId, conversationId),
      ),
    )
    .returning();
}

/**
 * Look up an existing inbound message by its provider `external_message_id`
 * within a tenant/channel. This is the inbound dedup key; the underlying unique
 * index (`messages_external_message_idx`) also enforces it on insert.
 */
export function messageByExternalIdQuery(
  db: SupportDatabase,
  scope: TenantScope,
  channelId: string,
  externalMessageId: string,
) {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, scope.tenantId),
        eq(messages.channelId, channelId),
        eq(messages.externalMessageId, externalMessageId),
      ),
    )
    .limit(1);
}

/**
 * Insert an inbound message, deduplicating on any unique constraint
 * (external message id or idempotency key). Returns the inserted row, or an
 * empty result when a concurrent insert already persisted the message.
 */
export function createInboundMessageQuery(
  db: SupportDatabase,
  scope: TenantScope,
  values: Omit<NewMessage, "tenantId">,
) {
  return db
    .insert(messages)
    .values({ ...values, tenantId: scope.tenantId })
    .onConflictDoNothing()
    .returning();
}
