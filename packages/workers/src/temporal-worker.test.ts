import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPORAL_ADDRESS,
  DEFAULT_TEMPORAL_NAMESPACE,
  loadTemporalWorkerConfig,
  ticketLifecycleWorkflowsPath,
} from "./temporal-worker.js";
import {
  TICKET_LIFECYCLE_DEFAULT_ACTIVITY_RETRY_POLICY,
  TICKET_LIFECYCLE_SIDE_EFFECT_ACTIVITY_RETRY_POLICY,
  TICKET_LIFECYCLE_TASK_QUEUE,
} from "./workflows/ticket-lifecycle-types.js";

describe("temporal worker scaffold", () => {
  it("loads local Temporal defaults", () => {
    expect(loadTemporalWorkerConfig({})).toEqual({
      address: DEFAULT_TEMPORAL_ADDRESS,
      namespace: DEFAULT_TEMPORAL_NAMESPACE,
      taskQueue: TICKET_LIFECYCLE_TASK_QUEUE,
    });
  });

  it("loads Temporal connection overrides from env", () => {
    expect(
      loadTemporalWorkerConfig({
        TEMPORAL_ADDRESS: "temporal.example:7233",
        TEMPORAL_NAMESPACE: "support-prod",
        TEMPORAL_TASK_QUEUE: "support-ticket-lifecycle-prod",
      }),
    ).toEqual({
      address: "temporal.example:7233",
      namespace: "support-prod",
      taskQueue: "support-ticket-lifecycle-prod",
    });
  });

  it("points the runtime worker at the workflow module next to the build", () => {
    // Compiled deployments resolve the .js output; source runs (tsx start,
    // vitest) fall back to the .ts module for Temporal's bundler.
    expect(ticketLifecycleWorkflowsPath()).toMatch(
      /workflows\/ticket-lifecycle-workflow\.(js|ts)$/,
    );
  });

  it("keeps ticket lifecycle activity retry policies explicit", () => {
    expect(TICKET_LIFECYCLE_DEFAULT_ACTIVITY_RETRY_POLICY).toEqual({
      initialInterval: "1 second",
      backoffCoefficient: 2,
      maximumInterval: "30 seconds",
      maximumAttempts: 3,
      nonRetryableErrorTypes: [
        "ValidationError",
        "NonRetryableActivityError",
        "TenantAccessDenied",
      ],
    });
    expect(TICKET_LIFECYCLE_SIDE_EFFECT_ACTIVITY_RETRY_POLICY).toEqual({
      initialInterval: "1 second",
      backoffCoefficient: 2,
      maximumInterval: "1 minute",
      maximumAttempts: 5,
      nonRetryableErrorTypes: [
        "ValidationError",
        "NonRetryableActivityError",
        "TenantAccessDenied",
      ],
    });
  });
});
