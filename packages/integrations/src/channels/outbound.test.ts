import { describe, expect, it, vi } from "vitest";
import type { NormalizedOutboundMessage } from "@support/shared-schemas";
import { buildOutboundEmailProviderRequest } from "./email-outbound-adapter.js";
import { buildOutboundWhatsAppProviderRequest } from "./whatsapp-outbound-adapter.js";
import {
  createHttpOutboundChannelSender,
  createRecordingOutboundChannelSender,
} from "./outbound-sender.js";

const emailMessage: NormalizedOutboundMessage = {
  tenant_id: "ten_test",
  conversation_id: "con_test",
  ticket_id: "tkt_con_test",
  channel_id: "chn_email",
  channel: "email",
  provider: "mailgun",
  to: {
    type: "email",
    value: "customer@example.com",
    display_name: "Customer Name",
  },
  direction: "outbound",
  subject: "Re: Where is my order?",
  body: {
    text: "Your order shipped yesterday.",
    html: "<p>Your order shipped yesterday.</p>",
  },
  external_thread_id: "<thread-1@example.com>",
  approval_id: "apr_test",
  ai_run_id: "run_test",
  sent_by_type: "human",
  sent_by_user_id: "usr_reviewer",
  idempotency_key: "outbound:ten_test:tkt_con_test:apr_test",
};

const whatsappMessage: NormalizedOutboundMessage = {
  ...emailMessage,
  channel_id: "chn_whatsapp",
  channel: "whatsapp",
  provider: "whatsapp_cloud",
  to: { type: "whatsapp_id", value: "15551234567", display_name: null },
  subject: null,
  body: { text: "Your order shipped yesterday.", html: null },
  external_thread_id: null,
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("email outbound adapter", () => {
  it("maps the normalized message onto the provider email request", () => {
    const request = buildOutboundEmailProviderRequest(emailMessage, {
      fromAddress: "support@tenant.example.com",
      fromName: "Tenant Support",
    });

    expect(request).toEqual({
      from: "Tenant Support <support@tenant.example.com>",
      to: "customer@example.com",
      subject: "Re: Where is my order?",
      text: "Your order shipped yesterday.",
      html: "<p>Your order shipped yesterday.</p>",
      in_reply_to: "<thread-1@example.com>",
      references: "<thread-1@example.com>",
    });
  });

  it("uses the bare from address when no display name is configured", () => {
    const request = buildOutboundEmailProviderRequest(
      { ...emailMessage, external_thread_id: null },
      { fromAddress: "support@tenant.example.com" },
    );

    expect(request.from).toBe("support@tenant.example.com");
    expect(request.in_reply_to).toBeNull();
    expect(request.references).toBeNull();
  });

  it("rejects non-email messages", () => {
    expect(() =>
      buildOutboundEmailProviderRequest(whatsappMessage, {
        fromAddress: "support@tenant.example.com",
      }),
    ).toThrow(/whatsapp/);
  });
});

describe("whatsapp outbound adapter", () => {
  it("maps the normalized message onto the Cloud API text request", () => {
    expect(buildOutboundWhatsAppProviderRequest(whatsappMessage)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "15551234567",
      type: "text",
      text: {
        preview_url: false,
        body: "Your order shipped yesterday.",
      },
    });
  });

  it("rejects non-whatsapp messages", () => {
    expect(() => buildOutboundWhatsAppProviderRequest(emailMessage)).toThrow(
      /email/,
    );
  });
});

describe("http outbound channel sender", () => {
  it("sends Mailgun email with basic auth, form encoding, and reply headers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { id: "<mailgun-msg-1>" }));
    const sender = createHttpOutboundChannelSender({ fetchImpl });

    const result = await sender.send({
      message: emailMessage,
      channelConfig: {
        sending_domain: "mg.tenant.example.com",
        from_address: "support@tenant.example.com",
        from_name: "Tenant Support",
      },
      credential: "mailgun-api-key",
    });

    expect(result).toEqual({
      status: "sent",
      provider_message_id: "<mailgun-msg-1>",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://api.mailgun.net/v3/mg.tenant.example.com/messages",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("api:mailgun-api-key").toString("base64")}`,
    );
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("from")).toBe(
      "Tenant Support <support@tenant.example.com>",
    );
    expect(body.get("to")).toBe("customer@example.com");
    expect(body.get("subject")).toBe("Re: Where is my order?");
    expect(body.get("h:In-Reply-To")).toBe("<thread-1@example.com>");
  });

  it("sends WhatsApp Cloud text messages with bearer auth", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(200, { messages: [{ id: "wamid.PROVIDER1" }] }),
      );
    const sender = createHttpOutboundChannelSender({ fetchImpl });

    const result = await sender.send({
      message: whatsappMessage,
      channelConfig: { phone_number_id: "1234567890" },
      credential: "whatsapp-token",
    });

    expect(result).toEqual({
      status: "sent",
      provider_message_id: "wamid.PROVIDER1",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v20.0/1234567890/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer whatsapp-token");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "15551234567",
    });
  });

  it("records provider HTTP failures with retryability by status class", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(500, { message: "upstream down" }))
      .mockResolvedValueOnce(jsonResponse(401, { message: "bad key" }));
    const sender = createHttpOutboundChannelSender({ fetchImpl });
    const config = {
      sending_domain: "mg.tenant.example.com",
      from_address: "support@tenant.example.com",
    };

    const serverError = await sender.send({
      message: emailMessage,
      channelConfig: config,
      credential: "mailgun-api-key",
    });
    const authError = await sender.send({
      message: emailMessage,
      channelConfig: config,
      credential: "mailgun-api-key",
    });

    expect(serverError).toMatchObject({
      status: "failed",
      error_code: "provider_http_500",
      retryable: true,
    });
    expect(authError).toMatchObject({
      status: "failed",
      error_code: "provider_http_401",
      retryable: false,
    });
  });

  it("fails without network calls when credential or config is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = createHttpOutboundChannelSender({ fetchImpl });

    const missingCredential = await sender.send({
      message: emailMessage,
      channelConfig: { sending_domain: "d", from_address: "a@b.c" },
      credential: null,
    });
    const missingConfig = await sender.send({
      message: emailMessage,
      channelConfig: {},
      credential: "key",
    });
    const unsupported = await sender.send({
      message: { ...emailMessage, provider: "unknown_provider" },
      channelConfig: {},
      credential: "key",
    });

    expect(missingCredential).toMatchObject({
      status: "failed",
      error_code: "credential_missing",
      retryable: false,
    });
    expect(missingConfig).toMatchObject({
      status: "failed",
      error_code: "channel_config_invalid",
      retryable: false,
    });
    expect(unsupported).toMatchObject({
      status: "failed",
      error_code: "unsupported_provider",
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps transport exceptions to retryable failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("socket hang up"));
    const sender = createHttpOutboundChannelSender({ fetchImpl });

    const result = await sender.send({
      message: whatsappMessage,
      channelConfig: { phone_number_id: "1234567890" },
      credential: "whatsapp-token",
    });

    expect(result).toMatchObject({
      status: "failed",
      error_code: "provider_transport_error",
      retryable: true,
    });
  });
});

describe("recording outbound channel sender", () => {
  it("captures sends and replays queued results before the default success", async () => {
    const sender = createRecordingOutboundChannelSender([
      {
        status: "failed",
        error_code: "provider_http_500",
        error_message: "boom",
        retryable: true,
      },
    ]);

    const first = await sender.send({
      message: emailMessage,
      channelConfig: {},
      credential: "key",
    });
    const second = await sender.send({
      message: emailMessage,
      channelConfig: {},
      credential: "key",
    });

    expect(first.status).toBe("failed");
    expect(second).toEqual({
      status: "sent",
      provider_message_id: "provider-out-2",
    });
    expect(sender.sends).toHaveLength(2);
  });
});
