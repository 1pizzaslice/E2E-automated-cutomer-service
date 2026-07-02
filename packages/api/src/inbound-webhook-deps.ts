import { createDatabaseInboundIntakeStore } from "./inbound-intake-store.js";
import { createInboundIntakeService } from "./inbound-intake.js";
import { createTemporalInboundWorkflowLauncher } from "./inbound-workflow-launcher.js";
import { createFilesystemRawPayloadStore } from "./raw-payload-store.js";
import type { InboundWebhookDependencies } from "./webhooks.js";

/**
 * Default production inbound webhook wiring: a lazily-connected PostgreSQL
 * intake store, a lazily-connected Temporal workflow launcher, and a
 * filesystem raw payload store. Constructing these opens no connections; the
 * database and Temporal client connect on the first webhook delivery.
 */
export function createDatabaseInboundWebhookDependencies(): InboundWebhookDependencies {
  const store = createDatabaseInboundIntakeStore();
  const launcher = createTemporalInboundWorkflowLauncher();
  const intake = createInboundIntakeService({ store, launcher });
  const rawPayloadStore = createFilesystemRawPayloadStore();

  return {
    intake,
    rawPayloadStore,
    async close() {
      await intake.close?.();
    },
  };
}
