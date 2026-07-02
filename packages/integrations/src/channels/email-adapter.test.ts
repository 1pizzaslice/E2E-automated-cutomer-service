import { describe, expect, it } from "vitest";
import { NormalizedInboundMessageSchema } from "@support/shared-schemas";
import { parseInboundEmailMessage } from "./email-adapter.js";
import type { InboundAdapterContext } from "./inbound-context.js";

const context: InboundAdapterContext = {
  tenant_id: "ten_test",
  channel_id: "chn_email",
  provider: "mailgun",
  raw_payload_ref: "s3://raw-payloads/email/provider-message-id.json",
};

const rawEmail = {
  message_id: "<provider-message-id@mail.example.com>",
  in_reply_to: "<thread-root@mail.example.com>",
  references: ["<thread-root@mail.example.com>"],
  from: { email: "customer@example.com", name: "Customer Name" },
  subject: "Where is my order?",
  text: "Where is my order?",
  html: "<p>Where is my order?</p>",
  attachments: [
    {
      filename: "receipt.pdf",
      content_type: "application/pdf",
      size_bytes: 12345,
      object_ref: "s3://raw-payloads/email/receipt.pdf",
    },
  ],
  received_at: "2026-06-18T00:00:00.000Z",
};

describe("parseInboundEmailMessage", () => {
  it("maps a raw provider email into a normalized inbound message", () => {
    const message = parseInboundEmailMessage(rawEmail, context);

    expect(NormalizedInboundMessageSchema.parse(message)).toEqual(message);
    expect(message).toMatchObject({
      tenant_id: "ten_test",
      channel_id: "chn_email",
      channel: "email",
      provider: "mailgun",
      external_message_id: "<provider-message-id@mail.example.com>",
      idempotency_key: "<provider-message-id@mail.example.com>",
      direction: "inbound",
      customer_identity: {
        type: "email",
        value: "customer@example.com",
        display_name: "Customer Name",
      },
      raw_payload_ref: context.raw_payload_ref,
      received_at: "2026-06-18T00:00:00.000Z",
    });
  });

  it("carries attachment metadata by reference", () => {
    const message = parseInboundEmailMessage(rawEmail, context);

    expect(message.attachments).toEqual([
      {
        filename: "receipt.pdf",
        content_type: "application/pdf",
        size_bytes: 12345,
        object_ref: "s3://raw-payloads/email/receipt.pdf",
      },
    ]);
  });

  it("threads on in_reply_to when no explicit thread id is present", () => {
    const message = parseInboundEmailMessage(rawEmail, context);

    expect(message.external_thread_id).toBe("<thread-root@mail.example.com>");
  });

  it("prefers an explicit provider thread id for threading", () => {
    const message = parseInboundEmailMessage(
      { ...rawEmail, thread_id: "thread-42" },
      context,
    );

    expect(message.external_thread_id).toBe("thread-42");
  });

  it("supports html-only emails with no attachments", () => {
    const message = parseInboundEmailMessage(
      { ...rawEmail, text: undefined, attachments: undefined },
      context,
    );

    expect(message.body).toEqual({
      text: null,
      html: "<p>Where is my order?</p>",
    });
    expect(message.attachments).toEqual([]);
    expect(message.external_thread_id).toBe("<thread-root@mail.example.com>");
  });

  it("rejects an email with no message id", () => {
    const { message_id: _omitted, ...withoutId } = rawEmail;

    expect(() => parseInboundEmailMessage(withoutId, context)).toThrow();
  });

  it("rejects an email with no text, html, or attachments", () => {
    expect(() =>
      parseInboundEmailMessage(
        { ...rawEmail, text: undefined, html: undefined, attachments: [] },
        context,
      ),
    ).toThrow();
  });
});
