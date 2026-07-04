import {
  createStructuredLogger,
  loadTelemetryConfig,
  startTelemetry,
  type StructuredLogger,
  type TelemetryRuntime,
} from "@support/observability";

/**
 * Telemetry + structured-logging bootstrap for worker processes. Call
 * before creating workers/jobs so tracers and meters resolve against the
 * registered providers (OTLP -> local otel-collector, port 4318).
 */
export function startWorkersTelemetry(
  env: Record<string, string | undefined> = process.env,
): TelemetryRuntime {
  return startTelemetry(
    loadTelemetryConfig(env, { serviceName: "support-workers" }),
  );
}

export function createWorkersLogger(
  env: Record<string, string | undefined> = process.env,
): StructuredLogger {
  return createStructuredLogger({
    service: "workers",
    environment: env.SUPPORT_ENVIRONMENT ?? env.NODE_ENV ?? "local",
    level: (env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
  });
}
