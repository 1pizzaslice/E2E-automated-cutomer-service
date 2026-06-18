import { describe, expect, it } from "vitest";
import { HealthResponseSchema, createHealthResponse } from "./index.js";

describe("shared health schema", () => {
  it("creates a valid health response", () => {
    const response = createHealthResponse("api");

    expect(HealthResponseSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("ok");
  });

  it("rejects unknown services", () => {
    expect(() =>
      HealthResponseSchema.parse({
        service: "unknown",
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
      }),
    ).toThrow();
  });
});
