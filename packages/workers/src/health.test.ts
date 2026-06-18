import { describe, expect, it } from "vitest";
import { getWorkerHealth } from "./health.js";

describe("worker health", () => {
  it("returns worker health status", () => {
    expect(getWorkerHealth()).toMatchObject({
      service: "workers",
      status: "ok",
    });
  });
});
