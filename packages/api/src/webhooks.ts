import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  parseInboundEmailMessage,
  parseInboundWhatsAppMessages,
  verifyHmacSha256Signature,
  verifyMailgunSignature,
  verifyWhatsAppCloudSignature,
  type InboundAdapterContext,
} from "@support/integrations";
import {
  InboundWebhookAcceptedResponseSchema,
  type InboundWebhookMessageResult,
  type NormalizedInboundChannel,
  type NormalizedInboundMessage,
} from "@support/shared-schemas";
import { HttpError } from "./errors.js";
import type { InboundIntakeService } from "./inbound-intake.js";
import type { RawPayloadStore } from "./raw-payload-store.js";

export interface InboundWebhookDependencies {
  readonly intake: InboundIntakeService;
  readonly rawPayloadStore: RawPayloadStore;
  close?(): Promise<void>;
}

const WebhookParamsSchema = z.object({
  provider: z.string().min(1),
});

const WebhookQuerySchema = z
  .object({
    channel_id: z.string().min(1),
  })
  .strict();

const MailgunSignatureSchema = z.object({
  timestamp: z.string().min(1),
  token: z.string().min(1),
  signature: z.string().min(1),
});

export function registerWebhookRoutes(
  app: FastifyInstance,
  deps: InboundWebhookDependencies,
): void {
  app.post("/v1/webhooks/email/:provider", async (request, reply) =>
    handleInboundWebhook("email", request, reply, deps),
  );
  app.post("/v1/webhooks/whatsapp/:provider", async (request, reply) =>
    handleInboundWebhook("whatsapp", request, reply, deps),
  );
}

async function handleInboundWebhook(
  channelType: NormalizedInboundChannel,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: InboundWebhookDependencies,
) {
  const { provider } = parse(WebhookParamsSchema, request.params);
  const { channel_id: channelId } = parse(WebhookQuerySchema, request.query);

  const resolution = await deps.intake.resolveChannel({
    channelType,
    provider,
    channelId,
  });

  if (!resolution) {
    throw new HttpError(
      404,
      "RESOURCE_NOT_FOUND",
      "Webhook channel was not found or is not active.",
    );
  }

  const rawBody = request.rawBody;

  if (!rawBody || rawBody.length === 0) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Webhook request body is required.",
    );
  }

  const signatureValid = verifyInboundSignature({
    channelType,
    provider,
    rawBody,
    parsedBody: request.body,
    headers: request.headers,
    secret: resolution.signing_secret,
  });

  if (!signatureValid) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Webhook signature verification failed.",
    );
  }

  const { ref } = await deps.rawPayloadStore.put({
    tenantId: resolution.tenant_id,
    channelId: resolution.channel_id,
    provider: resolution.provider,
    channelType,
    contentType: headerValue(request.headers, "content-type"),
    body: rawBody,
  });

  const context: InboundAdapterContext = {
    tenant_id: resolution.tenant_id,
    channel_id: resolution.channel_id,
    provider: resolution.provider,
    raw_payload_ref: ref,
  };

  const messages = parseInboundMessages(channelType, request.body, context);

  const results: InboundWebhookMessageResult[] = [];

  for (const message of messages) {
    const ingest = await deps.intake.ingestNormalizedMessage(message);
    results.push({
      external_message_id: message.external_message_id,
      message_id: ingest.message_id,
      conversation_id: ingest.conversation_id,
      ticket_id: ingest.ticket_id,
      deduplicated: ingest.deduplicated,
      rejected: ingest.rejected,
      rejection_reason: ingest.rejection_reason,
      workflow_id: ingest.workflow?.workflow_id ?? null,
    });
  }

  reply.status(202);
  return InboundWebhookAcceptedResponseSchema.parse({
    channel_id: resolution.channel_id,
    provider: resolution.provider,
    received: results.length,
    accepted: results.filter(
      (result) => !result.deduplicated && !result.rejected,
    ).length,
    deduplicated: results.filter((result) => result.deduplicated).length,
    rejected: results.filter((result) => result.rejected).length,
    results,
  });
}

function parseInboundMessages(
  channelType: NormalizedInboundChannel,
  body: unknown,
  context: InboundAdapterContext,
): NormalizedInboundMessage[] {
  try {
    return channelType === "email"
      ? [parseInboundEmailMessage(body, context)]
      : parseInboundWhatsAppMessages(body, context);
  } catch (error) {
    const details = error instanceof z.ZodError ? error.issues : [];
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Webhook payload could not be normalized.",
      details,
    );
  }
}

function verifyInboundSignature(params: {
  readonly channelType: NormalizedInboundChannel;
  readonly provider: string;
  readonly rawBody: Buffer;
  readonly parsedBody: unknown;
  readonly headers: FastifyRequest["headers"];
  readonly secret: string | null;
}): boolean {
  if (!params.secret) {
    return false;
  }

  if (params.channelType === "whatsapp") {
    return verifyWhatsAppCloudSignature({
      rawBody: params.rawBody,
      appSecret: params.secret,
      signatureHeader: headerValue(params.headers, "x-hub-signature-256"),
    });
  }

  if (params.provider === "mailgun") {
    const signature = MailgunSignatureSchema.safeParse(
      (params.parsedBody as { signature?: unknown } | null)?.signature,
    );

    if (!signature.success) {
      return false;
    }

    return verifyMailgunSignature({
      timestamp: signature.data.timestamp,
      token: signature.data.token,
      signature: signature.data.signature,
      signingKey: params.secret,
    });
  }

  // Generic scheme for other email providers: HMAC-SHA256 over the raw body,
  // supplied as `X-Webhook-Signature-256: sha256=<hex>`.
  const header = headerValue(params.headers, "x-webhook-signature-256") ?? "";
  const prefix = "sha256=";

  if (!header.startsWith(prefix)) {
    return false;
  }

  return verifyHmacSha256Signature({
    payload: params.rawBody,
    secret: params.secret,
    expectedHex: header.slice(prefix.length),
  });
}

export interface EmailPollPlaceholderResult {
  readonly provider: string;
  readonly channel_id: string;
  readonly polled: number;
  readonly accepted: number;
}

/**
 * Placeholder for scheduled inbound email polling. Providers without webhook
 * push (or as a reconciliation backstop) will be polled over IMAP or a provider
 * pull API and fed through the same normalized intake path. Until that slice
 * lands this performs no fetch and reports an empty batch.
 */
export async function pollInboundEmailPlaceholder(params: {
  readonly provider: string;
  readonly channelId: string;
}): Promise<EmailPollPlaceholderResult> {
  return {
    provider: params.provider,
    channel_id: params.channelId,
    polled: 0,
    accepted: 0,
  };
}

function headerValue(
  headers: FastifyRequest["headers"],
  name: string,
): string | null {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Webhook request parameters are invalid.",
      result.error.issues,
    );
  }

  return result.data;
}
