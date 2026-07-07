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
    metrics.recordJobRun({
      job: "retention",
      outcome: "succeeded",
      tenantId: "ten_a",
      durationMs: 120,
    });
    metrics.recordRetentionPurge({
      retentionClass: "raw_payload",
      tenantId: "ten_a",
      count: 3,
    });

    expect(metrics.apiRequests).toHaveLength(1);
    expect(metrics.workflowActivities).toHaveLength(1);
    expect(metrics.aiRuns).toHaveLength(1);
    expect(metrics.toolCalls).toHaveLength(1);
    expect(metrics.approvalRequests).toEqual(["ai_response_review"]);
    expect(metrics.approvalDecisions).toEqual([
      { decision: "approved", latencyMs: 900 },
    ]);
    expect(metrics.criticalFailures).toEqual(["outbound_send_failed"]);
    expect(metrics.jobRuns).toEqual([
      {
        job: "retention",
        outcome: "succeeded",
        tenantId: "ten_a",
        durationMs: 120,
      },
    ]);
    expect(metrics.retentionPurges).toEqual([
      { retentionClass: "raw_payload", tenantId: "ten_a", count: 3 },
    ]);
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
    metrics.recordJobRun({
      job: "qa_sampling",
      outcome: "succeeded",
      tenantId: "ten_a",
      durationMs: 45,
    });
    metrics.recordRetentionPurge({
      retentionClass: "ai_run",
      tenantId: "ten_a",
      count: 2,
    });

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
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.jobExecutions);
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.jobDurationMs);
    expect(metricNames).toContain(SUPPORT_METRIC_NAMES.retentionPurgedItems);

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

    const jobExecutionsMetric = allMetrics.find(
      (metric) => metric.descriptor.name === SUPPORT_METRIC_NAMES.jobExecutions,
    );
    expect(jobExecutionsMetric?.dataPoints[0]?.attributes).toEqual({
      job: "qa_sampling",
      outcome: "succeeded",
      tenant_id: "ten_a",
    });
  });

  it("skips the retention purge counter when nothing was purged", async () => {
    telemetry = createInMemoryTelemetry();
    const metrics = createOtelSupportMetrics(telemetry.meter);
    metrics.recordRetentionPurge({
      retentionClass: "attachment",
      tenantId: "ten_a",
      count: 0,
    });

    const collected = await telemetry.collectMetrics();
    const metricNames = collected.flatMap((resourceMetrics) =>
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.map((metric) => metric.descriptor.name),
      ),
    );
    expect(metricNames).not.toContain(
      SUPPORT_METRIC_NAMES.retentionPurgedItems,
    );
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
