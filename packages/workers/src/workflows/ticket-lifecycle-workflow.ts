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
  RunAiGraphActivityResult,
  RunInitialTriageActivityResult,
  SendOutboundMessageActivityResult,
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
  let aiGraphResult: RunAiGraphActivityResult | null = null;
  let approvalId: string | null = null;
  let outboundResult: SendOutboundMessageActivityResult | null = null;
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
    ai_run_id: aiGraphResult?.ai_run_id ?? null,
    ai_status: aiGraphResult?.status ?? null,
    ai_automation_mode:
      aiGraphResult?.status === "succeeded"
        ? aiGraphResult.final_recommendation.automation_mode
        : null,
    ai_failure_code:
      aiGraphResult?.status === "failed" ? aiGraphResult.error_code : null,
    outbound_message_id: outboundResult?.message_id ?? null,
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
    await activities.applyTicketStateTransition({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      to_status: "waiting_human",
      reason_code: triage.reason_code,
      metadata: { source: "triage" },
      actor: workflowActor(),
      transition_key: "manual-escalation-triage",
    });
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

  phase = "running_ai";
  await activities.applyTicketStateTransition({
    tenant_id: input.tenant_id,
    ticket_id: input.ticket_id,
    correlation_id: input.correlation_id,
    to_status: "waiting_ai",
    reason_code: "ai_drafting",
    metadata: { source: "workflow" },
    actor: workflowActor(),
    transition_key: "ai-drafting",
  });
  aiGraphResult = await activities.runAiGraph({
    ...input,
    ticket: ticketResult.ticket,
    triage,
  });

  if (aiGraphResult.status === "failed") {
    await recordAuditEvent({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      action: "ai_graph.failed",
      actor: workflowActor(),
      metadata: {
        ai_run_id: aiGraphResult.ai_run_id,
        trace_id: aiGraphResult.trace_id,
        error_code: aiGraphResult.error_code,
        error_message: aiGraphResult.error_message,
        retryable: aiGraphResult.retryable,
        reason_codes: aiGraphResult.reason_codes,
      },
    });
  }

  await emitAiGraphCompletionEvents(input, aiGraphResult);

  phase = "waiting_for_approval";
  const approval = await activities.createApproval({
    tenant_id: input.tenant_id,
    ticket_id: input.ticket_id,
    correlation_id: input.correlation_id,
    reason_code: approvalReasonCode(triage, aiGraphResult),
    metadata: approvalMetadata(triage, aiGraphResult),
  });
  approvalId = approval.approval_id;
  await activities.applyTicketStateTransition({
    tenant_id: input.tenant_id,
    ticket_id: input.ticket_id,
    correlation_id: input.correlation_id,
    to_status: "waiting_human",
    reason_code: "approval_requested",
    metadata: {
      approval_id: approval.approval_id,
      ai_status: aiGraphResult.status,
    },
    actor: workflowActor(),
    transition_key: "approval-requested",
  });

  const signalReceived = () =>
    signalState.approvalResult !== null ||
    signalState.manualEscalation !== null ||
    signalState.closeRequest !== null;
  const waitStartMs = Date.now();
  const slaDeadlineAtMs = computeSlaDeadlineAtMs(
    firstResponseSlaTimer,
    waitStartMs,
  );
  const expiryDeadlineAtMs = computeApprovalExpiryDeadlineAtMs(
    approval.expires_in_ms,
    waitStartMs,
  );

  let approvalWaitResult = await waitForApprovalOutcome(
    slaDeadlineAtMs,
    expiryDeadlineAtMs,
    signalReceived,
  );
  let approvalExpired = false;

  if (approvalWaitResult === "approval_expired") {
    const expiry = await activities.expireApproval({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      approval_id: approval.approval_id,
    });

    if (expiry.expired) {
      approvalExpired = true;
    } else {
      // A reviewer decision won the race. The API signals after commit, so
      // keep waiting for it (without the expiry timer).
      approvalWaitResult = await waitForApprovalOutcome(
        slaDeadlineAtMs,
        null,
        signalReceived,
      );
    }
  }

  if (approvalExpired) {
    // BACKEND_SPEC section 12: expired approvals return the ticket to the
    // human queue. The ticket already sits in `waiting_human`; the expiry
    // audit is written by the `expireApproval` activity.
    phase = "approval_expired";
  } else if (
    approvalWaitResult === "sla_breached" &&
    firstResponseSlaTimer !== null
  ) {
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
    const closeTransition = await activities.applyTicketStateTransition({
      tenant_id: input.tenant_id,
      ticket_id: input.ticket_id,
      correlation_id: input.correlation_id,
      to_status: "closed",
      reason_code: closeRequest.reason_code,
      metadata: {
        requested_by_actor_id: closeRequest.requested_by_actor_id,
        requested_at: closeRequest.requested_at,
      },
      actor: {
        type: "human",
        id: closeRequest.requested_by_actor_id,
      },
      transition_key: "close-requested",
    });

    if (closeTransition.applied) {
      await emitDomainEvent({
        event_type: "ticket_state_transition",
        event_id: buildWorkflowEventId(input, "ticket-closed"),
        tenant_id: input.tenant_id,
        correlation_id: input.correlation_id,
        causation_id: input.initial_message_id,
        actor: {
          type: "human",
          id: closeRequest.requested_by_actor_id,
        },
        event_name: "support.ticket.closed.v1",
        ticket_id: input.ticket_id,
        from_status: closeTransition.from_status,
        to_status: "closed",
        reason_code: closeRequest.reason_code,
        metadata: {
          requested_by_actor_id: closeRequest.requested_by_actor_id,
          requested_at: closeRequest.requested_at,
        },
      });
    }

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

    if (
      approvalResult.status === "approved" ||
      approvalResult.status === "edited"
    ) {
      phase = "sending_response";
      const outbound = await sendOutboundMessage({
        tenant_id: input.tenant_id,
        ticket_id: input.ticket_id,
        conversation_id: ticketResult.ticket.conversation_id,
        correlation_id: input.correlation_id,
        approval_id: approvalResult.approval_id,
        approval_status: approvalResult.status,
        idempotency_key: buildOutboundIdempotencyKey(
          input,
          approvalResult.approval_id,
        ),
      });
      outboundResult = outbound;
      await emitDomainEvent({
        event_type: "message_sent",
        event_id: buildWorkflowEventId(input, "message-sent"),
        tenant_id: input.tenant_id,
        correlation_id: input.correlation_id,
        causation_id: approvalResult.approval_id,
        actor: workflowActor(),
        message_id: outbound.message_id,
        conversation_id: outbound.conversation_id,
        ticket_id: input.ticket_id,
        channel_id: outbound.channel_id,
        sent_at: outbound.sent_at,
      });
      await recordAuditEvent({
        tenant_id: input.tenant_id,
        ticket_id: input.ticket_id,
        correlation_id: input.correlation_id,
        action: "message.sent",
        actor: workflowActor(),
        metadata: {
          message_id: outbound.message_id,
          conversation_id: outbound.conversation_id,
          channel_id: outbound.channel_id,
          external_message_id: outbound.external_message_id,
          approval_id: approvalResult.approval_id,
          approval_status: approvalResult.status,
          sent_at: outbound.sent_at,
        },
      });
      await activities.applyTicketStateTransition({
        tenant_id: input.tenant_id,
        ticket_id: input.ticket_id,
        correlation_id: input.correlation_id,
        to_status: "waiting_customer",
        reason_code: "response_sent",
        metadata: {
          message_id: outbound.message_id,
          approval_id: approvalResult.approval_id,
        },
        actor: workflowActor(),
        transition_key: "response-sent",
      });
      phase = "responded";
    } else if (approvalResult.status === "escalated") {
      phase = "manual_escalated";
      await recordAuditEvent({
        tenant_id: input.tenant_id,
        ticket_id: input.ticket_id,
        correlation_id: input.correlation_id,
        action: "ticket.manual_escalated",
        actor: {
          type: "human",
          id: approvalResult.actor_id,
        },
        metadata: {
          approval_id: approvalResult.approval_id,
          decided_at: approvalResult.decided_at,
          notes: approvalResult.notes,
          source: "approval_escalation",
        },
      });
    } else {
      phase = "completed";
    }
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

function computeSlaDeadlineAtMs(
  timer: TicketLifecycleSlaTimer | null,
  startMs: number,
): number | null {
  if (timer === null) {
    return null;
  }

  if (!Number.isFinite(timer.timer_ms)) {
    throw new Error(`Invalid SLA timer duration: ${timer.timer_ms}`);
  }

  return startMs + Math.trunc(timer.timer_ms);
}

function computeApprovalExpiryDeadlineAtMs(
  expiresInMs: number | null,
  startMs: number,
): number | null {
  if (expiresInMs === null) {
    return null;
  }

  if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
    throw new Error(`Invalid approval expiry duration: ${expiresInMs}`);
  }

  return startMs + Math.trunc(expiresInMs);
}

/**
 * Race the reviewer/escalation/close signals against the first-response SLA
 * timer and the approval-expiry timer. The earliest pending deadline arms a
 * single Temporal timer; deadlines already in the past fire immediately. On
 * an SLA/expiry tie the SLA breach wins so its incident handling runs first.
 */
async function waitForApprovalOutcome(
  slaDeadlineAtMs: number | null,
  expiryDeadlineAtMs: number | null,
  signalReceived: () => boolean,
): Promise<"signal_received" | "sla_breached" | "approval_expired"> {
  if (signalReceived()) {
    return "signal_received";
  }

  const deadlines: {
    readonly kind: "sla_breached" | "approval_expired";
    readonly atMs: number;
  }[] = [];

  if (slaDeadlineAtMs !== null) {
    deadlines.push({ kind: "sla_breached", atMs: slaDeadlineAtMs });
  }
  if (expiryDeadlineAtMs !== null) {
    deadlines.push({ kind: "approval_expired", atMs: expiryDeadlineAtMs });
  }

  if (deadlines.length === 0) {
    await condition(signalReceived);
    return "signal_received";
  }

  deadlines.sort((left, right) => left.atMs - right.atMs);
  const next = deadlines[0]!;
  const remainingMs = next.atMs - Date.now();

  if (remainingMs <= 0) {
    return next.kind;
  }

  const signaledBeforeDeadline = await condition(signalReceived, remainingMs);

  return signaledBeforeDeadline ? "signal_received" : next.kind;
}

/**
 * Emit `support.ai_run.completed.v1` (and one
 * `support.tool_call.completed.v1` per executed tool call) after the AI
 * graph activity returns. Failed runs are emitted too — their persisted run
 * id is backfilled deterministically by `createPersistedRunAiGraph`; a null
 * id means nothing was persisted, so there is nothing to reference.
 */
async function emitAiGraphCompletionEvents(
  input: TicketLifecycleWorkflowInput,
  aiGraphResult: RunAiGraphActivityResult,
): Promise<void> {
  const aiRunId = aiGraphResult.ai_run_id;

  if (aiRunId === null) {
    return;
  }

  await emitDomainEvent({
    event_type: "ai_run_completed",
    event_id: buildWorkflowEventId(input, "ai-run-completed"),
    tenant_id: input.tenant_id,
    correlation_id: input.correlation_id,
    causation_id: input.initial_message_id,
    actor: workflowActor(),
    ai_run_id: aiRunId,
    ticket_id: input.ticket_id,
    status: aiGraphResult.status,
    metadata:
      aiGraphResult.status === "succeeded"
        ? {
            trace_id: aiGraphResult.trace_id,
            automation_mode: aiGraphResult.final_recommendation.automation_mode,
            risk_level: aiGraphResult.final_recommendation.risk_level,
            confidence: aiGraphResult.final_recommendation.confidence,
          }
        : {
            trace_id: aiGraphResult.trace_id,
            error_code: aiGraphResult.error_code,
            retryable: aiGraphResult.retryable,
          },
  });

  if (aiGraphResult.status !== "succeeded") {
    return;
  }

  for (const [index, toolCall] of aiGraphResult.tool_calls.entries()) {
    const summary = summarizeToolCall(toolCall, index);
    await emitDomainEvent({
      event_type: "tool_call_completed",
      event_id: buildWorkflowEventId(input, `tool-call-${summary.toolCallId}`),
      tenant_id: input.tenant_id,
      correlation_id: input.correlation_id,
      causation_id: aiRunId,
      actor: workflowActor(),
      tool_call_id: summary.toolCallId,
      ticket_id: input.ticket_id,
      tool_name: summary.toolName,
      status: summary.status,
      metadata: { ai_run_id: aiRunId },
    });
  }
}

/**
 * The AI graph reports tool calls as loosely-typed records (the Milestone 8
 * envelope). Read the identifying fields defensively so a malformed entry
 * degrades to a labeled placeholder instead of failing the emission.
 */
function summarizeToolCall(
  toolCall: Record<string, unknown>,
  index: number,
): { toolCallId: string; toolName: string; status: string } {
  const readString = (key: string): string | null => {
    const value = toolCall[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };

  return {
    toolCallId: readString("tool_call_id") ?? `index-${index}`,
    toolName: readString("tool_name") ?? readString("name") ?? "unknown",
    status: readString("status") ?? "unknown",
  };
}

function approvalReasonCode(
  triage: RunInitialTriageActivityResult,
  aiGraphResult: RunAiGraphActivityResult,
): string | null {
  if (aiGraphResult.status === "failed") {
    return aiGraphResult.reason_codes[0] ?? aiGraphResult.error_code;
  }

  return (
    aiGraphResult.final_recommendation.reason_codes[0] ?? triage.reason_code
  );
}

function approvalMetadata(
  triage: RunInitialTriageActivityResult,
  aiGraphResult: RunAiGraphActivityResult,
): Record<string, unknown> {
  if (aiGraphResult.status === "failed") {
    return {
      ...triage.metadata,
      source: "ai_graph_failure",
      triage: {
        route: triage.route,
        reason_code: triage.reason_code,
        metadata: triage.metadata,
      },
      ai_graph: {
        status: aiGraphResult.status,
        ai_run_id: aiGraphResult.ai_run_id,
        trace_id: aiGraphResult.trace_id,
        error_code: aiGraphResult.error_code,
        error_message: aiGraphResult.error_message,
        retryable: aiGraphResult.retryable,
        reason_codes: aiGraphResult.reason_codes,
        eval_signals: aiGraphResult.eval_signals,
      },
    };
  }

  return {
    ...triage.metadata,
    source: "ai_graph",
    triage: {
      route: triage.route,
      reason_code: triage.reason_code,
      metadata: triage.metadata,
    },
    ai_graph: {
      status: aiGraphResult.status,
      ai_run_id: aiGraphResult.ai_run_id,
      trace_id: aiGraphResult.trace_id,
      classification: aiGraphResult.classification,
      routing_decision: aiGraphResult.routing_decision,
      tool_calls: aiGraphResult.tool_calls,
      draft: aiGraphResult.draft,
      guardrails: aiGraphResult.guardrails,
      final_recommendation: aiGraphResult.final_recommendation,
      eval_signals: aiGraphResult.eval_signals,
    },
  };
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

async function sendOutboundMessage(
  input: Parameters<TicketLifecycleActivities["sendOutboundMessage"]>[0],
): Promise<SendOutboundMessageActivityResult> {
  return activities.sendOutboundMessage.executeWithOptions(
    {
      startToCloseTimeout: "1 minute",
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

function buildOutboundIdempotencyKey(
  input: TicketLifecycleWorkflowInput,
  approvalId: string,
): string {
  return ["outbound", input.tenant_id, input.ticket_id, approvalId].join(":");
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
    ai_run_id: state.ai_run_id,
    ai_status: state.ai_status,
    ai_automation_mode: state.ai_automation_mode,
    ai_failure_code: state.ai_failure_code,
    outbound_message_id: state.outbound_message_id,
  };
}
