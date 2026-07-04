import { afterEach, describe, expect, it } from "vitest";
import { SUPPORT_ATTR } from "./attributes.js";
import {
  createInMemoryTelemetry,
  DEFAULT_METRIC_EXPORT_INTERVAL_MS,
  DEFAULT_OTLP_ENDPOINT,
  loadTelemetryConfig,
  startTelemetry,
  type InMemoryTelemetry,
} from "./telemetry.js";
import { getActiveTraceContext, withSpan } from "./tracing.js";

describe("loadTelemetryConfig", () => {
  it("applies defaults when env is empty", () => {
    const config = loadTelemetryConfig({}, { serviceName: "support-api" });
    expect(config).toEqual({
      serviceName: "support-api",
      serviceVersion: null,
      environment: "local",
      otlpEndpoint: DEFAULT_OTLP_ENDPOINT,
      metricExportIntervalMs: DEFAULT_METRIC_EXPORT_INTERVAL_MS,
      disabled: false,
    });
  });

  it("reads overrides from env and strips trailing slash", () => {
    const config = loadTelemetryConfig(
      {
        OTEL_SERVICE_NAME: "renamed",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/",
        OTEL_METRIC_EXPORT_INTERVAL: "2500",
        SUPPORT_ENVIRONMENT: "staging",
        OTEL_SDK_DISABLED: "true",
      },
      { serviceName: "support-api" },
    );
    expect(config.serviceName).toBe("renamed");
    expect(config.otlpEndpoint).toBe("http://collector:4318");
    expect(config.metricExportIntervalMs).toBe(2500);
    expect(config.environment).toBe("staging");
    expect(config.disabled).toBe(true);
  });
});

describe("startTelemetry", () => {
  it("returns a no-op runtime when disabled", async () => {
    const runtime = startTelemetry(
      loadTelemetryConfig(
        { OTEL_SDK_DISABLED: "true" },
        { serviceName: "support-api" },
      ),
    );
    await withSpan("noop.span", {}, async () => {
      expect(getActiveTraceContext()).toBeNull();
    });
    await runtime.forceFlush();
    await runtime.shutdown();
  });
});

describe("createInMemoryTelemetry", () => {
  let telemetry: InMemoryTelemetry | null = null;

  afterEach(async () => {
    if (telemetry !== null) {
      await telemetry.shutdown();
      telemetry = null;
    }
  });

  it("captures spans with support attributes", async () => {
    telemetry = createInMemoryTelemetry();
    await withSpan(
      "ticket.trace",
      {
        [SUPPORT_ATTR.tenantId]: "ten_1",
        [SUPPORT_ATTR.correlationId]: "corr_1",
      },
      async () => {
        const active = getActiveTraceContext();
        expect(active).not.toBeNull();
      },
    );
    const spans = telemetry.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("ticket.trace");
    expect(spans[0]?.attributes[SUPPORT_ATTR.tenantId]).toBe("ten_1");
    expect(spans[0]?.attributes[SUPPORT_ATTR.correlationId]).toBe("corr_1");
  });

  it("nests child spans under the active parent within a call chain", async () => {
    telemetry = createInMemoryTelemetry();
    await withSpan("parent.op", {}, async () => {
      await withSpan("child.op", {}, async () => {});
    });
    const spans = telemetry.getFinishedSpans();
    const parent = spans.find((span) => span.name === "parent.op");
    const child = spans.find((span) => span.name === "child.op");
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
  });

  it("records exceptions and rethrows from withSpan", async () => {
    telemetry = createInMemoryTelemetry();
    await expect(
      withSpan("failing.op", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const spans = telemetry.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(2);
    expect(spans[0]?.events.some((event) => event.name === "exception")).toBe(
      true,
    );
  });
});
