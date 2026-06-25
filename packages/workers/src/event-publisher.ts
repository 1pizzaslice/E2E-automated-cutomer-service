import { TextEncoder } from "node:util";

import {
  DomainEventEnvelopeSchema,
  buildDomainEventSubject,
  type DomainEventEnvelope,
} from "@support/shared-schemas";

export interface DomainEventPublisher {
  publish(event: DomainEventEnvelope): Promise<DomainEventPublishReceipt>;
}

export interface DomainEventPublishReceipt {
  readonly event_id: string;
  readonly subject: string;
  readonly stream: string | null;
  readonly sequence: number | null;
  readonly duplicate: boolean;
}

export interface JetStreamPublishOptions {
  readonly msgID?: string;
}

export interface JetStreamPublishAck {
  readonly stream?: string;
  readonly seq?: number;
  readonly duplicate?: boolean;
}

export interface JetStreamPublishClient {
  publish(
    subject: string,
    payload: Uint8Array,
    options?: JetStreamPublishOptions,
  ): Promise<JetStreamPublishAck>;
}

export class NatsJetStreamDomainEventPublisher implements DomainEventPublisher {
  private readonly encoder: TextEncoder;

  constructor(
    private readonly jetStream: JetStreamPublishClient,
    options: { readonly encoder?: TextEncoder } = {},
  ) {
    this.encoder = options.encoder ?? new TextEncoder();
  }

  async publish(
    event: DomainEventEnvelope,
  ): Promise<DomainEventPublishReceipt> {
    const validatedEvent = DomainEventEnvelopeSchema.parse(event);
    const subject = buildDomainEventSubject(validatedEvent);
    const payload = this.encoder.encode(JSON.stringify(validatedEvent));
    const ack = await this.jetStream.publish(subject, payload, {
      msgID: validatedEvent.event_id,
    });

    return {
      event_id: validatedEvent.event_id,
      subject,
      stream: ack.stream ?? null,
      sequence: ack.seq ?? null,
      duplicate: ack.duplicate ?? false,
    };
  }
}

export function createNatsJetStreamDomainEventPublisher(
  jetStream: JetStreamPublishClient,
): DomainEventPublisher {
  return new NatsJetStreamDomainEventPublisher(jetStream);
}
