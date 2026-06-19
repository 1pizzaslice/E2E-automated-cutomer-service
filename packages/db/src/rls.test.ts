import { describe, expect, it } from "vitest";
import type { PostgresClient } from "./client.js";
import { setLocalTenantContext } from "./rls.js";

describe("row-level security helpers", () => {
  it("rejects blank tenant context values before hitting PostgreSQL", async () => {
    await expect(
      setLocalTenantContext({} as PostgresClient, "   "),
    ).rejects.toThrow("tenantId is required to set database tenant context");
  });
});
