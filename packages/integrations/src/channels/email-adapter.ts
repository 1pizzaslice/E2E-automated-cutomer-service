import { z } from "zod";
import {
  NormalizedInboundMessageSchema,
  type NormalizedInboundAttachment,
  type NormalizedInboundMessage,
} from "@support/shared-schemas";
import type { InboundAdapterContext } from "./inbound-context.js";

/**
 * Raw inbound email payload consumed by the email adapter. This is the
 * provider-neutral shape a webhook handler produces after extracting the fields
 * we consume from a provider's inbound-email webhook (for example Mailgun
 * routes or SendGrid inbound parse). Unknown provider fields are ignored rather
 * than rejected, so the schema is intentionally non-strict; the normalized
 * output is validated with the strict `NormalizedInboundMessageSchema`.
 *
 * Attachment bodies are stored by the webhook handler before the adapter runs;
 * each attachment therefore already carries an `object_ref`. The adapter is
 * pure and performs no download or storage side effects.
 */
export const RawInboundEmailAttachmentSchema = z.object({
  filename: z.string().min(1),
  content_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  object_ref: z.string().min(1),
});

export const RawInboundEmailSchema = z.object({
  message_id: z.string().min(1),
  thread_id: z.string().min(1).nullish(),
  in_reply_to: z.string().min(1).nullish(),
  references: z.array(z.string().min(1)).nullish(),
  from: z.object({
    email: z.string().min(1),
    name: z.string().min(1).nullish(),
  }),
  subject: z.string().nullish(),
  text: z.string().nullish(),
  html: z.string().nullish(),
  attachments: z.array(RawInboundEmailAttachmentSchema).nullish(),
  received_at: z.string().datetime(),
});

export type RawInboundEmail = z.infer<typeof RawInboundEmailSchema>;

/**
 * Map a raw inbound email payload into the normalized inbound message contract.
 * The provider timestamp must already be normalized to an ISO datetime string
 * by the webhook handler. Threading prefers an explicit provider thread id, then
 * the `In-Reply-To` header, then the first `References` entry.
 */
export function parseInboundEmailMessage(
  rawPayload: unknown,
  context: InboundAdapterContext,
): NormalizedInboundMessage {
  const raw = RawInboundEmailSchema.parse(rawPayload);

  const externalThreadId =
    raw.thread_id ?? raw.in_reply_to ?? raw.references?.[0] ?? null;

  const attachments: NormalizedInboundAttachment[] = (
    raw.attachments ?? []
  ).map((attachment) => ({
    filename: attachment.filename,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
    object_ref: attachment.object_ref,
  }));

  const message: NormalizedInboundMessage = {
    tenant_id: context.tenant_id,
    channel_id: context.channel_id,
    channel: "email",
    provider: context.provider,
    external_thread_id: externalThreadId,
    external_message_id: raw.message_id,
    customer_identity: {
      type: "email",
      value: raw.from.email,
      display_name: raw.from.name ?? null,
    },
    direction: "inbound",
    body: {
      text: raw.text ?? null,
      html: raw.html ?? null,
    },
    attachments,
    raw_payload_ref: context.raw_payload_ref,
    received_at: raw.received_at,
    idempotency_key: raw.message_id,
  };

  return NormalizedInboundMessageSchema.parse(message);
}
