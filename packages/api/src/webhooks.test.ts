import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ApiErrorResponseSchema,
  InboundWebhookAcceptedResponseSchema,
} from "@support/shared-schemas";
import { buildApp } from "./app.js";
import {
  createInboundIntakeService,
  type WebhookSecretResolver,
} from "./inbound-intake.js";
import {
  createInMemoryInboundIntakeStore,
  type InboundChannelRecord,
} from "./inbound-intake-store.js";
import {
  createRecordingInboundWorkflowLauncher,
  type InboundWorkflowLauncher,
} from "./inbound-workflow-launcher.js";
import {
  createInMemoryRawPayloadStore,
  type RawPayloadStore,
} from "./raw-payload-store.js";
import { pollInboundEmailPlaceholder } from "./webhooks.js";

const TENANT_ID = "ten_wh";
const EMAIL_CHANNEL_ID = "chn_email";
const WHATSAPP_CHANNEL_ID = "chn_wa";
const SECRET = "webhook-signing-secret";

const emailChannel: InboundChannelRecord = {
  tenant_id: TENANT_ID,
  channel_id: EMAIL_CHANNEL_ID,
  type: "email",
  provider: "mailgun",
  status: "active",
  config: { signature_secret_ref: "WEBHOOK_SECRET_REF" },
};

const whatsappChannel: InboundChannelRecord = {
  tenant_id: TENANT_ID,
  channel_id: WHATSAPP_CHANNEL_ID,
  type: "whatsapp",
  provider: "cloud",
  status: "active",
  config: { signature_secret_ref: "WEBHOOK_SECRET_REF" },
};

const secretResolver: WebhookSecretResolver = {
  async resolve() {
    return SECRET;
  },
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function setup(
  channels: InboundChannelRecord[] = [emailChannel, whatsappChannel],
) {
  const store = createInMemoryInboundIntakeStore(channels);
  const launcher: InboundWorkflowLauncher & {
    calls: unknown[];
  } = createRecordingInboundWorkflowLauncher();
  const intake = createInboundIntakeService({
    store,
    launcher,
    secretResolver,
  });
  const rawPayloadStore: RawPayloadStore & {
    entries: Map<string, unknown>;
  } = createInMemoryRawPayloadStore();

  // Webhook routes authenticate by signature, not bearer token; the explicit
  // insecure-header mode just keeps app construction independent of JWT env.
  app = buildApp({
    webhooks: { intake, rawPayloadStore },
    auth: { mode: "insecure-headers" },
  });

  return { launcher, rawPayloadStore };
}

function mailgunEmailPayload(messageId: string): {
  raw: string;
  signatureHeader: undefined;
} {
  const timestamp = "1751414400";
  const token = "token-123";
  const signature = createHmac("sha256", SECRET)
    .update(`${timestamp}${token}`)
    .digest("hex");

  const raw = JSON.stringify({
    message_id: messageId,
    from: { email: "buyer@example.test", name: "Buyer" },
    subject: "Where is my order?",
    text: "Where is my order?",
    received_at: "2026-07-02T00:00:00.000Z",
    signature: { timestamp, token, signature },
  });

  return { raw, signatureHeader: undefined };
}

function whatsappPayload(messageId: string): {
  raw: string;
  signatureHeader: string;
} {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              contacts: [{ wa_id: "15551234567", profile: { name: "Buyer" } }],
              messages: [
                {
                  from: "15551234567",
                  id: messageId,
                  timestamp: "1751414400",
                  type: "text",
                  text: { body: "Where is my order?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const digest = createHmac("sha256", SECRET).update(raw).digest("hex");

  return { raw, signatureHeader: `sha256=${digest}` };
}

describe("inbound email webhook", () => {
  it("accepts a signed webhook, stores the raw payload, and starts the workflow", async () => {
    const { launcher, rawPayloadStore } = setup();
    const { raw } = mailgunEmailPayload("email-msg-1");

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/email/mailgun?channel_id=${EMAIL_CHANNEL_ID}`,
      headers: { "content-type": "application/json" },
      payload: raw,
    });
    const body = InboundWebhookAcceptedResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(202);
    expect(body).toMatchObject({
      channel_id: EMAIL_CHANNEL_ID,
      provider: "mailgun",
      received: 1,
      accepted: 1,
      deduplicated: 0,
    });
    expect(body.results[0]!.external_message_id).toBe("email-msg-1");
    expect(body.results[0]!.workflow_id).toContain(
      `ticket-lifecycle:${TENANT_ID}:`,
    );
    expect(rawPayloadStore.entries.size).toBe(1);
    expect(launcher.calls).toHaveLength(1);
  });

  it("rejects a webhook with an invalid signature", async () => {
    const { launcher, rawPayloadStore } = setup();
    const raw = JSON.stringify({
      message_id: "email-msg-1",
      from: { email: "buyer@example.test" },
      text: "hi",
      received_at: "2026-07-02T00:00:00.000Z",
      signature: {
        timestamp: "1751414400",
        token: "token-123",
        signature: "0".repeat(64),
      },
    });

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/email/mailgun?channel_id=${EMAIL_CHANNEL_ID}`,
      headers: { "content-type": "application/json" },
      payload: raw,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(rawPayloadStore.entries.size).toBe(0);
    expect(launcher.calls).toHaveLength(0);
  });

  it("deduplicates a repeated provider event", async () => {
    const { launcher } = setup();
    const { raw } = mailgunEmailPayload("email-msg-dup");
    const url = `/v1/webhooks/email/mailgun?channel_id=${EMAIL_CHANNEL_ID}`;
    const headers = { "content-type": "application/json" };

    const first = await app!.inject({
      method: "POST",
      url,
      headers,
      payload: raw,
    });
    const second = await app!.inject({
      method: "POST",
      url,
      headers,
      payload: raw,
    });
    const firstBody = InboundWebhookAcceptedResponseSchema.parse(first.json());
    const secondBody = InboundWebhookAcceptedResponseSchema.parse(
      second.json(),
    );

    expect(firstBody.accepted).toBe(1);
    expect(secondBody.accepted).toBe(0);
    expect(secondBody.deduplicated).toBe(1);
    expect(secondBody.results[0]!.deduplicated).toBe(true);
    expect(launcher.calls).toHaveLength(1);
  });

  it("returns 404 for an unknown channel", async () => {
    setup();
    const { raw } = mailgunEmailPayload("email-msg-1");

    const response = await app!.inject({
      method: "POST",
      url: "/v1/webhooks/email/mailgun?channel_id=chn_missing",
      headers: { "content-type": "application/json" },
      payload: raw,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("does not require bearer authentication", async () => {
    setup();
    const { raw } = mailgunEmailPayload("email-msg-noauth");

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/email/mailgun?channel_id=${EMAIL_CHANNEL_ID}`,
      headers: { "content-type": "application/json" },
      payload: raw,
    });

    expect(response.statusCode).toBe(202);
  });
});

describe("inbound whatsapp webhook", () => {
  it("accepts a signed WhatsApp webhook and normalizes the message", async () => {
    const { launcher, rawPayloadStore } = setup();
    const { raw, signatureHeader } = whatsappPayload("wamid.ABC");

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/whatsapp/cloud?channel_id=${WHATSAPP_CHANNEL_ID}`,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signatureHeader,
      },
      payload: raw,
    });
    const body = InboundWebhookAcceptedResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(202);
    expect(body.received).toBe(1);
    expect(body.results[0]!.external_message_id).toBe("wamid.ABC");
    expect(rawPayloadStore.entries.size).toBe(1);
    expect(launcher.calls).toHaveLength(1);
  });

  it("rejects a WhatsApp webhook with a missing/invalid signature", async () => {
    const { launcher } = setup();
    const { raw } = whatsappPayload("wamid.ABC");

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/whatsapp/cloud?channel_id=${WHATSAPP_CHANNEL_ID}`,
      headers: { "content-type": "application/json" },
      payload: raw,
    });

    expect(response.statusCode).toBe(403);
    expect(launcher.calls).toHaveLength(0);
  });
});

describe("inbound email polling placeholder", () => {
  it("reports an empty batch without touching intake", async () => {
    const result = await pollInboundEmailPlaceholder({
      provider: "mailgun",
      channelId: EMAIL_CHANNEL_ID,
    });

    expect(result).toEqual({
      provider: "mailgun",
      channel_id: EMAIL_CHANNEL_ID,
      polled: 0,
      accepted: 0,
    });
  });
});
