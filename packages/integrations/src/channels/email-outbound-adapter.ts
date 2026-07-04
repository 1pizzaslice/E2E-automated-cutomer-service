import { z } from "zod";
import {
  NormalizedOutboundMessageSchema,
  type NormalizedOutboundMessage,
} from "@support/shared-schemas";

/**
 * Provider-neutral outbound email request produced by the email outbound
 * adapter. This is the shape an email send API consumes (for example the
 * Mailgun messages API): the sender maps these fields onto the provider's
 * transport encoding. Threading uses standard RFC 5322 reply headers derived
 * from the conversation's external thread id so providers deliver the reply
 * into the customer's existing thread.
 */
export const OutboundEmailProviderRequestSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    subject: z.string().min(1).nullable(),
    text: z.string().min(1),
    html: z.string().nullable(),
    in_reply_to: z.string().min(1).nullable(),
    references: z.string().min(1).nullable(),
  })
  .strict();

export type OutboundEmailProviderRequest = z.infer<
  typeof OutboundEmailProviderRequestSchema
>;

export interface OutboundEmailAdapterOptions {
  /** Verified sender address for the tenant channel (channel config). */
  readonly fromAddress: string;
  /** Optional display name rendered as `Name <address>`. */
  readonly fromName?: string | null;
}

/**
 * Map a normalized outbound message onto the provider-neutral email send
 * request. The adapter is pure: recipient, body, and threading come from the
 * validated normalized message; the sender identity comes from the tenant
 * channel configuration supplied by the caller.
 */
export function buildOutboundEmailProviderRequest(
  message: NormalizedOutboundMessage,
  options: OutboundEmailAdapterOptions,
): OutboundEmailProviderRequest {
  const outbound = NormalizedOutboundMessageSchema.parse(message);

  if (outbound.channel !== "email") {
    throw new Error(
      `Email outbound adapter received a ${outbound.channel} message.`,
    );
  }

  const from = options.fromName
    ? `${options.fromName} <${options.fromAddress}>`
    : options.fromAddress;

  return OutboundEmailProviderRequestSchema.parse({
    from,
    to: outbound.to.value,
    subject: outbound.subject,
    text: outbound.body.text,
    html: outbound.body.html,
    in_reply_to: outbound.external_thread_id,
    references: outbound.external_thread_id,
  });
}
