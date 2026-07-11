import type { z } from "zod";
import {
  AiRunListResponseSchema,
  AiRunResourceResponseSchema,
  ApiErrorResponseSchema,
  ApprovalDecisionResponseSchema,
  ApprovalEvidenceResponseSchema,
  ApprovalListResponseSchema,
  ApprovalResourceResponseSchema,
  ApprovalSummaryResponseSchema,
  AuditEventListResponseSchema,
  AuditEventResourceResponseSchema,
  ConversationListResponseSchema,
  ConversationResourceResponseSchema,
  CustomerListResponseSchema,
  CustomerResourceResponseSchema,
  EffectiveAutomationPolicyResponseSchema,
  HealthResponseSchema,
  KbDocumentListResponseSchema,
  KbDocumentResourceResponseSchema,
  KbIngestionResultSchema,
  KbSearchResponseSchema,
  MessageListResponseSchema,
  MessageResourceResponseSchema,
  PolicyActivationResponseSchema,
  PolicyCreateResponseSchema,
  PolicyListResponseSchema,
  PolicyResourceResponseSchema,
  PolicyVersionListResponseSchema,
  PolicyVersionResourceResponseSchema,
  QaReviewEvidenceResponseSchema,
  QaReviewListResponseSchema,
  QaReviewResourceResponseSchema,
  SessionIdentityResponseSchema,
  TenantListResponseSchema,
  TenantResourceResponseSchema,
  TicketEventListResponseSchema,
  TicketListResponseSchema,
  TicketResourceResponseSchema,
  WeeklyPilotReportResponseSchema,
  type ApprovalApproveRequest,
  type ApprovalEditRequest,
  type ApprovalEscalateRequest,
  type ApprovalRejectRequest,
  type ApprovalStatus,
  type ApprovalType,
  type CustomerCreateRequest,
  type CustomerUpdateRequest,
  type KbDocumentCreateRequest,
  type KbDocumentUpdateRequest,
  type KbSearchRequest,
  type ListSortOrder,
  type PolicyCreateRequest,
  type PolicyVersionCreateRequest,
  type QaReviewCompleteRequest,
  type QaReviewCreateRequest,
  type TenantCreateRequest,
  type TenantUpdateRequest,
  type TicketCreateRequest,
  type TicketStatus,
  type TicketUpdateRequest,
} from "@support/shared-schemas";

export * from "./routes.js";

export interface SupportApiClientOptions {
  /** Base URL of the API, e.g. `https://api.example.com` (no trailing slash needed). */
  readonly baseUrl: string;
  /** Bearer token (IdP session token) sent as `Authorization: Bearer …`. */
  readonly token?: string;
  /** Tenant the caller operates on, sent as `x-tenant-id`. */
  readonly tenantId?: string;
  /** Injectable fetch (tests / non-browser runtimes). Defaults to global fetch. */
  readonly fetch?: typeof fetch;
}

/**
 * Thrown for any non-2xx response. `code` is the platform's structured error
 * code when the body parsed as an `ApiError`; otherwise a generic fallback.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly unknown[] = [],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type QueryValue = string | number | boolean | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface ApprovalListParams {
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: ListSortOrder;
  readonly status?: ApprovalStatus;
  readonly ticket_id?: string;
  readonly approval_type?: ApprovalType;
}

export interface TicketListParams {
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: ListSortOrder;
  readonly status?: TicketStatus;
  readonly customer_id?: string;
  readonly assigned_queue?: string;
  readonly updated_since?: string;
}

export interface PagingParams {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * A typed client over the Support API's `/v1/*` surface (Milestone 20). Every
 * method's return type is inferred from `@support/shared-schemas`, so the
 * console consumes the same contracts the API validates against. The wire
 * surface it covers is enumerated in `API_ROUTES` (see `./routes.ts`), which
 * the drift test binds to the registered Fastify routes and the OpenAPI doc.
 */
export class SupportApiClient {
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #tenantId: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: SupportApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#token = options.token;
    this.#tenantId = options.tenantId;

    if (options.fetch) {
      this.#fetch = options.fetch;
    } else if (globalThis.fetch) {
      // The default global `fetch` must keep its receiver bound to the global
      // object: stored as a field and invoked unbound (`this.#fetch(...)`), a
      // browser throws `TypeError: Illegal invocation`. Node's fetch tolerates
      // it, so this only bites in the browser — bind defensively.
      this.#fetch = globalThis.fetch.bind(globalThis);
    } else {
      throw new Error("No fetch implementation available; pass options.fetch.");
    }
  }

  /** Returns a copy of this client scoped to a different tenant. */
  withTenant(tenantId: string): SupportApiClient {
    return new SupportApiClient({
      baseUrl: this.#baseUrl,
      token: this.#token,
      tenantId,
      fetch: this.#fetch,
    });
  }

  // ---- health ------------------------------------------------------------
  health() {
    return this.#send("GET", "/health", HealthResponseSchema);
  }

  ready() {
    return this.#send("GET", "/ready", HealthResponseSchema);
  }

  // ---- session -----------------------------------------------------------
  /**
   * The authenticated caller's identity, roles, and permissions. Tenant-
   * optional (no `x-tenant-id` needed); the returned `tenant_id` is the
   * caller's home tenant, which the console scopes subsequent requests to.
   */
  me() {
    return this.#send("GET", "/v1/me", SessionIdentityResponseSchema);
  }

  // ---- tenants -----------------------------------------------------------
  listTenants(query?: PagingParams) {
    return this.#send("GET", "/v1/tenants", TenantListResponseSchema, {
      query,
    });
  }

  createTenant(body: TenantCreateRequest) {
    return this.#send("POST", "/v1/tenants", TenantResourceResponseSchema, {
      body,
    });
  }

  getTenant(tenantId: string) {
    return this.#send(
      "GET",
      `/v1/tenants/${seg(tenantId)}`,
      TenantResourceResponseSchema,
    );
  }

  updateTenant(tenantId: string, body: TenantUpdateRequest) {
    return this.#send(
      "PATCH",
      `/v1/tenants/${seg(tenantId)}`,
      TenantResourceResponseSchema,
      { body },
    );
  }

  // ---- customers ---------------------------------------------------------
  listCustomers(query?: QueryParams) {
    return this.#send("GET", "/v1/customers", CustomerListResponseSchema, {
      query,
    });
  }

  createCustomer(body: CustomerCreateRequest) {
    return this.#send("POST", "/v1/customers", CustomerResourceResponseSchema, {
      body,
    });
  }

  getCustomer(customerId: string) {
    return this.#send(
      "GET",
      `/v1/customers/${seg(customerId)}`,
      CustomerResourceResponseSchema,
    );
  }

  updateCustomer(customerId: string, body: CustomerUpdateRequest) {
    return this.#send(
      "PATCH",
      `/v1/customers/${seg(customerId)}`,
      CustomerResourceResponseSchema,
      { body },
    );
  }

  // ---- conversations -----------------------------------------------------
  listConversations(query?: QueryParams) {
    return this.#send(
      "GET",
      "/v1/conversations",
      ConversationListResponseSchema,
      { query },
    );
  }

  getConversation(conversationId: string) {
    return this.#send(
      "GET",
      `/v1/conversations/${seg(conversationId)}`,
      ConversationResourceResponseSchema,
    );
  }

  listMessages(conversationId: string, query?: QueryParams) {
    return this.#send(
      "GET",
      `/v1/conversations/${seg(conversationId)}/messages`,
      MessageListResponseSchema,
      { query },
    );
  }

  getMessage(conversationId: string, messageId: string) {
    return this.#send(
      "GET",
      `/v1/conversations/${seg(conversationId)}/messages/${seg(messageId)}`,
      MessageResourceResponseSchema,
    );
  }

  // ---- tickets -----------------------------------------------------------
  listTickets(query?: TicketListParams) {
    return this.#send("GET", "/v1/tickets", TicketListResponseSchema, {
      query,
    });
  }

  createTicket(body: TicketCreateRequest) {
    return this.#send("POST", "/v1/tickets", TicketResourceResponseSchema, {
      body,
    });
  }

  getTicket(ticketId: string) {
    return this.#send(
      "GET",
      `/v1/tickets/${seg(ticketId)}`,
      TicketResourceResponseSchema,
    );
  }

  updateTicket(ticketId: string, body: TicketUpdateRequest) {
    return this.#send(
      "PATCH",
      `/v1/tickets/${seg(ticketId)}`,
      TicketResourceResponseSchema,
      { body },
    );
  }

  listTicketAuditEvents(ticketId: string, query?: QueryParams) {
    return this.#send(
      "GET",
      `/v1/tickets/${seg(ticketId)}/audit-events`,
      AuditEventListResponseSchema,
      { query },
    );
  }

  listTicketEvents(ticketId: string, query?: PagingParams) {
    return this.#send(
      "GET",
      `/v1/tickets/${seg(ticketId)}/events`,
      TicketEventListResponseSchema,
      { query },
    );
  }

  // ---- approvals ---------------------------------------------------------
  listApprovals(query?: ApprovalListParams) {
    return this.#send("GET", "/v1/approvals", ApprovalListResponseSchema, {
      query,
    });
  }

  approvalSummary() {
    return this.#send(
      "GET",
      "/v1/approvals/summary",
      ApprovalSummaryResponseSchema,
    );
  }

  getApproval(approvalId: string) {
    return this.#send(
      "GET",
      `/v1/approvals/${seg(approvalId)}`,
      ApprovalResourceResponseSchema,
    );
  }

  approvalEvidence(approvalId: string) {
    return this.#send(
      "GET",
      `/v1/approvals/${seg(approvalId)}/evidence`,
      ApprovalEvidenceResponseSchema,
    );
  }

  approveApproval(approvalId: string, body: ApprovalApproveRequest = {}) {
    return this.#send(
      "POST",
      `/v1/approvals/${seg(approvalId)}/approve`,
      ApprovalDecisionResponseSchema,
      { body },
    );
  }

  editApproval(approvalId: string, body: ApprovalEditRequest) {
    return this.#send(
      "POST",
      `/v1/approvals/${seg(approvalId)}/edit`,
      ApprovalDecisionResponseSchema,
      { body },
    );
  }

  rejectApproval(approvalId: string, body: ApprovalRejectRequest = {}) {
    return this.#send(
      "POST",
      `/v1/approvals/${seg(approvalId)}/reject`,
      ApprovalDecisionResponseSchema,
      { body },
    );
  }

  escalateApproval(approvalId: string, body: ApprovalEscalateRequest = {}) {
    return this.#send(
      "POST",
      `/v1/approvals/${seg(approvalId)}/escalate`,
      ApprovalDecisionResponseSchema,
      { body },
    );
  }

  // ---- ai runs -----------------------------------------------------------
  listAiRuns(query?: QueryParams) {
    return this.#send("GET", "/v1/ai-runs", AiRunListResponseSchema, { query });
  }

  getAiRun(aiRunId: string) {
    return this.#send(
      "GET",
      `/v1/ai-runs/${seg(aiRunId)}`,
      AiRunResourceResponseSchema,
    );
  }

  // ---- qa reviews --------------------------------------------------------
  listQaReviews(query?: QueryParams) {
    return this.#send("GET", "/v1/qa-reviews", QaReviewListResponseSchema, {
      query,
    });
  }

  createQaReview(body: QaReviewCreateRequest) {
    return this.#send(
      "POST",
      "/v1/qa-reviews",
      QaReviewResourceResponseSchema,
      { body },
    );
  }

  getQaReview(qaReviewId: string) {
    return this.#send(
      "GET",
      `/v1/qa-reviews/${seg(qaReviewId)}`,
      QaReviewResourceResponseSchema,
    );
  }

  completeQaReview(qaReviewId: string, body: QaReviewCompleteRequest) {
    return this.#send(
      "POST",
      `/v1/qa-reviews/${seg(qaReviewId)}/complete`,
      QaReviewResourceResponseSchema,
      { body },
    );
  }

  qaReviewEvidence(qaReviewId: string) {
    return this.#send(
      "GET",
      `/v1/qa-reviews/${seg(qaReviewId)}/evidence`,
      QaReviewEvidenceResponseSchema,
    );
  }

  // ---- audit events ------------------------------------------------------
  listAuditEvents(query?: QueryParams) {
    return this.#send("GET", "/v1/audit-events", AuditEventListResponseSchema, {
      query,
    });
  }

  getAuditEvent(auditEventId: string) {
    return this.#send(
      "GET",
      `/v1/audit-events/${seg(auditEventId)}`,
      AuditEventResourceResponseSchema,
    );
  }

  // ---- policies ----------------------------------------------------------
  listPolicies(query?: QueryParams) {
    return this.#send("GET", "/v1/policies", PolicyListResponseSchema, {
      query,
    });
  }

  createPolicy(body: PolicyCreateRequest) {
    return this.#send("POST", "/v1/policies", PolicyCreateResponseSchema, {
      body,
    });
  }

  getAutomationPolicy() {
    return this.#send(
      "GET",
      "/v1/policies/automation",
      EffectiveAutomationPolicyResponseSchema,
    );
  }

  getPolicy(policyId: string) {
    return this.#send(
      "GET",
      `/v1/policies/${seg(policyId)}`,
      PolicyResourceResponseSchema,
    );
  }

  listPolicyVersions(policyId: string, query?: QueryParams) {
    return this.#send(
      "GET",
      `/v1/policies/${seg(policyId)}/versions`,
      PolicyVersionListResponseSchema,
      { query },
    );
  }

  createPolicyVersion(policyId: string, body: PolicyVersionCreateRequest) {
    return this.#send(
      "POST",
      `/v1/policies/${seg(policyId)}/versions`,
      PolicyVersionResourceResponseSchema,
      { body },
    );
  }

  archivePolicy(policyId: string) {
    return this.#send(
      "POST",
      `/v1/policies/${seg(policyId)}/archive`,
      PolicyResourceResponseSchema,
    );
  }

  activatePolicyVersion(policyVersionId: string) {
    return this.#send(
      "POST",
      `/v1/policy-versions/${seg(policyVersionId)}/activate`,
      PolicyActivationResponseSchema,
    );
  }

  // ---- knowledge base ----------------------------------------------------
  listKbDocuments(query?: QueryParams) {
    return this.#send("GET", "/v1/kb/documents", KbDocumentListResponseSchema, {
      query,
    });
  }

  createKbDocument(body: KbDocumentCreateRequest) {
    return this.#send(
      "POST",
      "/v1/kb/documents",
      KbDocumentResourceResponseSchema,
      { body },
    );
  }

  getKbDocument(kbDocumentId: string) {
    return this.#send(
      "GET",
      `/v1/kb/documents/${seg(kbDocumentId)}`,
      KbDocumentResourceResponseSchema,
    );
  }

  updateKbDocument(kbDocumentId: string, body: KbDocumentUpdateRequest) {
    return this.#send(
      "PATCH",
      `/v1/kb/documents/${seg(kbDocumentId)}`,
      KbDocumentResourceResponseSchema,
      { body },
    );
  }

  ingestKbDocument(kbDocumentId: string) {
    return this.#send(
      "POST",
      `/v1/kb/documents/${seg(kbDocumentId)}/ingest`,
      KbIngestionResultSchema,
    );
  }

  kbSearch(body: KbSearchRequest) {
    return this.#send("POST", "/v1/kb/search", KbSearchResponseSchema, {
      body,
    });
  }

  // ---- reports -----------------------------------------------------------
  pilotWeeklyReport(query?: QueryParams) {
    return this.#send(
      "GET",
      "/v1/reports/pilot-weekly",
      WeeklyPilotReportResponseSchema,
      { query },
    );
  }

  // ---- transport ---------------------------------------------------------
  async #send<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    // `query` is any typed params object; values are coerced to strings and
    // undefined/null are dropped (interfaces lack the index signature that a
    // strict QueryParams would demand).
    options: { query?: object; body?: unknown } = {},
  ): Promise<z.infer<S>> {
    const url = new URL(`${this.#baseUrl}${path}`);

    if (options.query) {
      for (const [key, value] of Object.entries(
        options.query as Record<string, unknown>,
      )) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = { accept: "application/json" };

    if (this.#token) {
      headers.authorization = `Bearer ${this.#token}`;
    }

    if (this.#tenantId) {
      headers["x-tenant-id"] = this.#tenantId;
    }

    let body: string | undefined;

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await this.#fetch(url.toString(), {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });

    const text = await response.text();
    const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const parsed = ApiErrorResponseSchema.safeParse(json);

      if (parsed.success) {
        throw new ApiClientError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.details,
        );
      }

      throw new ApiClientError(
        response.status,
        "INTERNAL_ERROR",
        `Request to ${method} ${path} failed with status ${response.status}.`,
      );
    }

    return schema.parse(json);
  }
}

function seg(value: string): string {
  return encodeURIComponent(value);
}
