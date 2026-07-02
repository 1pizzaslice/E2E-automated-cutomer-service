import { z } from "zod";

/**
 * Resolution context supplied by a channel webhook/polling handler before it
 * calls a pure inbound adapter. The handler is responsible for resolving the
 * tenant and channel from the provider path/config, storing the raw provider
 * payload, and passing the resulting storage reference here. Adapters stay pure
 * and perform no network or storage side effects.
 */
export const InboundAdapterContextSchema = z
  .object({
    tenant_id: z.string().min(1),
    channel_id: z.string().min(1),
    provider: z.string().min(1),
    raw_payload_ref: z.string().min(1),
  })
  .strict();

export type InboundAdapterContext = z.infer<typeof InboundAdapterContextSchema>;
