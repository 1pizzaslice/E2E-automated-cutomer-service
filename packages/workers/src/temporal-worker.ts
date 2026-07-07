import { NativeConnection, Worker } from "@temporalio/worker";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TicketLifecycleActivities } from "./activities/ticket-lifecycle-activities.js";
import type { ScheduledJobsActivities } from "./workflows/scheduled-jobs-types.js";
import { TICKET_LIFECYCLE_TASK_QUEUE } from "./workflows/ticket-lifecycle-types.js";

export const DEFAULT_TEMPORAL_ADDRESS = "localhost:7233";
export const DEFAULT_TEMPORAL_NAMESPACE = "default";

export interface TemporalWorkerConfig {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
}

export interface TicketLifecycleWorkerOptions {
  readonly config?: Partial<TemporalWorkerConfig>;
  readonly connection?: NativeConnection;
  /**
   * The lifecycle activities, optionally merged with the scheduled-job
   * activities (Milestone 17) — the production runtime registers both on
   * the shared task queue; workflow-focused tests may register only the
   * lifecycle set.
   */
  readonly activities: TicketLifecycleActivities &
    Partial<ScheduledJobsActivities>;
}

export interface TicketLifecycleWorkerRuntime {
  readonly worker: Worker;
  readonly connection: NativeConnection;
  close(): Promise<void>;
}

export function loadTemporalWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): TemporalWorkerConfig {
  return {
    address: env.TEMPORAL_ADDRESS ?? DEFAULT_TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE ?? DEFAULT_TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE ?? TICKET_LIFECYCLE_TASK_QUEUE,
  };
}

export async function createTicketLifecycleWorker(
  options: TicketLifecycleWorkerOptions,
): Promise<TicketLifecycleWorkerRuntime> {
  const config = {
    ...loadTemporalWorkerConfig(),
    ...options.config,
  };
  const ownsConnection = options.connection === undefined;
  const connection =
    options.connection ??
    (await NativeConnection.connect({
      address: config.address,
    }));
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: ticketLifecycleWorkflowsPath(),
    activities: options.activities,
  });

  return {
    worker,
    connection,
    async close() {
      if (ownsConnection) {
        await connection.close();
      }
    },
  };
}

/**
 * Resolve the workflow bundle entry next to this module. Compiled output
 * ships `.js`; when the worker runs from TypeScript source (tsx dev/start,
 * vitest) only the `.ts` file exists and Temporal's bundler handles it
 * directly.
 */
export function ticketLifecycleWorkflowsPath(): string {
  const compiledPath = fileURLToPath(
    new URL("./workflows/ticket-lifecycle-workflow.js", import.meta.url),
  );

  if (existsSync(compiledPath)) {
    return compiledPath;
  }

  return fileURLToPath(
    new URL("./workflows/ticket-lifecycle-workflow.ts", import.meta.url),
  );
}
