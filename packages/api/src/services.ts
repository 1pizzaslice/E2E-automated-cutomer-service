import { randomUUID } from "node:crypto";
import {
  activeAutomationPolicyVersionQuery,
  aiDraftedTicketsCountQuery,
  aiRunByIdQuery,
  aiRunsListQuery,
  aiRunStatusCountsQuery,
  approvalByIdQuery,
  approvalResolutionCountsQuery,
  approvalsListQuery,
  approvalsRequestedCountQuery,
  auditActionCountQuery,
  auditEventByIdQuery,
  auditEventsListQuery,
  completeQaReviewByIdQuery,
  conversationByIdQuery,
  conversationsListQuery,
  firstResponseMinutesAvgQuery,
  outboundMessageCountsQuery,
  qaReviewsCompletedStatsQuery,
  qaReviewsCreatedCountQuery,
  ticketsCreatedCountQuery,
  ticketsResolvedStatsQuery,
  ticketTopTopicsQuery,
  createAuditEventQuery,
  createCustomerQuery,
  createDatabaseFromEnv,
  createQaReviewQuery,
  createTenantQuery,
  createTicketQuery,
  resolvePendingApprovalByIdQuery,
  customerByIdQuery,
  customersListQuery,
  kbDocumentByIdQuery,
  kbDocumentsListQuery,
  messageByIdQuery,
  messagesListQuery,
  policiesListQuery,
  policyByIdQuery,
  qaReviewByIdQuery,
  qaReviewsListQuery,
  tenantsListQuery,
  tenantByIdQuery,
  ticketByIdQuery,
  ticketsListQuery,
  toolCallsListQuery,
  updateCustomerByIdQuery,
  updateTenantByIdQuery,
  updateTicketByIdQuery,
  withTenantTransaction,
  type AiRun,
  type Approval,
  type AuditEvent,
  type Conversation,
  type Customer,
  type KbDocument,
  type Message,
  type NewCustomer,
  type NewTenant,
  type NewTicket,
  type PostgresClient,
  type QaReview,
  type Tenant,
  type TenantPolicy,
  type Ticket,
  type ToolCall,
} from "@support/db";
import {
  createNoopSupportMetrics,
  SUPPORT_ATTR,
  withSpan,
  type SupportMetrics,
} from "@support/observability";
import {
  AutomationPolicyContentSchema,
  SupportAuditActionSchema,
  type EffectiveAutomationPolicyResponse,
  type WeeklyPilotReport,
} from "@support/shared-schemas";
import type {
  AiRunListResponse,
  AiRunResponse,
  ApprovalDecisionResponse,
  ApprovalDecisionStatus,
  ApprovalListResponse,
  ApprovalResponse,
  ApprovalWorkflowSignalResult,
  AuditEventListResponse,
  AuditEventResponse,
  ConversationListResponse,
  ConversationResponse,
  CustomerCreateRequest,
  CustomerListResponse,
  CustomerResponse,
  CustomerUpdateRequest,
  KbDocumentCreateRequest,
  KbDocumentListResponse,
  KbDocumentResponse,
  KbDocumentUpdateRequest,
  KbIngestionResult,
  KbSearchRequest,
  KbSearchResponse,
  MessageListResponse,
  MessageResponse,
  PolicyListResponse,
  PolicyResponse,
  QaReviewCompleteRequest,
  QaReviewCreateRequest,
  QaReviewEvidenceResponse,
  QaReviewListResponse,
  QaReviewResponse,
  TenantCreateRequest,
  TenantListResponse,
  TenantResponse,
  TenantUpdateRequest,
  TicketCreateRequest,
  TicketListResponse,
  TicketResponse,
  TicketUpdateRequest,
  ToolCallResponse,
} from "@support/shared-schemas";
import { createEmbedderFromEnv, type Embedder } from "@support/integrations";
import {
  createTemporalApprovalWorkflowSignaler,
  type ApprovalWorkflowSignaler,
} from "./approval-workflow-signaler.js";
import { HttpError } from "./errors.js";
import {
  createDatabaseKbIngestionService,
  type KbIngestionService,
} from "./kb-ingestion.js";
import {
  createDatabaseKbRetrievalService,
  DEFAULT_KB_SEARCH_LIMIT,
  EmbeddingModelMismatchError,
  type KbRetrievalService,
} from "./kb-retrieval.js";
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

export interface ApprovalListOptions extends ListOptions {
  readonly status?: Approval["status"];
  readonly ticket_id?: string;
  readonly approval_type?: Approval["approvalType"];
}

export interface ApprovalDecisionInput {
  readonly status: ApprovalDecisionStatus;
  /** Human-edited payload; required by the route contract for `edited`. */
  readonly approved_payload?: Record<string, unknown>;
  readonly review_notes?: string | null;
}

export type ApprovalDecisionOutcome =
  | {
      readonly outcome: "resolved";
      readonly decision: ApprovalDecisionResponse;
    }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "conflict"; readonly approval: ApprovalResponse };

export interface AuditEventListOptions extends ListOptions {
  readonly actor_type?: AuditEvent["actorType"];
  readonly entity_type?: string;
  readonly entity_id?: string;
  readonly action?: string;
  readonly correlation_id?: string;
}

export interface AiRunListOptions extends ListOptions {
  readonly ticket_id?: string;
  readonly status?: AiRun["status"];
  readonly run_type?: AiRun["runType"];
}

export interface QaReviewListOptions extends ListOptions {
  readonly ticket_id?: string;
  readonly ai_run_id?: string;
  readonly completed?: boolean;
}

export type QaReviewCreateOutcome =
  | { readonly outcome: "created"; readonly review: QaReviewResponse }
  | { readonly outcome: "ticket_not_found" }
  | { readonly outcome: "ai_run_not_found" };

export type QaReviewCompleteOutcome =
  | { readonly outcome: "completed"; readonly review: QaReviewResponse }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "conflict"; readonly review: QaReviewResponse };

export interface ReportWindowOptions {
  readonly since: Date;
  readonly until: Date;
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
    getEffectiveAutomationPolicy(
      context: TenantRequestContext,
    ): Promise<EffectiveAutomationPolicyResponse>;
  };
  readonly reports: {
    weekly(
      context: TenantRequestContext,
      window: ReportWindowOptions,
    ): Promise<WeeklyPilotReport>;
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
    create(
      context: TenantRequestContext,
      input: KbDocumentCreateRequest,
    ): Promise<KbDocumentResponse>;
    update(
      context: TenantRequestContext,
      kbDocumentId: string,
      input: KbDocumentUpdateRequest,
    ): Promise<KbDocumentResponse | null>;
    ingest(
      context: TenantRequestContext,
      kbDocumentId: string,
    ): Promise<KbIngestionResult | null>;
    search(
      context: TenantRequestContext,
      input: KbSearchRequest,
    ): Promise<KbSearchResponse>;
  };
  readonly approvals: {
    list(
      context: TenantRequestContext,
      options: ApprovalListOptions,
    ): Promise<ApprovalListResponse>;
    getById(
      context: TenantRequestContext,
      approvalId: string,
    ): Promise<ApprovalResponse | null>;
    decide(
      context: TenantRequestContext,
      approvalId: string,
      decision: ApprovalDecisionInput,
    ): Promise<ApprovalDecisionOutcome>;
  };
  readonly aiRuns: {
    list(
      context: TenantRequestContext,
      options: AiRunListOptions,
    ): Promise<AiRunListResponse>;
    getById(
      context: TenantRequestContext,
      aiRunId: string,
    ): Promise<AiRunResponse | null>;
  };
  readonly qaReviews: {
    list(
      context: TenantRequestContext,
      options: QaReviewListOptions,
    ): Promise<QaReviewListResponse>;
    getById(
      context: TenantRequestContext,
      qaReviewId: string,
    ): Promise<QaReviewResponse | null>;
    create(
      context: TenantRequestContext,
      input: QaReviewCreateRequest,
    ): Promise<QaReviewCreateOutcome>;
    complete(
      context: TenantRequestContext,
      qaReviewId: string,
      input: QaReviewCompleteRequest,
    ): Promise<QaReviewCompleteOutcome>;
    evidence(
      context: TenantRequestContext,
      qaReviewId: string,
    ): Promise<QaReviewEvidenceResponse | null>;
  };
  readonly auditEvents: {
    list(
      context: TenantRequestContext,
      options: AuditEventListOptions,
    ): Promise<AuditEventListResponse>;
    listForTicket(
      context: TenantRequestContext,
      ticketId: string,
      options: AuditEventListOptions,
    ): Promise<AuditEventListResponse | null>;
    getById(
      context: TenantRequestContext,
      auditEventId: string,
    ): Promise<AuditEventResponse | null>;
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

export interface DatabaseApiServicesDeps {
  readonly kbIngestion?: KbIngestionService;
  readonly kbRetrieval?: KbRetrievalService;
  /**
   * The shared embedder instance wired into BOTH KB ingestion and retrieval
   * (Milestone 15, ADR-0014): chunk and query vectors must share one
   * embedding space. Defaults to the env-selected factory
   * (`SUPPORT_EMBEDDING_PROVIDER`; deterministic unless configured).
   */
  readonly embedder?: Embedder;
  readonly approvalSignaler?: ApprovalWorkflowSignaler;
  readonly metrics?: SupportMetrics;
}

export function createDatabaseApiServices(
  deps: DatabaseApiServicesDeps = {},
): ApiServices {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;
  const embedder =
    deps.embedder ??
    (deps.kbIngestion && deps.kbRetrieval
      ? undefined
      : createEmbedderFromEnv());
  const kbIngestion =
    deps.kbIngestion ??
    createDatabaseKbIngestionService(embedder ? { embedder } : {});
  const kbRetrieval =
    deps.kbRetrieval ??
    createDatabaseKbRetrievalService(embedder ? { embedder } : {});
  const approvalSignaler =
    deps.approvalSignaler ?? createTemporalApprovalWorkflowSignaler();
  const metrics = deps.metrics ?? createNoopSupportMetrics();

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
      async getEffectiveAutomationPolicy(context) {
        const tenantId = context.tenant.tenantId;

        return withTenantTransaction(getClient(), { tenantId }, async (db) => {
          const rows = await activeAutomationPolicyVersionQuery(db, {
            tenantId,
          });
          const row = rows[0];
          const content = row
            ? AutomationPolicyContentSchema.safeParse(row.content)
            : null;

          // Only a valid, activated automation policy version counts as
          // configured; anything else resolves to the safe defaults
          // (auto-send disabled, empty allowlist).
          if (!row || !content?.success) {
            return {
              tenant_id: tenantId,
              configured: false,
              policy_id: null,
              policy_version_id: null,
              version: null,
              activated_at: null,
              auto_send_enabled: false,
              auto_send_allowed_topics: [],
            };
          }

          return {
            tenant_id: tenantId,
            configured: true,
            policy_id: row.policyId,
            policy_version_id: row.policyVersionId,
            version: row.version,
            activated_at: row.activatedAt?.toISOString() ?? null,
            auto_send_enabled: content.data.auto_send_enabled,
            auto_send_allowed_topics: content.data.auto_send_allowed_topics,
          };
        });
      },
    },
    reports: {
      async weekly(context, window) {
        const tenantId = context.tenant.tenantId;
        const scope = { tenantId };

        return withTenantTransaction(getClient(), scope, async (db) => {
          const [
            createdRows,
            resolvedRows,
            firstResponseRows,
            escalationRows,
            slaBreachRows,
            aiStatusRows,
            draftedRows,
            approvalsRequestedRows,
            approvalResolutionRows,
            outboundRows,
            qaCreatedRows,
            qaCompletedRows,
            topTopicRows,
          ] = await Promise.all([
            ticketsCreatedCountQuery(db, scope, window),
            ticketsResolvedStatsQuery(db, scope, window),
            firstResponseMinutesAvgQuery(db, scope, window),
            auditActionCountQuery(db, scope, "ticket.manual_escalated", window),
            auditActionCountQuery(db, scope, "ticket.sla_breached", window),
            aiRunStatusCountsQuery(db, scope, window),
            aiDraftedTicketsCountQuery(db, scope, window),
            approvalsRequestedCountQuery(db, scope, window),
            approvalResolutionCountsQuery(db, scope, window),
            outboundMessageCountsQuery(db, scope, window),
            qaReviewsCreatedCountQuery(db, scope, window),
            qaReviewsCompletedStatsQuery(db, scope, window),
            ticketTopTopicsQuery(db, scope, window),
          ]);

          const ticketsCreated = createdRows[0]?.count ?? 0;
          const ticketsResolved = resolvedRows[0]?.count ?? 0;
          const manualEscalations = escalationRows[0]?.count ?? 0;

          const aiCounts = new Map(
            aiStatusRows.map((row) => [row.status, row.count]),
          );
          const aiSucceeded = aiCounts.get("succeeded") ?? 0;
          const aiFailed = aiCounts.get("failed") ?? 0;
          const aiTotal = aiStatusRows.reduce((sum, row) => sum + row.count, 0);
          const draftedTickets = draftedRows[0]?.count ?? 0;

          const approvalCounts = new Map(
            approvalResolutionRows.map((row) => [row.status, row.count]),
          );
          const approvalsApproved = approvalCounts.get("approved") ?? 0;
          const approvalsEdited = approvalCounts.get("edited") ?? 0;
          const approvalsRejected = approvalCounts.get("rejected") ?? 0;
          const approvalsEscalated = approvalCounts.get("escalated") ?? 0;
          const approvalsResolved =
            approvalsApproved +
            approvalsEdited +
            approvalsRejected +
            approvalsEscalated;

          let outboundSent = 0;
          let outboundFailed = 0;
          let autoSent = 0;
          for (const row of outboundRows) {
            if (row.sendStatus === "sent") {
              outboundSent += row.count;
              if (row.sentByType === "ai_auto") {
                autoSent += row.count;
              }
            } else if (row.sendStatus === "failed") {
              outboundFailed += row.count;
            }
          }

          const qaCompleted = qaCompletedRows[0]?.count ?? 0;
          const qaWithDefects = qaCompletedRows[0]?.withDefects ?? 0;

          const rate = (numerator: number, denominator: number) =>
            denominator > 0 ? numerator / denominator : null;

          return {
            tenant_id: tenantId,
            window: {
              since: window.since.toISOString(),
              until: window.until.toISOString(),
            },
            tickets: {
              created: ticketsCreated,
              resolved: ticketsResolved,
              manual_escalations: manualEscalations,
              sla_breaches: slaBreachRows[0]?.count ?? 0,
              first_response_minutes_avg:
                firstResponseRows[0]?.firstResponseMinutesAvg ?? null,
              resolution_minutes_avg:
                resolvedRows[0]?.resolutionMinutesAvg ?? null,
              escalation_rate: rate(manualEscalations, ticketsCreated),
            },
            ai_runs: {
              total: aiTotal,
              succeeded: aiSucceeded,
              failed: aiFailed,
              draft_rate: rate(draftedTickets, ticketsCreated),
            },
            approvals: {
              requested: approvalsRequestedRows[0]?.count ?? 0,
              approved: approvalsApproved,
              edited: approvalsEdited,
              rejected: approvalsRejected,
              escalated: approvalsEscalated,
              approval_rate: rate(
                approvalsApproved + approvalsEdited,
                approvalsResolved,
              ),
            },
            outbound_messages: {
              sent: outboundSent,
              failed: outboundFailed,
              auto_sent: autoSent,
              auto_send_rate: rate(autoSent, outboundSent),
            },
            qa_reviews: {
              created: qaCreatedRows[0]?.count ?? 0,
              completed: qaCompleted,
              with_defects: qaWithDefects,
              defect_rate: rate(qaWithDefects, qaCompleted),
            },
            top_topics: topTopicRows.flatMap((row) =>
              row.topic ? [{ topic: row.topic, count: row.count }] : [],
            ),
          };
        });
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
      async create(context, input) {
        const document = await kbIngestion.createDocument({
          tenantId: context.tenant.tenantId,
          createdByUserId: context.actor.userId ?? null,
          input,
        });

        return mapKbDocument(document);
      },
      async update(context, kbDocumentId, input) {
        const document = await kbIngestion.updateDocument({
          tenantId: context.tenant.tenantId,
          kbDocumentId,
          input,
        });

        return document ? mapKbDocument(document) : null;
      },
      async ingest(context, kbDocumentId) {
        return kbIngestion.ingestDocument({
          tenantId: context.tenant.tenantId,
          kbDocumentId,
        });
      },
      async search(context, input) {
        let results;

        try {
          results = await kbRetrieval.search({
            tenantId: context.tenant.tenantId,
            query: input.query,
            limit: input.limit,
            documentType: input.document_type,
            sourceType: input.source_type,
          });
        } catch (error) {
          // Embedding-space mismatch is an operator problem (provider swap
          // without a re-embed), surfaced as a clear conflict instead of a
          // generic 500; consumers (incl. the AI sidecar) fail safe on it.
          if (error instanceof EmbeddingModelMismatchError) {
            throw new HttpError(409, "CONFLICT", error.message);
          }

          throw error;
        }

        return {
          results,
          page: {
            count: results.length,
            limit: input.limit ?? DEFAULT_KB_SEARCH_LIMIT,
          },
        };
      },
    },
    approvals: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await approvalsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                status: options.status,
                ticketId: options.ticket_id,
                approvalType: options.approval_type,
              },
            );

            return {
              approvals: rows.map(mapApproval),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, approvalId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await approvalByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              approvalId,
            );

            return rows[0] ? mapApproval(rows[0]) : null;
          },
        );
      },
      async decide(context, approvalId, decision) {
        const tenantId = context.tenant.tenantId;
        const scope = { tenantId };
        const decidedAt = new Date();

        return withSpan(
          "approval.decide",
          {
            [SUPPORT_ATTR.tenantId]: tenantId,
            [SUPPORT_ATTR.approvalId]: approvalId,
            [SUPPORT_ATTR.correlationId]: context.correlationId,
            [SUPPORT_ATTR.outcome]: decision.status,
          },
          async () => {
            const resolution = await withTenantTransaction(
              getClient(),
              scope,
              async (db) => {
                const existingRows = await approvalByIdQuery(
                  db,
                  scope,
                  approvalId,
                );
                const existing = existingRows[0];

                if (!existing) {
                  return { kind: "not_found" as const };
                }

                if (existing.status !== "pending") {
                  return { kind: "conflict" as const, approval: existing };
                }

                // Approved decisions send the AI draft as-is, so the approved
                // payload mirrors the request; edited decisions carry the human
                // edit while `requested_payload` preserves the original AI draft
                // (BACKEND_SPEC §12). Rejected/escalated decisions approve nothing.
                const approvedPayload =
                  decision.status === "edited"
                    ? (decision.approved_payload ?? {})
                    : decision.status === "approved"
                      ? existing.requestedPayload
                      : null;

                const updatedRows = await resolvePendingApprovalByIdQuery(
                  db,
                  scope,
                  approvalId,
                  {
                    status: decision.status,
                    approvedPayload,
                    reviewerUserId: context.actor.userId,
                    reviewNotes: decision.review_notes ?? null,
                    resolvedAt: decidedAt,
                  },
                );
                const updated = updatedRows[0];

                if (!updated) {
                  return { kind: "conflict" as const, approval: existing };
                }

                await createAuditEventQuery(db, scope, {
                  auditEventId: createId("aud"),
                  actorType: "human",
                  actorId: context.actor.userId,
                  entityType: "approval",
                  entityId: approvalId,
                  action: SupportAuditActionSchema.parse(
                    `approval.${decision.status}`,
                  ),
                  metadata: {
                    ticket_id: existing.ticketId,
                    status: decision.status,
                    review_notes: decision.review_notes ?? null,
                    requested_payload: existing.requestedPayload,
                    approved_payload: approvedPayload,
                    decided_at: decidedAt.toISOString(),
                  },
                  correlationId: context.correlationId,
                });

                const ticketRows = await ticketByIdQuery(
                  db,
                  scope,
                  existing.ticketId,
                );

                return {
                  kind: "resolved" as const,
                  approval: updated,
                  conversationId: ticketRows[0]?.conversationId ?? null,
                };
              },
            );

            if (resolution.kind === "not_found") {
              return { outcome: "not_found" as const };
            }

            if (resolution.kind === "conflict") {
              return {
                outcome: "conflict" as const,
                approval: mapApproval(resolution.approval),
              };
            }

            metrics.recordApprovalDecision({
              decision: decision.status,
              latencyMs: Math.max(
                0,
                decidedAt.getTime() - resolution.approval.createdAt.getTime(),
              ),
            });

            let workflowSignal: ApprovalWorkflowSignalResult;

            if (resolution.conversationId === null) {
              workflowSignal = {
                delivered: false,
                workflow_id: null,
                reason: "ticket_not_found",
              };
            } else {
              try {
                const signalResult =
                  await approvalSignaler.signalApprovalCompleted({
                    workflowId: `ticket-lifecycle:${tenantId}:${resolution.conversationId}`,
                    signal: {
                      approval_id: approvalId,
                      status: decision.status,
                      actor_id: context.actor.userId,
                      decided_at: decidedAt.toISOString(),
                      notes: decision.review_notes ?? null,
                    },
                  });
                workflowSignal = {
                  delivered: signalResult.delivered,
                  workflow_id: signalResult.workflow_id,
                  reason: signalResult.reason,
                };
              } catch (error) {
                metrics.recordCriticalFailure("approval_signal_failed");
                throw new HttpError(
                  502,
                  "WORKFLOW_ERROR",
                  "The approval decision was recorded but the workflow signal failed; redeliver the signal before retrying.",
                  [
                    {
                      message:
                        error instanceof Error ? error.message : String(error),
                    },
                  ],
                );
              }
            }

            return {
              outcome: "resolved" as const,
              decision: {
                approval: mapApproval(resolution.approval),
                workflow_signal: workflowSignal,
              },
            };
          },
        );
      },
    },
    aiRuns: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await aiRunsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                ticketId: options.ticket_id,
                status: options.status,
                runType: options.run_type,
              },
            );

            return {
              ai_runs: rows.map(mapAiRun),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, aiRunId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await aiRunByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              aiRunId,
            );

            return rows[0] ? mapAiRun(rows[0]) : null;
          },
        );
      },
    },
    qaReviews: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await qaReviewsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                ticketId: options.ticket_id,
                aiRunId: options.ai_run_id,
                completed: options.completed,
              },
            );

            return {
              qa_reviews: rows.map(mapQaReview),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, qaReviewId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await qaReviewByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              qaReviewId,
            );

            return rows[0] ? mapQaReview(rows[0]) : null;
          },
        );
      },
      async create(context, input) {
        const scope = { tenantId: context.tenant.tenantId };

        return withTenantTransaction(getClient(), scope, async (db) => {
          const [ticket] = await ticketByIdQuery(db, scope, input.ticket_id);

          if (!ticket) {
            return { outcome: "ticket_not_found" as const };
          }

          const aiRunId = input.ai_run_id ?? null;

          if (aiRunId !== null) {
            const [aiRun] = await aiRunByIdQuery(db, scope, aiRunId);

            if (!aiRun) {
              return { outcome: "ai_run_not_found" as const };
            }
          }

          const rows = await createQaReviewQuery(db, scope, {
            qaReviewId: createId("qa"),
            ticketId: input.ticket_id,
            aiRunId,
            sampleReason: input.sample_reason,
            notes: input.notes ?? null,
          });

          return {
            outcome: "created" as const,
            review: mapQaReview(rows[0]!),
          };
        });
      },
      async complete(context, qaReviewId, input) {
        const scope = { tenantId: context.tenant.tenantId };

        return withTenantTransaction(getClient(), scope, async (db) => {
          const existingRows = await qaReviewByIdQuery(db, scope, qaReviewId);
          const existing = existingRows[0];

          if (!existing) {
            return { outcome: "not_found" as const };
          }

          if (existing.completedAt !== null) {
            return {
              outcome: "conflict" as const,
              review: mapQaReview(existing),
            };
          }

          const updatedRows = await completeQaReviewByIdQuery(
            db,
            scope,
            qaReviewId,
            {
              reviewerUserId: context.actor.userId,
              scores: input.scores,
              defects: input.defects.map((defect) => ({ ...defect })),
              ...(input.notes !== undefined ? { notes: input.notes } : {}),
              completedAt: new Date(),
            },
          );
          const updated = updatedRows[0];

          if (!updated) {
            return {
              outcome: "conflict" as const,
              review: mapQaReview(existing),
            };
          }

          return {
            outcome: "completed" as const,
            review: mapQaReview(updated),
          };
        });
      },
      async evidence(context, qaReviewId) {
        const scope = { tenantId: context.tenant.tenantId };

        return withTenantTransaction(getClient(), scope, async (db) => {
          const [review] = await qaReviewByIdQuery(db, scope, qaReviewId);

          if (!review) {
            return null;
          }

          const [ticket] = await ticketByIdQuery(db, scope, review.ticketId);

          if (!ticket) {
            return null;
          }

          const [conversation] = await conversationByIdQuery(
            db,
            scope,
            ticket.conversationId,
          );

          if (!conversation) {
            return null;
          }

          const messages = await messagesListQuery(
            db,
            scope,
            conversation.conversationId,
            { limit: 100 },
          );

          let aiRun: AiRun | null = null;

          if (review.aiRunId !== null) {
            const aiRunRows = await aiRunByIdQuery(db, scope, review.aiRunId);
            aiRun = aiRunRows[0] ?? null;
          }

          const toolCalls = await toolCallsListQuery(db, scope, {
            limit: 100,
            ...(aiRun
              ? { aiRunId: aiRun.aiRunId }
              : { ticketId: review.ticketId }),
          });
          const ticketApprovals = await approvalsListQuery(db, scope, {
            limit: 50,
            ticketId: review.ticketId,
          });

          return {
            qa_review: mapQaReview(review),
            ticket: mapTicket(ticket),
            conversation: mapConversation(conversation),
            messages: messages.map(mapMessage),
            ai_run: aiRun ? mapAiRun(aiRun) : null,
            tool_calls: toolCalls.map(mapToolCall),
            approvals: ticketApprovals.map(mapApproval),
          };
        });
      },
    },
    auditEvents: {
      async list(context, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await auditEventsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                actorType: options.actor_type,
                entityType: options.entity_type,
                entityId: options.entity_id,
                action: options.action,
                correlationId: options.correlation_id,
              },
            );

            return {
              audit_events: rows.map(mapAuditEvent),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async listForTicket(context, ticketId, options) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const [ticket] = await ticketByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              ticketId,
            );

            if (!ticket) {
              return null;
            }

            const rows = await auditEventsListQuery(
              db,
              { tenantId: context.tenant.tenantId },
              {
                limit: options.limit,
                actorType: options.actor_type,
                entityType: "ticket",
                entityId: ticketId,
                action: options.action,
                correlationId: options.correlation_id,
              },
            );

            return {
              audit_events: rows.map(mapAuditEvent),
              page: {
                count: rows.length,
                limit: options.limit,
              },
            };
          },
        );
      },
      async getById(context, auditEventId) {
        return withTenantTransaction(
          getClient(),
          { tenantId: context.tenant.tenantId },
          async (db) => {
            const rows = await auditEventByIdQuery(
              db,
              { tenantId: context.tenant.tenantId },
              auditEventId,
            );

            return rows[0] ? mapAuditEvent(rows[0]) : null;
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
      await kbIngestion.close?.();
      await kbRetrieval.close?.();
      await approvalSignaler.close?.();
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

function mapApproval(row: Approval): ApprovalResponse {
  return {
    approval_id: row.approvalId,
    tenant_id: row.tenantId,
    ticket_id: row.ticketId,
    ai_run_id: row.aiRunId,
    approval_type: row.approvalType,
    status: row.status,
    requested_payload: row.requestedPayload,
    approved_payload: row.approvedPayload,
    reviewer_user_id: row.reviewerUserId,
    review_notes: row.reviewNotes,
    created_at: toIsoString(row.createdAt),
    resolved_at: toNullableIsoString(row.resolvedAt),
  };
}

function mapAiRun(row: AiRun): AiRunResponse {
  return {
    ai_run_id: row.aiRunId,
    tenant_id: row.tenantId,
    ticket_id: row.ticketId,
    conversation_id: row.conversationId,
    run_type: row.runType,
    prompt_version: row.promptVersion,
    model_provider: row.modelProvider,
    model_id: row.modelId,
    input_refs: row.inputRefs,
    retrieved_context_refs: row.retrievedContextRefs,
    structured_output: row.structuredOutput,
    confidence: row.confidence,
    risk_level: row.riskLevel,
    automation_recommendation: row.automationRecommendation,
    guardrail_results: row.guardrailResults,
    status: row.status,
    latency_ms: row.latencyMs,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    cost_estimate: row.costEstimate,
    trace_id: row.traceId,
    created_at: toIsoString(row.createdAt),
    completed_at: toNullableIsoString(row.completedAt),
  };
}

function mapToolCall(row: ToolCall): ToolCallResponse {
  return {
    tool_call_id: row.toolCallId,
    tenant_id: row.tenantId,
    ticket_id: row.ticketId,
    ai_run_id: row.aiRunId,
    tool_definition_id: row.toolDefinitionId,
    input: row.input,
    output: row.output,
    status: row.status,
    side_effect_class: row.sideEffectClass,
    idempotency_key: row.idempotencyKey,
    started_at: toNullableIsoString(row.startedAt),
    completed_at: toNullableIsoString(row.completedAt),
    error_code: row.errorCode,
    error_message: row.errorMessage,
  };
}

function mapQaReview(row: QaReview): QaReviewResponse {
  return {
    qa_review_id: row.qaReviewId,
    tenant_id: row.tenantId,
    ticket_id: row.ticketId,
    ai_run_id: row.aiRunId,
    reviewer_user_id: row.reviewerUserId,
    sample_reason: row.sampleReason,
    scores: row.scores,
    defects: row.defects,
    notes: row.notes,
    created_at: toIsoString(row.createdAt),
    completed_at: toNullableIsoString(row.completedAt),
  };
}

function mapAuditEvent(row: AuditEvent): AuditEventResponse {
  return {
    audit_event_id: row.auditEventId,
    tenant_id: row.tenantId,
    actor_type: row.actorType,
    actor_id: row.actorId,
    entity_type: row.entityType,
    entity_id: row.entityId,
    action: row.action,
    metadata: row.metadata,
    correlation_id: row.correlationId,
    created_at: toIsoString(row.createdAt),
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
