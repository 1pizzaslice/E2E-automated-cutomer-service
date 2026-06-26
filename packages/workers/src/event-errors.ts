import { TextEncoder } from "node:util";

import {
  SupportEventErrorRecordSchema,
  type SupportEventErrorRecord,
} from "@support/shared-schemas";
import {
  type JetStreamPublishAck,
  type JetStreamPublishClient,
  type JetStreamPublishOptions,
} from "./event-publisher.js";

export const SUPPORT_EVENT_ERRORS_SUBJECT = "support.events.errors.>";
export const SUPPORT_EVENT_ERROR_SUBJECT_PREFIX = "support.events.errors";

export interface SupportEventErrorPublisher {
  publish(
    record: SupportEventErrorRecord,
  ): Promise<SupportEventErrorPublishReceipt>;
}

export interface SupportEventErrorPublishReceipt {
  readonly error_id: string;
  readonly subject: string;
  readonly stream: string | null;
  readonly sequence: number | null;
  readonly duplicate: boolean;
}

export class NatsJetStreamSupportEventErrorPublisher implements SupportEventErrorPublisher {
  private readonly encoder: TextEncoder;

  constructor(
    private readonly jetStream: JetStreamPublishClient,
    options: { readonly encoder?: TextEncoder } = {},
  ) {
    this.encoder = options.encoder ?? new TextEncoder();
  }

  async publish(
    record: SupportEventErrorRecord,
  ): Promise<SupportEventErrorPublishReceipt> {
    const validatedRecord = SupportEventErrorRecordSchema.parse(record);
    const subject = buildSupportEventErrorSubject(validatedRecord);
    const payload = this.encoder.encode(JSON.stringify(validatedRecord));
    const ack: JetStreamPublishAck = await this.jetStream.publish(
      subject,
      payload,
      buildSupportEventErrorPublishOptions(validatedRecord),
    );

    return {
      error_id: validatedRecord.error_id,
      subject,
      stream: ack.stream ?? null,
      sequence: ack.seq ?? null,
      duplicate: ack.duplicate ?? false,
    };
  }
}

export function createNatsJetStreamSupportEventErrorPublisher(
  jetStream: JetStreamPublishClient,
): SupportEventErrorPublisher {
  return new NatsJetStreamSupportEventErrorPublisher(jetStream);
}

export function buildSupportEventErrorSubject(
  record: SupportEventErrorRecord,
): string {
  const validatedRecord = SupportEventErrorRecordSchema.parse(record);

  if (validatedRecord.tenant_id && validatedRecord.event_name) {
    const eventNameWithoutNamespace = validatedRecord.event_name.replace(
      /^support\./,
      "",
    );

    return `${SUPPORT_EVENT_ERROR_SUBJECT_PREFIX}.tenant.${validatedRecord.tenant_id}.${eventNameWithoutNamespace}`;
  }

  return `${SUPPORT_EVENT_ERROR_SUBJECT_PREFIX}.${validatedRecord.error_kind}.v1`;
}

function buildSupportEventErrorPublishOptions(
  record: SupportEventErrorRecord,
): JetStreamPublishOptions {
  return {
    msgID: record.error_id,
  };
}
