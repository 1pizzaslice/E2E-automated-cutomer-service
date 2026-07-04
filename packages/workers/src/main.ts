import { startWorkersTelemetry, createWorkersLogger } from "./telemetry.js";
import {
  loadTicketLifecycleWorkerRuntimeConfig,
  startTicketLifecycleWorkerRuntime,
} from "./worker-runtime.js";

// Telemetry must start before the runtime is composed so activity spans and
// metrics resolve against the registered providers (OTLP -> local
// otel-collector), mirroring the API's server.ts bootstrap order.
const telemetry = startWorkersTelemetry(process.env);
const logger = createWorkersLogger(process.env);

// Fail fast on configuration before any connection is opened.
const config = loadTicketLifecycleWorkerRuntimeConfig(process.env);
const runtime = await startTicketLifecycleWorkerRuntime(config, { logger });

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(`received ${signal}, draining ticket lifecycle worker`);
    await runtime.shutdown();
    await telemetry.shutdown();
    process.exit(0);
  });
}

try {
  await runtime.run();
} catch (error) {
  logger.error("ticket lifecycle worker crashed", {
    error_message: error instanceof Error ? error.message : String(error),
  });
  await runtime.shutdown();
  await telemetry.shutdown();
  process.exit(1);
}
