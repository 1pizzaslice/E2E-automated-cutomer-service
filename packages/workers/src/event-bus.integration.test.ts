import { DeliverPolicy } from "@nats-io/jetstream";
import {
  buildDomainEventSubject,
  type DomainEventEnvelope,
} from "@support/shared-schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SUPPORT_EVENTS_STREAM,
  connectNatsEventBus,
  type NatsEventBusRuntime,
} from "./event-bus.js";

const describeLive =
  process.env.RUN_WORKER_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

const fixturePrefix = `worker_it_${process.pid}_${Date.now()}`;

describeLive("live NATS JetStream event bus", () => {
  let runtime: NatsEventBusRuntime | undefined;

  beforeAll(async () => {
    runtime = await connectNatsEventBus();
    await runtime.ensureStream();
  });

  afterAll(async () => {
    if (!runtime) {
      return;
    }

    await runtime.close();
  });

  it("publishes, consumes, and deduplicates tenant-scoped domain events", async () => {
    if (!runtime) {
      throw new Error("NATS event bus runtime was not initialized");
    }

    const event = makeEvent();
    const subject = buildDomainEventSubject(event);
    const consumer = await runtime.jetStream.consumers.get(
      SUPPORT_EVENTS_STREAM,
      {
        deliver_policy: DeliverPolicy.All,
        filter_subjects: [subject],
      },
    );

    try {
      const receipt = await runtime.publisher.publish(event);
      const message = await consumer.next({ expires: 1_000 });
      const duplicateReceipt = await runtime.publisher.publish(event);

      expect(receipt).toEqual({
        event_id: event.event_id,
        subject,
        stream: SUPPORT_EVENTS_STREAM,
        sequence: expect.any(Number),
        duplicate: false,
      });
      expect(message).not.toBeNull();
      expect(message?.subject).toBe(subject);
      expect(message?.json()).toEqual(event);
      message?.ack();
      expect(duplicateReceipt).toEqual({
        event_id: event.event_id,
        subject,
        stream: SUPPORT_EVENTS_STREAM,
        sequence: receipt.sequence,
        duplicate: true,
      });
    } finally {
      await consumer.delete();
      await runtime.jetStreamManager.streams.purge(SUPPORT_EVENTS_STREAM, {
        filter: subject,
      });
    }
  });
});

function makeEvent(): DomainEventEnvelope {
  return {
    event_id: `${fixturePrefix}_evt_ticket_created`,
    event_name: "support.ticket.created.v1",
    schema_version: "1",
    tenant_id: `${fixturePrefix}_ten`,
    correlation_id: `${fixturePrefix}_corr`,
    causation_id: `${fixturePrefix}_req`,
    occurred_at: "2026-06-25T00:00:00.000Z",
    actor: {
      type: "system",
      id: "workflow",
    },
    payload: {
      ticket_id: `${fixturePrefix}_tic`,
      status: "new",
    },
  };
}
