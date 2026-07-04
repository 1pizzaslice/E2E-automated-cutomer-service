import { loadTelemetryConfig, startTelemetry } from "@support/observability";
import { buildApp } from "./app.js";

// Telemetry must start before the app is built so instruments and tracers
// resolve against the registered providers (OTLP -> local otel-collector).
const telemetry = startTelemetry(
  loadTelemetryConfig(process.env, { serviceName: "support-api" }),
);

const app = buildApp();
const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.API_PORT ?? "3000", 10);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await telemetry.shutdown();
    process.exit(0);
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ error }, "api failed to start");
  await telemetry.shutdown();
  process.exit(1);
}
