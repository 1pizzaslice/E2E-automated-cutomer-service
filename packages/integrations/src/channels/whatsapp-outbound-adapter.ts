import { z } from "zod";
import {
  NormalizedOutboundMessageSchema,
  type NormalizedOutboundMessage,
} from "@support/shared-schemas";

/**
 * Outbound WhatsApp Cloud API text message request. This mirrors the
 * documented `POST /{phone_number_id}/messages` body for `type: "text"`
 * sends. v1 sends plain text only; templates and media are future work.
 */
export const OutboundWhatsAppProviderRequestSchema = z
  .object({
    messaging_product: z.literal("whatsapp"),
    recipient_type: z.literal("individual"),
    to: z.string().min(1),
    type: z.literal("text"),
    text: z
      .object({
        preview_url: z.boolean(),
        body: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type OutboundWhatsAppProviderRequest = z.infer<
  typeof OutboundWhatsAppProviderRequestSchema
>;

/**
 * Map a normalized outbound message onto the WhatsApp Cloud API text send
 * request. The adapter is pure and only carries the customer-facing text body;
 * WhatsApp has no subject or HTML rendering.
 */
export function buildOutboundWhatsAppProviderRequest(
  message: NormalizedOutboundMessage,
): OutboundWhatsAppProviderRequest {
  const outbound = NormalizedOutboundMessageSchema.parse(message);

  if (outbound.channel !== "whatsapp") {
    throw new Error(
      `WhatsApp outbound adapter received a ${outbound.channel} message.`,
    );
  }

  return OutboundWhatsAppProviderRequestSchema.parse({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: outbound.to.value,
    type: "text",
    text: {
      preview_url: false,
      body: outbound.body.text,
    },
  });
}
