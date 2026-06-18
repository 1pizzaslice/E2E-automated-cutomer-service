import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "@support/shared-schemas";
import { buildApp } from "./app.js";

describe("api health endpoints", () => {
  it("returns health", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).service).toBe("api");
  });

  it("returns readiness", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).status).toBe("ok");
  });
});
