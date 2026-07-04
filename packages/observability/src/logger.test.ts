import { afterEach, describe, expect, it } from "vitest";
import {
  createRecordingLogSink,
  createStructuredLogger,
  REDACTED_EMAIL_VALUE,
  REDACTED_NUMBER_VALUE,
  REDACTED_PHONE_VALUE,
  REDACTED_VALUE,
  redactLogFields,
  redactPiiFromText,
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

  it("scrubs PII from field strings, nested objects, and arrays", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    logger.info("inbound message", {
      body: "reach me at jane.doe@example.com please",
      customer: { contact: "call +1 (415) 555-2671 after 5pm" },
      attachments: ["card ending 4111 1111 1111 1111", { note: "ok" }],
    });

    const entries = recording.entries();
    expect(entries[0]?.body).toBe(`reach me at ${REDACTED_EMAIL_VALUE} please`);
    expect(entries[0]?.customer).toEqual({
      contact: `call ${REDACTED_PHONE_VALUE} after 5pm`,
    });
    expect(entries[0]?.attachments).toEqual([
      `card ending ${REDACTED_NUMBER_VALUE}`,
      { note: "ok" },
    ]);
  });

  it("scrubs PII from the message itself", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    logger.info("customer jane.doe@example.com escalated");

    expect(recording.entries()[0]?.message).toBe(
      `customer ${REDACTED_EMAIL_VALUE} escalated`,
    );
  });

  it("skips content scrubbing when redactPii is false, including children", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "workers",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
      redactPii: false,
    });

    logger.info("contact jane.doe@example.com", {
      phone: "415-555-2671",
      token: "tok_live_abc",
    });
    logger
      .child({ tenant_id: "ten_1" })
      .info("child contact jane.doe@example.com");

    const entries = recording.entries();
    expect(entries[0]?.message).toBe("contact jane.doe@example.com");
    expect(entries[0]?.phone).toBe("415-555-2671");
    expect(entries[0]?.token).toBe(REDACTED_VALUE);
    expect(entries[1]?.message).toBe("child contact jane.doe@example.com");
  });

  it("prefers key redaction over PII scrubbing for secret-bearing keys", () => {
    const recording = createRecordingLogSink();
    const logger = createStructuredLogger({
      service: "api",
      environment: "local",
      sink: recording.sink,
      now: FIXED_NOW,
    });

    logger.info("callback", { token: "email jane.doe@example.com" });

    expect(recording.entries()[0]?.token).toBe(REDACTED_VALUE);
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
  it("leaves non-PII arrays and primitives untouched", () => {
    expect(redactLogFields({ ids: ["a", "b"], count: 2, note: null })).toEqual({
      ids: ["a", "b"],
      count: 2,
      note: null,
    });
  });

  it("applies key redaction inside arrays of objects", () => {
    expect(
      redactLogFields({ hops: [{ api_key: "mg-key", region: "us" }] }),
    ).toEqual({ hops: [{ api_key: REDACTED_VALUE, region: "us" }] });
  });
});

describe("redactPiiFromText", () => {
  it("redacts email addresses", () => {
    expect(redactPiiFromText("from jane.doe+billing@sub.example.co.uk!")).toBe(
      `from ${REDACTED_EMAIL_VALUE}!`,
    );
  });

  it.each([
    ["+1 (415) 555-2671", REDACTED_PHONE_VALUE],
    ["415-555-2671", REDACTED_PHONE_VALUE],
    ["415.555.2671", REDACTED_PHONE_VALUE],
    ["+911234567890", REDACTED_PHONE_VALUE],
    ["4155552671", REDACTED_PHONE_VALUE],
  ])("redacts phone number %s", (input, expected) => {
    expect(redactPiiFromText(`call ${input} now`)).toBe(`call ${expected} now`);
  });

  it.each([
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "3782 822463 10005",
  ])("redacts card-like digit run %s", (input) => {
    expect(redactPiiFromText(`card ${input} charged`)).toBe(
      `card ${REDACTED_NUMBER_VALUE} charged`,
    );
  });

  it("redacts mixed content in one pass", () => {
    expect(
      redactPiiFromText(
        "jane.doe@example.com paid with 4242 4242 4242 4242, callback 555-123-4567",
      ),
    ).toBe(
      `${REDACTED_EMAIL_VALUE} paid with ${REDACTED_NUMBER_VALUE}, callback ${REDACTED_PHONE_VALUE}`,
    );
  });

  it("does not let the phone pattern half-eat an adjacent card number", () => {
    expect(redactPiiFromText("4111 1111 1111 1111 5551234567")).toBe(
      `${REDACTED_NUMBER_VALUE} ${REDACTED_PHONE_VALUE}`,
    );
  });

  it.each([
    "2026-07-04T10:00:00.000Z",
    "550e8400-e29b-41d4-a716-446655440000",
    "12345678-1234-e29b-a716-446655440000",
    "4bf92f3577b34da6a3ce929d0e0e4736",
    "ten_pilot",
    "msg_out_abc123",
    "status 404",
    "latency_ms 12345",
    "version 1.2.3",
    "v10.20.30",
  ])("leaves non-PII string %j unchanged", (input) => {
    expect(redactPiiFromText(input)).toBe(input);
  });

  it("redacts a digits-only run of 13+ as a number (documented trade-off)", () => {
    expect(redactPiiFromText("ref 1751623200000")).toBe(
      `ref ${REDACTED_NUMBER_VALUE}`,
    );
  });
});
