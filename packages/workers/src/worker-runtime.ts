import {
  createHttpOutboundChannelSender,
  isValidSecretRef,
  type OutboundChannelSender,
} from "@support/integrations";
import {
  createOtelSupportMetrics,
  type StructuredLogger,
  type SupportMetrics,
} from "@support/observability";
import {
  createDatabaseAiGraphContextStore,
  type AiGraphContextStore,
} from "./activities/ai-graph-context.js";
import { createDeterministicRunAiGraph } from "./activities/deterministic-ai-graph.js";
import { createHttpRunAiGraph } from "./activities/http-ai-graph.js";
import { instrumentTicketLifecycleActivities } from "./activities/instrumented-activities.js";
import {
  createDatabaseTicketLifecyclePersistenceStore,
  createEnvOutboundCredentialResolver,
  createPersistedRunAiGraph,
  createTicketLifecyclePersistenceActivities,
  type TicketLifecyclePersistenceStore,
} from "./activities/ticket-lifecycle-persistence.js";
import { createTicketLifecycleActivities } from "./activities/ticket-lifecycle-activities.js";
import {
  createDatabaseAutomationPolicyStore,
  type AutomationPolicyStore,
} from "./automation-policy.js";
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
export const DEFAULT_AI_RUNTIME_SERVICE_TIMEOUT_MS = 30_000;
export const DEFAULT_AI_RUNTIME_SERVICE_TOKEN_REF = "SUPPORT_AI_SERVICE_TOKEN";

/**
 * Provenance recorded on `ai_runs` rows produced through the sidecar bridge:
 * the decision is still the deterministic support model, but running inside
 * the Python service (`ai/runtime/providers.py`), whose model id differs from
 * the in-process TypeScript stand-in's.
 */
export const AI_SIDECAR_RUN_PROVENANCE = {
  promptVersion: "support_graph.v1",
  modelProvider: "deterministic",
  modelId: "deterministic-support-v1",
} as const;

export interface AiRuntimeServiceConfig {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs: number;
}

export interface TicketLifecycleWorkerRuntimeConfig {
  readonly temporal: TemporalWorkerConfig;
  /** Null disables approval expiry (`APPROVAL_EXPIRY_MS` <= 0). */
  readonly approvalExpiresInMs: number | null;
  /**
   * When set, `runAiGraph` calls the Python AI runtime sidecar over HTTP
   * (Milestone 14). Null keeps the in-process deterministic stand-in — the
   * offline default for tests and environments without the sidecar.
   */
  readonly aiRuntimeService: AiRuntimeServiceConfig | null;
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

  let aiRuntimeService: AiRuntimeServiceConfig | null = null;

  if (env.AI_RUNTIME_SERVICE_URL !== undefined) {
    const rawUrl = env.AI_RUNTIME_SERVICE_URL.trim();
    let baseUrl: string | null = null;

    try {
      const parsed = new URL(rawUrl);

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }

      baseUrl = rawUrl.replace(/\/+$/, "");
    } catch {
      problems.push(
        `AI_RUNTIME_SERVICE_URL must be an http(s) URL (got "${env.AI_RUNTIME_SERVICE_URL}").`,
      );
    }

    const tokenRef =
      env.AI_RUNTIME_SERVICE_TOKEN_REF ?? DEFAULT_AI_RUNTIME_SERVICE_TOKEN_REF;
    let serviceToken: string | null = null;

    const tokenValue = env[tokenRef]?.trim();

    if (!isValidSecretRef(tokenRef)) {
      problems.push(
        `AI_RUNTIME_SERVICE_TOKEN_REF must name an environment variable matching ^[A-Z][A-Z0-9_]*$ (got "${tokenRef}").`,
      );
    } else if (!tokenValue) {
      problems.push(
        `${tokenRef} is required when AI_RUNTIME_SERVICE_URL is set (the sidecar rejects unauthenticated calls).`,
      );
    } else {
      serviceToken = tokenValue;
    }

    let timeoutMs = DEFAULT_AI_RUNTIME_SERVICE_TIMEOUT_MS;

    if (env.AI_RUNTIME_SERVICE_TIMEOUT_MS !== undefined) {
      const parsed = Number(env.AI_RUNTIME_SERVICE_TIMEOUT_MS);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        problems.push(
          `AI_RUNTIME_SERVICE_TIMEOUT_MS must be a positive number of milliseconds (got "${env.AI_RUNTIME_SERVICE_TIMEOUT_MS}").`,
        );
      } else {
        timeoutMs = Math.trunc(parsed);
      }
    }

    if (baseUrl !== null && serviceToken !== null) {
      aiRuntimeService = { baseUrl, serviceToken, timeoutMs };
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
    aiRuntimeService,
  };
}

export interface TicketLifecycleWorkerRuntimeOverrides {
  /** Injected by tests to avoid real provider calls; defaults to the HTTP sender. */
  readonly outboundSender?: OutboundChannelSender;
  readonly store?: TicketLifecyclePersistenceStore;
  readonly metrics?: SupportMetrics;
  readonly logger?: StructuredLogger;
  readonly now?: () => Date;
  /** Sidecar-bridge dependencies, injectable for tests (Milestone 14). */
  readonly automationPolicyStore?: AutomationPolicyStore;
  readonly aiGraphContextStore?: AiGraphContextStore;
  readonly fetchImpl?: typeof fetch;
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
  // Milestone 14: with a configured sidecar the AI decision happens in the
  // Python runtime service; without one the in-process deterministic stand-in
  // keeps the worker fully offline. Both compose under the unchanged
  // persistence wrapper.
  let automationPolicyStore: AutomationPolicyStore | undefined;
  let aiGraphContextStore: AiGraphContextStore | undefined;
  let aiGraphImplementation = createDeterministicRunAiGraph();

  if (config.aiRuntimeService) {
    automationPolicyStore =
      overrides.automationPolicyStore ?? createDatabaseAutomationPolicyStore();
    aiGraphContextStore =
      overrides.aiGraphContextStore ?? createDatabaseAiGraphContextStore();
    aiGraphImplementation = createHttpRunAiGraph({
      baseUrl: config.aiRuntimeService.baseUrl,
      serviceToken: config.aiRuntimeService.serviceToken,
      timeoutMs: config.aiRuntimeService.timeoutMs,
      policyStore: automationPolicyStore,
      contextStore: aiGraphContextStore,
      logger,
      ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    });
  }

  const runAiGraph = createPersistedRunAiGraph(aiGraphImplementation, {
    store,
    metrics,
    ...(config.aiRuntimeService
      ? { provenance: AI_SIDECAR_RUN_PROVENANCE }
      : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
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
    ai_graph: config.aiRuntimeService
      ? `sidecar:${config.aiRuntimeService.baseUrl}`
      : "deterministic-stand-in",
  });

  let runPromise: Promise<void> | null = null;
  let closed = false;

  async function closeResources() {
    if (closed) {
      return;
    }

    closed = true;
    await worker.close();
    await automationPolicyStore?.close?.();
    await aiGraphContextStore?.close?.();
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
