import { describe, expect, it } from "vitest";
import { kbChunks, tenantStatusEnum, ticketStatusEnum } from "./schema.js";

describe("database schema", () => {
  it("uses the v1 pgvector embedding dimension for KB chunks", () => {
    expect(kbChunks.embedding.getSQLType()).toBe("vector(1536)");
  });

  it("keeps enum values aligned with backend lifecycle contracts", () => {
    expect(tenantStatusEnum.enumValues).toEqual([
      "active",
      "suspended",
      "archived",
    ]);
    expect(ticketStatusEnum.enumValues).toContain("waiting_human");
    expect(ticketStatusEnum.enumValues).toContain("failed");
  });
});
