import { metrics as metricsApi, type Meter } from "@opentelemetry/api";
import {
  SUPPORT_METRIC_NAMES,
  type SupportCriticalFailureMode,
} from "./attributes.js";
import { SUPPORT_INSTRUMENTATION_SCOPE } from "./telemetry.js";

export interface ApiRequestMetric {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface WorkflowActivityMetric {
  activity: string;
  outcome: "succeeded" | "failed";
  durationMs: number;
}

export interface AiRunMetric {
  status: "succeeded" | "failed";
  automationMode: string | null;
  riskLevel: string | null;
  durationMs: number;
}

export interface ToolCallMetric {
  tool: string;
  status: "succeeded" | "failed" | "blocked";
  sideEffectClass: string;
  durationMs: number;
}

export interface ApprovalDecisionMetric {
  decision: string;
  latencyMs: number | null;
}

/**
 * Typed domain metrics port. Production wires the OTel-backed
 * implementation; tests use the recording one; everything defaults to
 * no-op so instrumented code paths never require telemetry.
 */
export interface SupportMetrics {
  recordApiRequest(metric: ApiRequestMetric): void;
  recordWorkflowActivity(metric: WorkflowActivityMetric): void;
  recordAiRun(metric: AiRunMetric): void;
  recordToolCall(metric: ToolCallMetric): void;
  recordApprovalRequested(approvalType: string): void;
  recordApprovalDecision(metric: ApprovalDecisionMetric): void;
  recordCriticalFailure(mode: SupportCriticalFailureMode): void;
}

export function createNoopSupportMetrics(): SupportMetrics {
  return {
    recordApiRequest: () => {},
    recordWorkflowActivity: () => {},
    recordAiRun: () => {},
    recordToolCall: () => {},
    recordApprovalRequested: () => {},
    recordApprovalDecision: () => {},
    recordCriticalFailure: () => {},
  };
}

export interface RecordingSupportMetrics extends SupportMetrics {
  apiRequests: ApiRequestMetric[];
  workflowActivities: WorkflowActivityMetric[];
  aiRuns: AiRunMetric[];
  toolCalls: ToolCallMetric[];
  approvalRequests: string[];
  approvalDecisions: ApprovalDecisionMetric[];
  criticalFailures: SupportCriticalFailureMode[];
}

export function createRecordingSupportMetrics(): RecordingSupportMetrics {
  const recording: RecordingSupportMetrics = {
    apiRequests: [],
    workflowActivities: [],
    aiRuns: [],
    toolCalls: [],
    approvalRequests: [],
    approvalDecisions: [],
    criticalFailures: [],
    recordApiRequest: (metric) => {
      recording.apiRequests.push(metric);
    },
    recordWorkflowActivity: (metric) => {
      recording.workflowActivities.push(metric);
    },
    recordAiRun: (metric) => {
      recording.aiRuns.push(metric);
    },
    recordToolCall: (metric) => {
      recording.toolCalls.push(metric);
    },
    recordApprovalRequested: (approvalType) => {
      recording.approvalRequests.push(approvalType);
    },
    recordApprovalDecision: (metric) => {
      recording.approvalDecisions.push(metric);
    },
    recordCriticalFailure: (mode) => {
      recording.criticalFailures.push(mode);
    },
  };
  return recording;
}

/**
 * OTel-backed implementation. Resolves instruments once at construction,
 * so the global meter provider must be registered first (start telemetry
 * before building the app/worker). With no provider registered every
 * instrument is the API's no-op implementation.
 */
export function createOtelSupportMetrics(meter?: Meter): SupportMetrics {
  const resolved = meter ?? metricsApi.getMeter(SUPPORT_INSTRUMENTATION_SCOPE);

  const apiRequests = resolved.createCounter(SUPPORT_METRIC_NAMES.apiRequests, {
    description: "API requests by method, route, and status code",
  });
  const apiRequestDuration = resolved.createHistogram(
    SUPPORT_METRIC_NAMES.apiRequestDurationMs,
    { description: "API request duration", unit: "ms" },
  );
  const workflowActivityExecutions = resolved.createCounter(
    SUPPORT_METRIC_NAMES.workflowActivityExecutions,
    { description: "Temporal workflow activity executions by outcome" },
  );
  const workflowActivityDuration = resolved.createHistogram(
    SUPPORT_METRIC_NAMES.workflowActivityDurationMs,
    { description: "Temporal workflow activity duration", unit: "ms" },
  );
  const aiRunCompletions = resolved.createCounter(
    SUPPORT_METRIC_NAMES.aiRunCompletions,
    { description: "AI runs completed by status and automation mode" },
  );
  const aiRunDuration = resolved.createHistogram(
    SUPPORT_METRIC_NAMES.aiRunDurationMs,
    { description: "AI run duration", unit: "ms" },
  );
  const toolCallExecutions = resolved.createCounter(
    SUPPORT_METRIC_NAMES.toolCallExecutions,
    { description: "Tool calls by tool, status, and side effect class" },
  );
  const toolCallDuration = resolved.createHistogram(
    SUPPORT_METRIC_NAMES.toolCallDurationMs,
    { description: "Tool call duration", unit: "ms" },
  );
  const approvalRequests = resolved.createCounter(
    SUPPORT_METRIC_NAMES.approvalRequests,
    { description: "Approvals requested" },
  );
  const approvalDecisions = resolved.createCounter(
    SUPPORT_METRIC_NAMES.approvalDecisions,
    { description: "Approval decisions by outcome" },
  );
  const approvalLatency = resolved.createHistogram(
    SUPPORT_METRIC_NAMES.approvalLatencyMs,
    { description: "Latency from approval request to decision", unit: "ms" },
  );
  const criticalFailures = resolved.createCounter(
    SUPPORT_METRIC_NAMES.criticalFailures,
    { description: "Critical failure events by failure mode" },
  );

  return {
    recordApiRequest: (metric) => {
      const attributes = {
        "http.request.method": metric.method,
        "http.route": metric.route,
        "http.response.status_code": metric.statusCode,
      };
      apiRequests.add(1, attributes);
      apiRequestDuration.record(metric.durationMs, attributes);
    },
    recordWorkflowActivity: (metric) => {
      const attributes = {
        activity: metric.activity,
        outcome: metric.outcome,
      };
      workflowActivityExecutions.add(1, attributes);
      workflowActivityDuration.record(metric.durationMs, attributes);
    },
    recordAiRun: (metric) => {
      aiRunCompletions.add(1, {
        status: metric.status,
        automation_mode: metric.automationMode ?? "unknown",
        risk_level: metric.riskLevel ?? "unknown",
      });
      aiRunDuration.record(metric.durationMs, { status: metric.status });
    },
    recordToolCall: (metric) => {
      const attributes = {
        tool: metric.tool,
        status: metric.status,
        side_effect_class: metric.sideEffectClass,
      };
      toolCallExecutions.add(1, attributes);
      toolCallDuration.record(metric.durationMs, {
        tool: metric.tool,
        status: metric.status,
      });
    },
    recordApprovalRequested: (approvalType) => {
      approvalRequests.add(1, { approval_type: approvalType });
    },
    recordApprovalDecision: (metric) => {
      approvalDecisions.add(1, { decision: metric.decision });
      if (metric.latencyMs !== null) {
        approvalLatency.record(metric.latencyMs, {
          decision: metric.decision,
        });
      }
    },
    recordCriticalFailure: (mode) => {
      criticalFailures.add(1, { failure_mode: mode });
    },
  };
}
