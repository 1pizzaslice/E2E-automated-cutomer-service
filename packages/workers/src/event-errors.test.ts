import { TextDecoder } from "node:util";

import { describe, expect, it } from "vitest";
import type { SupportEventErrorRecord } from "@support/shared-schemas";
import {
  NatsJetStreamSupportEventErrorPublisher,
  buildSupportEventErrorSubject,
} from "./event-errors.js";
import type {
  JetStreamPublishClient,
  JetStreamPublishOptions,
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
      stream: "SUPPORT_EVENT_ERRORS",
      seq: 12,
      duplicate: false,
    };
  }
}

describe("NatsJetStreamSupportEventErrorPublisher", () => {
  it("publishes valid error records to tenant-aware error subjects", async () => {
    const jetStream = new FakeJetStreamPublishClient();
    const publisher = new NatsJetStreamSupportEventErrorPublisher(jetStream);
    const record = makeErrorRecord();

    const receipt = await publisher.publish(record);

    expect(receipt).toEqual({
      error_id: "event_error_test",
      subject: "support.events.errors.tenant.ten_test.ticket.created.v1",
      stream: "SUPPORT_EVENT_ERRORS",
      sequence: 12,
      duplicate: false,
    });
    expect(jetStream.calls).toHaveLength(1);
    expect(jetStream.calls[0]?.options).toEqual({
      msgID: "event_error_test",
    });
    expect(
      JSON.parse(new TextDecoder().decode(jetStream.calls[0]?.payload)),
    ).toEqual(record);
  });

  it("routes invalid-envelope records to non-tenant error subjects", () => {
    expect(
      buildSupportEventErrorSubject({
        ...makeErrorRecord(),
        error_kind: "invalid_envelope",
        event_id: null,
        event_name: null,
        tenant_id: null,
        correlation_id: null,
        causation_id: null,
      }),
    ).toBe("support.events.errors.invalid_envelope.v1");
  });

  it("rejects invalid error records before publishing", async () => {
    const jetStream = new FakeJetStreamPublishClient();
    const publisher = new NatsJetStreamSupportEventErrorPublisher(jetStream);

    await expect(
      publisher.publish({
        ...makeErrorRecord(),
        tenant_id: "tenant.with.dot",
      } as SupportEventErrorRecord),
    ).rejects.toThrow();

    expect(jetStream.calls).toEqual([]);
  });
});

function makeErrorRecord(): SupportEventErrorRecord {
  return {
    error_id: "event_error_test",
    error_kind: "handler_failed",
    consumer_name: "ticket_projection",
    stream_name: "SUPPORT_EVENTS",
    original_subject: "support.events.tenant.ten_test.ticket.created.v1",
    original_sequence: 7,
    event_id: "evt_test",
    event_name: "support.ticket.created.v1",
    tenant_id: "ten_test",
    correlation_id: "corr_test",
    causation_id: "req_test",
    occurred_at: "2026-06-25T00:00:00.000Z",
    redelivered: true,
    delivery_count: 5,
    will_retry: false,
    error_name: "Error",
    error_message: "handler failed",
  };
}
