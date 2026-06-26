import {
  buildDomainEventSubject,
  type DomainEventEnvelope,
} from "@support/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  buildMessageReceivedEvent,
  buildTicketCreatedEvent,
  buildTicketSlaBreachedEvent,
  buildTicketStateTransitionEvent,
  emitMessageReceivedEvent,
  emitTicketCreatedEvent,
  emitTicketSlaBreachedEvent,
  emitTicketStateTransitionEvent,
  type DomainEventEmissionMetadata,
} from "./domain-events.js";
import type {
  DomainEventPublishReceipt,
  DomainEventPublisher,
} from "./event-publisher.js";

describe("domain event emit helpers", () => {
  it("builds message received events with schema-validated payloads", () => {
    const event = buildMessageReceivedEvent({
      ...makeMetadata("evt_message_received"),
      payload: {
        message_id: "msg_test",
        conversation_id: "cnv_test",
        ticket_id: "ticket_test",
        channel_id: "chn_email",
        direction: "inbound",
        external_message_id: "external_msg_test",
        external_thread_id: "thread_test",
        idempotency_key: "idem_msg_test",
        received_at: "2026-06-25T00:00:00.000Z",
      },
    });

    expect(event).toMatchObject({
      event_name: "support.message.received.v1",
      schema_version: "1",
      payload: {
        message_id: "msg_test",
        direction: "inbound",
      },
    });
    expect(buildDomainEventSubject(event)).toBe(
      "support.events.tenant.ten_test.message.received.v1",
    );
  });

  it("builds and emits ticket created events", async () => {
    const publisher = new FakeDomainEventPublisher();
    const input = {
      ...makeMetadata("evt_ticket_created"),
      payload: makeTicketCreatedPayload(),
    };

    expect(buildTicketCreatedEvent(input)).toMatchObject({
      event_name: "support.ticket.created.v1",
      payload: {
        ticket_id: "ticket_test",
        status: "new",
      },
    });

    await expect(emitTicketCreatedEvent(publisher, input)).resolves.toEqual({
      event_id: "evt_ticket_created",
      subject: "support.events.tenant.ten_test.ticket.created.v1",
      stream: null,
      sequence: null,
      duplicate: false,
    });
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.event_name).toBe("support.ticket.created.v1");
  });

  it("builds and emits ticket state transition events", async () => {
    const publisher = new FakeDomainEventPublisher();
    const input = {
      ...makeMetadata("evt_ticket_triaged"),
      event_name: "support.ticket.triaged.v1" as const,
      payload: {
        ticket_id: "ticket_test",
        from_status: "new" as const,
        to_status: "triaged" as const,
        reason_code: "ai_triage_completed",
        metadata: {
          classifier: "baseline",
        },
      },
    };

    const event = buildTicketStateTransitionEvent(input);

    expect(event).toMatchObject({
      event_name: "support.ticket.triaged.v1",
      payload: {
        from_status: "new",
        to_status: "triaged",
      },
    });

    await emitTicketStateTransitionEvent(publisher, input);
    expect(publisher.events[0]).toEqual(event);
  });

  it("builds and emits ticket SLA breach events", async () => {
    const publisher = new FakeDomainEventPublisher();
    const input = {
      ...makeMetadata("evt_ticket_sla_breached"),
      payload: {
        ticket_id: "ticket_test",
        breached_deadline: "first_response" as const,
        due_at: "2026-06-25T00:15:00.000Z",
        metadata: {
          source: "temporal_timer",
        },
      },
    };

    const event = buildTicketSlaBreachedEvent(input);

    expect(event).toMatchObject({
      event_name: "support.ticket.sla_breached.v1",
      payload: {
        ticket_id: "ticket_test",
        breached_deadline: "first_response",
      },
    });
    expect(buildDomainEventSubject(event)).toBe(
      "support.events.tenant.ten_test.ticket.sla_breached.v1",
    );

    await emitTicketSlaBreachedEvent(publisher, input);
    expect(publisher.events[0]).toEqual(event);
  });

  it("rejects invalid ticket transition event names before publishing", async () => {
    const publisher = new FakeDomainEventPublisher();

    await expect(
      emitTicketStateTransitionEvent(publisher, {
        ...makeMetadata("evt_invalid"),
        event_name: "support.ticket.priority_changed.v1" as never,
        payload: {
          ticket_id: "ticket_test",
          from_status: "new",
          to_status: "triaged",
          reason_code: null,
          metadata: {},
        },
      }),
    ).rejects.toThrow();
    expect(publisher.events).toEqual([]);
  });
});

class FakeDomainEventPublisher implements DomainEventPublisher {
  readonly events: DomainEventEnvelope[] = [];

  async publish(
    event: DomainEventEnvelope,
  ): Promise<DomainEventPublishReceipt> {
    this.events.push(event);

    return {
      event_id: event.event_id,
      subject: buildDomainEventSubject(event),
      stream: null,
      sequence: null,
      duplicate: false,
    };
  }
}

function makeMetadata(eventId: string): DomainEventEmissionMetadata {
  return {
    event_id: eventId,
    tenant_id: "ten_test",
    correlation_id: "corr_test",
    causation_id: "req_test",
    occurred_at: "2026-06-25T00:00:00.000Z",
    actor: {
      type: "system",
      id: "workflow",
    },
  };
}

function makeTicketCreatedPayload() {
  return {
    ticket_id: "ticket_test",
    conversation_id: "cnv_test",
    customer_id: "cus_test",
    status: "new" as const,
    priority: "p2" as const,
    automation_mode: "human_approve" as const,
    assigned_queue: null,
    assigned_user_id: null,
    opened_at: "2026-06-25T00:00:00.000Z",
  };
}
