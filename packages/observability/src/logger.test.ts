import { afterEach, describe, expect, it } from "vitest";
import {
  createRecordingLogSink,
  createStructuredLogger,
  REDACTED_VALUE,
  redactLogFields,
} from "./logger.js";
import {
  createInMemoryTelemetry,
  type InMemoryTelemetry,
} from "./telemetry.js";
import { withSpan } from "./tracing.js";

const FIXED_NOW = () => new Date("2026-07-04T12:00:00.000Z");

describe("createStructuredLogger", () => {
  it("writes JSON lines with the required base fields", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    logger.info("worker started", { task_queue: "support-ticket-lifecycle" });

    const entries = recording.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      level: "info",
      time: "2026-07-04T12:00:00.000Z",
      service: "workers",
      environment: "local",
      task_queue: "support-ticket-lifecycle",
      message: "worker started",
    });
  });

  it("carries child bindings such as correlation and tenant ids", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
    }).child({ tenant_id: "ten_1", correlation_id: "corr_1" });

    logger.warn("activity retrying", { activity: "sendOutboundMessage" });

    const entries = recording.entries();
    expect(entries[0]).toMatchObject({
      level: "warn",
      tenant_id: "ten_1",
      correlation_id: "corr_1",
      activity: "sendOutboundMessage",
    });
  });

  it("filters below the configured level", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "local",
      level: "warn",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    logger.debug("noise");
    logger.info("noise");
    logger.error("kept");

    const entries = recording.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("kept");
  });

  it("redacts secret-bearing keys recursively", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "api",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    logger.info("outbound send", {
      authorization: "Bearer abc",
      provider: { api_key: "mg-key", region: "us" },
    });

    const entries = recording.entries();
    expect(entries[0]?.authorization).toBe(REDACTED_VALUE);
    expect(entries[0]?.provider).toEqual({
      api_key: REDACTED_VALUE,
      region: "us",
    });
  });
});

describe("trace id injection", () => {
  let telemetry: InMemoryTelemetry | null = null;

  afterEach(async () => {
    if (telemetry !== null) {
      await telemetry.shutdown();
      telemetry = null;
    }
  });

  it("adds trace_id and span_id from the active span", async () => {
    telemetry = createInMemoryTelemetry();
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "test",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    await withSpan("activity.runAiGraph", {}, async () => {
      logger.info("running ai graph");
    });
    logger.info("outside span");

    const entries = recording.entries();
    expect(entries[0]?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(entries[0]?.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(entries[1]?.trace_id).toBeUndefined();
  });
});

describe("redactLogFields", () => {
  it("leaves arrays and primitives untouched", () => {
    expect(redactLogFields({ ids: ["a", "b"], count: 2, note: null })).toEqual({
      ids: ["a", "b"],
      count: 2,
      note: null,
    });
  });
});
