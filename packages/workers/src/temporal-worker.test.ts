import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPORAL_ADDRESS,
  DEFAULT_TEMPORAL_NAMESPACE,
  loadTemporalWorkerConfig,
  ticketLifecycleWorkflowsPath,
} from "./temporal-worker.js";
import { TICKET_LIFECYCLE_TASK_QUEUE } from "./workflows/ticket-lifecycle-types.js";

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

  it("points the runtime worker at the compiled workflow module", () => {
    expect(ticketLifecycleWorkflowsPath()).toMatch(
      /workflows\/ticket-lifecycle-workflow\.js$/,
    );
  });
});
