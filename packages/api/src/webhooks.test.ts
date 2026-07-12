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
const GENERIC_EMAIL_CHANNEL_ID = "chn_email_generic";
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

/**
 * A non-Mailgun email provider, which posts the provider-neutral JSON shape and
 * signs with the generic HMAC-over-body scheme. Keeps that documented path
 * covered now that Mailgun has its own field mapping.
 */
const genericEmailChannel: InboundChannelRecord = {
  tenant_id: TENANT_ID,
  channel_id: GENERIC_EMAIL_CHANNEL_ID,
  type: "email",
  provider: "generic",
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
  channels: InboundChannelRecord[] = [
    emailChannel,
    genericEmailChannel,
    whatsappChannel,
  ],
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

/**
 * The field set Mailgun's inbound routes actually POST: mixed-case `Message-Id`,
 * hyphenated `body-plain`, a Unix-SECONDS `timestamp`, and the signing triplet
 * FLAT at the top level (its event/tracking webhooks are the ones that nest it
 * under `signature`). The previous fixture here posted a neutral-shaped JSON
 * body Mailgun never sends, which is exactly why the ingress gap went unnoticed.
 */
function mailgunFields(
  messageId: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = `token-${messageId}`;
  const signature = createHmac("sha256", SECRET)
    .update(`${timestamp}${token}`)
    .digest("hex");

  return {
    recipient: "support@mg.example.test",
    sender: "buyer@example.test",
    from: "Buyer <buyer@example.test>",
    subject: "Where is my order?",
    "body-plain": "Where is my order?",
    "stripped-text": "Where is my order?",
    "Message-Id": `<${messageId}>`,
    "message-headers": JSON.stringify([
      ["Message-Id", `<${messageId}>`],
      ["From", "Buyer <buyer@example.test>"],
    ]),
    timestamp,
    token,
    signature,
    ...overrides,
  };
}

function urlEncoded(fields: Record<string, string>): {
  payload: string;
  contentType: string;
} {
  return {
    payload: new URLSearchParams(fields).toString(),
    contentType: "application/x-www-form-urlencoded",
  };
}

/** Mailgun switches to multipart when the received mail carries attachments. */
function multipart(
  fields: Record<string, string>,
  files: readonly {
    field: string;
    filename: string;
    contentType: string;
    content: Buffer;
  }[] = [],
): { payload: Buffer; contentType: string } {
  const boundary = "----supporttestboundary";
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** The provider-neutral JSON shape a non-Mailgun email provider posts. */
function genericEmailPayload(messageId: string): {
  raw: string;
  signatureHeader: string;
} {
  const raw = JSON.stringify({
    message_id: messageId,
    from: { email: "buyer@example.test", name: "Buyer" },
    subject: "Where is my order?",
    text: "Where is my order?",
    received_at: "2026-07-02T00:00:00.000Z",
  });
  const digest = createHmac("sha256", SECRET).update(raw).digest("hex");

  return { raw, signatureHeader: `sha256=${digest}` };
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

const MAILGUN_URL = `/v1/webhooks/email/mailgun?channel_id=${EMAIL_CHANNEL_ID}`;

describe("inbound mailgun webhook (form-encoded, as Mailgun actually posts)", () => {
  it("accepts a urlencoded route post, stores the raw payload, and starts the workflow", async () => {
    const { launcher, rawPayloadStore } = setup();
    const { payload, contentType } = urlEncoded(mailgunFields("email-msg-1"));

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
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
    // Angle brackets are stripped off the RFC 5322 Message-Id.
    expect(body.results[0]!.external_message_id).toBe("email-msg-1");
    expect(body.results[0]!.workflow_id).toContain(
      `ticket-lifecycle:${TENANT_ID}:`,
    );
    expect(rawPayloadStore.entries.size).toBe(1);
    expect(launcher.calls).toHaveLength(1);
  });

  it("accepts a multipart route post carrying an allowed attachment", async () => {
    const { launcher } = setup();
    const { payload, contentType } = multipart(
      mailgunFields("email-msg-attach", { "attachment-count": "1" }),
      [
        {
          field: "attachment-1",
          filename: "receipt.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4 fake"),
        },
      ],
    );

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
    });
    const body = InboundWebhookAcceptedResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(202);
    expect(body.accepted).toBe(1);
    expect(body.results[0]!.rejected).toBe(false);
    expect(launcher.calls).toHaveLength(1);
  });

  it("routes multipart attachment metadata through the attachment policy gate", async () => {
    // A disallowed content type can only be caught if the parsed file part's
    // metadata actually reached the validator, so this pins the whole path:
    // multipart parse -> Mailgun mapping -> normalized attachment -> policy.
    const { launcher } = setup();
    const { payload, contentType } = multipart(
      mailgunFields("email-msg-badattach", { "attachment-count": "1" }),
      [
        {
          field: "attachment-1",
          filename: "payload.exe",
          contentType: "application/x-msdownload",
          content: Buffer.from("MZ"),
        },
      ],
    );

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
    });
    const body = InboundWebhookAcceptedResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(202);
    expect(body.rejected).toBe(1);
    expect(body.results[0]!.rejected).toBe(true);
    expect(body.results[0]!.rejection_reason).toBe(
      "attachment_type_not_allowed",
    );
    expect(launcher.calls).toHaveLength(0);
  });

  it("rejects a tampered signature", async () => {
    const { launcher, rawPayloadStore } = setup();
    const { payload, contentType } = urlEncoded(
      mailgunFields("email-msg-bad", { signature: "0".repeat(64) }),
    );

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(rawPayloadStore.entries.size).toBe(0);
    expect(launcher.calls).toHaveLength(0);
  });

  it("rejects a correctly signed but STALE post, bounding the replay window", async () => {
    const { launcher } = setup();
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const token = "stale-token";
    const signature = createHmac("sha256", SECRET)
      .update(`${staleTimestamp}${token}`)
      .digest("hex");
    const { payload, contentType } = urlEncoded(
      mailgunFields("email-msg-stale", {
        timestamp: staleTimestamp,
        token,
        signature,
      }),
    );

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(launcher.calls).toHaveLength(0);
  });

  it("rejects a signed post whose body cannot be normalized", async () => {
    const { launcher } = setup();
    const fields = mailgunFields("email-msg-nomapping");
    delete fields["Message-Id"];
    delete fields["message-headers"];
    const { payload, contentType } = urlEncoded(fields);

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(launcher.calls).toHaveLength(0);
  });

  it("deduplicates a repeated provider event", async () => {
    const { launcher } = setup();
    const { payload, contentType } = urlEncoded(mailgunFields("email-msg-dup"));
    const headers = { "content-type": contentType };

    const first = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers,
      payload,
    });
    const second = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers,
      payload,
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
    const { payload, contentType } = urlEncoded(mailgunFields("email-msg-1"));

    const response = await app!.inject({
      method: "POST",
      url: "/v1/webhooks/email/mailgun?channel_id=chn_missing",
      headers: { "content-type": contentType },
      payload,
    });
    const body = ApiErrorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("does not require bearer authentication", async () => {
    setup();
    const { payload, contentType } = urlEncoded(
      mailgunFields("email-msg-noauth"),
    );

    const response = await app!.inject({
      method: "POST",
      url: MAILGUN_URL,
      headers: { "content-type": contentType },
      payload,
    });

    expect(response.statusCode).toBe(202);
  });
});

describe("inbound email webhook (generic provider, neutral JSON shape)", () => {
  it("accepts the neutral shape signed with the generic HMAC-over-body scheme", async () => {
    const { launcher } = setup();
    const { raw, signatureHeader } = genericEmailPayload("generic-msg-1");

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/email/generic?channel_id=${GENERIC_EMAIL_CHANNEL_ID}`,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature-256": signatureHeader,
      },
      payload: raw,
    });
    const body = InboundWebhookAcceptedResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(202);
    expect(body.accepted).toBe(1);
    expect(body.results[0]!.external_message_id).toBe("generic-msg-1");
    expect(launcher.calls).toHaveLength(1);
  });

  it("rejects the neutral shape when the body signature does not match", async () => {
    const { launcher } = setup();
    const { raw } = genericEmailPayload("generic-msg-bad");

    const response = await app!.inject({
      method: "POST",
      url: `/v1/webhooks/email/generic?channel_id=${GENERIC_EMAIL_CHANNEL_ID}`,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature-256": `sha256=${"0".repeat(64)}`,
      },
      payload: raw,
    });

    expect(response.statusCode).toBe(403);
    expect(launcher.calls).toHaveLength(0);
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
