import { z } from "zod";
import {
  NormalizedInboundMessageSchema,
  type NormalizedInboundAttachment,
  type NormalizedInboundMessage,
} from "@support/shared-schemas";
import type { InboundAdapterContext } from "./inbound-context.js";

/**
 * Raw WhatsApp Cloud API inbound webhook payload. This mirrors the documented
 * `whatsapp_business_account` change notification shape. A single webhook can
 * batch multiple messages across entries/changes, so the adapter returns an
 * array of normalized messages. Unknown provider fields are ignored, so the
 * schema is intentionally non-strict; normalized output is validated with the
 * strict `NormalizedInboundMessageSchema`.
 */
const WhatsAppMediaSchema = z.object({
  id: z.string().min(1),
  mime_type: z.string().min(1).nullish(),
  filename: z.string().min(1).nullish(),
  caption: z.string().nullish(),
});

const WhatsAppInboundMessageSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).nullish(),
  image: WhatsAppMediaSchema.nullish(),
  document: WhatsAppMediaSchema.nullish(),
  audio: WhatsAppMediaSchema.nullish(),
  video: WhatsAppMediaSchema.nullish(),
});

const WhatsAppContactSchema = z.object({
  wa_id: z.string().min(1),
  profile: z.object({ name: z.string().min(1).nullish() }).nullish(),
});

const WhatsAppChangeValueSchema = z.object({
  messaging_product: z.string().min(1).nullish(),
  contacts: z.array(WhatsAppContactSchema).nullish(),
  messages: z.array(WhatsAppInboundMessageSchema).nullish(),
});

const WhatsAppChangeSchema = z.object({
  field: z.string().min(1).nullish(),
  value: WhatsAppChangeValueSchema,
});

const WhatsAppEntrySchema = z.object({
  id: z.string().min(1).nullish(),
  changes: z.array(WhatsAppChangeSchema).nullish(),
});

export const RawInboundWhatsAppSchema = z.object({
  object: z.string().min(1).nullish(),
  entry: z.array(WhatsAppEntrySchema),
});

export type RawInboundWhatsApp = z.infer<typeof RawInboundWhatsAppSchema>;

const MEDIA_TYPES = ["image", "document", "audio", "video"] as const;

type WhatsAppMedia = z.infer<typeof WhatsAppMediaSchema>;
type WhatsAppMessage = z.infer<typeof WhatsAppInboundMessageSchema>;

function isoFromUnixSeconds(timestamp: string): string {
  const seconds = Number(timestamp);

  if (!Number.isFinite(seconds)) {
    throw new Error(`Invalid WhatsApp timestamp: ${timestamp}`);
  }

  return new Date(seconds * 1000).toISOString();
}

function mediaAttachment(
  type: (typeof MEDIA_TYPES)[number],
  media: WhatsAppMedia,
): NormalizedInboundAttachment {
  return {
    filename: media.filename ?? `${type}-${media.id}`,
    content_type: media.mime_type ?? "application/octet-stream",
    // WhatsApp does not report media size at webhook time; it is resolved when
    // the media is downloaded in a later slice.
    size_bytes: null,
    object_ref: `whatsapp-media:${media.id}`,
  };
}

function messageParts(message: WhatsAppMessage): {
  text: string | null;
  attachments: NormalizedInboundAttachment[];
} {
  const attachments: NormalizedInboundAttachment[] = [];
  let caption: string | null = null;

  for (const type of MEDIA_TYPES) {
    const media = message[type];

    if (media) {
      attachments.push(mediaAttachment(type, media));
      caption = caption ?? media.caption ?? null;
    }
  }

  const text = message.text?.body ?? caption;

  return { text: text ?? null, attachments };
}

/**
 * Map a raw WhatsApp Cloud webhook payload into normalized inbound messages.
 * Returns one normalized message per inbound message across all batched
 * entries/changes. Statuses and other non-message changes are ignored.
 */
export function parseInboundWhatsAppMessages(
  rawPayload: unknown,
  context: InboundAdapterContext,
): NormalizedInboundMessage[] {
  const raw = RawInboundWhatsAppSchema.parse(rawPayload);
  const normalized: NormalizedInboundMessage[] = [];

  for (const entry of raw.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages ?? []) {
        const { text, attachments } = messageParts(message);

        const normalizedMessage: NormalizedInboundMessage = {
          tenant_id: context.tenant_id,
          channel_id: context.channel_id,
          channel: "whatsapp",
          provider: context.provider,
          external_thread_id: message.from,
          external_message_id: message.id,
          customer_identity: {
            type: "whatsapp_id",
            value: message.from,
            display_name: contactName,
          },
          direction: "inbound",
          body: {
            text,
            html: null,
          },
          attachments,
          raw_payload_ref: context.raw_payload_ref,
          received_at: isoFromUnixSeconds(message.timestamp),
          idempotency_key: message.id,
        };

        normalized.push(
          NormalizedInboundMessageSchema.parse(normalizedMessage),
        );
      }
    }
  }

  return normalized;
}
