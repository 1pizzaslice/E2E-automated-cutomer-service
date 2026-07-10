import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "@support/api";
import { SupportApiClient } from "@support/api-client";
import { runReviewFlow, type ReviewStrategy } from "./review-flow.js";

// The Milestone 20 acceptance proof: login → queue → evidence → decide runs
// purely through @support/api-client against the REAL Fastify app. The client's
// transport is an app.inject() adapter (no socket), and the app runs in the
// insecure-header harness so the adapter can supply the reviewer identity a
// verified token would otherwise carry.
process.env.SUPPORT_AUTH_MODE = "insecure-headers";

type ApiServices = NonNullable<BuildAppOptions["services"]>;
type App = ReturnType<typeof buildApp>;

const now = "2026-06-19T00:00:00.000Z";

const approval = {
  approval_id: "apr_1",
  tenant_id: "ten_1",
  ticket_id: "tic_1",
  ai_run_id: null,
  approval_type: "reply" as const,
  status: "pending" as const,
  requested_payload: { draft: "The original AI draft reply." },
  approved_payload: null,
  reviewer_user_id: null,
  review_notes: null,
  created_at: now,
  resolved_at: null,
};

const ticket = {
  ticket_id: "tic_1",
  tenant_id: "ten_1",
  conversation_id: "cnv_1",
  customer_id: "cus_1",
  status: "waiting_human" as const,
  priority: "p2" as const,
  topic: null,
  subtopic: null,
  language: null,
  sentiment: null,
  urgency_score: null,
  automation_mode: "human_approve" as const,
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

const conversation = {
  conversation_id: "cnv_1",
  tenant_id: "ten_1",
  customer_id: "cus_1",
  channel_id: "chn_1",
  external_thread_id: null,
  status: "open" as const,
  last_message_at: now,
  created_at: now,
  updated_at: now,
};

const message = {
  message_id: "msg_1",
  tenant_id: "ten_1",
  conversation_id: "cnv_1",
  ticket_id: "tic_1",
  channel_id: "chn_1",
  direction: "inbound" as const,
  body_text: "Where is my order?",
  body_html_ref: null,
  attachments: [],
  external_message_id: null,
  external_thread_id: null,
  raw_payload_ref: null,
  created_by_type: "customer" as const,
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

interface DecideCall {
  approvalId: string;
  status: string;
}

function makeServices(decideCalls: DecideCall[]): ApiServices {
  return {
    approvals: {
      async summary() {
        return {
          counts: {
            pending: 1,
            approved: 0,
            edited: 0,
            rejected: 0,
            escalated: 0,
            expired: 0,
          },
          total: 1,
        };
      },
      async list() {
        return {
          approvals: [approval],
          page: { count: 1, limit: 20, offset: 0, has_more: false },
        };
      },
      async evidence(_context: unknown, approvalId: string) {
        if (approvalId !== approval.approval_id) {
          return null;
        }
        return {
          approval,
          ticket,
          conversation,
          messages: [message],
          ai_run: null,
          tool_calls: [],
          prior_approvals: [],
        };
      },
      async decide(
        context: { actor: { userId: string } },
        approvalId: string,
        decision: {
          status: string;
          approved_payload?: Record<string, unknown>;
          review_notes?: string | null;
        },
      ) {
        decideCalls.push({ approvalId, status: decision.status });
        return {
          outcome: "resolved",
          decision: {
            approval: {
              ...approval,
              status: decision.status,
              approved_payload:
                decision.status === "edited"
                  ? (decision.approved_payload ?? {})
                  : decision.status === "approved"
                    ? approval.requested_payload
                    : null,
              reviewer_user_id: context.actor.userId,
              review_notes: decision.review_notes ?? null,
              resolved_at: now,
            },
            workflow_signal: {
              delivered: true,
              workflow_id: `ticket-lifecycle:ten_1:cnv_1`,
              reason: null,
            },
          },
        };
      },
    },
  } as unknown as ApiServices;
}

/**
 * Routes the client's requests into the in-process app via `inject`, adding the
 * authenticated reviewer's identity (what a verified token would decode to).
 */
function injectTransport(app: App): typeof fetch {
  return (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const response = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: `${url.pathname}${url.search}`,
      headers: {
        ...((init?.headers as Record<string, string>) ?? {}),
        "x-user-id": "usr_reviewer",
        "x-user-roles": "support_agent",
      },
      ...(init?.body ? { payload: init.body as string } : {}),
    });

    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      text: async () => response.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function makeClient(services: ApiServices): SupportApiClient {
  app = buildApp({
    services,
    internalAuth: null,
    cors: null,
    rateLimit: null,
  });

  return new SupportApiClient({
    baseUrl: "http://console.local",
    token: "reviewer-session-token",
    tenantId: "ten_1",
    fetch: injectTransport(app),
  });
}

describe("console review flow (contract proof)", () => {
  it("runs login → queue → evidence → approve through the typed client", async () => {
    const decideCalls: DecideCall[] = [];
    const client = makeClient(makeServices(decideCalls));

    const approveAll: ReviewStrategy = () => ({ action: "approve" });
    const result = await runReviewFlow(client, approveAll);

    expect(result.pendingCount).toBe(1);
    expect(result.reviewed).toEqual({
      approvalId: "apr_1",
      ticketId: "tic_1",
      action: "approve",
      delivered: true,
    });
    expect(decideCalls).toEqual([{ approvalId: "apr_1", status: "approved" }]);
  });

  it("edits the draft, keeping the original AI draft visible in the evidence", async () => {
    const decideCalls: DecideCall[] = [];
    const client = makeClient(makeServices(decideCalls));

    let seenOriginalDraft: unknown;
    const editStrategy: ReviewStrategy = (evidence) => {
      seenOriginalDraft = evidence.approval.requested_payload;
      return {
        action: "edit",
        approvedPayload: { draft: "A reviewer-edited reply." },
        reviewNotes: "tightened tone",
      };
    };

    const result = await runReviewFlow(client, editStrategy);

    expect(seenOriginalDraft).toEqual({
      draft: "The original AI draft reply.",
    });
    expect(result.reviewed?.action).toBe("edit");
    expect(decideCalls).toEqual([{ approvalId: "apr_1", status: "edited" }]);
  });
});
