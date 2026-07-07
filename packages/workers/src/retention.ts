import { createHash } from "node:crypto";
import {
  anonymizeAiRunsQuery,
  clearMessageAttachmentsQuery,
  clearMessageRawPayloadRefsQuery,
  createAuditEventQuery,
  createDatabaseFromEnv,
  expiredAiRunsForAnonymizationQuery,
  expiredAttachmentMessagesQuery,
  expiredRawPayloadMessagesQuery,
  tenantByIdQuery,
  withTenantTransaction,
} from "@support/db";
import {
  TenantRetentionPolicySchema,
  type TenantRetentionPolicy,
} from "@support/shared-schemas";
import type { BlobSweeper, BlobSweepFailure } from "./blob-sweeper.js";

/**
 * Data retention execution (Milestones 12 + 17, BACKEND_SPEC section 22).
 * The job reads the tenant's `retention_policy`, computes per-class cutoffs,
 * and purges every configured class in bounded batches:
 *
 * - `raw_payload_days`: expired `messages.raw_payload_ref` blobs are deleted
 *   through the injected {@link BlobSweeper} and the database refs cleared.
 *   Sweep-before-clear fails closed: a ref whose blob could not be deleted
 *   keeps its database row and is retried on the next run, so no blob is
 *   ever orphaned silently.
 * - `attachment_days`: locally stored attachment blobs (`file://` refs) are
 *   swept the same way, then the message's attachment metadata is cleared.
 *   Provider-side refs (e.g. WhatsApp media ids) have no local bytes — for
 *   them clearing the metadata IS the purge.
 * - `ai_run_days`: the PII-bearing `ai_runs` columns (`structured_output`,
 *   `guardrail_results`) are cleared and `anonymized_at` stamped; run
 *   metadata (status, tokens, latency, provenance) is retained for
 *   reporting.
 *
 * Without an injected sweeper (legacy/manual mode) the job clears database
 * state and returns the refs so an operator can sweep the blobs externally.
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

/**
 * Refs written by our own stores use the `file://` scheme in v1 (the
 * filesystem raw-payload store); anything else on an attachment is a
 * provider-side pointer with no locally stored bytes. Milestone 18's object
 * store extends this to `s3://`.
 */
export function isLocallyStoredRef(ref: string): boolean {
  return ref.startsWith("file://");
}

export interface ExpiredRawPayloadMessage {
  readonly messageId: string;
  readonly rawPayloadRef: string | null;
}

export interface ExpiredAttachmentMessage {
  readonly messageId: string;
  readonly attachmentRefs: readonly string[];
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
  listExpiredAttachmentMessages(
    tenantId: string,
    cutoff: Date,
    limit: number,
  ): Promise<readonly ExpiredAttachmentMessage[]>;
  clearMessageAttachments(
    tenantId: string,
    messageIds: readonly string[],
  ): Promise<number>;
  listExpiredAiRunIds(
    tenantId: string,
    cutoff: Date,
    limit: number,
  ): Promise<readonly string[]>;
  anonymizeAiRuns(
    tenantId: string,
    aiRunIds: readonly string[],
    anonymizedAt: Date,
  ): Promise<number>;
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
  /**
   * Deletes the blobs behind purged refs. Optional for the legacy/manual
   * mode where the returned refs are swept externally; production always
   * wires one so purges fail closed on undeletable blobs.
   */
  readonly blobSweeper?: BlobSweeper;
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
  readonly attachmentMessagesPurged: number;
  readonly purgedAttachmentRefs: readonly string[];
  readonly aiRunsAnonymized: number;
  /** Refs whose blobs could not be deleted; their rows were NOT purged. */
  readonly blobSweepFailures: readonly BlobSweepFailure[];
  /**
   * True when any class filled its batch — the scheduler should run the job
   * again to keep draining the backlog.
   */
  readonly batchLimitHit: boolean;
  readonly skippedReason: "tenant_not_found" | "no_retention_configured" | null;
}

const DEFAULT_BATCH_LIMIT = 500;

function sha24(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 24);
}

function emptyResult(
  tenantId: string,
  skippedReason: TenantRetentionResult["skippedReason"],
): TenantRetentionResult {
  return {
    tenantId,
    applied: false,
    rawPayloadsCleared: 0,
    clearedRawPayloadRefs: [],
    attachmentMessagesPurged: 0,
    purgedAttachmentRefs: [],
    aiRunsAnonymized: 0,
    blobSweepFailures: [],
    batchLimitHit: false,
    skippedReason,
  };
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
    return emptyResult(tenantId, "tenant_not_found");
  }

  const cutoffs = computeRetentionCutoffs(policy, now);

  if (
    cutoffs.rawPayloadCutoff === null &&
    cutoffs.attachmentCutoff === null &&
    cutoffs.aiRunCutoff === null
  ) {
    return emptyResult(tenantId, "no_retention_configured");
  }

  const blobSweepFailures: BlobSweepFailure[] = [];
  let batchLimitHit = false;

  // Raw payload refs: every ref was written by our own store, so all of
  // them go through the sweeper. Sweep first, clear only what is gone.
  let clearedRefs: string[] = [];
  if (cutoffs.rawPayloadCutoff) {
    const expired = await deps.store.listExpiredRawPayloadMessages(
      tenantId,
      cutoffs.rawPayloadCutoff,
      batchLimit,
    );
    batchLimitHit ||= expired.length === batchLimit;

    if (expired.length > 0) {
      let clearable = expired;

      if (deps.blobSweeper) {
        const refs = expired.flatMap((message) =>
          message.rawPayloadRef ? [message.rawPayloadRef] : [],
        );
        const sweep = await deps.blobSweeper.sweep(refs);
        blobSweepFailures.push(...sweep.failed);
        const sweptRefs = new Set(sweep.swept);
        clearable = expired.filter(
          (message) =>
            message.rawPayloadRef !== null &&
            sweptRefs.has(message.rawPayloadRef),
        );
      }

      if (clearable.length > 0) {
        await deps.store.clearRawPayloadRefs(
          tenantId,
          clearable.map((message) => message.messageId),
        );
        clearedRefs = clearable.flatMap((message) =>
          message.rawPayloadRef ? [message.rawPayloadRef] : [],
        );
      }
    }
  }

  // Attachments: locally stored blobs must sweep before the metadata
  // clears; provider-side refs have no local bytes, so clearing the
  // metadata is the purge.
  let purgedAttachmentRefs: string[] = [];
  let attachmentMessagesPurged = 0;
  if (cutoffs.attachmentCutoff) {
    const expired = await deps.store.listExpiredAttachmentMessages(
      tenantId,
      cutoffs.attachmentCutoff,
      batchLimit,
    );
    batchLimitHit ||= expired.length === batchLimit;

    if (expired.length > 0) {
      let purgeable = expired;

      if (deps.blobSweeper) {
        const localRefs = [
          ...new Set(
            expired.flatMap((message) =>
              message.attachmentRefs.filter(isLocallyStoredRef),
            ),
          ),
        ];
        const sweep =
          localRefs.length > 0
            ? await deps.blobSweeper.sweep(localRefs)
            : { swept: [], failed: [] };
        blobSweepFailures.push(...sweep.failed);
        const sweptRefs = new Set(sweep.swept);
        purgeable = expired.filter((message) =>
          message.attachmentRefs
            .filter(isLocallyStoredRef)
            .every((ref) => sweptRefs.has(ref)),
        );
      }

      if (purgeable.length > 0) {
        attachmentMessagesPurged = await deps.store.clearMessageAttachments(
          tenantId,
          purgeable.map((message) => message.messageId),
        );
        purgedAttachmentRefs = purgeable.flatMap(
          (message) => message.attachmentRefs,
        );
      }
    }
  }

  // AI runs: anonymize in place — no blobs involved.
  let aiRunsAnonymized = 0;
  if (cutoffs.aiRunCutoff) {
    const expiredIds = await deps.store.listExpiredAiRunIds(
      tenantId,
      cutoffs.aiRunCutoff,
      batchLimit,
    );
    batchLimitHit ||= expiredIds.length === batchLimit;

    if (expiredIds.length > 0) {
      aiRunsAnonymized = await deps.store.anonymizeAiRuns(
        tenantId,
        expiredIds,
        now,
      );
    }
  }

  const applied =
    clearedRefs.length > 0 ||
    attachmentMessagesPurged > 0 ||
    aiRunsAnonymized > 0;

  if (applied) {
    await deps.store.recordRetentionAudit(tenantId, {
      raw_payloads_cleared: clearedRefs.length,
      attachment_messages_purged: attachmentMessagesPurged,
      ai_runs_anonymized: aiRunsAnonymized,
      blob_sweep_failures: blobSweepFailures.length,
      raw_payload_cutoff: cutoffs.rawPayloadCutoff?.toISOString() ?? null,
      attachment_cutoff: cutoffs.attachmentCutoff?.toISOString() ?? null,
      ai_run_cutoff: cutoffs.aiRunCutoff?.toISOString() ?? null,
    });
  }

  deps.logger?.info("retention job completed", {
    tenant_id: tenantId,
    raw_payloads_cleared: clearedRefs.length,
    attachment_messages_purged: attachmentMessagesPurged,
    ai_runs_anonymized: aiRunsAnonymized,
    blob_sweep_failures: blobSweepFailures.length,
    batch_limit_hit: batchLimitHit,
  });

  return {
    tenantId,
    applied,
    rawPayloadsCleared: clearedRefs.length,
    clearedRawPayloadRefs: clearedRefs,
    attachmentMessagesPurged,
    purgedAttachmentRefs,
    aiRunsAnonymized,
    blobSweepFailures,
    batchLimitHit,
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

    async listExpiredAttachmentMessages(tenantId, cutoff, limit) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await expiredAttachmentMessagesQuery(db, scope, {
          cutoff,
          limit,
        });

        return rows.map((row) => ({
          messageId: row.messageId,
          attachmentRefs: extractAttachmentRefs(row.attachments),
        }));
      });
    },

    async clearMessageAttachments(tenantId, messageIds) {
      if (messageIds.length === 0) {
        return 0;
      }

      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await clearMessageAttachmentsQuery(db, scope, messageIds);
        return rows.length;
      });
    },

    async listExpiredAiRunIds(tenantId, cutoff, limit) {
      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await expiredAiRunsForAnonymizationQuery(db, scope, {
          cutoff,
          limit,
        });

        return rows.map((row) => row.aiRunId);
      });
    },

    async anonymizeAiRuns(tenantId, aiRunIds, anonymizedAt) {
      if (aiRunIds.length === 0) {
        return 0;
      }

      const scope = { tenantId };

      return withTenantTransaction(getDatabase().client, scope, async (db) => {
        const rows = await anonymizeAiRunsQuery(
          db,
          scope,
          aiRunIds,
          anonymizedAt,
        );
        return rows.length;
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

/** Attachment metadata rows carry `object_ref` per the normalized contract. */
function extractAttachmentRefs(attachments: unknown): readonly string[] {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((attachment) => {
    if (
      typeof attachment === "object" &&
      attachment !== null &&
      "object_ref" in attachment &&
      typeof (attachment as { object_ref: unknown }).object_ref === "string"
    ) {
      return [(attachment as { object_ref: string }).object_ref];
    }

    return [];
  });
}

export interface InMemoryRetentionMessage {
  readonly messageId: string;
  readonly rawPayloadRef: string | null;
  readonly attachmentRefs: readonly string[];
  readonly createdAt: Date;
}

export interface InMemoryRetentionAiRun {
  readonly aiRunId: string;
  readonly createdAt: Date;
  readonly anonymizedAt?: Date | null;
}

export interface InMemoryRetentionFixtures {
  readonly retentionPolicy?: TenantRetentionPolicy;
  readonly tenantExists?: boolean;
  readonly messages?: readonly InMemoryRetentionMessage[];
  readonly aiRuns?: readonly InMemoryRetentionAiRun[];
}

export interface InMemoryRetentionStore extends RetentionStore {
  listMessages(): readonly InMemoryRetentionMessage[];
  listAiRuns(): readonly InMemoryRetentionAiRun[];
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
  let aiRuns = (fixtures.aiRuns ?? []).map((run) => ({
    ...run,
    anonymizedAt: run.anonymizedAt ?? null,
  }));
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

    async listExpiredAttachmentMessages(_tenantId, cutoff, limit) {
      return messages
        .filter(
          (message) =>
            message.attachmentRefs.length > 0 && message.createdAt < cutoff,
        )
        .slice(0, limit)
        .map((message) => ({
          messageId: message.messageId,
          attachmentRefs: message.attachmentRefs,
        }));
    },

    async clearMessageAttachments(_tenantId, messageIds) {
      let cleared = 0;
      messages = messages.map((message) => {
        if (
          messageIds.includes(message.messageId) &&
          message.attachmentRefs.length > 0
        ) {
          cleared += 1;
          return { ...message, attachmentRefs: [] };
        }
        return message;
      });
      return cleared;
    },

    async listExpiredAiRunIds(_tenantId, cutoff, limit) {
      return aiRuns
        .filter((run) => run.anonymizedAt === null && run.createdAt < cutoff)
        .slice(0, limit)
        .map((run) => run.aiRunId);
    },

    async anonymizeAiRuns(_tenantId, aiRunIds, anonymizedAt) {
      let anonymized = 0;
      aiRuns = aiRuns.map((run) => {
        if (aiRunIds.includes(run.aiRunId) && run.anonymizedAt === null) {
          anonymized += 1;
          return { ...run, anonymizedAt };
        }
        return run;
      });
      return anonymized;
    },

    async recordRetentionAudit(tenantId, metadata) {
      auditEvents.push({ tenantId, action: "retention.applied", metadata });
    },

    listMessages() {
      return messages;
    },

    listAiRuns() {
      return aiRuns;
    },

    listAuditEvents() {
      return auditEvents;
    },
  };
}
