import {
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
  type StreamConfig,
  type StreamInfo,
  type StreamUpdateConfig,
} from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import {
  SUPPORT_EVENT_ERRORS_SUBJECT,
  createNatsJetStreamSupportEventErrorPublisher,
  type SupportEventErrorPublisher,
} from "./event-errors.js";
import {
  createNatsJetStreamDomainEventPublisher,
  type DomainEventPublisher,
} from "./event-publisher.js";

export const SUPPORT_EVENTS_STREAM = "SUPPORT_EVENTS";
export const SUPPORT_EVENTS_SUBJECT = "support.events.tenant.*.*.*.v1";
export const SUPPORT_EVENT_ERRORS_STREAM = "SUPPORT_EVENT_ERRORS";
export const SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS = 10 * 60 * 1_000_000_000;
export const DEFAULT_NATS_URL = "nats://localhost:4222";

export interface NatsEventBusConfig {
  readonly servers: readonly string[];
  readonly streamName: string;
  readonly streamSubjects: readonly string[];
  readonly errorStreamName: string;
  readonly errorStreamSubjects: readonly string[];
  readonly duplicateWindowNanos: number;
}

export interface NatsEventBusRuntime {
  readonly connection: NatsConnection;
  readonly jetStream: JetStreamClient;
  readonly jetStreamManager: JetStreamManager;
  readonly publisher: DomainEventPublisher;
  readonly errorPublisher: SupportEventErrorPublisher;
  ensureStream(): Promise<StreamInfo>;
  ensureErrorStream(): Promise<StreamInfo>;
  ensureStreams(): Promise<readonly [StreamInfo, StreamInfo]>;
  close(): Promise<void>;
}

export function loadNatsEventBusConfig(
  env: NodeJS.ProcessEnv = process.env,
): NatsEventBusConfig {
  return {
    servers: splitServerList(env.NATS_URL ?? DEFAULT_NATS_URL),
    streamName: SUPPORT_EVENTS_STREAM,
    streamSubjects: [SUPPORT_EVENTS_SUBJECT],
    errorStreamName: SUPPORT_EVENT_ERRORS_STREAM,
    errorStreamSubjects: [SUPPORT_EVENT_ERRORS_SUBJECT],
    duplicateWindowNanos: SUPPORT_EVENTS_DUPLICATE_WINDOW_NANOS,
  };
}

export function buildSupportEventsStreamCreateConfig(
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Partial<StreamConfig> & { name: string } {
  return {
    name: config.streamName,
    subjects: [...config.streamSubjects],
    description:
      "Versioned tenant-scoped support domain events for workflow and worker processing.",
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: -1,
    max_msgs_per_subject: -1,
    max_age: 0,
    max_bytes: -1,
    max_msg_size: -1,
    duplicate_window: config.duplicateWindowNanos,
    num_replicas: 1,
    deny_delete: false,
    deny_purge: false,
    allow_direct: true,
  };
}

export function buildSupportEventsStreamUpdateConfig(
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Partial<StreamUpdateConfig> {
  return {
    subjects: [...config.streamSubjects],
    description:
      "Versioned tenant-scoped support domain events for workflow and worker processing.",
    duplicate_window: config.duplicateWindowNanos,
    max_msgs: -1,
    max_msgs_per_subject: -1,
    max_age: 0,
    max_bytes: -1,
    max_msg_size: -1,
    num_replicas: 1,
    deny_delete: false,
    deny_purge: false,
    allow_direct: true,
  };
}

export function buildSupportEventErrorsStreamCreateConfig(
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Partial<StreamConfig> & { name: string } {
  return {
    name: config.errorStreamName,
    subjects: [...config.errorStreamSubjects],
    description:
      "Structured worker error records for invalid or failed support domain event messages.",
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: -1,
    max_msgs_per_subject: -1,
    max_age: 0,
    max_bytes: -1,
    max_msg_size: -1,
    duplicate_window: config.duplicateWindowNanos,
    num_replicas: 1,
    deny_delete: false,
    deny_purge: false,
    allow_direct: true,
  };
}

export function buildSupportEventErrorsStreamUpdateConfig(
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Partial<StreamUpdateConfig> {
  return {
    subjects: [...config.errorStreamSubjects],
    description:
      "Structured worker error records for invalid or failed support domain event messages.",
    duplicate_window: config.duplicateWindowNanos,
    max_msgs: -1,
    max_msgs_per_subject: -1,
    max_age: 0,
    max_bytes: -1,
    max_msg_size: -1,
    num_replicas: 1,
    deny_delete: false,
    deny_purge: false,
    allow_direct: true,
  };
}

export async function ensureSupportEventsStream(
  manager: JetStreamManager,
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Promise<StreamInfo> {
  try {
    await manager.streams.info(config.streamName);
  } catch (error) {
    if (!isJetStreamNotFound(error)) {
      throw error;
    }

    return manager.streams.add(buildSupportEventsStreamCreateConfig(config));
  }

  return manager.streams.update(
    config.streamName,
    buildSupportEventsStreamUpdateConfig(config),
  );
}

export async function ensureSupportEventErrorsStream(
  manager: JetStreamManager,
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Promise<StreamInfo> {
  try {
    await manager.streams.info(config.errorStreamName);
  } catch (error) {
    if (!isJetStreamNotFound(error)) {
      throw error;
    }

    return manager.streams.add(
      buildSupportEventErrorsStreamCreateConfig(config),
    );
  }

  return manager.streams.update(
    config.errorStreamName,
    buildSupportEventErrorsStreamUpdateConfig(config),
  );
}

export async function connectNatsEventBus(
  config: NatsEventBusConfig = loadNatsEventBusConfig(),
): Promise<NatsEventBusRuntime> {
  const connection = await connect({ servers: [...config.servers] });
  const js = jetstream(connection);
  const manager = await jetstreamManager(connection);

  return {
    connection,
    jetStream: js,
    jetStreamManager: manager,
    publisher: createNatsJetStreamDomainEventPublisher(js),
    errorPublisher: createNatsJetStreamSupportEventErrorPublisher(js),
    ensureStream: () => ensureSupportEventsStream(manager, config),
    ensureErrorStream: () => ensureSupportEventErrorsStream(manager, config),
    ensureStreams: () =>
      Promise.all([
        ensureSupportEventsStream(manager, config),
        ensureSupportEventErrorsStream(manager, config),
      ]),
    close: () => connection.close(),
  };
}

function splitServerList(value: string): readonly string[] {
  return value
    .split(",")
    .map((server) => server.trim())
    .filter((server) => server.length > 0);
}

function isJetStreamNotFound(error: unknown): boolean {
  const candidate = error as {
    readonly code?: string | number;
    readonly api_error?: { readonly code?: number; readonly err_code?: number };
    readonly message?: string;
  };

  return (
    candidate.code === "404" ||
    candidate.code === 404 ||
    candidate.api_error?.code === 404 ||
    candidate.message?.toLowerCase().includes("not found") === true
  );
}
