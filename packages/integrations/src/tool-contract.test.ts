import { describe, expect, it } from "vitest";
import {
  ToolDefinitionSchema,
  defineReadOnlyTool,
  defineSideEffectTool,
} from "./tool-contract.js";

describe("tool contract", () => {
  it("defines read-only tools without human approval", () => {
    const tool = defineReadOnlyTool({
      name: "order_lookup",
      description: "Look up an order by order number.",
      permission: "order_read",
      timeoutMs: 2000,
    });

    expect(tool.sideEffectClass).toBe("read_only");
    expect(tool.requiresHumanApproval).toBe(false);
  });

  it("defaults side-effect tools to requiring human approval", () => {
    const tool = defineSideEffectTool({
      name: "issue_refund",
      description: "Issue a refund for an order.",
      permission: "action_execute",
      sideEffectClass: "irreversible_write",
      timeoutMs: 5000,
    });

    expect(tool.sideEffectClass).toBe("irreversible_write");
    expect(tool.requiresHumanApproval).toBe(true);
  });

  it("rejects a non-canonical permission class", () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: "order_lookup",
        description: "Look up an order.",
        permission: "orders:read",
        sideEffectClass: "read_only",
        requiresHumanApproval: false,
        timeoutMs: 1000,
      }),
    ).toThrow();
  });

  it("rejects invalid tool definitions", () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: "",
        description: "Invalid",
        permission: "order_read",
        sideEffectClass: "read_only",
        requiresHumanApproval: false,
        timeoutMs: 1000,
      }),
    ).toThrow();
  });
});
