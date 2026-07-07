import { proxyActivities } from "@temporalio/workflow";
import type {
  QaSamplingJobWorkflowResult,
  RetentionJobWorkflowResult,
  ScheduledJobWorkflowInput,
  ScheduledJobsActivities,
} from "./scheduled-jobs-types.js";
import {
  SCHEDULED_JOBS_ACTIVITY_RETRY_POLICY,
  SCHEDULED_JOBS_MAX_BATCHES,
} from "./scheduled-jobs-types.js";

/**
 * Scheduled job workflows (Milestone 17): thin deterministic drivers started
 * daily per tenant by Temporal Schedules. All database, event bus, and blob
 * work happens inside the activities (DEVELOPMENT_RULES §7); the workflow
 * only loops bounded batches until the tenant's backlog drains.
 */

const activities = proxyActivities<ScheduledJobsActivities>({
  startToCloseTimeout: "5 minutes",
  retry: SCHEDULED_JOBS_ACTIVITY_RETRY_POLICY,
});

export async function qaSamplingJobWorkflow(
  input: ScheduledJobWorkflowInput,
): Promise<QaSamplingJobWorkflowResult> {
  let batches = 0;
  let scanned = 0;
  let sampled = 0;
  let skipped = 0;

  for (;;) {
    const result = await activities.runQaSamplingJob({
      tenant_id: input.tenant_id,
    });
    batches += 1;
    scanned += result.scanned;
    sampled += result.sampled;
    skipped += result.skipped;

    // Stop when the backlog is drained, when the batch made no progress
    // (unsampled candidates stay in the pool, so an all-skipped batch would
    // repeat forever), or at the safety bound.
    if (
      !result.batch_limit_hit ||
      result.sampled === 0 ||
      batches >= SCHEDULED_JOBS_MAX_BATCHES
    ) {
      break;
    }
  }

  return { tenant_id: input.tenant_id, batches, scanned, sampled, skipped };
}

export async function retentionJobWorkflow(
  input: ScheduledJobWorkflowInput,
): Promise<RetentionJobWorkflowResult> {
  let batches = 0;
  let rawPayloadsCleared = 0;
  let attachmentMessagesPurged = 0;
  let aiRunsAnonymized = 0;
  let blobSweepFailures = 0;
  let skippedReason: RetentionJobWorkflowResult["skipped_reason"] = null;

  for (;;) {
    const result = await activities.runRetentionJob({
      tenant_id: input.tenant_id,
    });
    batches += 1;
    const purgedThisBatch =
      result.raw_payloads_cleared +
      result.attachment_messages_purged +
      result.ai_runs_anonymized;
    rawPayloadsCleared += result.raw_payloads_cleared;
    attachmentMessagesPurged += result.attachment_messages_purged;
    aiRunsAnonymized += result.ai_runs_anonymized;
    blobSweepFailures += result.blob_sweep_failures;
    skippedReason = result.skipped_reason;

    // Stop when the backlog is drained, when the batch made no progress
    // (rows blocked by sweep failures would repeat forever; the next daily
    // run retries them), or at the safety bound.
    if (
      !result.batch_limit_hit ||
      purgedThisBatch === 0 ||
      batches >= SCHEDULED_JOBS_MAX_BATCHES
    ) {
      break;
    }
  }

  return {
    tenant_id: input.tenant_id,
    batches,
    raw_payloads_cleared: rawPayloadsCleared,
    attachment_messages_purged: attachmentMessagesPurged,
    ai_runs_anonymized: aiRunsAnonymized,
    blob_sweep_failures: blobSweepFailures,
    skipped_reason: skippedReason,
  };
}
