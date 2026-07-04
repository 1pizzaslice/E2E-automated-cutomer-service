import { describe, expect, it } from "vitest";
import { createRecordingOutboundChannelSender } from "@support/integrations";
import {
  NonRetryableActivityError,
  createInMemoryTicketLifecyclePersistenceStore,
  createTicketLifecyclePersistenceActivities,
  deterministicApprovalId,
} from "./ticket-lifecycle-persistence.js";
import type {
  CreateApprovalActivityInput,
  SendOutboundMessageActivityInput,
} from "../workflows/ticket-lifecycle-types.js";

const TENANT = "ten_test";
const TICKET = "tkt_con_test";
const CONVERSATION = "con_test";
const CORRELATION = "corr-test";
const APPROVAL = deterministicApprovalId(TENANT, TICKET, CORRELATION);
const IDEMPOTENCY_KEY = `outbound:${TENANT}:${TICKET}:${APPROVAL}`;

const createApprovalInput: CreateApprovalActivityInput = {
  tenant_id: TENANT,
  ticket_id: TICKET,
  correlation_id: CORRELATION,
  reason_code: "v1_default_human_approval",
  metadata: {
    source: "ai_graph",
    ai_graph: {
      ai_run_id: "run_test",
      draft: { draft_text: "Your order shipped yesterday." },
    },
  },
};

const sendInput: SendOutboundMessageActivityInput = {
  tenant_id: TENANT,
  ticket_id: TICKET,
  conversation_id: CONVERSATION,
  correlation_id: CORRELATION,
  approval_id: APPROVAL,
  approval_status: "approved",
  idempotency_key: IDEMPOTENCY_KEY,
};

function makeFixtures() {
  return {
    conversations: [
      {
        tenantId: TENANT,
        conversationId: CONVERSATION,
        channelId: "chn_email",
        customerId: "cus_test",
        externalThreadId: "<thread-1@example.com>",
      },
    ],
    channels: [
      {
        tenantId: TENANT,
        channelId: "chn_email",
        type: "email",
        provider: "mailgun",
        config: {
          sending_domain: "mg.tenant.example.com",
          from_address: "support@tenant.example.com",
          send_credential_ref: "MAILGUN_SEND_KEY",
        },
      },
    ],
    identities: [
      {
        tenantId: TENANT,
        customerId: "cus_test",
        channel: "email",
        identityType: "email",
        identityValue: "customer@example.com",
        displayName: "Customer Name",
      },
    ],
  };
}

function makeHarness(options?: {
  senderResults?: Parameters<typeof createRecordingOutboundChannelSender>[0];
}) {
  const store = createInMemoryTicketLifecyclePersistenceStore(makeFixtures());
  const sender = createRecordingOutboundChannelSender(options?.senderResults);
  const activities = createTicketLifecyclePersistenceActivities({
    store,
    outboundSender: sender,
    credentialResolver: {
      async resolve(ref) {
        return ref === "MAILGUN_SEND_KEY" ? "mailgun-api-key" : null;
      },
    },
    now: () => new Date("2026-07-04T12:00:00.000Z"),
  });

  return { store, sender, activities };
}

async function approveSeededApproval(
  harness: ReturnType<typeof makeHarness>,
  overrides?: {
    status?: "approved" | "edited";
    approvedPayload?: Record<string, unknown> | null;
  },
) {
  await harness.activities.createApproval(createApprovalInput);
  harness.store.setApprovalDecision({
    tenantId: TENANT,
    approvalId: APPROVAL,
    status: overrides?.status ?? "approved",
    approvedPayload:
      overrides?.approvedPayload === undefined
        ? createApprovalInput.metadata
        : overrides.approvedPayload,
    reviewerUserId: "usr_reviewer",
  });
}

describe("createApproval activity", () => {
  it("persists a pending approval with the AI run id and requested payload", async () => {
    const { store, activities } = makeHarness();

    const result = await activities.createApproval(createApprovalInput);

    expect(result).toEqual({ approval_id: APPROVAL, status: "pending" });
    const approvals = store.listApprovals();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      tenantId: TENANT,
      approvalId: APPROVAL,
      ticketId: TICKET,
      aiRunId: "run_test",
      status: "pending",
    });
    expect(approvals[0]!.requestedPayload).toMatchObject({
      source: "ai_graph",
      reason_code: "v1_default_human_approval",
    });
  });

  it("records an approval.requested audit event once", async () => {
    const { store, activities } = makeHarness();

    await activities.createApproval(createApprovalInput);
    await activities.createApproval(createApprovalInput);

    expect(store.listApprovals()).toHaveLength(1);
    const audits = store
      .listAuditEvents()
      .filter((event) => event.action === "approval.requested");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "approval",
      entityId: APPROVAL,
      actorType: "system",
      correlationId: CORRELATION,
    });
  });
});

describe("sendOutboundMessage activity", () => {
  it("sends the approved draft once and persists the sent outbound message", async () => {
    const harness = makeHarness();
    await approveSeededApproval(harness);

    const result = await harness.activities.sendOutboundMessage(sendInput);

    expect(result.status).toBe("sent");
    expect(result.conversation_id).toBe(CONVERSATION);
    expect(result.channel_id).toBe("chn_email");
    expect(result.external_message_id).toBe("provider-out-1");
    expect(result.sent_at).toBe("2026-07-04T12:00:00.000Z");

    expect(harness.sender.sends).toHaveLength(1);
    const send = harness.sender.sends[0]!;
    expect(send.credential).toBe("mailgun-api-key");
    expect(send.message).toMatchObject({
      channel: "email",
      provider: "mailgun",
      to: { type: "email", value: "customer@example.com" },
      body: { text: "Your order shipped yesterday.", html: null },
      external_thread_id: "<thread-1@example.com>",
      approval_id: APPROVAL,
      ai_run_id: "run_test",
      sent_by_type: "human",
      sent_by_user_id: "usr_reviewer",
      idempotency_key: IDEMPOTENCY_KEY,
    });

    const messages = harness.store.listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: result.message_id,
      sendStatus: "sent",
      providerMessageId: "provider-out-1",
      approvalId: APPROVAL,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("sends the human-edited draft when the approval was edited", async () => {
    const harness = makeHarness();
    await approveSeededApproval(harness, {
      status: "edited",
      approvedPayload: { draft_text: "Edited human response." },
    });

    await harness.activities.sendOutboundMessage({
      ...sendInput,
      approval_status: "edited",
    });

    expect(harness.sender.sends[0]!.message.body.text).toBe(
      "Edited human response.",
    );
  });

  it("replays the first outcome for a duplicate idempotency key without re-sending", async () => {
    const harness = makeHarness();
    await approveSeededApproval(harness);

    const first = await harness.activities.sendOutboundMessage(sendInput);
    const second = await harness.activities.sendOutboundMessage(sendInput);

    expect(second).toEqual(first);
    expect(harness.sender.sends).toHaveLength(1);
    expect(harness.store.listMessages()).toHaveLength(1);
  });

  it("records a failed send with audit and retries onto the same message row", async () => {
    const harness = makeHarness({
      senderResults: [
        {
          status: "failed",
          error_code: "provider_http_500",
          error_message: "upstream down",
          retryable: true,
        },
      ],
    });
    await approveSeededApproval(harness);

    await expect(
      harness.activities.sendOutboundMessage(sendInput),
    ).rejects.toThrow(/provider_http_500/);

    const failed = harness.store.listMessages();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ sendStatus: "failed" });
    const failureAudit = harness.store
      .listAuditEvents()
      .filter((event) => event.action === "message.send_failed");
    expect(failureAudit).toHaveLength(1);
    expect(failureAudit[0]!.metadata).toMatchObject({
      error_code: "provider_http_500",
      retryable: true,
      approval_id: APPROVAL,
    });

    // Simulated Temporal retry: the second attempt reuses the persisted row.
    const retried = await harness.activities.sendOutboundMessage(sendInput);

    expect(retried.status).toBe("sent");
    expect(retried.message_id).toBe(failed[0]!.messageId);
    expect(harness.store.listMessages()).toHaveLength(1);
    expect(harness.store.listMessages()[0]).toMatchObject({
      sendStatus: "sent",
    });
    expect(harness.sender.sends).toHaveLength(2);
  });

  it("fails fast on non-retryable provider rejections", async () => {
    const harness = makeHarness({
      senderResults: [
        {
          status: "failed",
          error_code: "provider_http_401",
          error_message: "bad key",
          retryable: false,
        },
      ],
    });
    await approveSeededApproval(harness);

    await expect(
      harness.activities.sendOutboundMessage(sendInput),
    ).rejects.toBeInstanceOf(NonRetryableActivityError);
  });

  it("fails fast without sending when context is missing", async () => {
    const harness = makeHarness();
    await approveSeededApproval(harness);

    await expect(
      harness.activities.sendOutboundMessage({
        ...sendInput,
        conversation_id: "con_unknown",
      }),
    ).rejects.toBeInstanceOf(NonRetryableActivityError);
    await expect(
      harness.activities.sendOutboundMessage({
        ...sendInput,
        approval_id: "apr_unknown",
        idempotency_key: `outbound:${TENANT}:${TICKET}:apr_unknown`,
      }),
    ).rejects.toBeInstanceOf(NonRetryableActivityError);
    expect(harness.sender.sends).toHaveLength(0);
  });

  it("fails fast when the approval has no draft text", async () => {
    const harness = makeHarness();
    await harness.activities.createApproval({
      ...createApprovalInput,
      metadata: { source: "ai_graph_failure" },
    });
    harness.store.setApprovalDecision({
      tenantId: TENANT,
      approvalId: APPROVAL,
      status: "approved",
      approvedPayload: null,
      reviewerUserId: "usr_reviewer",
    });

    await expect(
      harness.activities.sendOutboundMessage(sendInput),
    ).rejects.toThrow(/no draft text/);
    expect(harness.sender.sends).toHaveLength(0);
  });

  it("fails fast when the customer has no channel identity", async () => {
    const store = createInMemoryTicketLifecyclePersistenceStore({
      ...makeFixtures(),
      identities: [],
    });
    const sender = createRecordingOutboundChannelSender();
    const activities = createTicketLifecyclePersistenceActivities({
      store,
      outboundSender: sender,
    });
    await activities.createApproval(createApprovalInput);
    store.setApprovalDecision({
      tenantId: TENANT,
      approvalId: APPROVAL,
      status: "approved",
      approvedPayload: createApprovalInput.metadata,
      reviewerUserId: "usr_reviewer",
    });

    await expect(activities.sendOutboundMessage(sendInput)).rejects.toThrow(
      /identity/,
    );
    expect(sender.sends).toHaveLength(0);
  });
});

describe("recordAuditEvent activity", () => {
  it("appends ticket audit rows and dedupes retried writes", async () => {
    const { store, activities } = makeHarness();
    const input = {
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      action: "message.sent",
      actor: { type: "system" as const, id: "workflow" },
      metadata: { message_id: "msg_out_1", approval_id: APPROVAL },
    };

    await activities.recordAuditEvent(input);
    await activities.recordAuditEvent(input);
    await activities.recordAuditEvent({
      ...input,
      action: "approval.completed",
    });

    const audits = store.listAuditEvents();
    expect(audits).toHaveLength(2);
    expect(audits.map((event) => event.action).sort()).toEqual([
      "approval.completed",
      "message.sent",
    ]);
    expect(audits[0]).toMatchObject({
      entityType: "ticket",
      entityId: TICKET,
      actorType: "system",
      actorId: "workflow",
      correlationId: CORRELATION,
    });
  });
});
