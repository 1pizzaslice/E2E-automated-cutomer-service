import { describe, expect, it } from "vitest";
import {
  createRecordingLogSink,
  createRecordingSupportMetrics,
  createStructuredLogger,
} from "@support/observability";
import { instrumentTicketLifecycleActivities } from "./instrumented-activities.js";
import type { TicketLifecycleActivities } from "./ticket-lifecycle-activities.js";
import type {
  RunAiGraphActivityResult,
  SendOutboundMessageActivityResult,
} from "../workflows/ticket-lifecycle-types.js";

const SUCCEEDED_SEND: SendOutboundMessageActivityResult = {
  status: "sent",
  message_id: "msg_out_test",
  conversation_id: "con_test",
  channel_id: "chn_email",
  external_message_id: "prov-1",
  sent_at: "2026-07-04T12:00:00.000Z",
};

const FAILED_AI_RESULT: RunAiGraphActivityResult = {
  status: "failed",
  ai_run_id: "air_test",
  trace_id: "trace_test",
  error_code: "AI_RUNTIME_ERROR",
  error_message: "graph blew up",
  retryable: false,
  reason_codes: ["runtime_error", "route_to_human"],
  eval_signals: {},
};

function makeActivities(
  overrides: Partial<TicketLifecycleActivities> = {},
): TicketLifecycleActivities {
  return {
    createOrUpdateTicket: async () => {
      throw new Error("not exercised");
    },
    runInitialTriage: async () => ({
      status: "triaged",
      route: "human_approval",
      reason_code: null,
      metadata: {},
    }),
    runAiGraph: async () => FAILED_AI_RESULT,
    createApproval: async () => ({
      approval_id: "apr_test",
      status: "pending",
    }),
    sendOutboundMessage: async () => SUCCEEDED_SEND,
    recordInboundMessage: async () => {},
    recordAuditEvent: async () => {},
    emitDomainEvent: async () => {},
    ...overrides,
  };
}

describe("instrumentTicketLifecycleActivities", () => {
  it("records success metrics and structured logs with correlation ids", async () => {
    const metrics = createRecordingSupportMetrics();
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "test",
      sink: recording.sink,
      now: () => new Date("2026-07-04T12:00:00.000Z"),
    });
    const activities = instrumentTicketLifecycleActivities(makeActivities(), {
      metrics,
      logger,
    });

    const result = await activities.sendOutboundMessage({
      tenant_id: "ten_test",
      ticket_id: "tkt_test",
      conversation_id: "con_test",
      correlation_id: "corr_test",
      approval_id: "apr_test",
      approval_status: "approved",
      idempotency_key: "outbound:ten_test:tkt_test:apr_test",
    });

    expect(result).toEqual(SUCCEEDED_SEND);
    expect(metrics.workflowActivities).toEqual([
      expect.objectContaining({
        activity: "sendOutboundMessage",
        outcome: "succeeded",
      }),
    ]);
    expect(metrics.criticalFailures).toEqual([]);
    const entries = recording.entries();
    expect(entries[0]).toMatchObject({
      service: "workers",
      activity: "sendOutboundMessage",
      "support.tenant_id": "ten_test",
      "support.ticket_id": "tkt_test",
      "support.correlation_id": "corr_test",
    });
  });

  it("records failure metrics and outbound_send_failed on send errors", async () => {
    const metrics = createRecordingSupportMetrics();
    const activities = instrumentTicketLifecycleActivities(
      makeActivities({
        sendOutboundMessage: async () => {
          throw new Error("provider unavailable");
        },
      }),
      { metrics },
    );

    await expect(
      activities.sendOutboundMessage({
        tenant_id: "ten_test",
        ticket_id: "tkt_test",
        conversation_id: "con_test",
        correlation_id: "corr_test",
        approval_id: "apr_test",
        approval_status: "approved",
        idempotency_key: "outbound:ten_test:tkt_test:apr_test",
      }),
    ).rejects.toThrow("provider unavailable");

    expect(metrics.workflowActivities[0]).toMatchObject({
      activity: "sendOutboundMessage",
      outcome: "failed",
    });
    expect(metrics.criticalFailures).toEqual(["outbound_send_failed"]);
  });

  it("maps failed AI graph results to ai_graph_failed without throwing", async () => {
    const metrics = createRecordingSupportMetrics();
    const activities = instrumentTicketLifecycleActivities(makeActivities(), {
      metrics,
    });

    const result = await activities.runAiGraph({
      tenant_id: "ten_test",
      ticket_id: "tkt_test",
      initial_message_id: "msg_test",
      correlation_id: "corr_test",
      ticket: {
        ticket_id: "tkt_test",
        conversation_id: "con_test",
        customer_id: "cus_test",
        status: "waiting_ai",
        priority: "p2",
        automation_mode: "human_approve",
        assigned_queue: null,
        assigned_user_id: null,
        sla_policy_id: null,
        opened_at: "2026-07-04T11:00:00.000Z",
        first_response_due_at: null,
        next_response_due_at: null,
        resolution_due_at: null,
      },
      triage: {
        status: "triaged",
        route: "human_approval",
        reason_code: null,
        metadata: {},
      },
    });

    expect(result.status).toBe("failed");
    expect(metrics.workflowActivities[0]).toMatchObject({
      activity: "runAiGraph",
      outcome: "succeeded",
    });
    expect(metrics.criticalFailures).toEqual(["ai_graph_failed"]);
  });

  it("maps SLA breach event emission to sla_breached", async () => {
    const metrics = createRecordingSupportMetrics();
    const activities = instrumentTicketLifecycleActivities(makeActivities(), {
      metrics,
    });

    await activities.emitDomainEvent({
      event_type: "ticket_sla_breached",
      event_id: "evt:test",
      tenant_id: "ten_test",
      correlation_id: "corr_test",
      causation_id: "msg_test",
      actor: { type: "system", id: "workflow" },
      ticket_id: "tkt_test",
      breached_deadline: "first_response",
      due_at: "2026-07-04T11:30:00.000Z",
      metadata: {},
    });

    expect(metrics.criticalFailures).toEqual(["sla_breached"]);
  });
});
