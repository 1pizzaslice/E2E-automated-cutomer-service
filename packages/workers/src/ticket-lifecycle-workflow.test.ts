import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TicketLifecycleActivities } from "./activities/ticket-lifecycle-activities.js";
import { ticketLifecycleWorkflow } from "./workflows/ticket-lifecycle-workflow.js";
import type {
  RunAiGraphActivityResult,
  TicketLifecycleMessageReceivedSignal,
  TicketLifecycleWorkflowInput,
  TicketLifecycleWorkflowState,
} from "./workflows/ticket-lifecycle-types.js";

const describeTemporalWorkflow =
  process.env.RUN_TEMPORAL_WORKFLOW_TESTS === "true" ? describe : describe.skip;

describeTemporalWorkflow("ticketLifecycleWorkflow", () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createFromExistingServer({
      address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
      namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    });
  }, 30_000);

  afterAll(async () => {
    await testEnv?.teardown();
  }, 30_000);

  it("creates and triages a ticket, runs AI graph, then sends the approved response", async () => {
    const calls: ActivityCall[] = [];
    let workflowHistory: unknown = null;
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls),
    });

    const result = await worker.runUntil(async () => {
      const workflowId = `ticket-lifecycle-${randomUUID()}`;
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId,
          args: [makeWorkflowInput()],
        },
      );

      const waitingState = await waitForWorkflowState(
        handle,
        (state) =>
          state.phase === "waiting_for_approval" &&
          state.approval_id === "apr_test" &&
          state.ai_status === "succeeded",
      );
      expect(waitingState.triage_route).toBe("human_approval");
      expect(waitingState.ai_run_id).toBe("air_test");
      expect(waitingState.ai_automation_mode).toBe("human_approve");

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "approved",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: null,
      });

      const workflowResult = await handle.result();
      workflowHistory = await handle.fetchHistory();
      return workflowResult;
    });

    expect(result).toEqual({
      tenant_id: "ten_test",
      ticket_id: "ticket_test",
      phase: "responded",
      processed_message_ids: ["msg_initial"],
      approval_id: "apr_test",
      approval_status: "approved",
      manual_escalation_reason_code: null,
      close_reason_code: null,
      first_response_due_at: null,
      sla_breached_deadline: null,
      sla_breached_due_at: null,
      ai_run_id: "air_test",
      ai_status: "succeeded",
      ai_automation_mode: "human_approve",
      ai_failure_code: null,
      outbound_message_id: "msg_outbound_test",
    });
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "recordAuditEvent:approval.completed",
      "sendOutboundMessage",
      "emitDomainEvent:message_sent",
      "recordAuditEvent:message.sent",
      "applyTicketStateTransition:waiting_customer",
    ]);
    expect(calls.find((call) => call.name === "createApproval")).toEqual(
      expect.objectContaining({
        reason_code: "v1_default_human_approval",
        metadata: expect.objectContaining({
          source: "ai_graph",
          ai_graph: expect.objectContaining({
            status: "succeeded",
            ai_run_id: "air_test",
          }),
        }),
      }),
    );
    expect(calls.find((call) => call.name === "sendOutboundMessage")).toEqual(
      expect.objectContaining({
        approval_status: "approved",
        idempotency_key: "outbound:ten_test:ticket_test:apr_test",
      }),
    );
    expect(workflowHistory).not.toBeNull();
    if (workflowHistory === null) {
      throw new Error("Expected workflow history to be fetched");
    }
    await expect(
      Worker.runReplayHistory(
        {
          workflowsPath: workflowsPath(),
        },
        workflowHistory,
      ),
    ).resolves.toBeUndefined();
  }, 30_000);

  it("deduplicates repeated inbound message signals", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      await waitForWorkflowState(
        handle,
        (state) => state.phase === "waiting_for_approval",
      );

      await handle.signal("message_received", makeMessageSignal("msg_initial"));
      await handle.signal(
        "message_received",
        makeMessageSignal("msg_followup"),
      );
      await handle.signal(
        "message_received",
        makeMessageSignal("msg_followup"),
      );
      await handle.signal(
        "customer_replied",
        makeMessageSignal("msg_followup_2"),
      );

      await waitForWorkflowState(
        handle,
        (state) => state.processed_message_ids.length === 3,
      );

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "approved",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: null,
      });

      return await handle.result();
    });

    expect(result.processed_message_ids).toEqual([
      "msg_initial",
      "msg_followup",
      "msg_followup_2",
    ]);
    expect(
      calls
        .filter((call) => call.name === "recordInboundMessage")
        .map((call) => call.message_id),
    ).toEqual(["msg_followup", "msg_followup_2"]);
  });

  it("fires the first-response SLA timer while waiting for approval", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls, {
        firstResponseTimer: {
          due_at: "2026-06-26T00:15:00.000Z",
          timer_ms: 1,
        },
      }),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      return await handle.result();
    });

    expect(result).toEqual({
      tenant_id: "ten_test",
      ticket_id: "ticket_test",
      phase: "sla_breached",
      processed_message_ids: ["msg_initial"],
      approval_id: "apr_test",
      approval_status: null,
      manual_escalation_reason_code: null,
      close_reason_code: null,
      first_response_due_at: "2026-06-26T00:15:00.000Z",
      sla_breached_deadline: "first_response",
      sla_breached_due_at: "2026-06-26T00:15:00.000Z",
      ai_run_id: "air_test",
      ai_status: "succeeded",
      ai_automation_mode: "human_approve",
      ai_failure_code: null,
      outbound_message_id: null,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "emitDomainEvent:ticket_sla_breached",
      "recordAuditEvent:ticket.sla_breached",
    ]);
  });

  it("routes structured AI graph failures to human approval", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls, {
        aiGraphResult: makeAiGraphFailure(),
      }),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      const waitingState = await waitForWorkflowState(
        handle,
        (state) =>
          state.phase === "waiting_for_approval" &&
          state.ai_status === "failed" &&
          state.approval_id === "apr_test",
      );
      expect(waitingState.ai_failure_code).toBe("AI_RUNTIME_ERROR");
      expect(waitingState.ai_automation_mode).toBeNull();

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "approved",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: "Handled after AI runtime failure.",
      });

      return await handle.result();
    });

    expect(result).toEqual({
      tenant_id: "ten_test",
      ticket_id: "ticket_test",
      phase: "responded",
      processed_message_ids: ["msg_initial"],
      approval_id: "apr_test",
      approval_status: "approved",
      manual_escalation_reason_code: null,
      close_reason_code: null,
      first_response_due_at: null,
      sla_breached_deadline: null,
      sla_breached_due_at: null,
      ai_run_id: "air_failed",
      ai_status: "failed",
      ai_automation_mode: null,
      ai_failure_code: "AI_RUNTIME_ERROR",
      outbound_message_id: "msg_outbound_test",
    });
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "recordAuditEvent:ai_graph.failed",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "recordAuditEvent:approval.completed",
      "sendOutboundMessage",
      "emitDomainEvent:message_sent",
      "recordAuditEvent:message.sent",
      "applyTicketStateTransition:waiting_customer",
    ]);
    expect(calls.find((call) => call.name === "createApproval")).toEqual(
      expect.objectContaining({
        reason_code: "AI_RUNTIME_ERROR",
        metadata: expect.objectContaining({
          source: "ai_graph_failure",
          ai_graph: expect.objectContaining({
            status: "failed",
            error_code: "AI_RUNTIME_ERROR",
          }),
        }),
      }),
    );
  });

  it("sends an edited approval response once", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      await waitForWorkflowState(
        handle,
        (state) => state.phase === "waiting_for_approval",
      );

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "edited",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: "Adjusted the greeting before sending.",
      });

      return await handle.result();
    });

    expect(result.phase).toBe("responded");
    expect(result.approval_status).toBe("edited");
    expect(result.outbound_message_id).toBe("msg_outbound_test");
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "recordAuditEvent:approval.completed",
      "sendOutboundMessage",
      "emitDomainEvent:message_sent",
      "recordAuditEvent:message.sent",
      "applyTicketStateTransition:waiting_customer",
    ]);
    expect(calls.find((call) => call.name === "sendOutboundMessage")).toEqual(
      expect.objectContaining({
        approval_status: "edited",
        idempotency_key: "outbound:ten_test:ticket_test:apr_test",
      }),
    );
  });

  it("does not send a rejected approval response", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      await waitForWorkflowState(
        handle,
        (state) => state.phase === "waiting_for_approval",
      );

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "rejected",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: "Draft was off-policy.",
      });

      return await handle.result();
    });

    expect(result.phase).toBe("completed");
    expect(result.approval_status).toBe("rejected");
    expect(result.outbound_message_id).toBeNull();
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "recordAuditEvent:approval.completed",
    ]);
    expect(calls.some((call) => call.name === "sendOutboundMessage")).toBe(
      false,
    );
  });

  it("routes an escalated approval to manual handling without sending", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      await waitForWorkflowState(
        handle,
        (state) => state.phase === "waiting_for_approval",
      );

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "escalated",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: "Needs a senior agent.",
      });

      return await handle.result();
    });

    expect(result.phase).toBe("manual_escalated");
    expect(result.approval_status).toBe("escalated");
    expect(result.outbound_message_id).toBeNull();
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "recordAuditEvent:approval.completed",
      "recordAuditEvent:ticket.manual_escalated",
    ]);
    expect(calls.some((call) => call.name === "sendOutboundMessage")).toBe(
      false,
    );
  });

  it("still requires human approval when the AI recommends auto_send (no bypass)", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const autoSendRecommendation = makeAiGraphSuccess();
    if (autoSendRecommendation.status !== "succeeded") {
      throw new Error("Expected a succeeded AI fixture");
    }
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls, {
        aiGraphResult: {
          ...autoSendRecommendation,
          routing_decision: {
            ...autoSendRecommendation.routing_decision,
            topic: "faq",
            automation_mode: "auto_send",
            reason_codes: ["auto_send_allowlisted"],
          },
          final_recommendation: {
            ...autoSendRecommendation.final_recommendation,
            automation_mode: "auto_send",
            reason_codes: ["auto_send_allowlisted"],
          },
        },
      }),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      // The workflow must park in waiting_for_approval — an approval row
      // exists and nothing has been sent — even though the AI recommended
      // auto_send (Milestone 12 acceptance: no bypass of human approval).
      const waitingState = await waitForWorkflowState(
        handle,
        (state) =>
          state.phase === "waiting_for_approval" &&
          state.approval_id === "apr_test",
      );
      expect(waitingState.ai_automation_mode).toBe("auto_send");
      expect(calls.some((call) => call.name === "sendOutboundMessage")).toBe(
        false,
      );
      expect(calls.some((call) => call.name === "createApproval")).toBe(true);

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "approved",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: null,
      });

      return await handle.result();
    });

    expect(result.phase).toBe("responded");
    expect(result.ai_automation_mode).toBe("auto_send");
    const sendIndex = calls.findIndex(
      (call) => call.name === "sendOutboundMessage",
    );
    const approvalAuditIndex = calls.findIndex(
      (call) => call.name === "recordAuditEvent:approval.completed",
    );
    expect(sendIndex).toBeGreaterThan(approvalAuditIndex);
  });

  it("expires an undecided approval after the configured wait and returns to the human queue", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls, { approvalExpiresInMs: 5 }),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      return await handle.result();
    });

    expect(result.phase).toBe("approval_expired");
    expect(result.approval_status).toBeNull();
    expect(result.outbound_message_id).toBeNull();
    expect(calls.some((call) => call.name === "expireApproval")).toBe(true);
    expect(calls.some((call) => call.name === "sendOutboundMessage")).toBe(
      false,
    );
  });

  it("keeps waiting for the decision signal when a reviewer beats the expiry timer", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls, {
        approvalExpiresInMs: 5,
        // The store reports the approval already decided: expiry lost the
        // race and the workflow must wait for the decision signal instead.
        expireApprovalResult: { expired: false, status: "approved" },
      }),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      const startedAt = Date.now();
      while (
        !calls.some((call) => call.name === "expireApproval") &&
        Date.now() - startedAt < 5_000
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(calls.some((call) => call.name === "expireApproval")).toBe(true);

      await handle.signal("approval_completed", {
        approval_id: "apr_test",
        status: "approved",
        actor_id: "usr_approver",
        decided_at: "2026-06-26T00:10:00.000Z",
        notes: null,
      });

      return await handle.result();
    });

    expect(result.phase).toBe("responded");
    expect(result.approval_status).toBe("approved");
    expect(result.outbound_message_id).toBe("msg_outbound_test");
  });

  it("closes the ticket on a close request with a persisted transition and domain event", async () => {
    const calls: ActivityCall[] = [];
    const taskQueue = `ticket-lifecycle-${randomUUID()}`;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: workflowsPath(),
      activities: makeActivities(calls),
    });

    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(
        ticketLifecycleWorkflow,
        {
          taskQueue,
          workflowId: `ticket-lifecycle-${randomUUID()}`,
          args: [makeWorkflowInput()],
        },
      );

      await waitForWorkflowState(
        handle,
        (state) => state.phase === "waiting_for_approval",
      );

      await handle.signal("close_requested", {
        requested_by_actor_id: "usr_ops",
        reason_code: "duplicate_ticket",
        requested_at: "2026-06-26T00:10:00.000Z",
      });

      return await handle.result();
    });

    expect(result.phase).toBe("closed");
    expect(result.close_reason_code).toBe("duplicate_ticket");
    expect(result.outbound_message_id).toBeNull();
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "applyTicketStateTransition:waiting_ai",
      "runAiGraph",
      "emitDomainEvent:ai_run_completed",
      "createApproval",
      "applyTicketStateTransition:waiting_human",
      "applyTicketStateTransition:closed",
      "emitDomainEvent:ticket_state_transition",
      "recordAuditEvent:ticket.close_requested",
    ]);
  });
});

interface ActivityCall {
  readonly name: string;
  readonly message_id?: string;
  readonly reason_code?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly approval_status?: string;
  readonly idempotency_key?: string;
}

interface WorkflowHandleForTest {
  query(name: "ticket_lifecycle_state"): Promise<TicketLifecycleWorkflowState>;
}

interface ActivityFixtureOptions {
  readonly firstResponseTimer?: {
    readonly due_at: string;
    readonly timer_ms: number;
  };
  readonly aiGraphResult?: RunAiGraphActivityResult;
  readonly approvalExpiresInMs?: number | null;
  readonly expireApprovalResult?: { expired: boolean; status: string };
}

function makeActivities(
  calls: ActivityCall[],
  options: ActivityFixtureOptions = {},
): TicketLifecycleActivities {
  let ticketStatus:
    | "new"
    | "triaged"
    | "waiting_ai"
    | "waiting_human"
    | "waiting_customer"
    | "resolved"
    | "closed"
    | "reopened"
    | "failed" = "new";

  return {
    async createOrUpdateTicket() {
      calls.push({ name: "createOrUpdateTicket" });
      const firstResponseTimer = options.firstResponseTimer ?? null;
      return {
        ticket: {
          ticket_id: "ticket_test",
          conversation_id: "cnv_test",
          customer_id: "cus_test",
          status: "new",
          priority: "p2",
          automation_mode: "human_approve",
          assigned_queue: null,
          assigned_user_id: null,
          sla_policy_id: firstResponseTimer === null ? null : "sla_test",
          opened_at: "2026-06-26T00:00:00.000Z",
          first_response_due_at: firstResponseTimer?.due_at ?? null,
          next_response_due_at: null,
          resolution_due_at: null,
        },
        created: true,
        previous_status: null,
        sla_timers:
          firstResponseTimer === null
            ? []
            : [
                {
                  deadline_type: "first_response",
                  due_at: firstResponseTimer.due_at,
                  timer_ms: firstResponseTimer.timer_ms,
                },
              ],
      };
    },
    async runInitialTriage() {
      calls.push({ name: "runInitialTriage" });
      return {
        status: "triaged",
        route: "human_approval",
        reason_code: "ai_triage_completed",
        metadata: {
          classifier: "baseline",
        },
      };
    },
    async runAiGraph() {
      calls.push({ name: "runAiGraph" });
      return options.aiGraphResult ?? makeAiGraphSuccess();
    },
    async createApproval(input) {
      calls.push({
        name: "createApproval",
        reason_code: input.reason_code,
        metadata: input.metadata,
      });
      return {
        approval_id: "apr_test",
        status: "pending",
        expires_in_ms: options.approvalExpiresInMs ?? null,
      };
    },
    async sendOutboundMessage(input) {
      calls.push({
        name: "sendOutboundMessage",
        approval_status: input.approval_status,
        idempotency_key: input.idempotency_key,
      });
      return {
        status: "sent",
        message_id: "msg_outbound_test",
        conversation_id: input.conversation_id,
        channel_id: "chn_email",
        external_message_id: "ext_outbound_test",
        sent_at: "2026-06-26T00:20:00.000Z",
      };
    },
    async recordInboundMessage(input) {
      calls.push({
        name: "recordInboundMessage",
        message_id: input.message.message_id,
      });
    },
    async applyTicketStateTransition(input) {
      calls.push({ name: `applyTicketStateTransition:${input.to_status}` });
      const fromStatus = ticketStatus;
      ticketStatus = input.to_status;
      return {
        applied: fromStatus !== input.to_status,
        from_status: fromStatus,
        to_status: input.to_status,
      };
    },
    async expireApproval() {
      calls.push({ name: "expireApproval" });
      return (
        options.expireApprovalResult ?? { expired: true, status: "expired" }
      );
    },
    async recordAuditEvent(input) {
      calls.push({ name: `recordAuditEvent:${input.action}` });
    },
    async emitDomainEvent(input) {
      calls.push({ name: `emitDomainEvent:${input.event_type}` });
    },
  };
}

function makeAiGraphSuccess(): RunAiGraphActivityResult {
  return {
    status: "succeeded",
    ai_run_id: "air_test",
    trace_id: "trace_test",
    classification: {
      topic: "order_status",
    },
    routing_decision: {
      topic: "order_status",
      subtopic: "shipment_tracking",
      language: "en",
      sentiment: "neutral",
      urgency: "normal",
      priority: "p2",
      risk_level: "low",
      confidence: 0.91,
      automation_mode: "human_approve",
      assigned_queue: "ai_draft_queue",
      reason_codes: ["order_lookup_needed"],
      required_tools: ["order_lookup"],
      required_evidence: ["order", "shipping_policy"],
    },
    tool_calls: [],
    draft: {
      draft_text: "Thanks for reaching out. I checked the order status.",
      customer_language: "en",
      tone: "helpful_professional",
      evidence: [
        {
          type: "order",
          ref_id: "order_test",
          summary: "Order is in transit.",
        },
      ],
      actions: [],
      risk_level: "low",
      confidence: 0.89,
      needs_human: true,
      human_review_reasons: ["v1_default_human_approval"],
    },
    guardrails: {
      passed: true,
    },
    final_recommendation: {
      automation_mode: "human_approve",
      risk_level: "low",
      confidence: 0.88,
      reason_codes: ["v1_default_human_approval"],
    },
    eval_signals: {
      fixture: "ai_success",
    },
  };
}

function makeAiGraphFailure(): RunAiGraphActivityResult {
  return {
    status: "failed",
    ai_run_id: "air_failed",
    trace_id: "trace_failed",
    error_code: "AI_RUNTIME_ERROR",
    error_message: "AI runtime output failed schema validation.",
    retryable: false,
    reason_codes: ["AI_RUNTIME_ERROR"],
    eval_signals: {
      fixture: "ai_failure",
    },
  };
}

function makeWorkflowInput(): TicketLifecycleWorkflowInput {
  return {
    tenant_id: "ten_test",
    ticket_id: "ticket_test",
    initial_message_id: "msg_initial",
    correlation_id: "corr_test",
  };
}

function makeMessageSignal(
  messageId: string,
): TicketLifecycleMessageReceivedSignal {
  return {
    message_id: messageId,
    conversation_id: "cnv_test",
    channel_id: "chn_email",
    received_at: "2026-06-26T00:05:00.000Z",
    external_message_id: null,
    external_thread_id: null,
    idempotency_key: null,
  };
}

async function waitForWorkflowState(
  handle: WorkflowHandleForTest,
  predicate: (state: TicketLifecycleWorkflowState) => boolean,
): Promise<TicketLifecycleWorkflowState> {
  const startedAt = Date.now();
  let lastState: TicketLifecycleWorkflowState | null = null;

  while (Date.now() - startedAt < 5_000) {
    lastState = await handle.query("ticket_lifecycle_state");

    if (predicate(lastState)) {
      return lastState;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Timed out waiting for workflow state. Last state: ${JSON.stringify(lastState)}`,
  );
}

function workflowsPath(): string {
  return fileURLToPath(
    new URL("./workflows/ticket-lifecycle-workflow.ts", import.meta.url),
  );
}
