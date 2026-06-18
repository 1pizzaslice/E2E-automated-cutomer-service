import { describe, expect, it } from "vitest";
import { ToolDefinitionSchema, defineReadOnlyTool } from "./tool-contract.js";

describe("tool contract", () => {
  it("defines read-only tools without human approval", () => {
    const tool = defineReadOnlyTool({
      name: "order_lookup",
      description: "Look up an order by order number.",
      permission: "orders:read",
      timeoutMs: 2000,
    });

    expect(tool.sideEffectClass).toBe("read_only");
    expect(tool.requiresHumanApproval).toBe(false);
  });

  it("rejects invalid tool definitions", () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: "",
        description: "Invalid",
        permission: "orders:read",
        sideEffectClass: "read_only",
        requiresHumanApproval: false,
        timeoutMs: 1000,
      }),
    ).toThrow();
  });
});
