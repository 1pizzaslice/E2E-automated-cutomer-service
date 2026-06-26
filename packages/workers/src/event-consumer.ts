import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  type ConsumerConfig,
  type ConsumerInfo,
  type ConsumerUpdateConfig,
  type JetStreamClient,
  type JetStreamManager,
  type NextOptions,
} from "@nats-io/jetstream";
import {
  DomainEventEnvelopeSchema,
  buildDomainEventSubject,
  type DomainEventEnvelope,
  type DomainEventName,
} from "@support/shared-schemas";
import { SUPPORT_EVENTS_STREAM, SUPPORT_EVENTS_SUBJECT } from "./event-bus.js";

export const DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE = "support_event_consumer";
export const SUPPORT_EVENT_CONSUMER_ACK_WAIT_NANOS = 30 * 1_000_000_000;
export const SUPPORT_EVENT_CONSUMER_MAX_DELIVER = 5;
export const SUPPORT_EVENT_CONSUMER_MAX_ACK_PENDING = 32;
export const SUPPORT_EVENT_CONSUMER_NEXT_EXPIRES_MS = 1_000;
export const SUPPORT_EVENT_CONSUMER_NAK_DELAY_MS = 30_000;

export interface SupportEventConsumerConfig {
  readonly streamName: string;
  readonly durableName: string;
  readonly filterSubjects: readonly string[];
  readonly ackWaitNanos: number;
  readonly maxDeliver: number;
  readonly maxAckPending: number;
}

export interface SupportEventConsumerConfigInput {
  readonly streamName?: string;
  readonly durableName?: string;
  readonly filterSubjects?: readonly string[];
  readonly ackWaitNanos?: number;
  readonly maxDeliver?: number;
  readonly maxAckPending?: number;
}

export interface DomainEventHandlerContext {
  readonly consumerName: string;
  readonly streamName: string;
  readonly subject: string;
  readonly sequence: number;
  readonly redelivered: boolean;
}

export type DomainEventHandler = (
  event: DomainEventEnvelope,
  context: DomainEventHandlerContext,
) => Promise<void> | void;

export interface DomainEventConsumerIdempotencyKey {
  readonly consumerName: string;
  readonly tenantId: string;
  readonly eventId: string;
}

export interface DomainEventConsumerIdempotencyStartInput extends DomainEventConsumerIdempotencyKey {
  readonly eventName: DomainEventName;
  readonly correlationId: string;
  readonly subject: string;
}

export type DomainEventConsumerIdempotencyStartResult =
  | { readonly status: "started" }
  | { readonly status: "already_started" }
  | { readonly status: "already_completed" };

export interface DomainEventConsumerIdempotencyStore {
  start(
    input: DomainEventConsumerIdempotencyStartInput,
  ): Promise<DomainEventConsumerIdempotencyStartResult>;
  complete(input: DomainEventConsumerIdempotencyKey): Promise<void>;
  fail(input: DomainEventConsumerIdempotencyKey, error: unknown): Promise<void>;
}

export type InMemoryDomainEventConsumerStatus =
  | "started"
  | "completed"
  | "failed";

export interface InMemoryDomainEventConsumerRecord {
  readonly status: InMemoryDomainEventConsumerStatus;
  readonly starts: number;
  readonly failures: number;
}

export class InMemoryDomainEventConsumerIdempotencyStore implements DomainEventConsumerIdempotencyStore {
  private readonly records = new Map<
    string,
    InMemoryDomainEventConsumerRecord
  >();

  async start(
    input: DomainEventConsumerIdempotencyStartInput,
  ): Promise<DomainEventConsumerIdempotencyStartResult> {
    const key = buildIdempotencyRecordKey(input);
    const existing = this.records.get(key);

    if (existing?.status === "completed") {
      return { status: "already_completed" };
    }

    if (existing?.status === "started") {
      return { status: "already_started" };
    }

    this.records.set(key, {
      status: "started",
      starts: (existing?.starts ?? 0) + 1,
      failures: existing?.failures ?? 0,
    });

    return { status: "started" };
  }

  async complete(input: DomainEventConsumerIdempotencyKey): Promise<void> {
    const key = buildIdempotencyRecordKey(input);
    const existing = this.records.get(key);

    this.records.set(key, {
      status: "completed",
      starts: existing?.starts ?? 0,
      failures: existing?.failures ?? 0,
    });
  }

  async fail(
    input: DomainEventConsumerIdempotencyKey,
    _error: unknown,
  ): Promise<void> {
    const key = buildIdempotencyRecordKey(input);
    const existing = this.records.get(key);

    if (existing?.status === "completed") {
      return;
    }

    this.records.set(key, {
      status: "failed",
      starts: existing?.starts ?? 0,
      failures: (existing?.failures ?? 0) + 1,
    });
  }

  getRecord(
    input: DomainEventConsumerIdempotencyKey,
  ): InMemoryDomainEventConsumerRecord | null {
    return this.records.get(buildIdempotencyRecordKey(input)) ?? null;
  }
}

export interface JetStreamDomainEventMessage {
  readonly subject: string;
  readonly seq: number;
  readonly redelivered: boolean;
  json<T = unknown>(): T;
  ack(): void;
  nak(millis?: number): void;
  term(reason?: string): void;
}

export type DomainEventMessageProcessResult =
  | {
      readonly status: "processed";
      readonly event: DomainEventEnvelope;
      readonly duplicate: false;
    }
  | {
      readonly status: "duplicate";
      readonly event: DomainEventEnvelope;
      readonly duplicate: true;
    }
  | {
      readonly status: "in_progress";
      readonly event: DomainEventEnvelope;
    }
  | {
      readonly status: "invalid";
      readonly error: unknown;
    }
  | {
      readonly status: "failed";
      readonly event: DomainEventEnvelope;
      readonly error: unknown;
    };

export interface ProcessDomainEventMessageOptions {
  readonly consumerName: string;
  readonly streamName?: string;
  readonly idempotencyStore: DomainEventConsumerIdempotencyStore;
  readonly handler: DomainEventHandler;
  readonly nakDelayMs?: number;
}

export interface NatsJetStreamDomainEventConsumerOptions extends ProcessDomainEventMessageOptions {
  readonly nextExpiresMs?: number;
}

export interface JetStreamPullConsumer {
  next(
    options?: Partial<NextOptions>,
  ): Promise<JetStreamDomainEventMessage | null>;
}

export interface JetStreamConsumerClient {
  readonly consumers: {
    get(stream: string, name: string): Promise<JetStreamPullConsumer>;
  };
}

export function buildSupportEventConsumerConfig(
  input: SupportEventConsumerConfigInput = {},
): SupportEventConsumerConfig {
  return {
    streamName: input.streamName ?? SUPPORT_EVENTS_STREAM,
    durableName: input.durableName ?? DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
    filterSubjects: input.filterSubjects ?? [SUPPORT_EVENTS_SUBJECT],
    ackWaitNanos: input.ackWaitNanos ?? SUPPORT_EVENT_CONSUMER_ACK_WAIT_NANOS,
    maxDeliver: input.maxDeliver ?? SUPPORT_EVENT_CONSUMER_MAX_DELIVER,
    maxAckPending:
      input.maxAckPending ?? SUPPORT_EVENT_CONSUMER_MAX_ACK_PENDING,
  };
}

export function buildSupportEventConsumerCreateConfig(
  input: SupportEventConsumerConfigInput = {},
): Partial<ConsumerConfig> & { durable_name: string } {
  const config = buildSupportEventConsumerConfig(input);

  return {
    durable_name: config.durableName,
    name: config.durableName,
    description:
      "Durable pull consumer for tenant-scoped support domain events.",
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    replay_policy: ReplayPolicy.Instant,
    filter_subjects: [...config.filterSubjects],
    ack_wait: config.ackWaitNanos,
    max_deliver: config.maxDeliver,
    max_ack_pending: config.maxAckPending,
  };
}

export function buildSupportEventConsumerUpdateConfig(
  input: SupportEventConsumerConfigInput = {},
): Partial<ConsumerUpdateConfig> {
  const config = buildSupportEventConsumerConfig(input);

  return {
    description:
      "Durable pull consumer for tenant-scoped support domain events.",
    filter_subjects: [...config.filterSubjects],
    ack_wait: config.ackWaitNanos,
    max_deliver: config.maxDeliver,
    max_ack_pending: config.maxAckPending,
  };
}

export async function ensureSupportEventConsumer(
  manager: JetStreamManager,
  input: SupportEventConsumerConfigInput = {},
): Promise<ConsumerInfo> {
  const config = buildSupportEventConsumerConfig(input);

  try {
    await manager.consumers.info(config.streamName, config.durableName);
  } catch (error) {
    if (!isJetStreamNotFound(error)) {
      throw error;
    }

    return manager.consumers.add(
      config.streamName,
      buildSupportEventConsumerCreateConfig(config),
    );
  }

  return manager.consumers.update(
    config.streamName,
    config.durableName,
    buildSupportEventConsumerUpdateConfig(config),
  );
}

export async function processDomainEventMessage(
  message: JetStreamDomainEventMessage,
  options: ProcessDomainEventMessageOptions,
): Promise<DomainEventMessageProcessResult> {
  const streamName = options.streamName ?? SUPPORT_EVENTS_STREAM;
  const nakDelayMs = options.nakDelayMs ?? SUPPORT_EVENT_CONSUMER_NAK_DELAY_MS;
  const parsed = parseDomainEventMessage(message);

  if (!parsed.success) {
    message.term("invalid domain event envelope");
    return {
      status: "invalid",
      error: parsed.error,
    };
  }

  const event = parsed.event;
  const idempotencyKey = buildDomainEventConsumerIdempotencyKey(
    options.consumerName,
    event,
  );
  const startResult = await options.idempotencyStore.start({
    ...idempotencyKey,
    eventName: event.event_name,
    correlationId: event.correlation_id,
    subject: message.subject,
  });

  if (startResult.status === "already_completed") {
    message.ack();
    return {
      status: "duplicate",
      event,
      duplicate: true,
    };
  }

  if (startResult.status === "already_started") {
    message.nak(nakDelayMs);
    return {
      status: "in_progress",
      event,
    };
  }

  try {
    await options.handler(event, {
      consumerName: options.consumerName,
      streamName,
      subject: message.subject,
      sequence: message.seq,
      redelivered: message.redelivered,
    });
    await options.idempotencyStore.complete(idempotencyKey);
    message.ack();

    return {
      status: "processed",
      event,
      duplicate: false,
    };
  } catch (error) {
    await options.idempotencyStore.fail(idempotencyKey, error);
    message.nak(nakDelayMs);

    return {
      status: "failed",
      event,
      error,
    };
  }
}

export class NatsJetStreamDomainEventConsumer {
  private consumer: JetStreamPullConsumer | null = null;

  constructor(
    private readonly jetStream: JetStreamConsumerClient,
    private readonly options: NatsJetStreamDomainEventConsumerOptions,
  ) {}

  async processNext(): Promise<DomainEventMessageProcessResult | null> {
    const consumer = await this.getConsumer();
    const message = await consumer.next({
      expires:
        this.options.nextExpiresMs ?? SUPPORT_EVENT_CONSUMER_NEXT_EXPIRES_MS,
    });

    if (!message) {
      return null;
    }

    return processDomainEventMessage(message, this.options);
  }

  private async getConsumer(): Promise<JetStreamPullConsumer> {
    if (this.consumer) {
      return this.consumer;
    }

    this.consumer = await this.jetStream.consumers.get(
      this.options.streamName ?? SUPPORT_EVENTS_STREAM,
      this.options.consumerName,
    );

    return this.consumer;
  }
}

export function createNatsJetStreamDomainEventConsumer(
  jetStream: JetStreamClient,
  options: NatsJetStreamDomainEventConsumerOptions,
): NatsJetStreamDomainEventConsumer {
  return new NatsJetStreamDomainEventConsumer(jetStream, options);
}

function parseDomainEventMessage(
  message: JetStreamDomainEventMessage,
):
  | { readonly success: true; readonly event: DomainEventEnvelope }
  | { readonly success: false; readonly error: unknown } {
  let payload: unknown;

  try {
    payload = message.json<unknown>();
  } catch (error) {
    return {
      success: false,
      error,
    };
  }

  const parsed = DomainEventEnvelopeSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error,
    };
  }

  const expectedSubject = buildDomainEventSubject(parsed.data);

  if (message.subject !== expectedSubject) {
    return {
      success: false,
      error: new Error(
        `Domain event subject mismatch: expected ${expectedSubject}, received ${message.subject}`,
      ),
    };
  }

  return {
    success: true,
    event: parsed.data,
  };
}

function buildDomainEventConsumerIdempotencyKey(
  consumerName: string,
  event: DomainEventEnvelope,
): DomainEventConsumerIdempotencyKey {
  return {
    consumerName,
    tenantId: event.tenant_id,
    eventId: event.event_id,
  };
}

function buildIdempotencyRecordKey(
  input: DomainEventConsumerIdempotencyKey,
): string {
  return `${input.consumerName}:${input.tenantId}:${input.eventId}`;
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
