import { describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "./config.js";

describe("database config", () => {
  it("loads DATABASE_URL", () => {
    expect(loadDatabaseConfig({ DATABASE_URL: "postgres://example" })).toEqual({
      databaseUrl: "postgres://example",
    });
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadDatabaseConfig({})).toThrow("DATABASE_URL is required");
  });
});
