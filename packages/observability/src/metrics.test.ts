import { afterEach, describe, expect, it } from "vitest";
import { SUPPORT_METRIC_NAMES } from "./attributes.js";
import {
  createNoopSupportMetrics,
  createOtelSupportMetrics,
  createRecordingSupportMetrics,
} from "./metrics.js";
import {
  createInMemoryTelemetry,
  type InMemoryTelemetry,
} from "./telemetry.js";

describe("createRecordingSupportMetrics", () => {
  it("captures every metric family", () => {
    const metrics = createRecordingSupportMetrics();
    metrics.recordApiRequest({
      method: "GET",
      route: "/v1/tickets",
      statusCode: 200,
      durationMs: 12,
    });
    metrics.recordWorkflowActivity({
      activity: "runAiGraph",
      outcome: "succeeded",
      durationMs: 40,
    });
    metrics.recordAiRun({
      status: "succeeded",
      automationMode: "human_approve",
      riskLevel: "low",
      durationMs: 35,
    });
    metrics.recordToolCall({
      tool: "order_lookup",
      status: "succeeded",
      sideEffectClass: "read_only",
      durationMs: 5,
    });
    metrics.recordApprovalRequested("ai_response_review");
    metrics.recordApprovalDecision({ decision: "approved", latencyMs: 900 });
    metrics.recordCriticalFailure("outbound_send_failed");

    expect(metrics.apiRequests).toHaveLength(1);
    expect(metrics.workflowActivities).toHaveLength(1);
    expect(metrics.aiRuns).toHaveLength(1);
    expect(metrics.toolCalls).toHaveLength(1);
    expect(metrics.approvalRequests).toEqual(["ai_response_review"]);
    expect(metrics.approvalDecisions).toEqual([
      { decision: "approved", latencyMs: 900 },
    ]);
    expect(metrics.criticalFailures).toEqual(["outbound_send_failed"]);
  });
});

describe("createNoopSupportMetrics", () => {
  it("accepts records without throwing", () => {
    const metrics = createNoopSupportMetrics();
    expect(() => {
      metrics.recordApiRequest({
        method: "GET",
        route: "/health",
        statusCode: 200,
        durationMs: 1,
      });
      metrics.recordCriticalFailure("sla_breached");
    }).not.toThrow();
  });
});

describe("createOtelSupportMetrics", () => {
  let telemetry: InMemoryTelemetry | null = null;

  afterEach(async () => {
    if (telemetry !== null) {
      await telemetry.shutdown();
      telemetry = null;
    }
  });

  it("emits counters and histograms through the registered meter", async () => {
    telemetry = createInMemoryTelemetry();
    const metrics = createOtelSupportMetrics(telemetry.meter);

    metrics.recordApiRequest({
      method: "POST",
      route: "/v1/approvals/:approval_id/approve",
      statusCode: 200,
      durationMs: 18,
    });
    metrics.recordApprovalDecision({ decision: "approved", latencyMs: 250 });
    metrics.recordCriticalFailure("approval_signal_failed");

    const collected = await telemetry.collectMetrics();
    const metricNames = collected.flatMap((resourceMetrics) =>
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.map((metric) => metric.descriptor.name),
      ),
    );
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.apiRequests);
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.apiRequestDurationMs);
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.approvalDecisions);
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.approvalLatencyMs);
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.criticalFailures);

    const allMetrics = collected.flatMap((resourceMetrics) =>
      resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics),
    );
    const criticalFailureMetric = allMetrics.find(
      (metric) =>
        metric.descriptor.name === SUPPORT_METRIC_NAMES.criticalFailures,
    );
    expect(criticalFailureMetric?.dataPoints[0]?.attributes).toEqual({
      failure_mode: "approval_signal_failed",
    });
  });

  it("skips approval latency when latency is unknown", async () => {
    telemetry = createInMemoryTelemetry();
    const metrics = createOtelSupportMetrics(telemetry.meter);
    metrics.recordApprovalDecision({ decision: "rejected", latencyMs: null });

    const collected = await telemetry.collectMetrics();
    const metricNames = collected.flatMap((resourceMetrics) =>
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.map((metric) => metric.descriptor.name),
      ),
    );
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.approvalDecisions);
    expect(metricNames).not.toContain(SUPPORT_METRIC_NAMES.approvalLatencyMs);
  });
});
