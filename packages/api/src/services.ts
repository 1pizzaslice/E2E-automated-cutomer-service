import {
  createDatabaseFromEnv,
  customerByIdQuery,
  tenantByIdQuery,
  ticketByIdQuery,
  withTenantTransaction,
  type Customer,
  type PostgresClient,
  type Tenant,
  type Ticket,
} from "@support/db";
import type {
  CustomerResponse,
  TenantResponse,
  TicketResponse,
} from "@support/shared-schemas";
import type { TenantRequestContext } from "./request-context.js";

export interface ApiServices {
  readonly tenants: {
    getById(
      context: TenantRequestContext,
      tenantId: string,
    ): Promise<TenantResponse | null>;
  };
  readonly customers: {
    getById(
      context: TenantRequestContext,
      customerId: string,
    ): Promise<CustomerResponse | null>;
  };
  readonly tickets: {
    getById(
      context: TenantRequestContext,
      ticketId: string,
    ): Promise<TicketResponse | null>;
  };
  readonly close?: () => Promise<void>;
}

export function createDatabaseApiServices(): ApiServices {
  let client: PostgresClient | undefined;

  function getClient(): PostgresClient {
    if (!client) {
      client = createDatabaseFromEnv().client;
    }

    return client;
  }

  return {
    tenants: {
      async getById(context, tenantId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await tenantByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              tenantId,
            );

            return rows[0] ? mapTenant(rows[0]) : null;
          },
        );
      },
    },
    customers: {
      async getById(context, customerId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await customerByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              customerId,
            );

            return rows[0] ? mapCustomer(rows[0]) : null;
          },
        );
      },
    },
    tickets: {
      async getById(context, ticketId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await ticketByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              ticketId,
            );

            return rows[0] ? mapTicket(rows[0]) : null;
          },
        );
      },
    },
    async close() {
      await client?.end();
    },
  };
}

function mapTenant(row: Tenant): TenantResponse {
  return {
    tenant_id: row.tenantId,
    name: row.name,
    status: row.status,
    default_timezone: row.defaultTimezone,
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

function mapCustomer(row: Customer): CustomerResponse {
  return {
    customer_id: row.customerId,
    tenant_id: row.tenantId,
    display_name: row.displayName,
    email: row.email,
    phone: row.phone,
    external_customer_ref: row.externalCustomerRef,
    metadata: row.metadata,
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

function mapTicket(row: Ticket): TicketResponse {
  return {
    ticket_id: row.ticketId,
    tenant_id: row.tenantId,
    conversation_id: row.conversationId,
    customer_id: row.customerId,
    status: row.status,
    priority: row.priority,
    topic: row.topic,
    subtopic: row.subtopic,
    language: row.language,
    sentiment: row.sentiment,
    urgency_score: row.urgencyScore,
    automation_mode: row.automationMode,
    assigned_queue: row.assignedQueue,
    assigned_user_id: row.assignedUserId,
    sla_policy_id: row.slaPolicyId,
    policy_version_id: row.policyVersionId,
    opened_at: toIsoString(row.openedAt),
    first_response_due_at: toNullableIsoString(row.firstResponseDueAt),
    next_response_due_at: toNullableIsoString(row.nextResponseDueAt),
    resolution_due_at: toNullableIsoString(row.resolutionDueAt),
    resolved_at: toNullableIsoString(row.resolvedAt),
    closed_at: toNullableIsoString(row.closedAt),
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

function toNullableIsoString(value: Date | null): string | null {
  return value ? toIsoString(value) : null;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}
