import { describe, expect, it } from "vitest";
import { NormalizedInboundMessageSchema } from "@support/shared-schemas";
import { parseInboundWhatsAppMessages } from "./whatsapp-adapter.js";
import type { InboundAdapterContext } from "./inbound-context.js";

const context: InboundAdapterContext = {
  tenant_id: "ten_test",
  channel_id: "chn_whatsapp",
  provider: "whatsapp_cloud",
  raw_payload_ref: "s3://raw-payloads/whatsapp/webhook.json",
};

const textTimestamp = "1718668800";
const documentTimestamp = "1718668900";

const rawWebhook = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550000000",
              phone_number_id: "PNID",
            },
            contacts: [
              { wa_id: "15551234567", profile: { name: "Customer Name" } },
            ],
            messages: [
              {
                from: "15551234567",
                id: "wamid.TEXT",
                timestamp: textTimestamp,
                type: "text",
                text: { body: "Where is my order?" },
              },
              {
                from: "15551234567",
                id: "wamid.DOC",
                timestamp: documentTimestamp,
                type: "document",
                document: {
                  id: "MEDIA_ID",
                  mime_type: "application/pdf",
                  filename: "receipt.pdf",
                  caption: "my receipt",
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("parseInboundWhatsAppMessages", () => {
  it("normalizes every batched inbound message", () => {
    const messages = parseInboundWhatsAppMessages(rawWebhook, context);

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(NormalizedInboundMessageSchema.parse(message)).toEqual(message);
      expect(message).toMatchObject({
        tenant_id: "ten_test",
        channel_id: "chn_whatsapp",
        channel: "whatsapp",
        provider: "whatsapp_cloud",
        direction: "inbound",
        customer_identity: {
          type: "whatsapp_id",
          value: "15551234567",
          display_name: "Customer Name",
        },
      });
    }
  });

  it("maps a text message with the sender as the thread key", () => {
    const [text] = parseInboundWhatsAppMessages(rawWebhook, context);

    expect(text).toMatchObject({
      external_message_id: "wamid.TEXT",
      idempotency_key: "wamid.TEXT",
      external_thread_id: "15551234567",
      body: { text: "Where is my order?", html: null },
      attachments: [],
      received_at: new Date(Number(textTimestamp) * 1000).toISOString(),
    });
  });

  it("maps a document message to attachment metadata with a pending size", () => {
    const [, document] = parseInboundWhatsAppMessages(rawWebhook, context);

    expect(document).toMatchObject({
      external_message_id: "wamid.DOC",
      body: { text: "my receipt", html: null },
      attachments: [
        {
          filename: "receipt.pdf",
          content_type: "application/pdf",
          size_bytes: null,
          object_ref: "whatsapp-media:MEDIA_ID",
        },
      ],
      received_at: new Date(Number(documentTimestamp) * 1000).toISOString(),
    });
  });

  it("normalizes a captionless media message with an empty body", () => {
    const messages = parseInboundWhatsAppMessages(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.IMG",
                      timestamp: textTimestamp,
                      type: "image",
                      image: { id: "IMG_ID", mime_type: "image/jpeg" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      context,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      body: { text: null, html: null },
      attachments: [
        {
          filename: "image-IMG_ID",
          content_type: "image/jpeg",
          size_bytes: null,
          object_ref: "whatsapp-media:IMG_ID",
        },
      ],
    });
  });

  it("ignores non-message changes such as status notifications", () => {
    const messages = parseInboundWhatsAppMessages(
      {
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: {} }] }],
      },
      context,
    );

    expect(messages).toEqual([]);
  });

  it("rejects a webhook missing the entry array", () => {
    expect(() =>
      parseInboundWhatsAppMessages(
        { object: "whatsapp_business_account" },
        context,
      ),
    ).toThrow();
  });
});
