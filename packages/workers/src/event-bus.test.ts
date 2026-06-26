import {
  RetentionPolicy,
  StorageType,
  type JetStreamManager,
  type StreamInfo,
} from "@nats-io/jetstream";
import { describe, expect, it, vi } from "vitest";
import {
  SUPPORT_EVENT_ERRORS_STREAM,
  SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
  SUPPORT_EVENTS_STREAM,
  SUPPORT_EVENTS_SUBJECT,
  buildSupportEventErrorsStreamCreateConfig,
  ensureSupportEventErrorsStream,
  buildSupportEventsStreamCreateConfig,
  ensureSupportEventsStream,
  loadNatsEventBusConfig,
} from "./event-bus.js";
import { SUPPORT_EVENT_ERRORS_SUBJECT } from "./event-errors.js";

describe("NATS event bus config", () => {
  it("loads the local NATS URL by default", () => {
    expect(loadNatsEventBusConfig({})).toEqual({
      servers: ["nats://localhost:4222"],
      streamName: SUPPORT_EVENTS_STREAM,
      streamSubjects: [SUPPORT_EVENTS_SUBJECT],
      errorStreamName: SUPPORT_EVENT_ERRORS_STREAM,
      errorStreamSubjects: [SUPPORT_EVENT_ERRORS_SUBJECT],
      duplicateWindowNanos: SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
    });
  });

  it("parses comma-separated NATS server URLs from the environment", () => {
    expect(
      loadNatsEventBusConfig({
        NATS_URL: "nats://nats-a:4222, nats://nats-b:4222",
      }).servers,
    ).toEqual(["nats://nats-a:4222", "nats://nats-b:4222"]);
  });

  it("builds the support event stream create config", () => {
    expect(buildSupportEventsStreamCreateConfig()).toMatchObject({
      name: SUPPORT_EVENTS_STREAM,
      subjects: [SUPPORT_EVENTS_SUBJECT],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      duplicate_window: SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
      num_replicas: 1,
      allow_direct: true,
    });
  });

  it("builds the support event error stream create config", () => {
    expect(buildSupportEventErrorsStreamCreateConfig()).toMatchObject({
      name: SUPPORT_EVENT_ERRORS_STREAM,
      subjects: [SUPPORT_EVENT_ERRORS_SUBJECT],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      duplicate_window: SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
      num_replicas: 1,
      allow_direct: true,
    });
  });
});

describe("ensureSupportEventsStream", () => {
  it("creates the support event stream when it is missing", async () => {
    const streamInfo = makeStreamInfo();
    const manager = makeManager({
      info: vi.fn().mockRejectedValue({ code: "404" }),
      add: vi.fn().mockResolvedValue(streamInfo),
      update: vi.fn(),
    });

    await expect(ensureSupportEventsStream(manager)).resolves.toBe(streamInfo);

    expect(manager.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SUPPORT_EVENTS_STREAM,
        subjects: [SUPPORT_EVENTS_SUBJECT],
      }),
    );
    expect(manager.streams.update).not.toHaveBeenCalled();
  });

  it("updates the support event stream when it already exists", async () => {
    const streamInfo = makeStreamInfo();
    const manager = makeManager({
      info: vi.fn().mockResolvedValue(streamInfo),
      add: vi.fn(),
      update: vi.fn().mockResolvedValue(streamInfo),
    });

    await expect(ensureSupportEventsStream(manager)).resolves.toBe(streamInfo);

    expect(manager.streams.add).not.toHaveBeenCalled();
    expect(manager.streams.update).toHaveBeenCalledWith(
      SUPPORT_EVENTS_STREAM,
      expect.objectContaining({
        subjects: [SUPPORT_EVENTS_SUBJECT],
        duplicate_window: SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
      }),
    );
  });
});

describe("ensureSupportEventErrorsStream", () => {
  it("creates the support event error stream when it is missing", async () => {
    const streamInfo = makeStreamInfo(SUPPORT_EVENT_ERRORS_STREAM, [
      SUPPORT_EVENT_ERRORS_SUBJECT,
    ]);
    const manager = makeManager({
      info: vi.fn().mockRejectedValue({ code: "404" }),
      add: vi.fn().mockResolvedValue(streamInfo),
      update: vi.fn(),
    });

    await expect(ensureSupportEventErrorsStream(manager)).resolves.toBe(
      streamInfo,
    );

    expect(manager.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SUPPORT_EVENT_ERRORS_STREAM,
        subjects: [SUPPORT_EVENT_ERRORS_SUBJECT],
      }),
    );
    expect(manager.streams.update).not.toHaveBeenCalled();
  });

  it("updates the support event error stream when it already exists", async () => {
    const streamInfo = makeStreamInfo(SUPPORT_EVENT_ERRORS_STREAM, [
      SUPPORT_EVENT_ERRORS_SUBJECT,
    ]);
    const manager = makeManager({
      info: vi.fn().mockResolvedValue(streamInfo),
      add: vi.fn(),
      update: vi.fn().mockResolvedValue(streamInfo),
    });

    await expect(ensureSupportEventErrorsStream(manager)).resolves.toBe(
      streamInfo,
    );

    expect(manager.streams.add).not.toHaveBeenCalled();
    expect(manager.streams.update).toHaveBeenCalledWith(
      SUPPORT_EVENT_ERRORS_STREAM,
      expect.objectContaining({
        subjects: [SUPPORT_EVENT_ERRORS_SUBJECT],
        duplicate_window: SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
      }),
    );
  });
});

function makeManager(streams: {
  readonly info: ReturnType<typeof vi.fn>;
  readonly add: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
}): JetStreamManager {
  return {
    streams,
  } as unknown as JetStreamManager;
}

function makeStreamInfo(
  streamName = SUPPORT_EVENTS_STREAM,
  subjects: readonly string[] = [SUPPORT_EVENTS_SUBJECT],
): StreamInfo {
  return {
    config: {
      name: streamName,
      subjects: [...subjects],
    },
    state: {
      messages: 0,
      bytes: 0,
      first_seq: 0,
      first_ts: "1970-01-01T00:00:00.000Z",
      last_seq: 0,
      last_ts: "1970-01-01T00:00:00.000Z",
      consumer_count: 0,
    },
  } as StreamInfo;
}
