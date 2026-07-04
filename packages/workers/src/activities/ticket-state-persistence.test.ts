import { describe, expect, it } from "vitest";
import { createRecordingOutboundChannelSender } from "@support/integrations";
import {
  NonRetryableActivityError,
  conversationIdFromTicketId,
  createInMemoryTicketLifecyclePersistenceStore,
  createTicketLifecyclePersistenceActivities,
  deterministicApprovalId,
} from "./ticket-lifecycle-persistence.js";

/**
 * Milestone 13 ticket persistence activities over the in-memory store:
 * create-or-load with the deterministic `tkt_{conversation_id}` id, inbound
 * message reconciliation, triage persistence, explicit state transitions,
 * and approval expiry — all mirroring the database-store semantics.
 */
const TENANT = "ten_state";
const CONVERSATION = "cnv_state";
const TICKET = `tkt_${CONVERSATION}`;
const CORRELATION = "corr-state";
const INITIAL_MESSAGE = "msg_state_inbound";
const NOW = new Date("2026-07-04T12:00:00.000Z");

function makeHarness(options?: {
  approvalExpiresInMs?: number | null;
  bodyText?: string;
}) {
  const store = createInMemoryTicketLifecyclePersistenceStore(
    {
      conversations: [
        {
          tenantId: TENANT,
          conversationId: CONVERSATION,
          channelId: "chn_email",
          customerId: "cus_state",
          externalThreadId: "<thread-state@example.com>",
        },
      ],
      slaPolicies: [
        {
          tenantId: TENANT,
          slaPolicyId: "sla_state",
          priority: "p2",
          firstResponseMinutes: 60,
          nextResponseMinutes: 240,
          resolutionMinutes: 1440,
          status: "active",
        },
      ],
      inboundMessages: [
        {
          tenantId: TENANT,
          messageId: INITIAL_MESSAGE,
          conversationId: CONVERSATION,
          bodyText: options?.bodyText ?? "Where is my order? Tracking please.",
        },
      ],
    },
    { now: () => NOW },
  );
  const activities = createTicketLifecyclePersistenceActivities({
    store,
    outboundSender: createRecordingOutboundChannelSender(),
    credentialResolver: { resolve: async () => null },
    now: () => NOW,
    approvalExpiresInMs: options?.approvalExpiresInMs,
  });

  return { store, activities };
}

function createInput() {
  return {
    tenant_id: TENANT,
    ticket_id: TICKET,
    initial_message_id: INITIAL_MESSAGE,
    correlation_id: CORRELATION,
  };
}

describe("conversationIdFromTicketId", () => {
  it("recovers the conversation id and rejects malformed ids", () => {
    expect(conversationIdFromTicketId("tkt_cnv_abc")).toBe("cnv_abc");
    expect(() => conversationIdFromTicketId("ticket-1")).toThrow(
      NonRetryableActivityError,
    );
    expect(() => conversationIdFromTicketId("tkt_")).toThrow(
      NonRetryableActivityError,
    );
  });
});

describe("createOrUpdateTicket activity", () => {
  it("creates the workflow-owned ticket with SLA due dates, audit, and ticket event", async () => {
    const { store, activities } = makeHarness();

    const result = await activities.createOrUpdateTicket(createInput());

    expect(result.created).toBe(true);
    expect(result.previous_status).toBe(null);
    expect(result.ticket).toMatchObject({
      ticket_id: TICKET,
      conversation_id: CONVERSATION,
      customer_id: "cus_state",
      status: "new",
      priority: "p2",
      automation_mode: "human_approve",
      sla_policy_id: "sla_state",
      opened_at: NOW.toISOString(),
      first_response_due_at: new Date(
        NOW.getTime() + 60 * 60_000,
      ).toISOString(),
    });
    expect(result.sla_timers).toEqual([
      {
        deadline_type: "first_response",
        due_at: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
        timer_ms: 60 * 60_000,
      },
      {
        deadline_type: "next_response",
        due_at: new Date(NOW.getTime() + 240 * 60_000).toISOString(),
        timer_ms: 240 * 60_000,
      },
      {
        deadline_type: "resolution",
        due_at: new Date(NOW.getTime() + 1440 * 60_000).toISOString(),
        timer_ms: 1440 * 60_000,
      },
    ]);

    const tickets = store.listTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ ticketId: TICKET, status: "new" });

    const events = store.listTicketEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "ticket_created",
      fromStatus: null,
      toStatus: "new",
    });

    const audits = store
      .listAuditEvents()
      .filter((event) => event.action === "ticket.created");
    expect(audits).toHaveLength(1);

    // The intake-persisted initial message is linked to the new ticket.
    expect(store.listInboundMessages()[0]?.ticketId).toBe(TICKET);
  });

  it("loads the existing ticket on retry without duplicating events", async () => {
    const { store, activities } = makeHarness();

    await activities.createOrUpdateTicket(createInput());
    const replay = await activities.createOrUpdateTicket(createInput());

    expect(replay.created).toBe(false);
    expect(replay.previous_status).toBe("new");
    expect(store.listTickets()).toHaveLength(1);
    expect(store.listTicketEvents()).toHaveLength(1);
    expect(
      store
        .listAuditEvents()
        .filter((event) => event.action === "ticket.created"),
    ).toHaveLength(1);
  });

  it("rejects a ticket whose conversation does not exist", async () => {
    const { activities } = makeHarness();

    await expect(
      activities.createOrUpdateTicket({
        ...createInput(),
        ticket_id: "tkt_cnv_missing",
      }),
    ).rejects.toThrow(NonRetryableActivityError);
  });
});

describe("runInitialTriage activity", () => {
  it("persists triage output onto the ticket row and moves it to triaged", async () => {
    const { store, activities } = makeHarness();
    const created = await activities.createOrUpdateTicket(createInput());

    const triage = await activities.runInitialTriage({
      ...createInput(),
      ticket: created.ticket,
    });

    expect(triage.status).toBe("triaged");
    expect(triage.route).toBe("human_approval");
    expect(triage.reason_code).toBe("triage_order_status");
    expect(triage.metadata).toMatchObject({
      topic: "order_status",
      language: "en",
      priority: "p2",
      from_status: "new",
    });

    const ticket = store.listTickets()[0];
    expect(ticket).toMatchObject({
      status: "triaged",
      topic: "order_status",
      subtopic: "tracking",
      language: "en",
      priority: "p2",
    });

    const transitionEvents = store
      .listTicketEvents()
      .filter((event) => event.eventType === "ticket_state_transition");
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0]).toMatchObject({
      fromStatus: "new",
      toStatus: "triaged",
    });
    expect(
      store
        .listAuditEvents()
        .filter((event) => event.action === "ticket.updated"),
    ).toHaveLength(1);
  });

  it("routes hard-sensitive messages to manual escalation and raises priority", async () => {
    const { store, activities } = makeHarness({
      bodyText:
        "I will take legal action and contact my lawyer about this order.",
    });
    const created = await activities.createOrUpdateTicket(createInput());

    const triage = await activities.runInitialTriage({
      ...createInput(),
      ticket: created.ticket,
    });

    expect(triage.route).toBe("manual_escalation");
    expect(triage.reason_code).toBe("sensitive_topic:legal_threat");
    expect(store.listTickets()[0]).toMatchObject({
      topic: "legal_or_chargeback",
      priority: "p1",
    });
  });

  it("retries when the initial message row is not yet visible", async () => {
    const { activities } = makeHarness();
    const created = await activities.createOrUpdateTicket(createInput());

    await expect(
      activities.runInitialTriage({
        ...createInput(),
        initial_message_id: "msg_not_persisted",
        ticket: created.ticket,
      }),
    ).rejects.toThrow(/was not found for triage/);
  });
});

describe("recordInboundMessage activity", () => {
  function replySignal(messageId: string) {
    return {
      ...createInput(),
      message: {
        message_id: messageId,
        conversation_id: CONVERSATION,
        channel_id: "chn_email",
        received_at: "2026-07-04T13:00:00.000Z",
        external_message_id: `<${messageId}@example.com>`,
        external_thread_id: "<thread-state@example.com>",
        idempotency_key: `<${messageId}@example.com>`,
      },
    };
  }

  it("links a follow-up message to the ticket without duplicating rows", async () => {
    // Intake persists the reply row (ticket_id null) before signaling; the
    // activity links it to the workflow-owned ticket.
    const secondMessage = "msg_state_reply";
    const storeWithReply = createInMemoryTicketLifecyclePersistenceStore(
      {
        conversations: [
          {
            tenantId: TENANT,
            conversationId: CONVERSATION,
            channelId: "chn_email",
            customerId: "cus_state",
            externalThreadId: "<thread-state@example.com>",
          },
        ],
        inboundMessages: [
          {
            tenantId: TENANT,
            messageId: INITIAL_MESSAGE,
            conversationId: CONVERSATION,
            bodyText: "Where is my order?",
          },
          {
            tenantId: TENANT,
            messageId: secondMessage,
            conversationId: CONVERSATION,
            bodyText: "Any update?",
          },
        ],
      },
      { now: () => NOW },
    );
    const activitiesWithReply = createTicketLifecyclePersistenceActivities({
      store: storeWithReply,
      outboundSender: createRecordingOutboundChannelSender(),
      credentialResolver: { resolve: async () => null },
      now: () => NOW,
    });

    await activitiesWithReply.createOrUpdateTicket(createInput());
    await activitiesWithReply.recordInboundMessage(replySignal(secondMessage));

    const linked = storeWithReply
      .listInboundMessages()
      .find((message) => message.messageId === secondMessage);
    expect(linked?.ticketId).toBe(TICKET);
    // Replay is a no-op.
    await activitiesWithReply.recordInboundMessage(replySignal(secondMessage));
    expect(storeWithReply.listInboundMessages()).toHaveLength(2);
  });

  it("moves a waiting_customer ticket back to waiting_human when the customer replies", async () => {
    const { store, activities } = makeHarness();
    await activities.createOrUpdateTicket(createInput());
    await activities.applyTicketStateTransition({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      to_status: "waiting_customer",
      reason_code: "response_sent",
      metadata: {},
      actor: { type: "system", id: "workflow" },
      transition_key: "response-sent",
    });

    await activities.recordInboundMessage(replySignal(INITIAL_MESSAGE));

    expect(store.listTickets()[0]?.status).toBe("waiting_human");
    const replyEvents = store
      .listTicketEvents()
      .filter((event) => event.reasonCode === "customer_replied");
    expect(replyEvents).toHaveLength(1);
    expect(replyEvents[0]).toMatchObject({
      fromStatus: "waiting_customer",
      toStatus: "waiting_human",
    });
  });

  it("skips reconciliation gracefully while the ticket row does not exist yet", async () => {
    const { store, activities } = makeHarness();

    await activities.recordInboundMessage(replySignal(INITIAL_MESSAGE));

    expect(store.listTickets()).toHaveLength(0);
    expect(store.listInboundMessages()[0]?.ticketId).toBe(null);
  });
});

describe("applyTicketStateTransition activity", () => {
  it("applies transitions once with ticket event and audit, then no-ops on replay", async () => {
    const { store, activities } = makeHarness();
    await activities.createOrUpdateTicket(createInput());

    const transitionInput = {
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      to_status: "waiting_ai" as const,
      reason_code: "ai_drafting",
      metadata: { source: "workflow" },
      actor: { type: "system" as const, id: "workflow" },
      transition_key: "ai-drafting",
    };
    const first = await activities.applyTicketStateTransition(transitionInput);
    const replay = await activities.applyTicketStateTransition(transitionInput);

    expect(first).toEqual({
      applied: true,
      from_status: "new",
      to_status: "waiting_ai",
    });
    expect(replay).toEqual({
      applied: false,
      from_status: "waiting_ai",
      to_status: "waiting_ai",
    });
    expect(store.listTickets()[0]?.status).toBe("waiting_ai");
    expect(
      store
        .listTicketEvents()
        .filter((event) => event.toStatus === "waiting_ai"),
    ).toHaveLength(1);
  });

  it("audits closed transitions as ticket.closed and stamps closed_at", async () => {
    const { store, activities } = makeHarness();
    await activities.createOrUpdateTicket(createInput());

    await activities.applyTicketStateTransition({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      to_status: "closed",
      reason_code: "resolved_by_reviewer",
      metadata: {},
      actor: { type: "human", id: "usr_reviewer" },
      transition_key: "close-requested",
    });

    expect(store.listTickets()[0]).toMatchObject({
      status: "closed",
      closedAt: NOW,
    });
    const closedAudits = store
      .listAuditEvents()
      .filter((event) => event.action === "ticket.closed");
    expect(closedAudits).toHaveLength(1);
    expect(closedAudits[0]).toMatchObject({
      actorType: "human",
      actorId: "usr_reviewer",
    });
  });

  it("rejects transitions for unknown tickets", async () => {
    const { activities } = makeHarness();

    await expect(
      activities.applyTicketStateTransition({
        tenant_id: TENANT,
        ticket_id: "tkt_missing",
        correlation_id: CORRELATION,
        to_status: "closed",
        reason_code: null,
        metadata: {},
        actor: { type: "system", id: "workflow" },
        transition_key: "close-requested",
      }),
    ).rejects.toThrow(NonRetryableActivityError);
  });
});

describe("expireApproval activity", () => {
  const APPROVAL = deterministicApprovalId(TENANT, TICKET, CORRELATION);

  function approvalInput() {
    return {
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      reason_code: "v1_default_human_approval",
      metadata: { draft: { draft_text: "Draft reply." } },
    };
  }

  it("expires a pending approval once and audits approval.expired", async () => {
    const { store, activities } = makeHarness({ approvalExpiresInMs: 60_000 });
    const created = await activities.createApproval(approvalInput());

    expect(created.expires_in_ms).toBe(60_000);

    const result = await activities.expireApproval({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      approval_id: APPROVAL,
    });
    const replay = await activities.expireApproval({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      approval_id: APPROVAL,
    });

    expect(result).toEqual({ expired: true, status: "expired" });
    expect(replay).toEqual({ expired: true, status: "expired" });
    expect(store.listApprovals()[0]?.status).toBe("expired");
    expect(
      store
        .listAuditEvents()
        .filter((event) => event.action === "approval.expired"),
    ).toHaveLength(1);
  });

  it("reports the decision when a reviewer won the race", async () => {
    const { store, activities } = makeHarness();
    await activities.createApproval(approvalInput());
    store.setApprovalDecision({
      tenantId: TENANT,
      approvalId: APPROVAL,
      status: "approved",
      approvedPayload: { draft_text: "Draft reply." },
      reviewerUserId: "usr_reviewer",
    });

    const result = await activities.expireApproval({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      approval_id: APPROVAL,
    });

    expect(result).toEqual({ expired: false, status: "approved" });
    expect(
      store
        .listAuditEvents()
        .filter((event) => event.action === "approval.expired"),
    ).toHaveLength(0);
  });

  it("rejects expiry for unknown approvals", async () => {
    const { activities } = makeHarness();

    await expect(
      activities.expireApproval({
        tenant_id: TENANT,
        ticket_id: TICKET,
        correlation_id: CORRELATION,
        approval_id: "apr_missing",
      }),
    ).rejects.toThrow(NonRetryableActivityError);
  });
});
