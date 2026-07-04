import {
  conversationByIdQuery,
  createDatabaseFromEnv,
  customerByIdQuery,
  messagesListQuery,
  tenantByIdQuery,
  withTenantTransaction,
} from "@support/db";
import type { AiRuntimeMessage } from "@support/shared-schemas";

/**
 * Conversation context the HTTP `runAiGraph` activity feeds to the Python AI
 * runtime sidecar (Milestone 14). The workflow input only carries ids; the
 * runtime needs the actual customer-visible message history plus customer and
 * tenant context, so the activity loads them here under RLS right before the
 * sidecar call. Message order is chronological (oldest first) because the
 * runtime treats the last customer message as the active ask.
 */
export interface AiGraphConversationContext {
  readonly messages: readonly AiRuntimeMessage[];
  readonly customer: {
    readonly customer_id: string | null;
    readonly email: string | null;
    readonly display_name: string | null;
    readonly tier: "standard" | "vip";
    readonly locale: string | null;
  };
  readonly tenant: {
    readonly brand_name: string;
    readonly timezone: string;
  } | null;
}

export interface AiGraphContextStore {
  loadConversationContext(params: {
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<AiGraphConversationContext | null>;
  close?(): Promise<void>;
}

/**
 * Upper bound on the history handed to the runtime. The runtime works from the
 * latest customer ask; older context beyond this window adds cost, not signal.
 */
const MAX_CONTEXT_MESSAGES = 100;

export function createDatabaseAiGraphContextStore(): AiGraphContextStore {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase() {
    database ??= createDatabaseFromEnv();
    return database;
  }

  return {
    async loadConversationContext({ tenantId, conversationId }) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const conversationRows = await conversationByIdQuery(
          db,
          scope,
          conversationId,
        );
        const conversation = conversationRows[0];

        if (!conversation) {
          return null;
        }

        const messageRows = await messagesListQuery(db, scope, conversationId, {
          limit: MAX_CONTEXT_MESSAGES,
        });
        // messagesListQuery returns newest-first; the runtime wants
        // chronological order.
        const messages = messageRows.reverse().map((row) => ({
          role: roleForDirection(row.direction),
          content: row.bodyText ?? "",
          is_internal: row.direction === "internal_note",
        }));

        const customerRows = conversation.customerId
          ? await customerByIdQuery(db, scope, conversation.customerId)
          : [];
        const customer = customerRows[0];

        const tenantRows = await tenantByIdQuery(db, scope, tenantId);
        const tenant = tenantRows[0];

        return {
          messages,
          customer: {
            customer_id: customer?.customerId ?? null,
            email: customer?.email ?? null,
            display_name: customer?.displayName ?? null,
            tier: customerTier(customer?.metadata ?? null),
            locale: null,
          },
          tenant: tenant
            ? { brand_name: tenant.name, timezone: tenant.defaultTimezone }
            : null,
        };
      });
    },

    async close() {
      await database?.client.end();
    },
  };
}

export function createInMemoryAiGraphContextStore(
  contexts: Readonly<Record<string, AiGraphConversationContext>> = {},
): AiGraphContextStore {
  return {
    async loadConversationContext({ tenantId, conversationId }) {
      return contexts[`${tenantId}:${conversationId}`] ?? null;
    },
  };
}

function roleForDirection(
  direction: "inbound" | "outbound" | "internal_note" | "system",
): AiRuntimeMessage["role"] {
  switch (direction) {
    case "inbound":
      return "customer";
    case "outbound":
    case "internal_note":
      return "agent";
    case "system":
      return "system";
  }
}

/**
 * VIP handling is metadata-driven until a first-class customer tier column
 * exists: `customers.metadata.tier === "vip"` marks the customer as VIP for
 * the runtime's policy node (VIP blocks auto-send, ADR-0016).
 */
function customerTier(
  metadata: Record<string, unknown> | null,
): "standard" | "vip" {
  return metadata?.["tier"] === "vip" ? "vip" : "standard";
}
