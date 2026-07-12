import { describe, expect, it } from "vitest";
import {
  extractMailgunSignatureFields,
  mapMailgunInboundToRawEmail,
} from "./mailgun-inbound.js";
import { parseInboundEmailMessage } from "./email-adapter.js";

const CONTEXT = {
  tenant_id: "ten_1",
  channel_id: "chn_1",
  provider: "mailgun",
  raw_payload_ref: "file://raw/1",
};

/**
 * The field set Mailgun's inbound routes actually POST. Every name and shape
 * here comes from Mailgun's "Routes"/"Receiving, Forwarding and Storing
 * Messages" contract: mixed-case `Message-Id`, hyphenated `body-plain`, a
 * Unix-SECONDS `timestamp`, and the signing triplet flat at the top level.
 */
function mailgunFields(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    recipient: "support@mg.example.test",
    sender: "buyer@example.test",
    from: '"Buyer Person" <buyer@example.test>',
    subject: "Where is my order?",
    "body-plain":
      "Where is my order?\n\nOn Tue, someone wrote:\n> the quoted thread",
    "stripped-text": "Where is my order?",
    "body-html": "<p>Where is my order?</p><blockquote>quoted</blockquote>",
    "stripped-html": "<p>Where is my order?</p>",
    "Message-Id": "<CAF-abc123@mail.example.test>",
    "message-headers": JSON.stringify([
      ["Received", "by mx.example.test"],
      ["Message-Id", "<CAF-abc123@mail.example.test>"],
      ["From", '"Buyer Person" <buyer@example.test>'],
      ["Subject", "Where is my order?"],
    ]),
    timestamp: "1751414400",
    token: "token-123",
    signature: "deadbeef",
    ...overrides,
  };
}

describe("mapMailgunInboundToRawEmail", () => {
  it("maps a real Mailgun inbound-route field set onto the neutral contract", () => {
    const raw = mapMailgunInboundToRawEmail({ fields: mailgunFields() });

    expect(raw).toMatchObject({
      message_id: "CAF-abc123@mail.example.test",
      from: { email: "buyer@example.test", name: "Buyer Person" },
      subject: "Where is my order?",
    });
    // Unix SECONDS -> ISO-8601, which is what RawInboundEmailSchema demands.
    expect(raw.received_at).toBe("2025-07-02T00:00:00.000Z");
  });

  it("prefers the stripped bodies so the quoted thread never reaches the model", () => {
    const raw = mapMailgunInboundToRawEmail({ fields: mailgunFields() });

    expect(raw.text).toBe("Where is my order?");
    expect(raw.html).toBe("<p>Where is my order?</p>");
  });

  it("falls back to the full body when Mailgun sends no stripped variant", () => {
    const fields = mailgunFields();
    delete fields["stripped-text"];
    delete fields["stripped-html"];

    const raw = mapMailgunInboundToRawEmail({ fields });

    expect(raw.text).toContain("the quoted thread");
    expect(raw.html).toContain("blockquote");
  });

  it("derives threading from In-Reply-To and References", () => {
    const raw = mapMailgunInboundToRawEmail({
      fields: mailgunFields({
        "In-Reply-To": "<prev@mail.example.test>",
        References: "<root@mail.example.test> <prev@mail.example.test>",
      }),
    });

    expect(raw.in_reply_to).toBe("prev@mail.example.test");
    expect(raw.references).toEqual([
      "root@mail.example.test",
      "prev@mail.example.test",
    ]);
  });

  it("recovers the message id and sender from message-headers when the flat fields are absent", () => {
    const fields = mailgunFields();
    delete fields["Message-Id"];
    delete fields["from"];
    delete fields["sender"];

    const raw = mapMailgunInboundToRawEmail({ fields });

    expect(raw.message_id).toBe("CAF-abc123@mail.example.test");
    expect(raw.from.email).toBe("buyer@example.test");
  });

  it("accepts a bare sender address with no display name", () => {
    const fields = mailgunFields();
    delete fields["from"];
    delete fields["message-headers"];
    fields["Message-Id"] = "<x@y>";

    const raw = mapMailgunInboundToRawEmail({ fields });

    expect(raw.from).toEqual({ email: "buyer@example.test", name: null });
  });

  it("carries attachment metadata with a provider-side placeholder ref", () => {
    const raw = mapMailgunInboundToRawEmail({
      fields: mailgunFields({ "attachment-count": "1" }),
      files: [
        {
          fieldname: "attachment-1",
          filename: "receipt.pdf",
          content_type: "application/pdf",
          size_bytes: 2048,
        },
      ],
    });

    expect(raw.attachments).toEqual([
      {
        filename: "receipt.pdf",
        content_type: "application/pdf",
        size_bytes: 2048,
        object_ref:
          "mailgun-attachment:CAF-abc123@mail.example.test:attachment-1",
      },
    ]);
  });

  it("produces a payload the neutral email adapter accepts end to end", () => {
    const raw = mapMailgunInboundToRawEmail({ fields: mailgunFields() });
    const message = parseInboundEmailMessage(raw, CONTEXT);

    expect(message).toMatchObject({
      channel: "email",
      direction: "inbound",
      external_message_id: "CAF-abc123@mail.example.test",
      customer_identity: { type: "email", value: "buyer@example.test" },
    });
    expect(message.body.text).toBe("Where is my order?");
  });

  it("throws when the message id cannot be derived", () => {
    const fields = mailgunFields();
    delete fields["Message-Id"];
    delete fields["message-headers"];

    expect(() => mapMailgunInboundToRawEmail({ fields })).toThrow(/Message-Id/);
  });

  it("throws when the timestamp is missing or not Unix seconds", () => {
    expect(() =>
      mapMailgunInboundToRawEmail({
        fields: mailgunFields({ timestamp: "not-a-number" }),
      }),
    ).toThrow(/timestamp/);
  });
});

describe("extractMailgunSignatureFields", () => {
  const triplet = {
    timestamp: "1751414400",
    token: "token-123",
    signature: "deadbeef",
  };

  it("reads the FLAT fields an inbound route posts", () => {
    expect(
      extractMailgunSignatureFields({ fields: mailgunFields(), files: [] }),
    ).toEqual(triplet);
  });

  it("reads the NESTED envelope an event/tracking webhook posts", () => {
    expect(
      extractMailgunSignatureFields({
        signature: triplet,
        "event-data": { event: "delivered" },
      }),
    ).toEqual(triplet);
  });

  it("reads a flat triplet posted as JSON", () => {
    expect(extractMailgunSignatureFields(triplet)).toEqual(triplet);
  });

  it("returns null when no triplet is present, so the caller fails closed", () => {
    expect(extractMailgunSignatureFields({ fields: {}, files: [] })).toBeNull();
    expect(extractMailgunSignatureFields({})).toBeNull();
    expect(extractMailgunSignatureFields(null)).toBeNull();
    expect(extractMailgunSignatureFields("nope")).toBeNull();
  });
});
