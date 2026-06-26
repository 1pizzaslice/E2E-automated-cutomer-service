import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  type ConsumerInfo,
  type JetStreamManager,
} from "@nats-io/jetstream";
import {
  buildDomainEventSubject,
  type DomainEventEnvelope,
} from "@support/shared-schemas";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
  InMemoryDomainEventConsumerIdempotencyStore,
  NatsJetStreamDomainEventConsumer,
  SUPPORT_EVENT_CONSUMER_ACK_WAIT_NANOS,
  SUPPORT_EVENT_CONSUMER_MAX_ACK_PENDING,
  SUPPORT_EVENT_CONSUMER_MAX_DELIVER,
  SUPPORT_EVENT_CONSUMER_NAK_DELAY_MS,
  buildSupportEventConsumerCreateConfig,
  ensureSupportEventConsumer,
  processDomainEventMessage,
  type JetStreamConsumerClient,
  type JetStreamDomainEventMessage,
  type JetStreamPullConsumer,
} from "./event-consumer.js";
import { SUPPORT_EVENTS_STREAM, SUPPORT_EVENTS_SUBJECT } from "./event-bus.js";

describe("support event consumer config", () => {
  it("builds durable pull consumer create config", () => {
    expect(buildSupportEventConsumerCreateConfig()).toMatchObject({
      durable_name: DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
      name: DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      filter_subjects: [SUPPORT_EVENTS_SUBJECT],
      ack_wait: SUPPORT_EVENT_CONSUMER_ACK_WAIT_NANOS,
      max_deliver: SUPPORT_EVENT_CONSUMER_MAX_DELIVER,
      max_ack_pending: SUPPORT_EVENT_CONSUMER_MAX_ACK_PENDING,
    });
  });

  it("creates the durable consumer when it is missing", async () => {
    const consumerInfo = makeConsumerInfo();
    const manager = makeManager({
      info: vi.fn().mockRejectedValue({ code: "404" }),
      add: vi.fn().mockResolvedValue(consumerInfo),
      update: vi.fn(),
    });

    await expect(ensureSupportEventConsumer(manager)).resolves.toBe(
      consumerInfo,
    );

    expect(manager.consumers.add).toHaveBeenCalledWith(
      SUPPORT_EVENTS_STREAM,
      expect.objectContaining({
        durable_name: DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
        filter_subjects: [SUPPORT_EVENTS_SUBJECT],
      }),
    );
    expect(manager.consumers.update).not.toHaveBeenCalled();
  });

  it("updates the durable consumer when it already exists", async () => {
    const consumerInfo = makeConsumerInfo();
    const manager = makeManager({
      info: vi.fn().mockResolvedValue(consumerInfo),
      add: vi.fn(),
      update: vi.fn().mockResolvedValue(consumerInfo),
    });

    await expect(ensureSupportEventConsumer(manager)).resolves.toBe(
      consumerInfo,
    );

    expect(manager.consumers.add).not.toHaveBeenCalled();
    expect(manager.consumers.update).toHaveBeenCalledWith(
      SUPPORT_EVENTS_STREAM,
      DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
      expect.objectContaining({
        filter_subjects: [SUPPORT_EVENTS_SUBJECT],
        max_deliver: SUPPORT_EVENT_CONSUMER_MAX_DELIVER,
      }),
    );
  });
});

describe("processDomainEventMessage", () => {
  it("validates, handles, records completion, and acks valid domain events", async () => {
    const event = makeEvent();
    const message = new FakeJetStreamDomainEventMessage(event);
    const store = new InMemoryDomainEventConsumerIdempotencyStore();
    const handler = vi.fn();

    const result = await processDomainEventMessage(message, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler,
    });

    expect(result).toMatchObject({
      status: "processed",
      event,
      duplicate: false,
    });
    expect(handler).toHaveBeenCalledWith(event, {
      consumerName: "ticket_projection",
      streamName: SUPPORT_EVENTS_STREAM,
      subject: buildDomainEventSubject(event),
      sequence: 7,
      redelivered: false,
    });
    expect(message.acks).toBe(1);
    expect(message.naks).toEqual([]);
    expect(message.terms).toEqual([]);
    expect(
      store.getRecord({
        consumerName: "ticket_projection",
        tenantId: event.tenant_id,
        eventId: event.event_id,
      }),
    ).toEqual({
      status: "completed",
      starts: 1,
      failures: 0,
    });
  });

  it("acks completed duplicate events without rerunning the handler", async () => {
    const event = makeEvent();
    const store = new InMemoryDomainEventConsumerIdempotencyStore();
    const handler = vi.fn();

    await processDomainEventMessage(
      new FakeJetStreamDomainEventMessage(event),
      {
        consumerName: "ticket_projection",
        idempotencyStore: store,
        handler,
      },
    );

    const duplicateMessage = new FakeJetStreamDomainEventMessage(event);
    const result = await processDomainEventMessage(duplicateMessage, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler,
    });

    expect(result).toMatchObject({
      status: "duplicate",
      event,
      duplicate: true,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(duplicateMessage.acks).toBe(1);
    expect(duplicateMessage.naks).toEqual([]);
  });

  it("naks in-progress duplicates instead of running concurrent work", async () => {
    const event = makeEvent();
    const store = new InMemoryDomainEventConsumerIdempotencyStore();
    const handler = vi.fn();

    await store.start({
      consumerName: "ticket_projection",
      tenantId: event.tenant_id,
      eventId: event.event_id,
      eventName: event.event_name,
      correlationId: event.correlation_id,
      subject: buildDomainEventSubject(event),
    });

    const message = new FakeJetStreamDomainEventMessage(event);
    const result = await processDomainEventMessage(message, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler,
      nakDelayMs: 123,
    });

    expect(result).toMatchObject({
      status: "in_progress",
      event,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(message.acks).toBe(0);
    expect(message.naks).toEqual([123]);
  });

  it("marks failed handling and allows a later retry", async () => {
    const event = makeEvent();
    const store = new InMemoryDomainEventConsumerIdempotencyStore();
    const error = new Error("handler failed");
    const failingHandler = vi.fn().mockRejectedValue(error);

    const failedMessage = new FakeJetStreamDomainEventMessage(event);
    const failedResult = await processDomainEventMessage(failedMessage, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler: failingHandler,
    });

    expect(failedResult).toMatchObject({
      status: "failed",
      event,
      error,
    });
    expect(failedMessage.acks).toBe(0);
    expect(failedMessage.naks).toEqual([SUPPORT_EVENT_CONSUMER_NAK_DELAY_MS]);
    expect(
      store.getRecord({
        consumerName: "ticket_projection",
        tenantId: event.tenant_id,
        eventId: event.event_id,
      }),
    ).toEqual({
      status: "failed",
      starts: 1,
      failures: 1,
    });

    const retryHandler = vi.fn();
    const retryMessage = new FakeJetStreamDomainEventMessage(event);
    const retryResult = await processDomainEventMessage(retryMessage, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler: retryHandler,
    });

    expect(retryResult).toMatchObject({
      status: "processed",
      event,
      duplicate: false,
    });
    expect(retryHandler).toHaveBeenCalledTimes(1);
    expect(retryMessage.acks).toBe(1);
    expect(
      store.getRecord({
        consumerName: "ticket_projection",
        tenantId: event.tenant_id,
        eventId: event.event_id,
      }),
    ).toEqual({
      status: "completed",
      starts: 2,
      failures: 1,
    });
  });

  it("terms invalid payloads before idempotency or handler work", async () => {
    const message = new FakeJetStreamDomainEventMessage({
      ...makeEvent(),
      schema_version: "2",
    });
    const store = new InMemoryDomainEventConsumerIdempotencyStore();
    const handler = vi.fn();

    const result = await processDomainEventMessage(message, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler,
    });

    expect(result.status).toBe("invalid");
    expect(handler).not.toHaveBeenCalled();
    expect(message.acks).toBe(0);
    expect(message.naks).toEqual([]);
    expect(message.terms).toEqual(["invalid domain event envelope"]);
  });

  it("terms events whose payload subject does not match the NATS subject", async () => {
    const event = makeEvent();
    const message = new FakeJetStreamDomainEventMessage(
      event,
      "support.events.tenant.ten_test.ticket.triaged.v1",
    );
    const store = new InMemoryDomainEventConsumerIdempotencyStore();
    const handler = vi.fn();

    const result = await processDomainEventMessage(message, {
      consumerName: "ticket_projection",
      idempotencyStore: store,
      handler,
    });

    expect(result.status).toBe("invalid");
    expect(handler).not.toHaveBeenCalled();
    expect(message.terms).toEqual(["invalid domain event envelope"]);
  });
});

describe("NatsJetStreamDomainEventConsumer", () => {
  it("pulls one message from a durable consumer and processes it", async () => {
    const event = makeEvent();
    const message = new FakeJetStreamDomainEventMessage(event);
    const pullConsumer: JetStreamPullConsumer = {
      next: vi.fn().mockResolvedValue(message),
    };
    const jetStream: JetStreamConsumerClient = {
      consumers: {
        get: vi.fn().mockResolvedValue(pullConsumer),
      },
    };
    const handler = vi.fn();
    const consumer = new NatsJetStreamDomainEventConsumer(jetStream, {
      consumerName: "ticket_projection",
      idempotencyStore: new InMemoryDomainEventConsumerIdempotencyStore(),
      handler,
      nextExpiresMs: 25,
    });

    await expect(consumer.processNext()).resolves.toMatchObject({
      status: "processed",
      event,
    });

    expect(jetStream.consumers.get).toHaveBeenCalledWith(
      SUPPORT_EVENTS_STREAM,
      "ticket_projection",
    );
    expect(pullConsumer.next).toHaveBeenCalledWith({ expires: 25 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(message.acks).toBe(1);
  });
});

class FakeJetStreamDomainEventMessage implements JetStreamDomainEventMessage {
  readonly seq = 7;
  readonly redelivered = false;
  acks = 0;
  readonly naks: number[] = [];
  readonly terms: string[] = [];

  constructor(
    private readonly payload: unknown,
    readonly subject = buildDomainEventSubject(payload as DomainEventEnvelope),
  ) {}

  json<T = unknown>(): T {
    return this.payload as T;
  }

  ack(): void {
    this.acks += 1;
  }

  nak(millis?: number): void {
    this.naks.push(millis ?? 0);
  }

  term(reason?: string): void {
    this.terms.push(reason ?? "");
  }
}

function makeManager(consumers: {
  readonly info: ReturnType<typeof vi.fn>;
  readonly add: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
}): JetStreamManager {
  return {
    consumers,
  } as unknown as JetStreamManager;
}

function makeConsumerInfo(): ConsumerInfo {
  return {
    stream_name: SUPPORT_EVENTS_STREAM,
    name: DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
    config: {
      durable_name: DEFAULT_SUPPORT_EVENT_CONSUMER_DURABLE,
    },
  } as ConsumerInfo;
}

function makeEvent(): DomainEventEnvelope {
  return {
    event_id: "evt_test",
    event_name: "support.ticket.created.v1",
    schema_version: "1",
    tenant_id: "ten_test",
    correlation_id: "corr_test",
    causation_id: "req_test",
    occurred_at: "2026-06-25T00:00:00.000Z",
    actor: {
      type: "system",
      id: "workflow",
    },
    payload: {
      ticket_id: "ticket_test",
      status: "new",
    },
  };
}
