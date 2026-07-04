/**
 * Shared span attribute keys and metric names for the support platform.
 *
 * Spans emitted by the API, workers, and jobs all carry the same
 * `support.*` correlation attributes so a ticket can be traced end to end
 * across process boundaries by `correlation_id` / `ticket_id` even where
 * strict parent-child span propagation is not wired (see ADR-0018).
 */

export const SUPPORT_ATTR = {
  service: "support.service",
  tenantId: "support.tenant_id",
  ticketId: "support.ticket_id",
  conversationId: "support.conversation_id",
  correlationId: "support.correlation_id",
  requestId: "support.request_id",
  workflowId: "support.workflow_id",
  activity: "support.activity",
  aiRunId: "support.ai_run_id",
  approvalId: "support.approval_id",
  messageId: "support.message_id",
  toolName: "support.tool_name",
  outcome: "support.outcome",
  failureMode: "support.failure_mode",
} as const;

export const SUPPORT_METRIC_NAMES = {
  apiRequests: "support.api.requests",
  apiRequestDurationMs: "support.api.request.duration_ms",
  workflowActivityExecutions: "support.workflow.activity.executions",
  workflowActivityDurationMs: "support.workflow.activity.duration_ms",
  aiRunCompletions: "support.ai_run.completions",
  aiRunDurationMs: "support.ai_run.duration_ms",
  toolCallExecutions: "support.tool_call.executions",
  toolCallDurationMs: "support.tool_call.duration_ms",
  approvalRequests: "support.approval.requests",
  approvalDecisions: "support.approval.decisions",
  approvalLatencyMs: "support.approval.latency_ms",
  criticalFailures: "support.critical_failures",
} as const;

export type SupportMetricName =
  (typeof SUPPORT_METRIC_NAMES)[keyof typeof SUPPORT_METRIC_NAMES];

export const SUPPORT_CRITICAL_FAILURE_MODES = [
  "ai_graph_failed",
  "outbound_send_failed",
  "approval_signal_failed",
  "event_dead_letter",
  "sla_breached",
] as const;

export type SupportCriticalFailureMode =
  (typeof SUPPORT_CRITICAL_FAILURE_MODES)[number];
