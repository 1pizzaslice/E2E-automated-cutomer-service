import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
  type ScheduleClient,
} from "@temporalio/client";
import { createDatabaseFromEnv, tenantsListQuery } from "@support/db";
import type { StructuredLogger } from "@support/observability";
import {
  loadTemporalWorkerConfig,
  type TemporalWorkerConfig,
} from "./temporal-worker.js";
import {
  QA_SAMPLING_JOB_WORKFLOW_TYPE,
  RETENTION_JOB_WORKFLOW_TYPE,
  qaSamplingScheduleId,
  retentionScheduleId,
} from "./workflows/scheduled-jobs-types.js";

/**
 * Per-tenant Temporal Schedules for the QA sampling and retention jobs
 * (Milestone 17). The worker entrypoint bootstraps them create-if-missing on
 * every start: an existing schedule is left untouched (Temporal rejects the
 * duplicate id), so restarts are idempotent and operator edits — pausing a
 * schedule, changing its time via the Temporal UI/CLI — survive redeploys.
 * Tenants created after boot get their schedules on the next worker start
 * (worker restart is the documented onboarding step, SOPS §10/§16).
 */

export interface DailyScheduleTime {
  readonly hour: number;
  readonly minute: number;
}

export interface ScheduledJobsConfig {
  /** `SUPPORT_JOB_SCHEDULES=disabled` skips the bootstrap entirely. */
  readonly enabled: boolean;
  /** Daily QA sampling fire time, UTC (`SUPPORT_QA_SAMPLING_SCHEDULE_UTC`). */
  readonly qaSampling: DailyScheduleTime;
  /** Daily retention fire time, UTC (`SUPPORT_RETENTION_SCHEDULE_UTC`). */
  readonly retention: DailyScheduleTime;
}

export const DEFAULT_QA_SAMPLING_SCHEDULE_UTC = "02:00";
export const DEFAULT_RETENTION_SCHEDULE_UTC = "02:30";

/**
 * Spreads per-tenant fire times so a fleet of tenants does not hit the
 * database at the same instant.
 */
const SCHEDULE_JITTER = "5m";

/**
 * Missed fire window (worker/Temporal down at fire time). One catch-up run
 * inside the window keeps the daily cadence; beyond it the next daily fire
 * drains the backlog anyway because both jobs walk everything overdue.
 */
const SCHEDULE_CATCHUP_WINDOW = "6h";

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function parseDailyTime(
  name: string,
  value: string,
  problems: string[],
): DailyScheduleTime {
  const match = TIME_PATTERN.exec(value.trim());
  const hour = match ? Number(match[1]) : Number.NaN;
  const minute = match ? Number(match[2]) : Number.NaN;

  if (!match || hour > 23 || minute > 59) {
    problems.push(
      `${name} must be a UTC time of day in HH:MM 24h format (got "${value}").`,
    );
    return { hour: 0, minute: 0 };
  }

  return { hour, minute };
}

/**
 * Fail-fast environment validation, mirroring the worker runtime config
 * loader: every problem is collected and reported in one error.
 */
export function loadScheduledJobsConfig(
  env: NodeJS.ProcessEnv = process.env,
): ScheduledJobsConfig {
  const problems: string[] = [];

  const mode = env.SUPPORT_JOB_SCHEDULES?.trim() ?? "enabled";
  let enabled = true;

  if (mode === "disabled") {
    enabled = false;
  } else if (mode !== "enabled") {
    problems.push(
      `SUPPORT_JOB_SCHEDULES must be "enabled" or "disabled" (got "${env.SUPPORT_JOB_SCHEDULES}").`,
    );
  }

  const qaSampling = parseDailyTime(
    "SUPPORT_QA_SAMPLING_SCHEDULE_UTC",
    env.SUPPORT_QA_SAMPLING_SCHEDULE_UTC ?? DEFAULT_QA_SAMPLING_SCHEDULE_UTC,
    problems,
  );
  const retention = parseDailyTime(
    "SUPPORT_RETENTION_SCHEDULE_UTC",
    env.SUPPORT_RETENTION_SCHEDULE_UTC ?? DEFAULT_RETENTION_SCHEDULE_UTC,
    problems,
  );

  if (problems.length > 0) {
    throw new Error(
      `Scheduled jobs configuration is invalid:\n- ${problems.join("\n- ")}`,
    );
  }

  return { enabled, qaSampling, retention };
}

/** The single ScheduleClient capability the bootstrap needs (fakeable). */
export type ScheduleCreator = Pick<ScheduleClient, "create">;

export interface EnsureTenantJobSchedulesOptions {
  readonly scheduleClient: ScheduleCreator;
  readonly taskQueue: string;
  readonly tenantIds: readonly string[];
  readonly config: ScheduledJobsConfig;
  readonly logger?: StructuredLogger;
}

export interface EnsureTenantJobSchedulesResult {
  readonly created: readonly string[];
  readonly existing: readonly string[];
}

/**
 * Create-if-missing: one QA sampling and one retention schedule per tenant,
 * daily at the configured UTC times, overlap SKIP (a run still draining is
 * never doubled), jittered so tenants spread out.
 */
export async function ensureTenantJobSchedules(
  options: EnsureTenantJobSchedulesOptions,
): Promise<EnsureTenantJobSchedulesResult> {
  const created: string[] = [];
  const existing: string[] = [];

  const definitions = options.tenantIds.flatMap((tenantId) => [
    {
      scheduleId: qaSamplingScheduleId(tenantId),
      workflowType: QA_SAMPLING_JOB_WORKFLOW_TYPE,
      time: options.config.qaSampling,
      tenantId,
    },
    {
      scheduleId: retentionScheduleId(tenantId),
      workflowType: RETENTION_JOB_WORKFLOW_TYPE,
      time: options.config.retention,
      tenantId,
    },
  ]);

  for (const definition of definitions) {
    try {
      await options.scheduleClient.create({
        scheduleId: definition.scheduleId,
        spec: {
          calendars: [
            {
              hour: definition.time.hour,
              minute: definition.time.minute,
              comment: "daily support job (Milestone 17)",
            },
          ],
          jitter: SCHEDULE_JITTER,
        },
        action: {
          type: "startWorkflow",
          workflowType: definition.workflowType,
          taskQueue: options.taskQueue,
          args: [{ tenant_id: definition.tenantId }],
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP,
          catchupWindow: SCHEDULE_CATCHUP_WINDOW,
        },
      });
      created.push(definition.scheduleId);
      options.logger?.info("job schedule created", {
        schedule_id: definition.scheduleId,
        workflow_type: definition.workflowType,
        tenant_id: definition.tenantId,
      });
    } catch (error) {
      if (error instanceof ScheduleAlreadyRunning) {
        existing.push(definition.scheduleId);
        continue;
      }

      throw error;
    }
  }

  return { created, existing };
}

export interface TenantLister {
  listActiveTenantIds(): Promise<readonly string[]>;
  close?(): Promise<void>;
}

const TENANT_LIST_LIMIT = 1000;

/**
 * Owner-connection tenant discovery for the bootstrap: schedules are a
 * platform concern spanning tenants, so this deliberately does not run under
 * a tenant scope. Only `active` tenants get schedules; a suspended tenant's
 * existing schedules are left alone (its job runs no-op under RLS scope).
 */
export function createDatabaseTenantLister(): TenantLister {
  let database: ReturnType<typeof createDatabaseFromEnv> | undefined;

  function getDatabase() {
    database ??= createDatabaseFromEnv();
    return database;
  }

  return {
    async listActiveTenantIds() {
      const rows = await tenantsListQuery(getDatabase().db, {
        limit: TENANT_LIST_LIMIT,
      });

      return rows
        .filter((tenant) => tenant.status === "active")
        .map((tenant) => tenant.tenantId);
    },

    async close() {
      await database?.client.end();
    },
  };
}

export interface BootstrapJobSchedulesOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: StructuredLogger;
  /** Injected by tests; defaults to the owner-connection database lister. */
  readonly tenantLister?: TenantLister;
  /** Injected by tests; defaults to a fresh Temporal client connection. */
  readonly scheduleClient?: ScheduleCreator;
  readonly temporal?: TemporalWorkerConfig;
}

export interface BootstrapJobSchedulesResult {
  readonly enabled: boolean;
  readonly tenants: number;
  readonly created: readonly string[];
  readonly existing: readonly string[];
}

/**
 * The worker entrypoint's schedule bootstrap: discover active tenants and
 * ensure both daily job schedules exist for each. Failures propagate — a
 * worker that cannot guarantee its schedules must not silently run without
 * them (the jobs would never fire again).
 */
export async function bootstrapJobSchedules(
  options: BootstrapJobSchedulesOptions = {},
): Promise<BootstrapJobSchedulesResult> {
  const env = options.env ?? process.env;
  const config = loadScheduledJobsConfig(env);
  const logger = options.logger;

  if (!config.enabled) {
    logger?.info("job schedule bootstrap disabled by configuration");
    return { enabled: false, tenants: 0, created: [], existing: [] };
  }

  const temporal = options.temporal ?? loadTemporalWorkerConfig(env);
  const tenantLister = options.tenantLister ?? createDatabaseTenantLister();
  const ownsScheduleClient = options.scheduleClient === undefined;
  let connection: Connection | null = null;
  let scheduleClient = options.scheduleClient;

  try {
    if (!scheduleClient) {
      connection = await Connection.connect({ address: temporal.address });
      scheduleClient = new Client({
        connection,
        namespace: temporal.namespace,
      }).schedule;
    }

    const tenantIds = await tenantLister.listActiveTenantIds();
    const result = await ensureTenantJobSchedules({
      scheduleClient,
      taskQueue: temporal.taskQueue,
      tenantIds,
      config,
      ...(logger ? { logger } : {}),
    });

    logger?.info("job schedule bootstrap completed", {
      tenants: tenantIds.length,
      schedules_created: result.created.length,
      schedules_existing: result.existing.length,
    });

    return {
      enabled: true,
      tenants: tenantIds.length,
      created: result.created,
      existing: result.existing,
    };
  } finally {
    if (options.tenantLister === undefined) {
      await tenantLister.close?.();
    }
    if (ownsScheduleClient) {
      await connection?.close();
    }
  }
}
