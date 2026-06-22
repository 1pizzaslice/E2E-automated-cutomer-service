import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import type { SupportDatabase } from "./client.js";
import {
  approvals,
  auditEvents,
  conversations,
  customers,
  integrations,
  kbChunks,
  kbDocuments,
  messages,
  type Approval,
  type Conversation,
  type KbDocument,
  type Message,
  type NewCustomer,
  type NewTenant,
  type NewTicket,
  type TenantPolicy,
  type Ticket,
  tenantPolicies,
  tenants,
  tickets,
  toolDefinitions,
} from "./schema.js";

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
