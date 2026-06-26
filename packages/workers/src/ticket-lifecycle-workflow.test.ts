import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TicketLifecycleActivities } from "./activities/ticket-lifecycle-activities.js";
import { ticketLifecycleWorkflow } from "./workflows/ticket-lifecycle-workflow.js";
import type {
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

  it("creates and triages a ticket, then waits for approval completion", async () => {
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
          state.approval_id === "apr_test",
      );
      expect(waitingState.triage_route).toBe("human_approval");

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
      phase: "completed",
      processed_message_ids: ["msg_initial"],
      approval_id: "apr_test",
      approval_status: "approved",
      manual_escalation_reason_code: null,
      close_reason_code: null,
      first_response_due_at: null,
      sla_breached_deadline: null,
      sla_breached_due_at: null,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "createApproval",
      "recordAuditEvent:approval.completed",
    ]);
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
  });

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
    });
    expect(calls.map((call) => call.name)).toEqual([
      "createOrUpdateTicket",
      "emitDomainEvent:ticket_created",
      "runInitialTriage",
      "emitDomainEvent:ticket_state_transition",
      "createApproval",
      "emitDomainEvent:ticket_sla_breached",
      "recordAuditEvent:ticket.sla_breached",
    ]);
  });
});

interface ActivityCall {
  readonly name: string;
  readonly message_id?: string;
}

interface WorkflowHandleForTest {
  query(name: "ticket_lifecycle_state"): Promise<TicketLifecycleWorkflowState>;
}

interface ActivityFixtureOptions {
  readonly firstResponseTimer?: {
    readonly due_at: string;
    readonly timer_ms: number;
  };
}

function makeActivities(
  calls: ActivityCall[],
  options: ActivityFixtureOptions = {},
): TicketLifecycleActivities {
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
    async createApproval() {
      calls.push({ name: "createApproval" });
      return {
        approval_id: "apr_test",
        status: "pending",
      };
    },
    async recordInboundMessage(input) {
      calls.push({
        name: "recordInboundMessage",
        message_id: input.message.message_id,
      });
    },
    async recordAuditEvent(input) {
      calls.push({ name: `recordAuditEvent:${input.action}` });
    },
    async emitDomainEvent(input) {
      calls.push({ name: `emitDomainEvent:${input.event_type}` });
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
