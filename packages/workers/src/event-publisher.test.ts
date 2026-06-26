import { TextDecoder } from "node:util";

import { describe, expect, it } from "vitest";
import type { DomainEventEnvelope } from "@support/shared-schemas";
import {
  NatsJetStreamDomainEventPublisher,
  type JetStreamPublishClient,
  type JetStreamPublishOptions,
} from "./event-publisher.js";

interface PublishCall {
  readonly subject: string;
  readonly payload: Uint8Array;
  readonly options?: JetStreamPublishOptions;
}

class FakeJetStreamPublishClient implements JetStreamPublishClient {
  readonly calls: PublishCall[] = [];

  async publish(
    subject: string,
    payload: Uint8Array,
    options?: JetStreamPublishOptions,
  ): Promise<{ stream: string; seq: number; duplicate: boolean }> {
    this.calls.push({ subject, payload, options });

    return {
      stream: "SUPPORT_EVENTS",
      seq: 42,
      duplicate: false,
    };
  }
}

describe("NatsJetStreamDomainEventPublisher", () => {
  it("validates and publishes domain events to tenant-aware subjects", async () => {
    const jetStream = new FakeJetStreamPublishClient();
    const publisher = new NatsJetStreamDomainEventPublisher(jetStream);
    const event = makeEvent();

    const receipt = await publisher.publish(event);

    expect(receipt).toEqual({
      event_id: "evt_test",
      subject: "support.events.tenant.ten_test.ticket.created.v1",
      stream: "SUPPORT_EVENTS",
      sequence: 42,
      duplicate: false,
    });
    expect(jetStream.calls).toHaveLength(1);

    const call = jetStream.calls[0]!;
    expect(call.subject).toBe(
      "support.events.tenant.ten_test.ticket.created.v1",
    );
    expect(call.options).toEqual({ msgID: "evt_test" });
    expect(JSON.parse(new TextDecoder().decode(call.payload))).toEqual(event);
  });

  it("rejects invalid event envelopes before publishing", async () => {
    const jetStream = new FakeJetStreamPublishClient();
    const publisher = new NatsJetStreamDomainEventPublisher(jetStream);

    await expect(
      publisher.publish({
        ...makeEvent(),
        schema_version: "2",
      } as unknown as DomainEventEnvelope),
    ).rejects.toThrow();

    expect(jetStream.calls).toEqual([]);
  });
});

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
      conversation_id: "cnv_test",
      customer_id: "cus_test",
      status: "new",
      priority: "p2",
      automation_mode: "human_approve",
      assigned_queue: null,
      assigned_user_id: null,
      opened_at: "2026-06-25T00:00:00.000Z",
    },
  };
}
