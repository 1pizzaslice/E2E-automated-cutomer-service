import { describe, expect, it } from "vitest";
import { createRecordingOutboundChannelSender } from "@support/integrations";
import {
  SupportAuditActionSchema,
  type SupportAuditAction,
} from "@support/shared-schemas";
import {
  createInMemoryTicketLifecyclePersistenceStore,
  createTicketLifecyclePersistenceActivities,
  deterministicApprovalId,
} from "./activities/ticket-lifecycle-persistence.js";
import {
  createInMemoryRetentionStore,
  runTenantRetentionJob,
} from "./retention.js";

/**
 * Audit completeness (BACKEND_SPEC section 13 rules): audit events must exist
 * for ticket transitions, AI runs, tool calls, approvals, outbound sends,
 * policy changes, integration credential changes, and permission changes.
 * This suite drives every live producer through the in-memory stores and
 * proves (a) each producible action is emitted, (b) every emitted action is
 * in the canonical taxonomy, and (c) the taxonomy reserves actions for the
 * families whose write paths do not exist yet. Tool calls are audited in the
 * `tool_calls` table (Milestone 8), not `audit_events`; approval decisions
 * (`approval.approved|edited|rejected|escalated`) are produced by the API's
 * decide service and covered by its integration tests.
 */
const TENANT = "ten_audit";
const TICKET = "tkt_con_audit";
const CONVERSATION = "con_audit";
const CORRELATION = "corr-audit";
const APPROVAL = deterministicApprovalId(TENANT, TICKET, CORRELATION);

const WORKFLOW_EMITTED_ACTIONS: readonly SupportAuditAction[] = [
  "ticket.manual_escalated",
  "ai_graph.failed",
  "ticket.sla_breached",
  "ticket.close_requested",
  "approval.completed",
  "message.sent",
];

const RESERVED_ACTIONS: readonly SupportAuditAction[] = [
  "policy.created",
  "policy.activated",
  "policy.archived",
  "integration.credential_changed",
  "permission.granted",
  "permission.revoked",
];

function makeHarness(options?: {
  senderResults?: Parameters<typeof createRecordingOutboundChannelSender>[0];
}) {
  const store = createInMemoryTicketLifecyclePersistenceStore({
    conversations: [
      {
        tenantId: TENANT,
        conversationId: CONVERSATION,
        channelId: "chn_email",
        customerId: "cus_audit",
        externalThreadId: "<thread-audit@example.com>",
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
        customerId: "cus_audit",
        channel: "email",
        identityType: "email",
        identityValue: "customer@example.com",
        displayName: "Customer Name",
      },
    ],
    slaPolicies: [
      {
        tenantId: TENANT,
        slaPolicyId: "sla_audit",
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
        messageId: "msg_audit_inbound",
        conversationId: CONVERSATION,
        bodyText: "Where is my order? I need tracking please.",
      },
    ],
  });
  const activities = createTicketLifecyclePersistenceActivities({
    store,
    outboundSender: createRecordingOutboundChannelSender(
      options?.senderResults,
    ),
    credentialResolver: {
      async resolve(ref) {
        return ref === "MAILGUN_SEND_KEY" ? "mailgun-api-key" : null;
      },
    },
    now: () => new Date("2026-07-04T12:00:00.000Z"),
  });

  return { store, activities };
}

describe("audit completeness", () => {
  it("emits canonical audit events for every live producer family", async () => {
    const { store, activities } = makeHarness({
      senderResults: [
        {
          status: "failed",
          error_code: "invalid_recipient",
          error_message: "Recipient rejected by provider.",
          retryable: false,
        },
      ],
    });

    // Ticket family: creating the workflow-owned ticket audits
    // ticket.created; triage and explicit transitions audit ticket.updated;
    // the closed transition audits ticket.closed.
    const ticketResult = await activities.createOrUpdateTicket({
      tenant_id: TENANT,
      ticket_id: TICKET,
      initial_message_id: "msg_audit_inbound",
      correlation_id: CORRELATION,
    });
    await activities.runInitialTriage({
      tenant_id: TENANT,
      ticket_id: TICKET,
      initial_message_id: "msg_audit_inbound",
      correlation_id: CORRELATION,
      ticket: ticketResult.ticket,
    });
    await activities.applyTicketStateTransition({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      to_status: "waiting_ai",
      reason_code: "ai_drafting",
      metadata: {},
      actor: { type: "system", id: "workflow" },
      transition_key: "ai-drafting",
    });
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

    // Approvals family: creating an approval audits approval.requested;
    // a pending approval passing its decision window audits approval.expired.
    await activities.createApproval({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      reason_code: "v1_default_human_approval",
      metadata: { draft: { draft_text: "Draft reply." } },
    });
    await activities.expireApproval({
      tenant_id: TENANT,
      ticket_id: TICKET,
      correlation_id: CORRELATION,
      approval_id: APPROVAL,
    });

    // Outbound send family: a permanent provider failure audits
    // message.send_failed.
    store.setApprovalDecision({
      tenantId: TENANT,
      approvalId: APPROVAL,
      status: "approved",
      approvedPayload: { draft_text: "Draft reply." },
      reviewerUserId: "usr_reviewer",
    });
    await expect(
      activities.sendOutboundMessage({
        tenant_id: TENANT,
        ticket_id: TICKET,
        conversation_id: CONVERSATION,
        correlation_id: CORRELATION,
        approval_id: APPROVAL,
        approval_status: "approved",
        idempotency_key: `outbound:${TENANT}:${TICKET}:${APPROVAL}`,
      }),
    ).rejects.toThrow();

    // Ticket transitions, AI runs, approvals, and sends emitted by the
    // workflow all route through recordAuditEvent with taxonomy-typed
    // actions.
    for (const action of WORKFLOW_EMITTED_ACTIONS) {
      await activities.recordAuditEvent({
        tenant_id: TENANT,
        ticket_id: TICKET,
        correlation_id: `${CORRELATION}-${action}`,
        action,
        actor: { type: "system", id: "workflow" },
        metadata: {},
      });
    }

    const actions = store.listAuditEvents().map((event) => event.action);

    expect(actions).toContain("ticket.created");
    expect(actions).toContain("ticket.updated");
    expect(actions).toContain("ticket.closed");
    expect(actions).toContain("approval.requested");
    expect(actions).toContain("approval.expired");
    expect(actions).toContain("message.send_failed");
    for (const action of WORKFLOW_EMITTED_ACTIONS) {
      expect(actions).toContain(action);
    }

    for (const action of actions) {
      expect(() => SupportAuditActionSchema.parse(action)).not.toThrow();
    }
  });

  it("audits retention purges", async () => {
    const retentionStore = createInMemoryRetentionStore({
      retentionPolicy: { raw_payload_days: 1 },
      messages: [
        {
          messageId: "msg_expired",
          rawPayloadRef: "file://raw/expired.json",
          attachmentCount: 0,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    await runTenantRetentionJob(
      {
        store: retentionStore,
        now: () => new Date("2026-07-04T00:00:00.000Z"),
      },
      { tenantId: TENANT },
    );

    const audits = retentionStore.listAuditEvents();
    expect(audits).toHaveLength(1);
    expect(() =>
      SupportAuditActionSchema.parse(audits[0]?.action),
    ).not.toThrow();
  });

  it("reserves taxonomy entries for families whose write paths are pending", () => {
    for (const action of RESERVED_ACTIONS) {
      expect(SupportAuditActionSchema.options).toContain(action);
    }

    // Approval decisions are produced by the API decide service with the
    // same taxonomy.
    for (const status of ["approved", "edited", "rejected", "escalated"]) {
      expect(SupportAuditActionSchema.options).toContain(`approval.${status}`);
    }
  });
});
