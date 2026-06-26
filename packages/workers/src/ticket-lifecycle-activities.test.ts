import {
  buildDomainEventSubject,
  type DomainEventEnvelope,
} from "@support/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  createTicketLifecycleActivities,
  type TicketLifecycleActivities,
} from "./activities/ticket-lifecycle-activities.js";
import type {
  DomainEventPublishReceipt,
  DomainEventPublisher,
} from "./event-publisher.js";

describe("ticket lifecycle activities", () => {
  it("emits ticket lifecycle domain events through the shared emit helpers", async () => {
    const publisher = new FakeDomainEventPublisher();
    const activities = createTicketLifecycleActivities({
      domainEventPublisher: publisher,
      now: () => new Date("2026-06-26T00:00:00.000Z"),
      implementations: makeActivityImplementations(),
    });

    await activities.emitDomainEvent({
      event_type: "ticket_created",
      event_id: "evt_ticket_created",
      tenant_id: "ten_test",
      correlation_id: "corr_test",
      causation_id: "msg_initial",
      actor: {
        type: "system",
        id: "workflow",
      },
      ticket: makeTicketSnapshot(),
    });
    await activities.emitDomainEvent({
      event_type: "ticket_state_transition",
      event_id: "evt_ticket_triaged",
      tenant_id: "ten_test",
      correlation_id: "corr_test",
      causation_id: "msg_initial",
      actor: {
        type: "system",
        id: "workflow",
      },
      event_name: "support.ticket.triaged.v1",
      ticket_id: "ticket_test",
      from_status: "new",
      to_status: "triaged",
      reason_code: "ai_triage_completed",
      metadata: {
        classifier: "baseline",
      },
    });
    await activities.emitDomainEvent({
      event_type: "ticket_sla_breached",
      event_id: "evt_ticket_sla_breached",
      tenant_id: "ten_test",
      correlation_id: "corr_test",
      causation_id: "msg_initial",
      actor: {
        type: "system",
        id: "workflow",
      },
      ticket_id: "ticket_test",
      breached_deadline: "first_response",
      due_at: "2026-06-26T00:15:00.000Z",
      metadata: {
        source: "temporal_timer",
      },
    });

    expect(publisher.events).toHaveLength(3);
    expect(publisher.events).toEqual([
      expect.objectContaining({
        event_id: "evt_ticket_created",
        event_name: "support.ticket.created.v1",
        occurred_at: "2026-06-26T00:00:00.000Z",
        payload: expect.objectContaining({
          ticket_id: "ticket_test",
          status: "new",
        }),
      }),
      expect.objectContaining({
        event_id: "evt_ticket_triaged",
        event_name: "support.ticket.triaged.v1",
        occurred_at: "2026-06-26T00:00:00.000Z",
        payload: expect.objectContaining({
          from_status: "new",
          to_status: "triaged",
        }),
      }),
      expect.objectContaining({
        event_id: "evt_ticket_sla_breached",
        event_name: "support.ticket.sla_breached.v1",
        occurred_at: "2026-06-26T00:00:00.000Z",
        payload: expect.objectContaining({
          breached_deadline: "first_response",
          due_at: "2026-06-26T00:15:00.000Z",
        }),
      }),
    ]);
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

function makeActivityImplementations(): Omit<
  TicketLifecycleActivities,
  "emitDomainEvent"
> {
  return {
    async createOrUpdateTicket() {
      return {
        ticket: makeTicketSnapshot(),
        created: true,
        previous_status: null,
        sla_timers: [],
      };
    },
    async runInitialTriage() {
      return {
        status: "triaged",
        route: "human_approval",
        reason_code: "ai_triage_completed",
        metadata: {},
      };
    },
    async createApproval() {
      return {
        approval_id: "apr_test",
        status: "pending",
      };
    },
    async recordInboundMessage() {},
    async recordAuditEvent() {},
  };
}

function makeTicketSnapshot() {
  return {
    ticket_id: "ticket_test",
    conversation_id: "cnv_test",
    customer_id: "cus_test",
    status: "new" as const,
    priority: "p2" as const,
    automation_mode: "human_approve" as const,
    assigned_queue: null,
    assigned_user_id: null,
    sla_policy_id: null,
    opened_at: "2026-06-26T00:00:00.000Z",
    first_response_due_at: null,
    next_response_due_at: null,
    resolution_due_at: null,
  };
}
