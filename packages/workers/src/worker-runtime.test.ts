import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_RUNTIME_SERVICE_TIMEOUT_MS,
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
    // No sidecar configured: the worker keeps the deterministic stand-in.
    expect(config.aiRuntimeService).toBeNull();
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

  it("configures the AI runtime sidecar from the environment", () => {
    const config = loadTicketLifecycleWorkerRuntimeConfig({
      DATABASE_URL: "postgres://support:support@localhost:5432/support",
      AI_RUNTIME_SERVICE_URL: "http://localhost:8090/",
      SUPPORT_AI_SERVICE_TOKEN: "sidecar-token",
    });

    expect(config.aiRuntimeService).toEqual({
      baseUrl: "http://localhost:8090",
      serviceToken: "sidecar-token",
      timeoutMs: DEFAULT_AI_RUNTIME_SERVICE_TIMEOUT_MS,
    });
  });

  it("resolves the sidecar token through a custom env reference and timeout", () => {
    const config = loadTicketLifecycleWorkerRuntimeConfig({
      DATABASE_URL: "postgres://support:support@localhost:5432/support",
      AI_RUNTIME_SERVICE_URL: "https://ai.internal.example",
      AI_RUNTIME_SERVICE_TOKEN_REF: "CUSTOM_AI_TOKEN",
      CUSTOM_AI_TOKEN: "custom-token",
      AI_RUNTIME_SERVICE_TIMEOUT_MS: "5000",
    });

    expect(config.aiRuntimeService).toEqual({
      baseUrl: "https://ai.internal.example",
      serviceToken: "custom-token",
      timeoutMs: 5000,
    });
  });

  it("fails fast on sidecar misconfiguration", () => {
    expect(() =>
      loadTicketLifecycleWorkerRuntimeConfig({
        DATABASE_URL: "postgres://support:support@localhost:5432/support",
        AI_RUNTIME_SERVICE_URL: "not-a-url",
      }),
    ).toThrow(/AI_RUNTIME_SERVICE_URL must be an http\(s\) URL/);

    expect(() =>
      loadTicketLifecycleWorkerRuntimeConfig({
        DATABASE_URL: "postgres://support:support@localhost:5432/support",
        AI_RUNTIME_SERVICE_URL: "http://localhost:8090",
      }),
    ).toThrow(/SUPPORT_AI_SERVICE_TOKEN is required/);

    expect(() =>
      loadTicketLifecycleWorkerRuntimeConfig({
        DATABASE_URL: "postgres://support:support@localhost:5432/support",
        AI_RUNTIME_SERVICE_URL: "http://localhost:8090",
        AI_RUNTIME_SERVICE_TOKEN_REF: "lowercase-invalid",
      }),
    ).toThrow(/AI_RUNTIME_SERVICE_TOKEN_REF must name an environment variable/);

    expect(() =>
      loadTicketLifecycleWorkerRuntimeConfig({
        DATABASE_URL: "postgres://support:support@localhost:5432/support",
        AI_RUNTIME_SERVICE_URL: "http://localhost:8090",
        SUPPORT_AI_SERVICE_TOKEN: "sidecar-token",
        AI_RUNTIME_SERVICE_TIMEOUT_MS: "0",
      }),
    ).toThrow(/AI_RUNTIME_SERVICE_TIMEOUT_MS must be a positive number/);
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
