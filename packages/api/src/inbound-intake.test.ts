import { describe, expect, it } from "vitest";
import {
  NormalizedInboundMessageSchema,
  type NormalizedInboundMessage,
} from "@support/shared-schemas";
import {
  createInboundIntakeService,
  type WebhookSecretResolver,
} from "./inbound-intake.js";
import {
  createInMemoryInboundIntakeStore,
  type InboundChannelRecord,
} from "./inbound-intake-store.js";
import { createRecordingInboundWorkflowLauncher } from "./inbound-workflow-launcher.js";

const TENANT_ID = "ten_intake";
const CHANNEL_ID = "chn_intake";

const channel: InboundChannelRecord = {
  tenant_id: TENANT_ID,
  channel_id: CHANNEL_ID,
  type: "email",
  provider: "mailgun",
  status: "active",
  config: { signature_secret_ref: "WEBHOOK_SECRET_REF" },
};

const fixedSecretResolver: WebhookSecretResolver = {
  async resolve() {
    return "resolved-secret";
  },
};

function makeMessage(
  overrides: Partial<NormalizedInboundMessage> = {},
): NormalizedInboundMessage {
  return NormalizedInboundMessageSchema.parse({
    tenant_id: TENANT_ID,
    channel_id: CHANNEL_ID,
    channel: "email",
    provider: "mailgun",
    external_thread_id: "thread-1",
    external_message_id: "provider-msg-1",
    customer_identity: {
      type: "email",
      value: "customer@example.test",
      display_name: "Test Customer",
    },
    direction: "inbound",
    body: { text: "Where is my order?", html: null },
    attachments: [],
    raw_payload_ref: "memory://raw/1",
    received_at: "2026-07-02T00:00:00.000Z",
    idempotency_key: "provider-msg-1",
    ...overrides,
  });
}

function makeService(channels: InboundChannelRecord[] = [channel]) {
  const store = createInMemoryInboundIntakeStore(channels);
  const launcher = createRecordingInboundWorkflowLauncher();
  const intake = createInboundIntakeService({
    store,
    launcher,
    secretResolver: fixedSecretResolver,
  });

  return { store, launcher, intake };
}

describe("inbound intake channel resolution", () => {
  it("resolves an active channel and its signing secret", async () => {
    const { intake } = makeService();

    const resolution = await intake.resolveChannel({
      channelType: "email",
      provider: "mailgun",
      channelId: CHANNEL_ID,
    });

    expect(resolution).toEqual({
      tenant_id: TENANT_ID,
      channel_id: CHANNEL_ID,
      channel_type: "email",
      provider: "mailgun",
      signing_secret: "resolved-secret",
      // The email channel declares no `verify_token_ref`; only the WhatsApp
      // subscription handshake needs one.
      verify_token: null,
    });
  });

  it("resolves a verify token when the channel declares one", async () => {
    const { intake } = makeService([
      {
        tenant_id: TENANT_ID,
        channel_id: "chn_wa",
        type: "whatsapp",
        provider: "cloud",
        status: "active",
        config: {
          signature_secret_ref: "WEBHOOK_SECRET_REF",
          verify_token_ref: "WHATSAPP_VERIFY_TOKEN_REF",
        },
      },
    ]);

    const resolution = await intake.resolveChannel({
      channelType: "whatsapp",
      provider: "cloud",
      channelId: "chn_wa",
    });

    expect(resolution?.verify_token).toBe("resolved-secret");
  });

  it("returns null for unknown, mismatched, or inactive channels", async () => {
    const { intake } = makeService([{ ...channel, status: "disabled" }]);

    expect(
      await intake.resolveChannel({
        channelType: "email",
        provider: "mailgun",
        channelId: "chn_missing",
      }),
    ).toBeNull();
    expect(
      await intake.resolveChannel({
        channelType: "whatsapp",
        provider: "mailgun",
        channelId: CHANNEL_ID,
      }),
    ).toBeNull();
    expect(
      await intake.resolveChannel({
        channelType: "email",
        provider: "sendgrid",
        channelId: CHANNEL_ID,
      }),
    ).toBeNull();
    expect(
      await intake.resolveChannel({
        channelType: "email",
        provider: "mailgun",
        channelId: CHANNEL_ID,
      }),
    ).toBeNull();
  });
});

describe("inbound intake persistence and workflow wiring", () => {
  it("persists a new message, threads a conversation, and starts the workflow", async () => {
    const { intake, launcher, store } = makeService();

    const result = await intake.ingestNormalizedMessage(makeMessage());

    expect(result.deduplicated).toBe(false);
    expect(result.customer_id).not.toBeNull();
    expect(result.workflow?.workflow_id).toBe(
      `ticket-lifecycle:${TENANT_ID}:${result.conversation_id}`,
    );
    expect(result.ticket_id).toBe(`tkt_${result.conversation_id}`);
    expect(store.messages).toHaveLength(1);
    expect(launcher.calls).toHaveLength(1);

    const call = launcher.calls[0]!;
    expect(call.input).toMatchObject({
      tenant_id: TENANT_ID,
      ticket_id: result.ticket_id,
      initial_message_id: result.message_id,
      correlation_id: "provider-msg-1",
    });
    expect(call.signal).toMatchObject({
      message_id: result.message_id,
      conversation_id: result.conversation_id,
      channel_id: CHANNEL_ID,
      external_message_id: "provider-msg-1",
      external_thread_id: "thread-1",
    });
  });

  it("deduplicates a repeated provider event by external_message_id", async () => {
    const { intake, launcher, store } = makeService();

    const first = await intake.ingestNormalizedMessage(makeMessage());
    const second = await intake.ingestNormalizedMessage(makeMessage());

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.message_id).toBe(first.message_id);
    expect(second.conversation_id).toBe(first.conversation_id);
    expect(second.workflow).toBeNull();
    expect(store.messages).toHaveLength(1);
    expect(launcher.calls).toHaveLength(1);
  });

  it("threads replies with the same external_thread_id into one conversation", async () => {
    const { intake, launcher } = makeService();

    const first = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-1",
        idempotency_key: "provider-msg-1",
      }),
    );
    const reply = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-2",
        idempotency_key: "provider-msg-2",
      }),
    );

    expect(reply.deduplicated).toBe(false);
    expect(reply.conversation_id).toBe(first.conversation_id);
    expect(launcher.calls).toHaveLength(2);
    // Both deliveries target the same per-conversation workflow id.
    expect(launcher.calls[0]!.workflowId).toBe(launcher.calls[1]!.workflowId);
  });

  it("creates separate conversations for different threads", async () => {
    const { intake } = makeService();

    const first = await intake.ingestNormalizedMessage(
      makeMessage({
        external_thread_id: "thread-1",
        external_message_id: "provider-msg-1",
        idempotency_key: "provider-msg-1",
      }),
    );
    const second = await intake.ingestNormalizedMessage(
      makeMessage({
        external_thread_id: "thread-2",
        external_message_id: "provider-msg-2",
        idempotency_key: "provider-msg-2",
      }),
    );

    expect(second.conversation_id).not.toBe(first.conversation_id);
  });

  it("reuses the same customer across messages from one identity", async () => {
    const { intake } = makeService();

    const first = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-1",
        idempotency_key: "provider-msg-1",
      }),
    );
    const second = await intake.ingestNormalizedMessage(
      makeMessage({
        external_thread_id: "thread-2",
        external_message_id: "provider-msg-2",
        idempotency_key: "provider-msg-2",
      }),
    );

    expect(second.customer_id).toBe(first.customer_id);
  });
});

describe("inbound intake attachment validation", () => {
  const oversized = {
    filename: "huge.pdf",
    content_type: "application/pdf",
    size_bytes: 11 * 1024 * 1024,
    object_ref: "memory://raw/attachments/huge.pdf",
  };

  const executable = {
    filename: "invoice.exe",
    content_type: "application/x-msdownload",
    size_bytes: 1024,
    object_ref: "memory://raw/attachments/invoice.exe",
  };

  it("rejects oversized attachments before any persistence or workflow signal", async () => {
    const { store, launcher, intake } = makeService();

    const result = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-oversized",
        idempotency_key: "provider-msg-oversized",
        attachments: [oversized],
      }),
    );

    expect(result.rejected).toBe(true);
    expect(result.rejection_reason).toBe("attachment_too_large");
    expect(result.message_id).toBe("");
    expect(result.workflow).toBeNull();
    expect(store.messages).toHaveLength(0);
    expect(launcher.calls).toHaveLength(0);
  });

  it("rejects disallowed attachment types", async () => {
    const { intake } = makeService();

    const result = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-exe",
        idempotency_key: "provider-msg-exe",
        attachments: [executable],
      }),
    );

    expect(result.rejected).toBe(true);
    expect(result.rejection_reason).toBe("attachment_type_not_allowed");
  });

  it("accepts allowed attachments and ingests normally", async () => {
    const { intake } = makeService();

    const result = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-pdf",
        idempotency_key: "provider-msg-pdf",
        attachments: [
          {
            filename: "receipt.pdf",
            content_type: "application/pdf",
            size_bytes: 100_000,
            object_ref: "memory://raw/attachments/receipt.pdf",
          },
        ],
      }),
    );

    expect(result.rejected).toBe(false);
    expect(result.rejection_reason).toBeNull();
    expect(result.deduplicated).toBe(false);
    expect(result.message_id).not.toBe("");
  });

  it("honors an injected attachment policy", async () => {
    const store = createInMemoryInboundIntakeStore([channel]);
    const launcher = createRecordingInboundWorkflowLauncher();
    const intake = createInboundIntakeService({
      store,
      launcher,
      secretResolver: fixedSecretResolver,
      attachmentPolicy: {
        maxSizeBytes: 1024,
        allowedContentTypes: ["application/pdf"],
        maxAttachmentsPerMessage: 1,
      },
    });

    const result = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: "provider-msg-policy",
        idempotency_key: "provider-msg-policy",
        attachments: [
          {
            filename: "receipt.pdf",
            content_type: "application/pdf",
            size_bytes: 4096,
            object_ref: "memory://raw/attachments/receipt.pdf",
          },
        ],
      }),
    );

    expect(result.rejected).toBe(true);
    expect(result.rejection_reason).toBe("attachment_too_large");
  });
});
