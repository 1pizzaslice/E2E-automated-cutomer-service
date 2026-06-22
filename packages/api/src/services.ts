import { randomUUID } from "node:crypto";
import {
  conversationByIdQuery,
  conversationsListQuery,
  createCustomerQuery,
  createDatabaseFromEnv,
  createTenantQuery,
  createTicketQuery,
  customerByIdQuery,
  customersListQuery,
  kbDocumentByIdQuery,
  kbDocumentsListQuery,
  messageByIdQuery,
  messagesListQuery,
  policiesListQuery,
  policyByIdQuery,
  tenantsListQuery,
  tenantByIdQuery,
  ticketByIdQuery,
  ticketsListQuery,
  updateCustomerByIdQuery,
  updateTenantByIdQuery,
  updateTicketByIdQuery,
  withTenantTransaction,
  type Conversation,
  type Customer,
  type KbDocument,
  type Message,
  type NewCustomer,
  type NewTenant,
  type NewTicket,
  type PostgresClient,
  type Tenant,
  type TenantPolicy,
  type Ticket,
} from "@support/db";
import type {
  ConversationListResponse,
  ConversationResponse,
  CustomerCreateRequest,
  CustomerListResponse,
  CustomerResponse,
  CustomerUpdateRequest,
  KbDocumentListResponse,
  KbDocumentResponse,
  MessageListResponse,
  MessageResponse,
  PolicyListResponse,
  PolicyResponse,
  TenantCreateRequest,
  TenantListResponse,
  TenantResponse,
  TenantUpdateRequest,
  TicketCreateRequest,
  TicketListResponse,
  TicketResponse,
  TicketUpdateRequest,
} from "@support/shared-schemas";
import type {
  AuthenticatedRequestContext,
  TenantRequestContext,
} from "./request-context.js";

export interface ListOptions {
  readonly limit: number;
}

export interface CustomerListOptions extends ListOptions {
  readonly email?: string;
  readonly external_customer_ref?: string;
}

export interface ConversationListOptions extends ListOptions {
  readonly status?: Conversation["status"];
  readonly customer_id?: string;
  readonly channel_id?: string;
}

export interface MessageListOptions extends ListOptions {
  readonly direction?: Message["direction"];
  readonly ticket_id?: string;
}

export interface TicketListOptions extends ListOptions {
  readonly status?: Ticket["status"];
  readonly customer_id?: string;
  readonly assigned_queue?: string;
}

export interface PolicyListOptions extends ListOptions {
  readonly domain?: TenantPolicy["domain"];
  readonly status?: TenantPolicy["status"];
}

export interface KbDocumentListOptions extends ListOptions {
  readonly source_type?: KbDocument["sourceType"];
  readonly document_type?: KbDocument["documentType"];
  readonly status?: KbDocument["status"];
}

export interface ApiServices {
  readonly tenants: {
    list(
      context: AuthenticatedRequestContext,
      options: ListOptions,
    ): Promise<TenantListResponse>;
    create(
      context: AuthenticatedRequestContext,
      input: TenantCreateRequest,
    ): Promise<TenantResponse>;
    getById(
      context: TenantRequestContext,
      tenantId: string,
    ): Promise<TenantResponse | null>;
    update(
      context: AuthenticatedRequestContext,
      tenantId: string,
      input: TenantUpdateRequest,
    ): Promise<TenantResponse | null>;
  };
  readonly customers: {
    list(
      context: TenantRequestContext,
      options: CustomerListOptions,
    ): Promise<CustomerListResponse>;
    create(
      context: TenantRequestContext,
      input: CustomerCreateRequest,
    ): Promise<CustomerResponse>;
    getById(
      context: TenantRequestContext,
      customerId: string,
    ): Promise<CustomerResponse | null>;
    update(
      context: TenantRequestContext,
      customerId: string,
      input: CustomerUpdateRequest,
    ): Promise<CustomerResponse | null>;
  };
  readonly conversations: {
    list(
      context: TenantRequestContext,
      options: ConversationListOptions,
    ): Promise<ConversationListResponse>;
    getById(
      context: TenantRequestContext,
      conversationId: string,
    ): Promise<ConversationResponse | null>;
  };
  readonly messages: {
    list(
      context: TenantRequestContext,
      conversationId: string,
      options: MessageListOptions,
    ): Promise<MessageListResponse | null>;
    getById(
      context: TenantRequestContext,
      conversationId: string,
      messageId: string,
    ): Promise<MessageResponse | null>;
  };
  readonly policies: {
    list(
      context: TenantRequestContext,
      options: PolicyListOptions,
    ): Promise<PolicyListResponse>;
    getById(
      context: TenantRequestContext,
      policyId: string,
    ): Promise<PolicyResponse | null>;
  };
  readonly kbDocuments: {
    list(
      context: TenantRequestContext,
      options: KbDocumentListOptions,
    ): Promise<KbDocumentListResponse>;
    getById(
      context: TenantRequestContext,
      kbDocumentId: string,
    ): Promise<KbDocumentResponse | null>;
  };
  readonly tickets: {
    list(
      context: TenantRequestContext,
      options: TicketListOptions,
    ): Promise<TicketListResponse>;
    create(
      context: TenantRequestContext,
      input: TicketCreateRequest,
    ): Promise<TicketResponse | null>;
    getById(
      context: TenantRequestContext,
      ticketId: string,
    ): Promise<TicketResponse | null>;
    update(
      context: TenantRequestContext,
      ticketId: string,
      input: TicketUpdateRequest,
    ): Promise<TicketResponse | null>;
  };
  readonly close?: () => Promise<void>;
}

export function createDatabaseApiServices(): ApiServices {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase(): ReturnType<typeof createDatabaseFromEnv> {
    if (!database) {
      database = createDatabaseFromEnv();
    }

    return database;
  }

  function getClient(): PostgresClient {
    return getDatabase().client;
  }

  return {
    tenants: {
      async list(_context, options) {
        const rows = await tenantsListQuery(getDatabase().db, {
          limit: options.limit,
        });

        return {
          tenants: rows.map(mapTenant),
          page: {
            count: rows.length,
            limit: options.limit,
          },
        };
      },
      async create(_context, input) {
        const rows = await createTenantQuery(getDatabase().db, {
          tenantId: input.tenant_id ?? createId("ten"),
          name: input.name,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.default_timezone !== undefined
            ? { defaultTimezone: input.default_timezone }
            : {}),
        });

        return mapTenant(rows[0]!);
      },
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
      async update(context, tenantId, input) {
        const values: Partial<NewTenant> = removeUndefined({
          name: input.name,
          status: input.status,
          defaultTimezone: input.default_timezone,
          updatedAt: new Date(),
        });
        const rows = isPlatformAdmin(context)
          ? await updateTenantByIdQuery(getDatabase().db, tenantId, values)
          : await withTenantTransaction(
              getClient(),
              { tenantId: context.tenant!.tenantId },
              (db) => updateTenantByIdQuery(db, tenantId, values),
            );

        return rows[0] ? mapTenant(rows[0]) : null;
      },
    },
    customers: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await customersListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                email: options.email,
                externalCustomerRef: options.external_customer_ref,
              },
            );

            return {
              customers: rows.map(mapCustomer),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async create(context, input) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const values: Omit<NewCustomer, "tenantId"> = removeUndefined({
              customerId: input.customer_id ?? createId("cus"),
              displayName: input.display_name,
              email: input.email,
              phone: input.phone,
              externalCustomerRef: input.external_customer_ref,
              metadata: input.metadata,
            });
            const rows = await createCustomerQuery(
              db,
              { tenantId: context.tenant.tenantId },
              values,
            );

            return mapCustomer(rows[0]!);
          },
        );
      },
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
      async update(context, customerId, input) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const values: Partial<NewCustomer> = removeUndefined({
              displayName: input.display_name,
              email: input.email,
              phone: input.phone,
              externalCustomerRef: input.external_customer_ref,
              metadata: input.metadata,
              updatedAt: new Date(),
            });
            const rows = await updateCustomerByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              customerId,
              values,
            );

            return rows[0] ? mapCustomer(rows[0]) : null;
          },
        );
      },
    },
    conversations: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await conversationsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                status: options.status,
                customerId: options.customer_id,
                channelId: options.channel_id,
              },
            );

            return {
              conversations: rows.map(mapConversation),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, conversationId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await conversationByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              conversationId,
            );

            return rows[0] ? mapConversation(rows[0]) : null;
          },
        );
      },
    },
    messages: {
      async list(context, conversationId, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const [conversation] = await conversationByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              conversationId,
            );

            if (!conversation) {
              return null;
            }

            const rows = await messagesListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              conversationId,
              {
                limit: options.limit,
                direction: options.direction,
                ticketId: options.ticket_id,
              },
            );

            return {
              messages: rows.map(mapMessage),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, conversationId, messageId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await messageByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              conversationId,
              messageId,
            );

            return rows[0] ? mapMessage(rows[0]) : null;
          },
        );
      },
    },
    policies: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await policiesListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                domain: options.domain,
                status: options.status,
              },
            );

            return {
              policies: rows.map(mapPolicy),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, policyId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await policyByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              policyId,
            );

            return rows[0] ? mapPolicy(rows[0]) : null;
          },
        );
      },
    },
    kbDocuments: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await kbDocumentsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                sourceType: options.source_type,
                documentType: options.document_type,
                status: options.status,
              },
            );

            return {
              kb_documents: rows.map(mapKbDocument),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, kbDocumentId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await kbDocumentByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              kbDocumentId,
            );

            return rows[0] ? mapKbDocument(rows[0]) : null;
          },
        );
      },
    },
    tickets: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await ticketsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                status: options.status,
                customerId: options.customer_id,
                assignedQueue: options.assigned_queue,
              },
            );

            return {
              tickets: rows.map(mapTicket),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async create(context, input) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const [customer] = await customerByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              input.customer_id,
            );
            const [conversation] = await conversationByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              input.conversation_id,
            );

            if (
              !customer ||
              !conversation ||
              conversation.customerId !== customer.customerId
            ) {
              return null;
            }

            const values: Omit<NewTicket, "tenantId"> = removeUndefined({
              ticketId: input.ticket_id ?? createId("tic"),
              conversationId: input.conversation_id,
              customerId: input.customer_id,
              priority: input.priority,
              topic: input.topic,
              subtopic: input.subtopic,
              language: input.language,
              sentiment: input.sentiment,
              urgencyScore: input.urgency_score,
              automationMode: input.automation_mode,
              assignedQueue: input.assigned_queue,
              assignedUserId: input.assigned_user_id,
              slaPolicyId: input.sla_policy_id,
              policyVersionId: input.policy_version_id,
              openedAt: input.opened_at
                ? new Date(input.opened_at)
                : new Date(),
              firstResponseDueAt: toDateOrNull(input.first_response_due_at),
              nextResponseDueAt: toDateOrNull(input.next_response_due_at),
              resolutionDueAt: toDateOrNull(input.resolution_due_at),
            });
            const rows = await createTicketQuery(
              db,
              { tenantId: context.tenant.tenantId },
              values,
            );

            return mapTicket(rows[0]!);
          },
        );
      },
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
      async update(context, ticketId, input) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const values: Partial<NewTicket> = removeUndefined({
              priority: input.priority,
              topic: input.topic,
              subtopic: input.subtopic,
              language: input.language,
              sentiment: input.sentiment,
              urgencyScore: input.urgency_score,
              automationMode: input.automation_mode,
              assignedQueue: input.assigned_queue,
              assignedUserId: input.assigned_user_id,
              slaPolicyId: input.sla_policy_id,
              policyVersionId: input.policy_version_id,
              firstResponseDueAt: toDateOrNull(input.first_response_due_at),
              nextResponseDueAt: toDateOrNull(input.next_response_due_at),
              resolutionDueAt: toDateOrNull(input.resolution_due_at),
              updatedAt: new Date(),
            });
            const rows = await updateTicketByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              ticketId,
              values,
            );

            return rows[0] ? mapTicket(rows[0]) : null;
          },
        );
      },
    },
    async close() {
      await database?.client.end();
    },
  };
}

function isPlatformAdmin(context: AuthenticatedRequestContext): boolean {
  return context.actor.roles.includes("platform_admin");
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function removeUndefined<T extends Record<string, unknown>>(
  values: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function toDateOrNull(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === null ? null : new Date(value);
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

function mapConversation(row: Conversation): ConversationResponse {
  return {
    conversation_id: row.conversationId,
    tenant_id: row.tenantId,
    customer_id: row.customerId,
    channel_id: row.channelId,
    external_thread_id: row.externalThreadId,
    status: row.status,
    last_message_at: toNullableIsoString(row.lastMessageAt),
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

function mapMessage(row: Message): MessageResponse {
  return {
    message_id: row.messageId,
    tenant_id: row.tenantId,
    conversation_id: row.conversationId,
    ticket_id: row.ticketId,
    channel_id: row.channelId,
    direction: row.direction,
    body_text: row.bodyText,
    body_html_ref: row.bodyHtmlRef,
    attachments: row.attachments,
    external_message_id: row.externalMessageId,
    external_thread_id: row.externalThreadId,
    raw_payload_ref: row.rawPayloadRef,
    created_by_type: row.createdByType,
    created_by_user_id: row.createdByUserId,
    provider_message_id: row.providerMessageId,
    send_status: row.sendStatus,
    sent_by_type: row.sentByType,
    ai_run_id: row.aiRunId,
    approval_id: row.approvalId,
    sent_at: toNullableIsoString(row.sentAt),
    idempotency_key: row.idempotencyKey,
    created_at: toIsoString(row.createdAt),
  };
}

function mapPolicy(row: TenantPolicy): PolicyResponse {
  return {
    policy_id: row.policyId,
    tenant_id: row.tenantId,
    name: row.name,
    domain: row.domain,
    status: row.status,
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

function mapKbDocument(row: KbDocument): KbDocumentResponse {
  return {
    kb_document_id: row.kbDocumentId,
    tenant_id: row.tenantId,
    title: row.title,
    source_type: row.sourceType,
    source_ref: row.sourceRef,
    document_type: row.documentType,
    status: row.status,
    version: row.version,
    content_hash: row.contentHash,
    created_by_user_id: row.createdByUserId,
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
