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
  DomainEventNameSchema,
  DomainEventEnvelopeSchema,
  DomainEventSubjectTenantIdSchema,
  buildDomainEventSubject,
  type DomainEventEnvelope,
  type DomainEventName,
  type SupportEventErrorKind,
  type SupportEventErrorRecord,
} from "@support/shared-schemas";
import type { SupportMetrics } from "@support/observability";
import { SUPPORT_EVENTS_STREAM, SUPPORT_EVENTS_SUBJECT } from "./event-bus.js";
import type { SupportEventErrorPublisher } from "./event-errors.js";

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
  readonly deliveryCount?: number;
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
      readonly errorRecord?: SupportEventErrorRecord;
    }
  | {
      readonly status: "failed";
      readonly event: DomainEventEnvelope;
      readonly error: unknown;
      readonly errorRecord?: SupportEventErrorRecord;
      readonly deadLettered: boolean;
    };

export interface ProcessDomainEventMessageOptions {
  readonly consumerName: string;
  readonly streamName?: string;
  readonly idempotencyStore: DomainEventConsumerIdempotencyStore;
  readonly handler: DomainEventHandler;
  readonly errorPublisher?: SupportEventErrorPublisher;
  /**
   * Domain metrics recorder; when provided, terminally dropped messages
   * (poison envelopes, handler failure at max deliveries) record an
   * `event_dead_letter` critical failure.
   */
  readonly metrics?: SupportMetrics;
  readonly nakDelayMs?: number;
  readonly maxDeliver?: number;
  readonly now?: () => Date;
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
  const maxDeliver = options.maxDeliver ?? SUPPORT_EVENT_CONSUMER_MAX_DELIVER;
  const parsed = parseDomainEventMessage(message);

  if (!parsed.success) {
    const errorRecord = await publishSupportEventError({
      message,
      options,
      streamName,
      kind: "invalid_envelope",
      event: null,
      payload: parsed.payload,
      error: parsed.error,
      deliveryCount: getMessageDeliveryCount(message),
      willRetry: false,
    });

    message.term("invalid domain event envelope");
    options.metrics?.recordCriticalFailure("event_dead_letter");
    return {
      status: "invalid",
      error: parsed.error,
      ...(errorRecord ? { errorRecord } : {}),
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
    const deliveryCount = getMessageDeliveryCount(message);
    const deadLettered = deliveryCount !== null && deliveryCount >= maxDeliver;
    const errorRecord = await publishSupportEventError({
      message,
      options,
      streamName,
      kind: "handler_failed",
      event,
      payload: event,
      error,
      deliveryCount,
      willRetry: !deadLettered,
    });

    if (deadLettered) {
      message.term("domain event handler failed after max deliveries");
      options.metrics?.recordCriticalFailure("event_dead_letter");
    } else {
      message.nak(nakDelayMs);
    }

    return {
      status: "failed",
      event,
      error,
      ...(errorRecord ? { errorRecord } : {}),
      deadLettered,
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

function parseDomainEventMessage(message: JetStreamDomainEventMessage):
  | { readonly success: true; readonly event: DomainEventEnvelope }
  | {
      readonly success: false;
      readonly error: unknown;
      readonly payload?: unknown;
    } {
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
      payload,
    };
  }

  const expectedSubject = buildDomainEventSubject(parsed.data);

  if (message.subject !== expectedSubject) {
    return {
      success: false,
      error: new Error(
        `Domain event subject mismatch: expected ${expectedSubject}, received ${message.subject}`,
      ),
      payload,
    };
  }

  return {
    success: true,
    event: parsed.data,
  };
}

interface PublishSupportEventErrorInput {
  readonly message: JetStreamDomainEventMessage;
  readonly options: ProcessDomainEventMessageOptions;
  readonly streamName: string;
  readonly kind: SupportEventErrorKind;
  readonly event: DomainEventEnvelope | null;
  readonly payload: unknown;
  readonly error: unknown;
  readonly deliveryCount: number | null;
  readonly willRetry: boolean;
}

async function publishSupportEventError(
  input: PublishSupportEventErrorInput,
): Promise<SupportEventErrorRecord | undefined> {
  if (!input.options.errorPublisher) {
    return undefined;
  }

  const fields = extractDomainEventErrorFields(input.event, input.payload);
  const errorRecord: SupportEventErrorRecord = {
    error_id: buildSupportEventErrorId(input, fields.eventId),
    error_kind: input.kind,
    consumer_name: input.options.consumerName,
    stream_name: input.streamName,
    original_subject: input.message.subject,
    original_sequence: input.message.seq,
    event_id: fields.eventId,
    event_name: fields.eventName,
    tenant_id: fields.tenantId,
    correlation_id: fields.correlationId,
    causation_id: fields.causationId,
    occurred_at: (input.options.now ?? (() => new Date()))().toISOString(),
    redelivered: input.message.redelivered,
    delivery_count: input.deliveryCount,
    will_retry: input.willRetry,
    error_name: getErrorName(input.error),
    error_message: getErrorMessage(input.error),
  };

  await input.options.errorPublisher.publish(errorRecord);

  return errorRecord;
}

interface ExtractedDomainEventErrorFields {
  readonly eventId: string | null;
  readonly eventName: DomainEventName | null;
  readonly tenantId: string | null;
  readonly correlationId: string | null;
  readonly causationId: string | null;
}

function extractDomainEventErrorFields(
  event: DomainEventEnvelope | null,
  payload: unknown,
): ExtractedDomainEventErrorFields {
  if (event) {
    return {
      eventId: event.event_id,
      eventName: event.event_name,
      tenantId: event.tenant_id,
      correlationId: event.correlation_id,
      causationId: event.causation_id,
    };
  }

  if (!isRecord(payload)) {
    return emptyDomainEventErrorFields();
  }

  return {
    eventId: getNonEmptyString(payload.event_id),
    eventName: parseDomainEventName(payload.event_name),
    tenantId: parseDomainEventTenantId(payload.tenant_id),
    correlationId: getNonEmptyString(payload.correlation_id),
    causationId: getNonEmptyString(payload.causation_id),
  };
}

function emptyDomainEventErrorFields(): ExtractedDomainEventErrorFields {
  return {
    eventId: null,
    eventName: null,
    tenantId: null,
    correlationId: null,
    causationId: null,
  };
}

function buildSupportEventErrorId(
  input: PublishSupportEventErrorInput,
  eventId: string | null,
): string {
  return [
    "event_error",
    sanitizeErrorIdToken(input.options.consumerName),
    sanitizeErrorIdToken(input.streamName),
    input.message.seq.toString(),
    input.kind,
    (input.deliveryCount ?? "unknown").toString(),
    sanitizeErrorIdToken(eventId ?? "unknown_event"),
  ].join(":");
}

function sanitizeErrorIdToken(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, "_");

  return sanitized.length > 0 ? sanitized : "unknown";
}

function getMessageDeliveryCount(
  message: JetStreamDomainEventMessage,
): number | null {
  if (Number.isInteger(message.deliveryCount) && message.deliveryCount! > 0) {
    return message.deliveryCount!;
  }

  const candidate = message as {
    readonly info?: {
      readonly deliveryCount?: number;
      readonly redeliveryCount?: number;
    };
  };

  if (
    Number.isInteger(candidate.info?.deliveryCount) &&
    candidate.info!.deliveryCount! > 0
  ) {
    return candidate.info!.deliveryCount!;
  }

  if (
    Number.isInteger(candidate.info?.redeliveryCount) &&
    candidate.info!.redeliveryCount! >= 0
  ) {
    return candidate.info!.redeliveryCount! + 1;
  }

  return null;
}

function parseDomainEventName(value: unknown): DomainEventName | null {
  const parsed = DomainEventNameSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function parseDomainEventTenantId(value: unknown): string | null {
  const parsed = DomainEventSubjectTenantIdSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getErrorName(error: unknown): string | null {
  return error instanceof Error && error.name.length > 0 ? error.name : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  const message = String(error);

  return message.length > 0 ? message : "Unknown event processing error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
