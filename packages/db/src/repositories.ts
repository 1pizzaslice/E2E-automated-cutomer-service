import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import type { SupportDatabase } from "./client.js";
import {
  auditEvents,
  conversations,
  customers,
  integrations,
  kbChunks,
  type NewCustomer,
  type NewTenant,
  type NewTicket,
  type Ticket,
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

export interface TicketListQueryOptions extends ListQueryOptions {
  readonly status?: Ticket["status"];
  readonly customerId?: string;
  readonly assignedQueue?: string;
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
