import {
  createNoopSupportMetrics,
  SUPPORT_ATTR,
  withSpan,
  type StructuredLogger,
  type SupportMetrics,
} from "@support/observability";
import type { BlobSweeper } from "../blob-sweeper.js";
import type { DomainEventPublisher } from "../event-publisher.js";
import {
  runQaSamplingJob,
  type QaSamplingRules,
  type QaSamplingStore,
} from "../qa-sampling.js";
import { runTenantRetentionJob, type RetentionStore } from "../retention.js";
import type {
  RunQaSamplingJobActivityInput,
  RunQaSamplingJobActivityResult,
  RunRetentionJobActivityInput,
  RunRetentionJobActivityResult,
  ScheduledJobsActivities,
} from "../workflows/scheduled-jobs-types.js";

/**
 * Production implementations of the scheduled job activities (Milestone 17).
 * Each activity runs one bounded batch of its job with per-run observability
 * (a `job.*` span, the `support.job.*` metrics, structured logs); the
 * workflow loops batches until the tenant backlog drains. Errors propagate
 * unchanged so Temporal retry semantics apply — a run that exhausts its
 * retries surfaces on the `support.job.executions{outcome="failed"}` alert.
 */

/**
 * One scheduled run drains in bounded batches of this size (the retention
 * job's own default, applied to both jobs for a shared drain contract).
 */
export const SCHEDULED_JOBS_BATCH_LIMIT = 500;

export interface ScheduledJobsActivityDependencies {
  readonly retentionStore: RetentionStore;
  readonly qaSamplingStore: QaSamplingStore;
  readonly blobSweeper: BlobSweeper;
  readonly domainEventPublisher: DomainEventPublisher;
  readonly metrics?: SupportMetrics;
  readonly logger?: StructuredLogger;
  readonly now?: () => Date;
  readonly qaSamplingRules?: QaSamplingRules;
  readonly batchLimit?: number;
}

export function createScheduledJobsActivities(
  dependencies: ScheduledJobsActivityDependencies,
): ScheduledJobsActivities {
  const metrics = dependencies.metrics ?? createNoopSupportMetrics();
  const logger = dependencies.logger;
  const now = dependencies.now ?? (() => new Date());
  const batchLimit = dependencies.batchLimit ?? SCHEDULED_JOBS_BATCH_LIMIT;

  return {
    async runQaSamplingJob(
      input: RunQaSamplingJobActivityInput,
    ): Promise<RunQaSamplingJobActivityResult> {
      const startedAtMs = now().getTime();

      return withSpan(
        "job.qa_sampling",
        {
          [SUPPORT_ATTR.job]: "qa_sampling",
          [SUPPORT_ATTR.tenantId]: input.tenant_id,
        },
        async (span) => {
          try {
            const result = await runQaSamplingJob(
              {
                store: dependencies.qaSamplingStore,
                publisher: dependencies.domainEventPublisher,
                ...(logger ? { logger } : {}),
                now,
              },
              {
                tenantId: input.tenant_id,
                limit: batchLimit,
                ...(dependencies.qaSamplingRules
                  ? { rules: dependencies.qaSamplingRules }
                  : {}),
              },
            );
            const durationMs = Math.max(0, now().getTime() - startedAtMs);

            metrics.recordJobRun({
              job: "qa_sampling",
              outcome: "succeeded",
              tenantId: input.tenant_id,
              durationMs,
            });
            span.setAttribute(SUPPORT_ATTR.outcome, "succeeded");
            logger?.info("qa sampling job run completed", {
              job: "qa_sampling",
              tenant_id: input.tenant_id,
              duration_ms: durationMs,
              scanned: result.scanned,
              sampled: result.sampled,
              skipped: result.skipped,
            });

            return {
              scanned: result.scanned,
              sampled: result.sampled,
              skipped: result.skipped,
              by_reason: result.byReason,
              batch_limit_hit: result.scanned === batchLimit,
            };
          } catch (error) {
            const durationMs = Math.max(0, now().getTime() - startedAtMs);

            metrics.recordJobRun({
              job: "qa_sampling",
              outcome: "failed",
              tenantId: input.tenant_id,
              durationMs,
            });
            span.setAttribute(SUPPORT_ATTR.outcome, "failed");
            logger?.error("qa sampling job run failed", {
              job: "qa_sampling",
              tenant_id: input.tenant_id,
              duration_ms: durationMs,
              error_message:
                error instanceof Error ? error.message : String(error),
            });

            throw error;
          }
        },
      );
    },

    async runRetentionJob(
      input: RunRetentionJobActivityInput,
    ): Promise<RunRetentionJobActivityResult> {
      const startedAtMs = now().getTime();

      return withSpan(
        "job.retention",
        {
          [SUPPORT_ATTR.job]: "retention",
          [SUPPORT_ATTR.tenantId]: input.tenant_id,
        },
        async (span) => {
          try {
            const result = await runTenantRetentionJob(
              {
                store: dependencies.retentionStore,
                blobSweeper: dependencies.blobSweeper,
                now,
                ...(logger ? { logger } : {}),
              },
              { tenantId: input.tenant_id, batchLimit },
            );
            const durationMs = Math.max(0, now().getTime() - startedAtMs);
            const outcome =
              result.skippedReason === null ? "succeeded" : "skipped";

            metrics.recordJobRun({
              job: "retention",
              outcome,
              tenantId: input.tenant_id,
              durationMs,
            });
            metrics.recordRetentionPurge({
              retentionClass: "raw_payload",
              tenantId: input.tenant_id,
              count: result.rawPayloadsCleared,
            });
            metrics.recordRetentionPurge({
              retentionClass: "attachment",
              tenantId: input.tenant_id,
              count: result.attachmentMessagesPurged,
            });
            metrics.recordRetentionPurge({
              retentionClass: "ai_run",
              tenantId: input.tenant_id,
              count: result.aiRunsAnonymized,
            });
            span.setAttribute(SUPPORT_ATTR.outcome, outcome);

            if (result.blobSweepFailures.length > 0) {
              // Fail-closed leftovers: rows kept because their blobs could
              // not be deleted. Alertable — the retention window is not
              // honored until the sweep succeeds.
              metrics.recordCriticalFailure("retention_sweep_failed");
              span.setAttribute(
                SUPPORT_ATTR.failureMode,
                "retention_sweep_failed",
              );
              logger?.warn("retention job run left unswept blobs", {
                job: "retention",
                tenant_id: input.tenant_id,
                blob_sweep_failures: result.blobSweepFailures.length,
                failures: result.blobSweepFailures.map(
                  (failure) => `${failure.ref}: ${failure.reason}`,
                ),
              });
            }
            logger?.info("retention job run completed", {
              job: "retention",
              tenant_id: input.tenant_id,
              duration_ms: durationMs,
              raw_payloads_cleared: result.rawPayloadsCleared,
              attachment_messages_purged: result.attachmentMessagesPurged,
              ai_runs_anonymized: result.aiRunsAnonymized,
              blob_sweep_failures: result.blobSweepFailures.length,
              skipped_reason: result.skippedReason,
            });

            return {
              applied: result.applied,
              raw_payloads_cleared: result.rawPayloadsCleared,
              attachment_messages_purged: result.attachmentMessagesPurged,
              ai_runs_anonymized: result.aiRunsAnonymized,
              blob_sweep_failures: result.blobSweepFailures.length,
              batch_limit_hit: result.batchLimitHit,
              skipped_reason: result.skippedReason,
            };
          } catch (error) {
            const durationMs = Math.max(0, now().getTime() - startedAtMs);

            metrics.recordJobRun({
              job: "retention",
              outcome: "failed",
              tenantId: input.tenant_id,
              durationMs,
            });
            span.setAttribute(SUPPORT_ATTR.outcome, "failed");
            logger?.error("retention job run failed", {
              job: "retention",
              tenant_id: input.tenant_id,
              duration_ms: durationMs,
              error_message:
                error instanceof Error ? error.message : String(error),
            });

            throw error;
          }
        },
      );
    },
  };
}
