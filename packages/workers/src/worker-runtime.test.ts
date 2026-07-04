import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_EXPIRES_IN_MS,
  loadTicketLifecycleWorkerRuntimeConfig,
} from "./worker-runtime.js";

describe("loadTicketLifecycleWorkerRuntimeConfig", () => {
  it("loads defaults with a database url present", () => {
    const config = loadTicketLifecycleWorkerRuntimeConfig({
      DATABASE_URL: "postgres://support:support@localhost:5432/support",
    });

    expect(config.temporal).toEqual({
      address: "localhost:7233",
      namespace: "default",
      taskQueue: "support-ticket-lifecycle",
    });
    expect(config.approvalExpiresInMs).toBe(DEFAULT_APPROVAL_EXPIRES_IN_MS);
  });

  it("fails fast with every configuration problem listed", () => {
    expect(() =>
      loadTicketLifecycleWorkerRuntimeConfig({
        APPROVAL_EXPIRY_MS: "not-a-number",
      }),
    ).toThrow(
      /DATABASE_URL is required[\s\S]*APPROVAL_EXPIRY_MS must be a number/,
    );
  });

  it("parses the approval expiry window and disables it for non-positive values", () => {
    const env = {
      DATABASE_URL: "postgres://support:support@localhost:5432/support",
    };

    expect(
      loadTicketLifecycleWorkerRuntimeConfig({
        ...env,
        APPROVAL_EXPIRY_MS: "60000",
      }).approvalExpiresInMs,
    ).toBe(60_000);
    expect(
      loadTicketLifecycleWorkerRuntimeConfig({
        ...env,
        APPROVAL_EXPIRY_MS: "0",
      }).approvalExpiresInMs,
    ).toBe(null);
    expect(
      loadTicketLifecycleWorkerRuntimeConfig({
        ...env,
        APPROVAL_EXPIRY_MS: "-1",
      }).approvalExpiresInMs,
    ).toBe(null);
  });

  it("honors temporal connection overrides", () => {
    const config = loadTicketLifecycleWorkerRuntimeConfig({
      DATABASE_URL: "postgres://support:support@localhost:5432/support",
      TEMPORAL_ADDRESS: "temporal.example:7233",
      TEMPORAL_NAMESPACE: "support-prod",
      TEMPORAL_TASK_QUEUE: "support-ticket-lifecycle-prod",
    });

    expect(config.temporal).toEqual({
      address: "temporal.example:7233",
      namespace: "support-prod",
      taskQueue: "support-ticket-lifecycle-prod",
    });
  });
});
