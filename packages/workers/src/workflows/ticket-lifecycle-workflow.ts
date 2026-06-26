import {
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type { TicketLifecycleActivities } from "../activities/ticket-lifecycle-activities.js";
import type {
  CreateOrUpdateTicketActivityResult,
  RunInitialTriageActivityResult,
  TicketLifecycleSlaTimer,
  TicketLifecycleApprovalCompletedSignal,
  TicketLifecycleCloseRequestedSignal,
  TicketLifecycleManualEscalationSignal,
  TicketLifecycleMessageReceivedSignal,
  TicketLifecycleWorkflowInput,
  TicketLifecycleWorkflowPhase,
  TicketLifecycleWorkflowResult,
  TicketLifecycleWorkflowState,
} from "./ticket-lifecycle-types.js";
import {
  TICKET_LIFECYCLE_DEFAULT_ACTIVITY_RETRY_POLICY,
  TICKET_LIFECYCLE_SIDE_EFFECT_ACTIVITY_RETRY_POLICY,
} from "./ticket-lifecycle-types.js";

const activities = proxyActivities<TicketLifecycleActivities>({
  startToCloseTimeout: "1 minute",
  retry: TICKET_LIFECYCLE_DEFAULT_ACTIVITY_RETRY_POLICY,
});

export const messageReceivedSignal =
  defineSignal<[TicketLifecycleMessageReceivedSignal]>("message_received");
export const customerRepliedSignal =
  defineSignal<[TicketLifecycleMessageReceivedSignal]>("customer_replied");
export const approvalCompletedSignal =
  defineSignal<[TicketLifecycleApprovalCompletedSignal]>("approval_completed");
export const manualEscalationRequestedSignal = defineSignal<
  [TicketLifecycleManualEscalationSignal]
>("manual_escalation_requested");
export const closeRequestedSignal =
  defineSignal<[TicketLifecycleCloseRequestedSignal]>("close_requested");
export const ticketLifecycleStateQuery =
  defineQuery<TicketLifecycleWorkflowState>("ticket_lifecycle_state");

export async function ticketLifecycleWorkflow(
  input: TicketLifecycleWorkflowInput,
): Promise<TicketLifecycleWorkflowResult> {
  let phase: TicketLifecycleWorkflowPhase = "starting";
  let ticketResult: CreateOrUpdateTicketActivityResult | null = null;
  let triage: RunInitialTriageActivityResult | null = null;
  let approvalId: string | null = null;
  let firstResponseSlaTimer: TicketLifecycleSlaTimer | null = null;
  let slaBreach: TicketLifecycleSlaTimer | null = null;
  const signalState: {
    approvalResult: TicketLifecycleApprovalCompletedSignal | null;
    manualEscalation: TicketLifecycleManualEscalationSignal | null;
    closeRequest: TicketLifecycleCloseRequestedSignal | null;
  } = {
    approvalResult: null,
    manualEscalation: null,
    closeRequest: null,
  };
  const processedMessageIds = new Set<string>([input.initial_message_id]);

  const currentState = (): TicketLifecycleWorkflowState => ({
    tenant_id: input.tenant_id,
    ticket_id: input.ticket_id,
    phase,
    processed_message_ids: [...processedMessageIds],
    approval_id: approvalId,
    approval_status: signalState.approvalResult?.status ?? null,
    manual_escalation_reason_code:
      signalState.manualEscalation?.reason_code ?? null,
    close_reason_code: signalState.closeRequest?.reason_code ?? null,
    first_response_due_at: firstResponseSlaTimer?.due_at ?? null,
    sla_breached_deadline: slaBreach?.deadline_type ?? null,
    sla_breached_due_at: slaBreach?.due_at ?? null,
    triage_route: triage?.route ?? null,
  });

  setHandler(ticketLifecycleStateQuery, currentState);
  setHandler(messageReceivedSignal, async (message) => {
    await recordReceivedMessage(input, processedMessageIds, message);
  });
  setHandler(customerRepliedSignal, async (message) => {
    await recordReceivedMessage(input, processedMessageIds, message);
  });
  setHandler(approvalCompletedSignal, (approval) => {
    if (approvalId === null || approval.approval_id === approvalId) {
      signalState.approvalResult = approval;
    }
  });
  setHandler(manualEscalationRequestedSignal, (escalation) => {
    signalState.manualEscalation = escalation;
  });
  setHandler(closeRequestedSignal, (request) => {
    signalState.closeRequest = request;
  });

  phase = "creating_ticket";
  ticketResult = await activities.createOrUpdateTicket(input);
  firstResponseSlaTimer = findSlaTimer(
    ticketResult.sla_timers,
    "first_response",
  );

  if (ticketResult.created) {
    await emitDomainEvent({
      event_type: "ticket_created",
      event_id: buildWorkflowEventId(input, "ticket-created"),
      tenant_id: input.tenant_id,
      correlation_id: input.correlation_id,
      causation_id: input.initial_message_id,
      actor: workflowActor(),
      ticket: ticketResult.ticket,
    });
  }

  phase = "triaging";
  triage = await activities.runInitialTriage({
    ...input,
    ticket: ticketResult.ticket,
  });

  if (ticketResult.ticket.status !== triage.status) {
    await emitDomainEvent({
      event_type: "ticket_state_transition",
      event_id: buildWorkflowEventId(input, "ticket-triaged"),
      tenant_id: input.tenant_id,
      correlation_id: input.correlation_id,
      causation_id: input.initial_message_id,
      actor: workflowActor(),
      event_name: "support.ticket.triaged.v1",
      ticket_id: input.ticket_id,
      from_status: ticketResult.ticket.status,
      to_status: triage.status,
      reason_code: triage.reason_code,
      metadata: triage.metadata,
    });
  }

  if (triage.route === "manual_escalation") {
    phase = "manual_escalated";
    await recordAuditEvent({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      action: "ticket.manual_escalated",
      actor: workflowActor(),
      metadata: {
        reason_code: triage.reason_code,
        source: "triage",
      },
    });
    await condition(allHandlersFinished);
    return resultFromState(currentState());
  }

  phase = "waiting_for_approval";
  const approval = await activities.createApproval({
    tenant_id: input.tenant_id,
    ticket_id: input.ticket_id,
    correlation_id: input.correlation_id,
    reason_code: triage.reason_code,
    metadata: triage.metadata,
  });
  approvalId = approval.approval_id;

  const approvalWaitResult = await waitForApprovalSignalOrFirstResponseSla(
    firstResponseSlaTimer,
    () =>
      signalState.approvalResult !== null ||
      signalState.manualEscalation !== null ||
      signalState.closeRequest !== null,
  );

  if (approvalWaitResult === "sla_breached" && firstResponseSlaTimer !== null) {
    slaBreach = firstResponseSlaTimer;
    phase = "sla_breached";
    await emitDomainEvent({
      event_type: "ticket_sla_breached",
      event_id: buildWorkflowEventId(input, "ticket-sla-first-response"),
      tenant_id: input.tenant_id,
      correlation_id: input.correlation_id,
      causation_id: input.initial_message_id,
      actor: workflowActor(),
      ticket_id: input.ticket_id,
      breached_deadline: firstResponseSlaTimer.deadline_type,
      due_at: firstResponseSlaTimer.due_at,
      metadata: {
        source: "temporal_timer",
        approval_id: approvalId,
      },
    });
    await recordAuditEvent({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      action: "ticket.sla_breached",
      actor: workflowActor(),
      metadata: {
        breached_deadline: firstResponseSlaTimer.deadline_type,
        due_at: firstResponseSlaTimer.due_at,
        approval_id: approvalId,
      },
    });
  } else if (signalState.manualEscalation !== null) {
    const manualEscalation = signalState.manualEscalation;
    phase = "manual_escalated";
    await recordAuditEvent({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      action: "ticket.manual_escalated",
      actor: {
        type: "human",
        id: manualEscalation.requested_by_actor_id,
      },
      metadata: {
        reason_code: manualEscalation.reason_code,
        requested_at: manualEscalation.requested_at,
        source: "signal",
      },
    });
  } else if (signalState.closeRequest !== null) {
    const closeRequest = signalState.closeRequest;
    phase = "closed";
    await recordAuditEvent({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      action: "ticket.close_requested",
      actor: {
        type: "human",
        id: closeRequest.requested_by_actor_id,
      },
      metadata: {
        reason_code: closeRequest.reason_code,
        requested_at: closeRequest.requested_at,
      },
    });
  } else if (signalState.approvalResult !== null) {
    const approvalResult = signalState.approvalResult;
    phase = "completed";
    await recordAuditEvent({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      action: "approval.completed",
      actor: {
        type: "human",
        id: approvalResult.actor_id,
      },
      metadata: {
        approval_id: approvalResult.approval_id,
        status: approvalResult.status,
        decided_at: approvalResult.decided_at,
        notes: approvalResult.notes,
      },
    });
  }

  await condition(allHandlersFinished);
  return resultFromState(currentState());
}

async function recordReceivedMessage(
  input: TicketLifecycleWorkflowInput,
  processedMessageIds: Set<string>,
  message: TicketLifecycleMessageReceivedSignal,
): Promise<void> {
  if (processedMessageIds.has(message.message_id)) {
    return;
  }

  processedMessageIds.add(message.message_id);
  await activities.recordInboundMessage({
    ...input,
    message,
  });
}

async function waitForApprovalSignalOrFirstResponseSla(
  timer: TicketLifecycleSlaTimer | null,
  signalReceived: () => boolean,
): Promise<"signal_received" | "sla_breached"> {
  if (signalReceived()) {
    return "signal_received";
  }

  if (timer === null) {
    await condition(signalReceived);
    return "signal_received";
  }

  if (!Number.isFinite(timer.timer_ms)) {
    throw new Error(`Invalid SLA timer duration: ${timer.timer_ms}`);
  }

  if (timer.timer_ms <= 0) {
    return "sla_breached";
  }

  const timerMs = Math.trunc(timer.timer_ms);
  const signaledBeforeDeadline = await condition(signalReceived, timerMs);

  return signaledBeforeDeadline ? "signal_received" : "sla_breached";
}

function findSlaTimer(
  timers: readonly TicketLifecycleSlaTimer[],
  deadlineType: TicketLifecycleSlaTimer["deadline_type"],
): TicketLifecycleSlaTimer | null {
  return timers.find((timer) => timer.deadline_type === deadlineType) ?? null;
}

async function emitDomainEvent(
  input: Parameters<TicketLifecycleActivities["emitDomainEvent"]>[0],
): Promise<void> {
  await activities.emitDomainEvent.executeWithOptions(
    {
      startToCloseTimeout: "30 seconds",
      retry: TICKET_LIFECYCLE_SIDE_EFFECT_ACTIVITY_RETRY_POLICY,
    },
    [input],
  );
}

async function recordAuditEvent(
  input: Parameters<TicketLifecycleActivities["recordAuditEvent"]>[0],
): Promise<void> {
  await activities.recordAuditEvent.executeWithOptions(
    {
      startToCloseTimeout: "30 seconds",
      retry: TICKET_LIFECYCLE_SIDE_EFFECT_ACTIVITY_RETRY_POLICY,
    },
    [input],
  );
}

function workflowActor() {
  return {
    type: "system" as const,
    id: "workflow",
  };
}

function buildWorkflowEventId(
  input: TicketLifecycleWorkflowInput,
  eventName: string,
): string {
  return [
    "evt",
    input.tenant_id,
    input.ticket_id,
    input.initial_message_id,
    eventName,
  ].join(":");
}

function resultFromState(
  state: TicketLifecycleWorkflowState,
): TicketLifecycleWorkflowResult {
  return {
    tenant_id: state.tenant_id,
    ticket_id: state.ticket_id,
    phase: state.phase,
    processed_message_ids: state.processed_message_ids,
    approval_id: state.approval_id,
    approval_status: state.approval_status,
    manual_escalation_reason_code: state.manual_escalation_reason_code,
    close_reason_code: state.close_reason_code,
    first_response_due_at: state.first_response_due_at,
    sla_breached_deadline: state.sla_breached_deadline,
    sla_breached_due_at: state.sla_breached_due_at,
  };
}
