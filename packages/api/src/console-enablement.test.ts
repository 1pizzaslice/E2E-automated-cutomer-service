import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApprovalEvidenceResponseSchema,
  ApprovalListResponseSchema,
  ApprovalSummaryResponseSchema,
  TicketEventListResponseSchema,
  TicketListResponseSchema,
  type ApprovalResponse,
  type ConversationResponse,
  type MessageResponse,
  type TicketResponse,
} from "@support/shared-schemas";
import { buildApp } from "./app.js";
import type { ApiServices } from "./services.js";

// Milestone 20 read surfaces: queue ergonomics (order/offset/has_more), the
// approvals summary + evidence composite, the ticket-events timeline, and the
// ETag/If-None-Match freshness contract. Exercised through the insecure-header
// mode with a support_agent (holds approvals:read + tickets:read).
process.env.SUPPORT_AUTH_MODE = "insecure-headers";

const now = "2026-06-19T00:00:00.000Z";
const headers = {
  authorization: "Bearer test-token",
  "x-user-id": "usr_test",
  "x-user-roles": "support_agent",
  "x-tenant-id": "ten_test",
};

const approvalFixture: ApprovalResponse = {
  approval_id: "apr_test",
  tenant_id: "ten_test",
  ticket_id: "tic_test",
  ai_run_id: "air_test",
  approval_type: "reply",
  status: "pending",
  requested_payload: { draft: "Original AI draft." },
  approved_payload: null,
  reviewer_user_id: null,
  review_notes: null,
  created_at: now,
  resolved_at: null,
};

const ticketFixture: TicketResponse = {
  ticket_id: "tic_test",
  tenant_id: "ten_test",
  conversation_id: "cnv_test",
  customer_id: "cus_test",
  status: "new",
  priority: "p2",
  topic: null,
  subtopic: null,
  language: null,
  sentiment: null,
  urgency_score: null,
  automation_mode: "human_approve",
  assigned_queue: null,
  assigned_user_id: null,
  sla_policy_id: null,
  policy_version_id: null,
  opened_at: now,
  first_response_due_at: null,
  next_response_due_at: null,
  resolution_due_at: null,
  resolved_at: null,
  closed_at: null,
  created_at: now,
  updated_at: now,
};

const conversationFixture: ConversationResponse = {
  conversation_id: "cnv_test",
  tenant_id: "ten_test",
  customer_id: "cus_test",
  channel_id: "chn_test",
  external_thread_id: null,
  status: "open",
  last_message_at: now,
  created_at: now,
  updated_at: now,
};

const messageFixture: MessageResponse = {
  message_id: "msg_test",
  tenant_id: "ten_test",
  conversation_id: "cnv_test",
  ticket_id: "tic_test",
  channel_id: "chn_test",
  direction: "inbound",
  body_text: "Where is my order?",
  body_html_ref: null,
  attachments: [],
  external_message_id: null,
  external_thread_id: null,
  raw_payload_ref: null,
  created_by_type: "customer",
  created_by_user_id: null,
  provider_message_id: null,
  send_status: null,
  sent_by_type: null,
  ai_run_id: null,
  approval_id: null,
  sent_at: null,
  idempotency_key: null,
  created_at: now,
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("approval queue ergonomics", () => {
  it("forwards order/offset/limit and returns a paginated page with an ETag", async () => {
    const list = vi.fn().mockResolvedValue({
      approvals: [approvalFixture],
      page: { count: 1, limit: 5, offset: 10, has_more: true },
    });
    app = buildApp({
      services: { approvals: { list } } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals?status=pending&order=created_asc&offset=10&limit=5",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "pending",
        order: "created_asc",
        offset: 10,
        limit: 5,
      }),
    );
    const body = ApprovalListResponseSchema.parse(response.json());
    expect(body.page).toMatchObject({ offset: 10, has_more: true });
    expect(response.headers.etag).toBeDefined();
  });

  it("returns 304 when the client's If-None-Match matches", async () => {
    const list = vi.fn().mockResolvedValue({
      approvals: [approvalFixture],
      page: { count: 1, limit: 50, offset: 0, has_more: false },
    });
    app = buildApp({
      services: { approvals: { list } } as unknown as ApiServices,
    });

    const first = await app.inject({
      method: "GET",
      url: "/v1/approvals",
      headers,
    });
    const etag = first.headers.etag as string;
    expect(etag).toBeDefined();

    const second = await app.inject({
      method: "GET",
      url: "/v1/approvals",
      headers: { ...headers, "if-none-match": etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("rejects a non-integer offset", async () => {
    app = buildApp({
      services: { approvals: { list: vi.fn() } } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals?offset=-1",
      headers,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("approval summary", () => {
  it("returns per-status counts and the total", async () => {
    const summary = vi.fn().mockResolvedValue({
      counts: {
        pending: 3,
        approved: 10,
        edited: 2,
        rejected: 1,
        escalated: 0,
        expired: 0,
      },
      total: 16,
    });
    app = buildApp({
      services: { approvals: { summary } } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals/summary",
      headers,
    });

    expect(response.statusCode).toBe(200);
    const body = ApprovalSummaryResponseSchema.parse(response.json());
    expect(body.counts.pending).toBe(3);
    expect(body.total).toBe(16);
  });
});

describe("approval evidence composite", () => {
  it("returns the composite with prior approvals for the ticket", async () => {
    const evidence = vi.fn().mockResolvedValue({
      approval: approvalFixture,
      ticket: ticketFixture,
      conversation: conversationFixture,
      messages: [messageFixture],
      ai_run: null,
      tool_calls: [],
      prior_approvals: [],
    });
    app = buildApp({
      services: {
        approvals: { evidence },
      } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals/apr_test/evidence",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(evidence).toHaveBeenCalledWith(expect.anything(), "apr_test");
    const body = ApprovalEvidenceResponseSchema.parse(response.json());
    expect(body.approval.approval_id).toBe("apr_test");
    expect(body.messages).toHaveLength(1);
  });

  it("404s when the approval is missing", async () => {
    app = buildApp({
      services: {
        approvals: { evidence: vi.fn().mockResolvedValue(null) },
      } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals/apr_missing/evidence",
      headers,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("ticket ergonomics and events", () => {
  it("forwards updated_since/order/offset on the ticket list", async () => {
    const list = vi.fn().mockResolvedValue({
      tickets: [ticketFixture],
      page: { count: 1, limit: 50, offset: 2, has_more: false },
    });
    app = buildApp({
      services: { tickets: { list } } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets?updated_since=2026-06-01T00:00:00.000Z&order=created_asc&offset=2",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        updated_since: "2026-06-01T00:00:00.000Z",
        order: "created_asc",
        offset: 2,
      }),
    );
    TicketListResponseSchema.parse(response.json());
    expect(response.headers.etag).toBeDefined();
  });

  it("rejects a malformed updated_since", async () => {
    app = buildApp({
      services: { tickets: { list: vi.fn() } } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets?updated_since=not-a-date",
      headers,
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns the ticket-event timeline", async () => {
    const listEvents = vi.fn().mockResolvedValue({
      ticket_events: [
        {
          ticket_event_id: "tev_1",
          tenant_id: "ten_test",
          ticket_id: "tic_test",
          event_type: "status_transition",
          from_status: null,
          to_status: "new",
          actor_type: "system",
          actor_id: null,
          reason_code: null,
          metadata: null,
          created_at: now,
        },
      ],
      page: { count: 1, limit: 50, offset: 0, has_more: false },
    });
    app = buildApp({
      services: { tickets: { listEvents } } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/tic_test/events",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(listEvents).toHaveBeenCalledWith(
      expect.anything(),
      "tic_test",
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
    const body = TicketEventListResponseSchema.parse(response.json());
    expect(body.ticket_events[0]?.to_status).toBe("new");
  });

  it("404s the timeline when the ticket is missing", async () => {
    app = buildApp({
      services: {
        tickets: { listEvents: vi.fn().mockResolvedValue(null) },
      } as unknown as ApiServices,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/tickets/tic_missing/events",
      headers,
    });

    expect(response.statusCode).toBe(404);
  });
});
