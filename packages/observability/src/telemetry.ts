import {
  context,
  metrics as metricsApi,
  trace,
  type Meter,
  type Tracer,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";
export const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 10_000;
export const SUPPORT_INSTRUMENTATION_SCOPE = "support-platform";

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string | null;
  environment: string;
  otlpEndpoint: string;
  metricExportIntervalMs: number;
  disabled: boolean;
}

export interface LoadTelemetryConfigDefaults {
  serviceName: string;
  serviceVersion?: string | null;
}

export function loadTelemetryConfig(
  env: Record<string, string | undefined>,
  defaults: LoadTelemetryConfigDefaults,
): TelemetryConfig {
  const rawInterval = env.OTEL_METRIC_EXPORT_INTERVAL;
  const parsedInterval = rawInterval === undefined ? NaN : Number(rawInterval);
  return {
    serviceName: env.OTEL_SERVICE_NAME ?? defaults.serviceName,
    serviceVersion: defaults.serviceVersion ?? null,
    environment: env.SUPPORT_ENVIRONMENT ?? env.NODE_ENV ?? "local",
    otlpEndpoint: stripTrailingSlash(
      env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT,
    ),
    metricExportIntervalMs: Number.isFinite(parsedInterval)
      ? parsedInterval
      : DEFAULT_METRIC_EXPORT_INTERVAL_MS,
    disabled: env.OTEL_SDK_DISABLED === "true",
  };
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export interface TelemetryRuntime {
  config: TelemetryConfig;
  tracer: Tracer;
  meter: Meter;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

function buildResource(config: TelemetryConfig) {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      ...(config.serviceVersion === null
        ? {}
        : { [ATTR_SERVICE_VERSION]: config.serviceVersion }),
      "deployment.environment.name": config.environment,
    }),
  );
}

/**
 * Starts OTel tracing + metrics for a service process and registers the
 * global providers. Exports OTLP/HTTP to the local collector by default
 * (`infra/docker-compose.yml` `otel-collector`, port 4318).
 *
 * Must run before any code resolves tracers/meters from the global API
 * (for the API service: before `buildApp()` in `server.ts`).
 */
export function startTelemetry(config: TelemetryConfig): TelemetryRuntime {
  if (config.disabled) {
    return {
      config,
      tracer: trace.getTracer(SUPPORT_INSTRUMENTATION_SCOPE),
      meter: metricsApi.getMeter(SUPPORT_INSTRUMENTATION_SCOPE),
      forceFlush: async () => {},
      shutdown: async () => {},
    };
  }

  const resource = buildResource(config);
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces` }),
      ),
    ],
  });
  tracerProvider.register();

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${config.otlpEndpoint}/v1/metrics`,
    }),
    exportIntervalMillis: config.metricExportIntervalMs,
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });
  metricsApi.setGlobalMeterProvider(meterProvider);

  return {
    config,
    tracer: trace.getTracer(SUPPORT_INSTRUMENTATION_SCOPE),
    meter: metricsApi.getMeter(SUPPORT_INSTRUMENTATION_SCOPE),
    forceFlush: async () => {
      await tracerProvider.forceFlush();
      await meterProvider.forceFlush();
    },
    shutdown: async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      trace.disable();
      metricsApi.disable();
      context.disable();
    },
  };
}

export interface InMemoryTelemetry extends TelemetryRuntime {
  getFinishedSpans(): ReadableSpan[];
  collectMetrics(): Promise<ResourceMetrics[]>;
  reset(): void;
}

/**
 * Test double: registers real global tracer/meter providers backed by
 * in-memory exporters so tests can assert emitted spans and metrics.
 * Call `shutdown()` (e.g. in afterEach) to unregister the globals.
 */
export function createInMemoryTelemetry(
  options: { serviceName?: string; environment?: string } = {},
): InMemoryTelemetry {
  const config: TelemetryConfig = {
    serviceName: options.serviceName ?? "support-test",
    serviceVersion: null,
    environment: options.environment ?? "test",
    otlpEndpoint: DEFAULT_OTLP_ENDPOINT,
    metricExportIntervalMs: DEFAULT_METRIC_EXPORT_INTERVAL_MS,
    disabled: false,
  };
  const resource = buildResource(config);
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  tracerProvider.register();

  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    // Effectively manual collection: tests call collectMetrics().
    exportIntervalMillis: 60 * 60 * 1000,
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });
  metricsApi.setGlobalMeterProvider(meterProvider);

  return {
    config,
    tracer: trace.getTracer(SUPPORT_INSTRUMENTATION_SCOPE),
    meter: metricsApi.getMeter(SUPPORT_INSTRUMENTATION_SCOPE),
    getFinishedSpans: () => spanExporter.getFinishedSpans(),
    collectMetrics: async () => {
      await metricReader.forceFlush();
      return metricExporter.getMetrics();
    },
    reset: () => {
      spanExporter.reset();
      metricExporter.reset();
    },
    forceFlush: async () => {
      await tracerProvider.forceFlush();
      await meterProvider.forceFlush();
    },
    shutdown: async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      trace.disable();
      metricsApi.disable();
      context.disable();
    },
  };
}
