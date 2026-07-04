import {
  createHttpOutboundChannelSender,
  type OutboundChannelSender,
} from "@support/integrations";
import {
  createOtelSupportMetrics,
  type StructuredLogger,
  type SupportMetrics,
} from "@support/observability";
import { createDeterministicRunAiGraph } from "./activities/deterministic-ai-graph.js";
import { instrumentTicketLifecycleActivities } from "./activities/instrumented-activities.js";
import {
  createDatabaseTicketLifecyclePersistenceStore,
  createEnvOutboundCredentialResolver,
  createPersistedRunAiGraph,
  createTicketLifecyclePersistenceActivities,
  type TicketLifecyclePersistenceStore,
} from "./activities/ticket-lifecycle-persistence.js";
import { createTicketLifecycleActivities } from "./activities/ticket-lifecycle-activities.js";
import { connectNatsEventBus, loadNatsEventBusConfig } from "./event-bus.js";
import { createWorkersLogger } from "./telemetry.js";
import {
  createTicketLifecycleWorker,
  loadTemporalWorkerConfig,
  type TemporalWorkerConfig,
} from "./temporal-worker.js";

/**
 * The production ticket lifecycle worker composition (Milestone 13): one
 * restart-safe process wiring the database persistence store, the HTTP
 * outbound sender, the deterministic AI graph behind
 * `createPersistedRunAiGraph`, domain event emission over NATS JetStream,
 * and full activity instrumentation into `createTicketLifecycleWorker`.
 * `main.ts` runs it as a process; the live end-to-end test drives the same
 * composition in-process with an injected outbound sender.
 */

export const DEFAULT_APPROVAL_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;

export interface TicketLifecycleWorkerRuntimeConfig {
  readonly temporal: TemporalWorkerConfig;
  /** Null disables approval expiry (`APPROVAL_EXPIRY_MS` <= 0). */
  readonly approvalExpiresInMs: number | null;
}

/**
 * Fail-fast environment validation: every problem is collected and reported
 * in one error so a misconfigured deployment surfaces the complete list
 * instead of failing one variable at a time.
 */
export function loadTicketLifecycleWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): TicketLifecycleWorkerRuntimeConfig {
  const problems: string[] = [];

  if (!env.DATABASE_URL || env.DATABASE_URL.trim().length === 0) {
    problems.push(
      "DATABASE_URL is required (postgres connection string for the persistence store).",
    );
  }

  let approvalExpiresInMs: number | null = DEFAULT_APPROVAL_EXPIRES_IN_MS;

  if (env.APPROVAL_EXPIRY_MS !== undefined) {
    const parsed = Number(env.APPROVAL_EXPIRY_MS);

    if (!Number.isFinite(parsed)) {
      problems.push(
        `APPROVAL_EXPIRY_MS must be a number of milliseconds (got "${env.APPROVAL_EXPIRY_MS}").`,
      );
    } else {
      approvalExpiresInMs = parsed > 0 ? Math.trunc(parsed) : null;
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Ticket lifecycle worker configuration is invalid:\n- ${problems.join("\n- ")}`,
    );
  }

  return {
    temporal: loadTemporalWorkerConfig(env),
    approvalExpiresInMs,
  };
}

export interface TicketLifecycleWorkerRuntimeOverrides {
  /** Injected by tests to avoid real provider calls; defaults to the HTTP sender. */
  readonly outboundSender?: OutboundChannelSender;
  readonly store?: TicketLifecyclePersistenceStore;
  readonly metrics?: SupportMetrics;
  readonly logger?: StructuredLogger;
  readonly now?: () => Date;
}

export interface RunningTicketLifecycleWorkerRuntime {
  /** Resolves when the worker stops (after `shutdown()` or a fatal error). */
  run(): Promise<void>;
  shutdown(): Promise<void>;
}

export async function startTicketLifecycleWorkerRuntime(
  config: TicketLifecycleWorkerRuntimeConfig,
  overrides: TicketLifecycleWorkerRuntimeOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunningTicketLifecycleWorkerRuntime> {
  const metrics = overrides.metrics ?? createOtelSupportMetrics();
  const logger = overrides.logger ?? createWorkersLogger(env);

  // Domain events flow over NATS JetStream; stream creation is idempotent so
  // a fresh environment self-provisions and an existing one is untouched.
  const eventBus = await connectNatsEventBus(loadNatsEventBusConfig(env));
  await eventBus.ensureStreams();

  const store =
    overrides.store ??
    createDatabaseTicketLifecyclePersistenceStore(
      overrides.now ? { now: overrides.now } : {},
    );
  const outboundSender =
    overrides.outboundSender ?? createHttpOutboundChannelSender();
  const persistenceActivities = createTicketLifecyclePersistenceActivities({
    store,
    outboundSender,
    credentialResolver: createEnvOutboundCredentialResolver(env),
    approvalExpiresInMs: config.approvalExpiresInMs,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const runAiGraph = createPersistedRunAiGraph(
    createDeterministicRunAiGraph(),
    {
      store,
      metrics,
      ...(overrides.now ? { now: overrides.now } : {}),
    },
  );
  const activities = instrumentTicketLifecycleActivities(
    createTicketLifecycleActivities({
      domainEventPublisher: eventBus.publisher,
      implementations: { ...persistenceActivities, runAiGraph },
    }),
    { metrics, logger },
  );
  const worker = await createTicketLifecycleWorker({
    config: config.temporal,
    activities,
  });

  logger.info("ticket lifecycle worker starting", {
    task_queue: config.temporal.taskQueue,
    namespace: config.temporal.namespace,
    approval_expires_in_ms: config.approvalExpiresInMs,
  });

  let runPromise: Promise<void> | null = null;
  let closed = false;

  async function closeResources() {
    if (closed) {
      return;
    }

    closed = true;
    await worker.close();
    await store.close?.();
    await eventBus.close();
  }

  return {
    run() {
      runPromise ??= worker.worker.run();
      return runPromise;
    },

    async shutdown() {
      if (runPromise !== null && worker.worker.getState() === "RUNNING") {
        worker.worker.shutdown();
      }

      if (runPromise !== null) {
        await runPromise.catch(() => {
          // Fatal run errors are surfaced by run(); shutdown still releases
          // every connection.
        });
      }

      await closeResources();
      logger.info("ticket lifecycle worker stopped", {
        task_queue: config.temporal.taskQueue,
      });
    },
  };
}
