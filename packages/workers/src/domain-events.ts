import {
  DomainEventEnvelopeSchema,
  TicketStateTransitionEventNameSchema,
  type DomainEventActor,
  type DomainEventEnvelope,
  type DomainEventName,
  type MessageReceivedEventPayload,
  type TicketCreatedEventPayload,
  type TicketSlaBreachedEventPayload,
  type TicketStateTransitionEventName,
  type TicketStateTransitionEventPayload,
} from "@support/shared-schemas";
import type {
  DomainEventPublishReceipt,
  DomainEventPublisher,
} from "./event-publisher.js";

export interface DomainEventEmissionMetadata {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly occurred_at: string;
  readonly actor: DomainEventActor;
}

export interface MessageReceivedEventInput extends DomainEventEmissionMetadata {
  readonly payload: MessageReceivedEventPayload;
}

export interface TicketCreatedEventInput extends DomainEventEmissionMetadata {
  readonly payload: TicketCreatedEventPayload;
}

export interface TicketStateTransitionEventInput extends DomainEventEmissionMetadata {
  readonly event_name: TicketStateTransitionEventName;
  readonly payload: TicketStateTransitionEventPayload;
}

export interface TicketSlaBreachedEventInput extends DomainEventEmissionMetadata {
  readonly payload: TicketSlaBreachedEventPayload;
}

export function buildMessageReceivedEvent(
  input: MessageReceivedEventInput,
): DomainEventEnvelope {
  return buildDomainEventEnvelope("support.message.received.v1", input);
}

export function buildTicketCreatedEvent(
  input: TicketCreatedEventInput,
): DomainEventEnvelope {
  return buildDomainEventEnvelope("support.ticket.created.v1", input);
}

export function buildTicketStateTransitionEvent(
  input: TicketStateTransitionEventInput,
): DomainEventEnvelope {
  const eventName = TicketStateTransitionEventNameSchema.parse(
    input.event_name,
  );

  return buildDomainEventEnvelope(eventName, input);
}

export function buildTicketSlaBreachedEvent(
  input: TicketSlaBreachedEventInput,
): DomainEventEnvelope {
  return buildDomainEventEnvelope("support.ticket.sla_breached.v1", input);
}

export async function emitMessageReceivedEvent(
  publisher: DomainEventPublisher,
  input: MessageReceivedEventInput,
): Promise<DomainEventPublishReceipt> {
  return publisher.publish(buildMessageReceivedEvent(input));
}

export async function emitTicketCreatedEvent(
  publisher: DomainEventPublisher,
  input: TicketCreatedEventInput,
): Promise<DomainEventPublishReceipt> {
  return publisher.publish(buildTicketCreatedEvent(input));
}

export async function emitTicketStateTransitionEvent(
  publisher: DomainEventPublisher,
  input: TicketStateTransitionEventInput,
): Promise<DomainEventPublishReceipt> {
  return publisher.publish(buildTicketStateTransitionEvent(input));
}

export async function emitTicketSlaBreachedEvent(
  publisher: DomainEventPublisher,
  input: TicketSlaBreachedEventInput,
): Promise<DomainEventPublishReceipt> {
  return publisher.publish(buildTicketSlaBreachedEvent(input));
}

function buildDomainEventEnvelope(
  eventName: DomainEventName,
  input: DomainEventEmissionMetadata & {
    readonly payload: DomainEventEnvelope["payload"];
  },
): DomainEventEnvelope {
  return DomainEventEnvelopeSchema.parse({
    event_id: input.event_id,
    event_name: eventName,
    schema_version: "1",
    tenant_id: input.tenant_id,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    occurred_at: input.occurred_at,
    actor: input.actor,
    payload: input.payload,
  });
}
