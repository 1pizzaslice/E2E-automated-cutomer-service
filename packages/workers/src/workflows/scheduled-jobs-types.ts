/**
 * Scheduled job workflow contracts (Milestone 17). The QA sampling and
 * retention jobs run as short-lived Temporal workflows started by per-tenant
 * Temporal Schedules (daily). Each workflow drives one activity in bounded
 * batches until the tenant's backlog is drained, so a day with more expired
 * rows than one batch still converges within a single scheduled run.
 *
 * The workflows share the ticket-lifecycle task queue: one worker process
 * serves both the lifecycle and the jobs (ADR-0025).
 */

export const QA_SAMPLING_JOB_WORKFLOW_TYPE = "qaSamplingJobWorkflow";
export const RETENTION_JOB_WORKFLOW_TYPE = "retentionJobWorkflow";

export const QA_SAMPLING_SCHEDULE_ID_PREFIX = "support-qa-sampling";
export const RETENTION_SCHEDULE_ID_PREFIX = "support-retention";

export function qaSamplingScheduleId(tenantId: string): string {
  return `${QA_SAMPLING_SCHEDULE_ID_PREFIX}-${tenantId}`;
}

export function retentionScheduleId(tenantId: string): string {
  return `${RETENTION_SCHEDULE_ID_PREFIX}-${tenantId}`;
}

export const SCHEDULED_JOBS_ACTIVITY_RETRY_POLICY = {
  initialInterval: "1 second",
  backoffCoefficient: 2,
  maximumInterval: "30 seconds",
  maximumAttempts: 3,
  nonRetryableErrorTypes: [
    "ValidationError",
    "NonRetryableActivityError",
    "TenantAccessDenied",
  ],
};

/**
 * Safety bound on the drain loop: with the default batch limit of 500 this
 * caps one scheduled run at 25k rows per class per day, far above pilot
 * volume, while guaranteeing termination even if a batch never shrinks.
 */
export const SCHEDULED_JOBS_MAX_BATCHES = 50;

export interface ScheduledJobWorkflowInput {
  readonly tenant_id: string;
}

export interface RunQaSamplingJobActivityInput {
  readonly tenant_id: string;
}

export interface RunQaSamplingJobActivityResult {
  readonly scanned: number;
  readonly sampled: number;
  readonly skipped: number;
  readonly by_reason: Readonly<Record<string, number>>;
  /** True when the scan filled its batch — run again to keep draining. */
  readonly batch_limit_hit: boolean;
}

export interface QaSamplingJobWorkflowResult {
  readonly tenant_id: string;
  readonly batches: number;
  readonly scanned: number;
  readonly sampled: number;
  readonly skipped: number;
}

export interface RunRetentionJobActivityInput {
  readonly tenant_id: string;
}

export interface RunRetentionJobActivityResult {
  readonly applied: boolean;
  readonly raw_payloads_cleared: number;
  readonly attachment_messages_purged: number;
  readonly ai_runs_anonymized: number;
  readonly blob_sweep_failures: number;
  readonly batch_limit_hit: boolean;
  readonly skipped_reason:
    | "tenant_not_found"
    | "no_retention_configured"
    | null;
}

export interface RetentionJobWorkflowResult {
  readonly tenant_id: string;
  readonly batches: number;
  readonly raw_payloads_cleared: number;
  readonly attachment_messages_purged: number;
  readonly ai_runs_anonymized: number;
  readonly blob_sweep_failures: number;
  readonly skipped_reason:
    | "tenant_not_found"
    | "no_retention_configured"
    | null;
}

export interface ScheduledJobsActivities {
  runQaSamplingJob(
    input: RunQaSamplingJobActivityInput,
  ): Promise<RunQaSamplingJobActivityResult>;
  runRetentionJob(
    input: RunRetentionJobActivityInput,
  ): Promise<RunRetentionJobActivityResult>;
}
