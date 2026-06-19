import { and, eq, isNull, or } from "drizzle-orm";
import type { SupportDatabase } from "./client.js";
import {
  auditEvents,
  customers,
  integrations,
  kbChunks,
  tickets,
  toolDefinitions,
} from "./schema.js";

export interface TenantScope {
  readonly tenantId: string;
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
