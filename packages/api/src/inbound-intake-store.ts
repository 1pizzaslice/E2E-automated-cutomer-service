import { randomUUID } from "node:crypto";
import {
  channelByIdQuery,
  conversationByExternalThreadQuery,
  createConversationQuery,
  createCustomerIdentityQuery,
  createCustomerQuery,
  createDatabaseFromEnv,
  createInboundMessageQuery,
  customerIdentityByValueQuery,
  messageByExternalIdQuery,
  updateConversationLastMessageAtQuery,
  withTenantTransaction,
  type JsonArray,
  type PostgresClient,
} from "@support/db";
import type {
  ChannelType,
  CustomerIdentityType,
  NormalizedInboundChannel,
} from "@support/shared-schemas";

export interface InboundChannelRecord {
  readonly tenant_id: string;
  readonly channel_id: string;
  readonly type: ChannelType;
  readonly provider: string;
  readonly status: "active" | "paused" | "disabled";
  readonly config: Record<string, unknown>;
}

export interface InboundCustomerIdentityInput {
  readonly channel: NormalizedInboundChannel;
  readonly type: CustomerIdentityType;
  readonly value: string;
  readonly display_name: string | null;
}

export interface InboundCustomerResolution {
  readonly customer_id: string;
  readonly created: boolean;
}

export interface InboundConversationResolution {
  readonly conversation_id: string;
  readonly created: boolean;
}

export interface InboundMessageInsert {
  readonly messageId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly bodyText: string | null;
  readonly bodyHtmlRef: string | null;
  readonly attachments: JsonArray;
  readonly externalMessageId: string;
  readonly externalThreadId: string | null;
  readonly rawPayloadRef: string;
  readonly idempotencyKey: string;
}

export interface InboundExistingMessage {
  readonly message_id: string;
  readonly conversation_id: string;
}

/**
 * Persistence boundary for inbound intake. The DB-backed implementation runs
 * tenant-scoped writes under row-level security; the in-memory implementation
 * faithfully mirrors the dedup and threading semantics for unit tests.
 */
export interface InboundIntakeStore {
  /** Resolve a channel by id without tenant scope (pre-tenant webhook read). */
  getChannelById(channelId: string): Promise<InboundChannelRecord | null>;
  findMessageByExternalId(
    tenantId: string,
    channelId: string,
    externalMessageId: string,
  ): Promise<InboundExistingMessage | null>;
  resolveCustomer(
    tenantId: string,
    identity: InboundCustomerIdentityInput,
  ): Promise<InboundCustomerResolution>;
  resolveConversation(
    tenantId: string,
    params: {
      readonly channelId: string;
      readonly customerId: string;
      readonly externalThreadId: string | null;
    },
  ): Promise<InboundConversationResolution>;
  /** Insert an inbound message; returns false when a duplicate already exists. */
  insertMessage(
    tenantId: string,
    values: InboundMessageInsert,
  ): Promise<{ inserted: boolean }>;
  touchConversation(
    tenantId: string,
    conversationId: string,
    lastMessageAt: string,
  ): Promise<void>;
  close?(): Promise<void>;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function identityToCustomerFields(identity: InboundCustomerIdentityInput): {
  displayName: string | null;
  email: string | null;
  phone: string | null;
} {
  return {
    displayName: identity.display_name,
    email: identity.type === "email" ? identity.value : null,
    phone: identity.type === "phone" ? identity.value : null,
  };
}

/**
 * PostgreSQL-backed inbound intake store. Channel resolution runs on the
 * owner/service connection (RLS is enabled but not forced) because tenant
 * context is not known until the channel is resolved; all subsequent writes run
 * under `withTenantTransaction`, which sets the `support_app` role and the
 * transaction-local tenant id enforced by row-level security.
 */
export function createDatabaseInboundIntakeStore(
  database?: ReturnType<typeof createDatabaseFromEnv>,
): InboundIntakeStore {
  let handle = database;

  function getDatabase(): ReturnType<typeof createDatabaseFromEnv> {
    if (!handle) {
      handle = createDatabaseFromEnv();
    }

    return handle;
  }

  function getClient(): PostgresClient {
    return getDatabase().client;
  }

  return {
    async getChannelById(channelId) {
      const [channel] = await channelByIdQuery(getDatabase().db, channelId);

      if (!channel) {
        return null;
      }

      return {
        tenant_id: channel.tenantId,
        channel_id: channel.channelId,
        type: channel.type,
        provider: channel.provider,
        status: channel.status,
        config: channel.config,
      };
    },
    async findMessageByExternalId(tenantId, channelId, externalMessageId) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const [message] = await messageByExternalIdQuery(
            scoped,
            { tenantId },
            channelId,
            externalMessageId,
          );

          return message
            ? {
                message_id: message.messageId,
                conversation_id: message.conversationId,
              }
            : null;
        },
      );
    },
    async resolveCustomer(tenantId, identity) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const [existing] = await customerIdentityByValueQuery(
            scoped,
            { tenantId },
            {
              channel: identity.channel,
              identityType: identity.type,
              identityValue: identity.value,
            },
          );

          if (existing) {
            return { customer_id: existing.customerId, created: false };
          }

          const customerId = createId("cus");
          await createCustomerQuery(
            scoped,
            { tenantId },
            {
              customerId,
              ...identityToCustomerFields(identity),
            },
          );
          const inserted = await createCustomerIdentityQuery(
            scoped,
            { tenantId },
            {
              customerIdentityId: createId("cid"),
              customerId,
              channel: identity.channel,
              identityType: identity.type,
              identityValue: identity.value,
            },
          );

          // A concurrent intake may have created the identity first; re-resolve so
          // both inbound messages attach to the same customer.
          if (inserted.length === 0) {
            const [raced] = await customerIdentityByValueQuery(
              scoped,
              { tenantId },
              {
                channel: identity.channel,
                identityType: identity.type,
                identityValue: identity.value,
              },
            );

            if (raced) {
              return { customer_id: raced.customerId, created: false };
            }
          }

          return { customer_id: customerId, created: true };
        },
      );
    },
    async resolveConversation(tenantId, params) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          if (params.externalThreadId !== null) {
            const [existing] = await conversationByExternalThreadQuery(
              scoped,
              { tenantId },
              params.channelId,
              params.externalThreadId,
            );

            if (existing) {
              return {
                conversation_id: existing.conversationId,
                created: false,
              };
            }
          }

          const conversationId = createId("cnv");
          const inserted = await createConversationQuery(
            scoped,
            { tenantId },
            {
              conversationId,
              customerId: params.customerId,
              channelId: params.channelId,
              externalThreadId: params.externalThreadId,
            },
          );

          if (inserted.length === 0 && params.externalThreadId !== null) {
            const [raced] = await conversationByExternalThreadQuery(
              scoped,
              { tenantId },
              params.channelId,
              params.externalThreadId,
            );

            if (raced) {
              return { conversation_id: raced.conversationId, created: false };
            }
          }

          return { conversation_id: conversationId, created: true };
        },
      );
    },
    async insertMessage(tenantId, values) {
      return withTenantTransaction(
        getClient(),
        { tenantId },
        async (scoped) => {
          const inserted = await createInboundMessageQuery(
            scoped,
            { tenantId },
            {
              messageId: values.messageId,
              conversationId: values.conversationId,
              channelId: values.channelId,
              direction: "inbound",
              createdByType: "customer",
              bodyText: values.bodyText,
              bodyHtmlRef: values.bodyHtmlRef,
              attachments: values.attachments,
              externalMessageId: values.externalMessageId,
              externalThreadId: values.externalThreadId,
              rawPayloadRef: values.rawPayloadRef,
              idempotencyKey: values.idempotencyKey,
            },
          );

          return { inserted: inserted.length > 0 };
        },
      );
    },
    async touchConversation(tenantId, conversationId, lastMessageAt) {
      await withTenantTransaction(getClient(), { tenantId }, async (scoped) => {
        await updateConversationLastMessageAtQuery(
          scoped,
          { tenantId },
          conversationId,
          new Date(lastMessageAt),
        );
      });
    },
    async close() {
      if (handle) {
        await handle.client.end();
      }
    },
  };
}

interface InMemoryMessageRecord {
  readonly tenantId: string;
  readonly channelId: string;
  readonly externalMessageId: string;
  readonly idempotencyKey: string;
  readonly messageId: string;
  readonly conversationId: string;
}

/**
 * In-memory inbound intake store for unit tests. Mirrors the production dedup
 * (external message id + idempotency key) and threading (external thread id)
 * semantics so intake orchestration can be verified without PostgreSQL.
 */
export function createInMemoryInboundIntakeStore(
  channels: readonly InboundChannelRecord[] = [],
): InboundIntakeStore & {
  readonly channels: Map<string, InboundChannelRecord>;
  readonly messages: InMemoryMessageRecord[];
} {
  const channelMap = new Map<string, InboundChannelRecord>(
    channels.map((channel) => [channel.channel_id, channel]),
  );
  const identities = new Map<string, string>();
  const conversations = new Map<string, string>();
  const messages: InMemoryMessageRecord[] = [];
  let sequence = 0;

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}_mem_${sequence}`;
  }

  function identityKey(
    tenantId: string,
    identity: InboundCustomerIdentityInput,
  ): string {
    return [tenantId, identity.channel, identity.type, identity.value].join(
      "::",
    );
  }

  function threadKey(
    tenantId: string,
    channelId: string,
    externalThreadId: string,
  ): string {
    return [tenantId, channelId, externalThreadId].join("::");
  }

  return {
    channels: channelMap,
    messages,
    async getChannelById(channelId) {
      return channelMap.get(channelId) ?? null;
    },
    async findMessageByExternalId(tenantId, channelId, externalMessageId) {
      const found = messages.find(
        (message) =>
          message.tenantId === tenantId &&
          message.channelId === channelId &&
          message.externalMessageId === externalMessageId,
      );

      return found
        ? { message_id: found.messageId, conversation_id: found.conversationId }
        : null;
    },
    async resolveCustomer(tenantId, identity) {
      const key = identityKey(tenantId, identity);
      const existing = identities.get(key);

      if (existing) {
        return { customer_id: existing, created: false };
      }

      const customerId = nextId("cus");
      identities.set(key, customerId);
      return { customer_id: customerId, created: true };
    },
    async resolveConversation(tenantId, params) {
      if (params.externalThreadId !== null) {
        const key = threadKey(
          tenantId,
          params.channelId,
          params.externalThreadId,
        );
        const existing = conversations.get(key);

        if (existing) {
          return { conversation_id: existing, created: false };
        }

        const conversationId = nextId("cnv");
        conversations.set(key, conversationId);
        return { conversation_id: conversationId, created: true };
      }

      return { conversation_id: nextId("cnv"), created: true };
    },
    async insertMessage(tenantId, values) {
      const duplicate = messages.some(
        (message) =>
          message.tenantId === tenantId &&
          ((message.channelId === values.channelId &&
            message.externalMessageId === values.externalMessageId) ||
            message.idempotencyKey === values.idempotencyKey),
      );

      if (duplicate) {
        return { inserted: false };
      }

      messages.push({
        tenantId,
        channelId: values.channelId,
        externalMessageId: values.externalMessageId,
        idempotencyKey: values.idempotencyKey,
        messageId: values.messageId,
        conversationId: values.conversationId,
      });
      return { inserted: true };
    },
    async touchConversation() {
      // No-op for the in-memory store.
    },
  };
}
