import { randomUUID } from "node:crypto";
import type { JsonArray } from "@support/db";
import {
  createEnvSecretResolver,
  validateInboundAttachments,
  type AttachmentValidationPolicy,
} from "@support/integrations";
import type {
  NormalizedInboundChannel,
  NormalizedInboundMessage,
} from "@support/shared-schemas";
import {
  TICKET_LIFECYCLE_TASK_QUEUE,
  type DeliverInboundMessageResult,
  type InboundWorkflowLauncher,
} from "./inbound-workflow-launcher.js";
import type {
  InboundChannelRecord,
  InboundIntakeStore,
} from "./inbound-intake-store.js";

/**
 * Resolves a per-channel webhook signing secret from an opaque reference. The
 * default reads the reference from the environment through the shared
 * validating secret resolver so secrets stay out of the channel config row
 * (see BACKEND_SPEC §4.1: reference by key, never plaintext) and malformed
 * references never touch process state.
 */
export interface WebhookSecretResolver {
  resolve(ref: string): Promise<string | null>;
}

export function createEnvWebhookSecretResolver(
  env: NodeJS.ProcessEnv = process.env,
): WebhookSecretResolver {
  return createEnvSecretResolver(env);
}

export interface ResolveInboundChannelParams {
  readonly channelType: NormalizedInboundChannel;
  readonly provider: string;
  readonly channelId: string;
}

export interface InboundChannelResolution {
  readonly tenant_id: string;
  readonly channel_id: string;
  readonly channel_type: NormalizedInboundChannel;
  readonly provider: string;
  readonly signing_secret: string | null;
}

export interface InboundIngestResult {
  readonly deduplicated: boolean;
  readonly rejected: boolean;
  readonly rejection_reason: string | null;
  readonly message_id: string;
  readonly conversation_id: string;
  readonly customer_id: string | null;
  readonly ticket_id: string;
  readonly workflow: DeliverInboundMessageResult | null;
}

export interface InboundIntakeService {
  resolveChannel(
    params: ResolveInboundChannelParams,
  ): Promise<InboundChannelResolution | null>;
  ingestNormalizedMessage(
    message: NormalizedInboundMessage,
  ): Promise<InboundIngestResult>;
  close?(): Promise<void>;
}

export interface InboundIntakeServiceDeps {
  readonly store: InboundIntakeStore;
  readonly launcher: InboundWorkflowLauncher;
  readonly secretResolver?: WebhookSecretResolver;
  readonly taskQueue?: string;
  readonly attachmentPolicy?: AttachmentValidationPolicy;
}

function readSecretRef(config: InboundChannelRecord["config"]): string | null {
  const ref = config["signature_secret_ref"];
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

/**
 * Deterministic ticket id for a conversation. Milestone 6 models one lifecycle
 * workflow per conversation, so the ticket id is derived from the conversation
 * id; the durable `ticketLifecycleWorkflow` upserts the ticket by this id. This
 * is a placeholder simplification (a conversation may accrue multiple tickets
 * over time) to be revisited when the full ticketing milestone lands.
 */
function ticketIdForConversation(conversationId: string): string {
  return `tkt_${conversationId}`;
}

function workflowIdForConversation(
  tenantId: string,
  conversationId: string,
): string {
  return `ticket-lifecycle:${tenantId}:${conversationId}`;
}

export function createInboundIntakeService(
  deps: InboundIntakeServiceDeps,
): InboundIntakeService {
  const secretResolver =
    deps.secretResolver ?? createEnvWebhookSecretResolver();
  const taskQueue = deps.taskQueue ?? TICKET_LIFECYCLE_TASK_QUEUE;

  return {
    async resolveChannel(params) {
      const channel = await deps.store.getChannelById(params.channelId);

      if (
        !channel ||
        channel.status !== "active" ||
        channel.type !== params.channelType ||
        channel.provider !== params.provider
      ) {
        return null;
      }

      const secretRef = readSecretRef(channel.config);
      const signingSecret = secretRef
        ? await secretResolver.resolve(secretRef)
        : null;

      return {
        tenant_id: channel.tenant_id,
        channel_id: channel.channel_id,
        channel_type: params.channelType,
        provider: channel.provider,
        signing_secret: signingSecret,
      };
    },
    async ingestNormalizedMessage(message) {
      const tenantId = message.tenant_id;
      const channelId = message.channel_id;

      // Attachment size/type validation runs before any persistence so a
      // rejected message never creates customers, conversations, or workflow
      // signals (PLAN §13).
      const attachmentCheck = validateInboundAttachments(
        message.attachments,
        deps.attachmentPolicy,
      );
      if (!attachmentCheck.valid) {
        return {
          deduplicated: false,
          rejected: true,
          rejection_reason: attachmentCheck.reasonCode,
          message_id: "",
          conversation_id: "",
          customer_id: null,
          ticket_id: "",
          workflow: null,
        };
      }

      const existing = await deps.store.findMessageByExternalId(
        tenantId,
        channelId,
        message.external_message_id,
      );

      if (existing) {
        return {
          deduplicated: true,
          rejected: false,
          rejection_reason: null,
          message_id: existing.message_id,
          conversation_id: existing.conversation_id,
          customer_id: null,
          ticket_id: ticketIdForConversation(existing.conversation_id),
          workflow: null,
        };
      }

      const customer = await deps.store.resolveCustomer(tenantId, {
        channel: message.channel,
        type: message.customer_identity.type,
        value: message.customer_identity.value,
        display_name: message.customer_identity.display_name ?? null,
      });

      const conversation = await deps.store.resolveConversation(tenantId, {
        channelId,
        customerId: customer.customer_id,
        externalThreadId: message.external_thread_id,
      });

      const messageId = `msg_${randomUUID()}`;
      const insert = await deps.store.insertMessage(tenantId, {
        messageId,
        conversationId: conversation.conversation_id,
        channelId,
        bodyText: message.body.text,
        // HTML is retained in the raw payload; a sanitized body_html_ref is a
        // later Milestone 6 slice, so it stays null here.
        bodyHtmlRef: null,
        attachments: message.attachments as unknown as JsonArray,
        externalMessageId: message.external_message_id,
        externalThreadId: message.external_thread_id,
        rawPayloadRef: message.raw_payload_ref,
        idempotencyKey: message.idempotency_key,
      });

      if (!insert.inserted) {
        // Lost an insert race with a concurrent delivery of the same provider
        // event; resolve to the persisted message and do not signal again.
        const raced = await deps.store.findMessageByExternalId(
          tenantId,
          channelId,
          message.external_message_id,
        );

        return {
          deduplicated: true,
          rejected: false,
          rejection_reason: null,
          message_id: raced?.message_id ?? messageId,
          conversation_id:
            raced?.conversation_id ?? conversation.conversation_id,
          customer_id: customer.customer_id,
          ticket_id: ticketIdForConversation(
            raced?.conversation_id ?? conversation.conversation_id,
          ),
          workflow: null,
        };
      }

      await deps.store.touchConversation(
        tenantId,
        conversation.conversation_id,
        message.received_at,
      );

      const ticketId = ticketIdForConversation(conversation.conversation_id);
      const workflow = await deps.launcher.deliverInboundMessage({
        workflowId: workflowIdForConversation(
          tenantId,
          conversation.conversation_id,
        ),
        taskQueue,
        input: {
          tenant_id: tenantId,
          ticket_id: ticketId,
          initial_message_id: messageId,
          correlation_id: message.idempotency_key,
        },
        signal: {
          message_id: messageId,
          conversation_id: conversation.conversation_id,
          channel_id: channelId,
          received_at: message.received_at,
          external_message_id: message.external_message_id,
          external_thread_id: message.external_thread_id,
          idempotency_key: message.idempotency_key,
        },
      });

      return {
        deduplicated: false,
        rejected: false,
        rejection_reason: null,
        message_id: messageId,
        conversation_id: conversation.conversation_id,
        customer_id: customer.customer_id,
        ticket_id: ticketId,
        workflow,
      };
    },
    async close() {
      await deps.store.close?.();
      await deps.launcher.close?.();
    },
  };
}
