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
  TicketLifecycleApprovalCompletedSignal,
  TicketLifecycleCloseRequestedSignal,
  TicketLifecycleManualEscalationSignal,
  TicketLifecycleMessageReceivedSignal,
  TicketLifecycleWorkflowInput,
  TicketLifecycleWorkflowPhase,
  TicketLifecycleWorkflowResult,
  TicketLifecycleWorkflowState,
} from "./ticket-lifecycle-types.js";

const activities = proxyActivities<TicketLifecycleActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
  },
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

  if (ticketResult.created) {
    await activities.emitDomainEvent({
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
    await activities.emitDomainEvent({
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
    await activities.recordAuditEvent({
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

  await condition(
    () =>
      signalState.approvalResult !== null ||
      signalState.manualEscalation !== null ||
      signalState.closeRequest !== null,
  );

  if (signalState.manualEscalation !== null) {
    const manualEscalation = signalState.manualEscalation;
    phase = "manual_escalated";
    await activities.recordAuditEvent({
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
    await activities.recordAuditEvent({
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
    await activities.recordAuditEvent({
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
  };
}
