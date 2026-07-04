import { createHash } from "node:crypto";
import {
  clearMessageRawPayloadRefsQuery,
  createAuditEventQuery,
  createDatabaseFromEnv,
  expiredAiRunsCountQuery,
  expiredAttachmentMessagesCountQuery,
  expiredRawPayloadMessagesQuery,
  tenantByIdQuery,
  withTenantTransaction,
} from "@support/db";
import {
  TenantRetentionPolicySchema,
  type TenantRetentionPolicy,
} from "@support/shared-schemas";

/**
 * Data retention policy hooks (Milestone 12, BACKEND_SPEC section 22). The
 * job reads the tenant's `retention_policy`, computes cutoffs, and applies
 * the safe subset: clearing expired `messages.raw_payload_ref` references in
 * bounded batches (the cleared refs are returned so an operator or storage
 * sweeper can delete the underlying blobs). Attachment metadata and AI-run
 * traces are counted and reported as planned-but-not-executed placeholders —
 * purging them waits on the blob-deletion and anonymization strategies.
 * Every applied run appends a `retention.applied` audit event. Missing or
 * malformed retention configuration fails closed: nothing is purged.
 */
export interface RetentionCutoffs {
  readonly rawPayloadCutoff: Date | null;
  readonly attachmentCutoff: Date | null;
  readonly aiRunCutoff: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRetentionCutoffs(
  policy: TenantRetentionPolicy,
  now: Date,
): RetentionCutoffs {
  const cutoff = (days: number | null | undefined): Date | null =>
    typeof days === "number" ? new Date(now.getTime() - days * DAY_MS) : null;

  return {
    rawPayloadCutoff: cutoff(policy.raw_payload_days),
    attachmentCutoff: cutoff(policy.attachment_days),
    aiRunCutoff: cutoff(policy.ai_run_days),
  };
}

export interface ExpiredRawPayloadMessage {
  readonly messageId: string;
  readonly rawPayloadRef: string | null;
}

export interface RetentionStore {
  getTenantRetentionPolicy(
    tenantId: string,
  ): Promise<TenantRetentionPolicy | null>;
  listExpiredRawPayloadMessages(
    tenantId: string,
    cutoff: Date,
    limit: number,
  ): Promise<readonly ExpiredRawPayloadMessage[]>;
  clearRawPayloadRefs(
    tenantId: string,
    messageIds: readonly string[],
  ): Promise<number>;
  countExpiredAttachmentMessages(
    tenantId: string,
    cutoff: Date,
  ): Promise<number>;
  countExpiredAiRuns(tenantId: string, cutoff: Date): Promise<number>;
  recordRetentionAudit(
    tenantId: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
  close?(): Promise<void>;
}

export interface RetentionJobLogger {
  info(message: string, fields?: Record<string, unknown>): void;
}

export interface RetentionJobDeps {
  readonly store: RetentionStore;
  readonly now?: () => Date;
  readonly logger?: RetentionJobLogger;
}

export interface RetentionJobOptions {
  readonly tenantId: string;
  readonly batchLimit?: number;
}

export interface TenantRetentionResult {
  readonly tenantId: string;
  readonly applied: boolean;
  readonly rawPayloadsCleared: number;
  readonly clearedRawPayloadRefs: readonly string[];
  readonly plannedAttachmentMessages: number;
  readonly plannedAiRuns: number;
  readonly skippedReason: "tenant_not_found" | "no_retention_configured" | null;
}

const DEFAULT_BATCH_LIMIT = 500;

function sha24(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 24);
}

export async function runTenantRetentionJob(
  deps: RetentionJobDeps,
  options: RetentionJobOptions,
): Promise<TenantRetentionResult> {
  const now = deps.now ? deps.now() : new Date();
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const tenantId = options.tenantId;

  const policy = await deps.store.getTenantRetentionPolicy(tenantId);

  if (policy === null) {
    return {
      tenantId,
      applied: false,
      rawPayloadsCleared: 0,
      clearedRawPayloadRefs: [],
      plannedAttachmentMessages: 0,
      plannedAiRuns: 0,
      skippedReason: "tenant_not_found",
    };
  }

  const cutoffs = computeRetentionCutoffs(policy, now);

  if (
    cutoffs.rawPayloadCutoff === null &&
    cutoffs.attachmentCutoff === null &&
    cutoffs.aiRunCutoff === null
  ) {
    return {
      tenantId,
      applied: false,
      rawPayloadsCleared: 0,
      clearedRawPayloadRefs: [],
      plannedAttachmentMessages: 0,
      plannedAiRuns: 0,
      skippedReason: "no_retention_configured",
    };
  }

  let clearedRefs: string[] = [];
  if (cutoffs.rawPayloadCutoff) {
    const expired = await deps.store.listExpiredRawPayloadMessages(
      tenantId,
      cutoffs.rawPayloadCutoff,
      batchLimit,
    );

    if (expired.length > 0) {
      await deps.store.clearRawPayloadRefs(
        tenantId,
        expired.map((message) => message.messageId),
      );
      clearedRefs = expired.flatMap((message) =>
        message.rawPayloadRef ? [message.rawPayloadRef] : [],
      );
    }
  }

  const plannedAttachmentMessages = cutoffs.attachmentCutoff
    ? await deps.store.countExpiredAttachmentMessages(
        tenantId,
        cutoffs.attachmentCutoff,
      )
    : 0;
  const plannedAiRuns = cutoffs.aiRunCutoff
    ? await deps.store.countExpiredAiRuns(tenantId, cutoffs.aiRunCutoff)
    : 0;

  if (clearedRefs.length > 0) {
    await deps.store.recordRetentionAudit(tenantId, {
      raw_payloads_cleared: clearedRefs.length,
      raw_payload_cutoff: cutoffs.rawPayloadCutoff?.toISOString() ?? null,
      planned_attachment_messages: plannedAttachmentMessages,
      planned_ai_runs: plannedAiRuns,
    });
  }

  deps.logger?.info("retention job completed", {
    tenant_id: tenantId,
    raw_payloads_cleared: clearedRefs.length,
    planned_attachment_messages: plannedAttachmentMessages,
    planned_ai_runs: plannedAiRuns,
  });

  return {
    tenantId,
    applied: clearedRefs.length > 0,
    rawPayloadsCleared: clearedRefs.length,
    clearedRawPayloadRefs: clearedRefs,
    plannedAttachmentMessages,
    plannedAiRuns,
    skippedReason: null,
  };
}

/**
 * Database-backed retention store. Reads and writes run under
 * `withTenantTransaction`/RLS; a missing or malformed `retention_policy`
 * resolves to "nothing configured" so misconfiguration can never purge data.
 */
export function createDatabaseRetentionStore(): RetentionStore {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase() {
    database ??= createDatabaseFromEnv();
    return database;
  }

  return {
    async getTenantRetentionPolicy(tenantId) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await tenantByIdQuery(db, scope, tenantId);
        const tenant = rows[0];

        if (!tenant) {
          return null;
        }

        const parsed = TenantRetentionPolicySchema.safeParse(
          tenant.retentionPolicy,
        );
        return parsed.success ? parsed.data : {};
      });
    },

    async listExpiredRawPayloadMessages(tenantId, cutoff, limit) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await expiredRawPayloadMessagesQuery(db, scope, {
          cutoff,
          limit,
        });

        return rows.map((row) => ({
          messageId: row.messageId,
          rawPayloadRef: row.rawPayloadRef,
        }));
      });
    },

    async clearRawPayloadRefs(tenantId, messageIds) {
      if (messageIds.length === 0) {
        return 0;
      }

      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await clearMessageRawPayloadRefsQuery(
          db,
          scope,
          messageIds,
        );
        return rows.length;
      });
    },

    async countExpiredAttachmentMessages(tenantId, cutoff) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await expiredAttachmentMessagesCountQuery(
          db,
          scope,
          cutoff,
        );
        return rows[0]?.count ?? 0;
      });
    },

    async countExpiredAiRuns(tenantId, cutoff) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await expiredAiRunsCountQuery(db, scope, cutoff);
        return rows[0]?.count ?? 0;
      });
    },

    async recordRetentionAudit(tenantId, metadata) {
      const scope = { tenantId };

      await withTenantTransaction(getDatabase().client, scope, async (db) => {
        await createAuditEventQuery(db, scope, {
          auditEventId: `aud_${sha24([
            tenantId,
            "retention.applied",
            JSON.stringify(metadata),
          ])}`,
          actorType: "system",
          actorId: "retention_job",
          entityType: "tenant",
          entityId: tenantId,
          action: "retention.applied",
          metadata,
          correlationId: null,
        });
      });
    },

    async close() {
      await database?.client.end();
    },
  };
}

export interface InMemoryRetentionMessage {
  readonly messageId: string;
  readonly rawPayloadRef: string | null;
  readonly attachmentCount: number;
  readonly createdAt: Date;
}

export interface InMemoryRetentionFixtures {
  readonly retentionPolicy?: TenantRetentionPolicy;
  readonly tenantExists?: boolean;
  readonly messages?: readonly InMemoryRetentionMessage[];
  readonly aiRunCreatedAts?: readonly Date[];
}

export interface InMemoryRetentionStore extends RetentionStore {
  listMessages(): readonly InMemoryRetentionMessage[];
  listAuditEvents(): readonly {
    tenantId: string;
    action: string;
    metadata: Record<string, unknown>;
  }[];
}

export function createInMemoryRetentionStore(
  fixtures: InMemoryRetentionFixtures = {},
): InMemoryRetentionStore {
  const tenantExists = fixtures.tenantExists ?? true;
  const retentionPolicy = fixtures.retentionPolicy ?? {};
  let messages = [...(fixtures.messages ?? [])];
  const aiRunCreatedAts = [...(fixtures.aiRunCreatedAts ?? [])];
  const auditEvents: {
    tenantId: string;
    action: string;
    metadata: Record<string, unknown>;
  }[] = [];

  return {
    async getTenantRetentionPolicy() {
      return tenantExists ? retentionPolicy : null;
    },

    async listExpiredRawPayloadMessages(_tenantId, cutoff, limit) {
      return messages
        .filter(
          (message) =>
            message.rawPayloadRef !== null && message.createdAt < cutoff,
        )
        .slice(0, limit)
        .map((message) => ({
          messageId: message.messageId,
          rawPayloadRef: message.rawPayloadRef,
        }));
    },

    async clearRawPayloadRefs(_tenantId, messageIds) {
      let cleared = 0;
      messages = messages.map((message) => {
        if (
          messageIds.includes(message.messageId) &&
          message.rawPayloadRef !== null
        ) {
          cleared += 1;
          return { ...message, rawPayloadRef: null };
        }
        return message;
      });
      return cleared;
    },

    async countExpiredAttachmentMessages(_tenantId, cutoff) {
      return messages.filter(
        (message) => message.attachmentCount > 0 && message.createdAt < cutoff,
      ).length;
    },

    async countExpiredAiRuns(_tenantId, cutoff) {
      return aiRunCreatedAts.filter((createdAt) => createdAt < cutoff).length;
    },

    async recordRetentionAudit(tenantId, metadata) {
      auditEvents.push({ tenantId, action: "retention.applied", metadata });
    },

    listMessages() {
      return messages;
    },

    listAuditEvents() {
      return auditEvents;
    },
  };
}
