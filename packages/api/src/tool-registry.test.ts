import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KbSearchResult,
  ToolCallResult,
  ToolPermissionClass,
} from "@support/shared-schemas";
import type { KbRetrievalService } from "./kb-retrieval.js";
import {
  createInMemoryToolRegistryStore,
  createToolExecutor,
  defineTool,
  type InMemoryToolDefinitionRow,
  type InMemoryToolRegistryStore,
  type RegisteredTool,
  type ToolExecutionContext,
} from "./tool-registry.js";
import {
  defineReadOnlyTool,
  defineSideEffectTool,
} from "@support/integrations";
import { z } from "zod";
import { createFirstPartyTools } from "./tools/index.js";
import { createSampleCommerceDataset } from "./tools/commerce-fixtures.js";

const TENANT_ACME = "ten_acme";
const TENANT_GLOBEX = "ten_globex";

const ALL_PERMISSIONS: ToolPermissionClass[] = [
  "customer_read",
  "order_read",
  "kb_read",
  "eligibility_evaluate",
  "reply_draft",
  "action_execute",
];

function context(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    tenantId: TENANT_ACME,
    ticketId: "tkt_1",
    aiRunId: "air_1",
    grantedPermissions: ALL_PERMISSIONS,
    ...overrides,
  };
}

/** A KB retrieval stub returning canned hits, so the KB tool test is focused. */
function stubKbRetrieval(hits: KbSearchResult[]): KbRetrievalService {
  return {
    async search() {
      return hits;
    },
  };
}

function kbHit(overrides: Partial<KbSearchResult> = {}): KbSearchResult {
  return {
    kb_chunk_id: "kbc_1",
    tenant_id: TENANT_ACME,
    kb_document_id: "kbd_1",
    chunk_index: 0,
    content: "Refunds are accepted within 30 days of delivery.",
    status: "active",
    metadata: {},
    created_at: "2026-06-01T00:00:00.000Z",
    score: 0.91,
    document_title: "Return Policy",
    document_type: "policy",
    source_type: "manual",
    source_ref: null,
    ...overrides,
  };
}

/** Definition rows mirroring active, global tool_definition rows for all tools. */
function globalDefs(
  names: string[],
  sideEffectClass: InMemoryToolDefinitionRow["sideEffectClass"] = "read_only",
): InMemoryToolDefinitionRow[] {
  return names.map((name) => ({
    toolDefinitionId: `tdf_${name}`,
    tenantId: null,
    name,
    sideEffectClass,
    status: "active" as const,
  }));
}

const FIRST_PARTY_NAMES = [
  "order_lookup",
  "shipment_tracking_lookup",
  "refund_eligibility",
  "cancellation_eligibility",
  "customer_profile_lookup",
  "kb_search",
];

function makeExecutor(options: {
  store: InMemoryToolRegistryStore;
  tools: RegisteredTool[];
  maxOutputBytes?: number;
}) {
  return createToolExecutor({
    store: options.store,
    tools: options.tools,
    maxOutputBytes: options.maxOutputBytes,
  });
}

describe("tool executor", () => {
  let store: InMemoryToolRegistryStore;
  let tools: RegisteredTool[];

  beforeEach(() => {
    store = createInMemoryToolRegistryStore(globalDefs(FIRST_PARTY_NAMES));
    tools = createFirstPartyTools({
      dataset: createSampleCommerceDataset(),
      kbRetrieval: stubKbRetrieval([kbHit()]),
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });
  });

  it("executes a read-only tool and audits the succeeded call", async () => {
    const executor = makeExecutor({ store, tools });
    const result = await executor.execute(context(), {
      tool_name: "order_lookup",
      arguments: { order_id: "ord_1001" },
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.output).toMatchObject({
      found: true,
      order: { order_id: "ord_1001", status: "delivered" },
    });
    expect(result.idempotent_replay).toBe(false);

    // Every call is audited: one succeeded row anchored to the definition.
    const calls = store.listCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      toolDefinitionId: "tdf_order_lookup",
      status: "succeeded",
      input: { order_id: "ord_1001" },
    });
    expect(calls[0]?.output).toMatchObject({ found: true });
    expect(calls[0]?.toolCallId).toBe(result.tool_call_id);
  });

  it("rejects invalid arguments and audits a failed call", async () => {
    const executor = makeExecutor({ store, tools });
    const result = await executor.execute(context(), {
      tool_name: "order_lookup",
      arguments: { order_number: "ord_1001" }, // wrong key
    });

    expect(result.status).toBe("failed");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("invalid_arguments");

    const calls = store.listCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("failed");
    expect(calls[0]?.errorCode).toBe("invalid_arguments");
  });

  it("blocks a tool when the caller lacks its permission class", async () => {
    // Prove the handler never runs by wrapping order_lookup with a spy.
    const spy = vi.fn(() => ({ found: false as const, order_id: "x" }));
    const guardedTool = defineTool({
      definition: defineReadOnlyTool({
        name: "order_lookup",
        description: "spy",
        permission: "order_read",
        timeoutMs: 1000,
      }),
      argsSchema: z.object({ order_id: z.string().min(1) }).strict(),
      resultSchema: z.object({ found: z.boolean(), order_id: z.string() }),
      handler: spy,
    });
    const executor = makeExecutor({ store, tools: [guardedTool] });

    const result = await executor.execute(
      context({ grantedPermissions: ["customer_read"] }),
      { tool_name: "order_lookup", arguments: { order_id: "ord_1001" } },
    );

    expect(result.status).toBe("blocked");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("unauthorized");
    expect(spy).not.toHaveBeenCalled();

    const calls = store.listCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("blocked");
    expect(calls[0]?.errorCode).toBe("unauthorized");
  });

  it("blocks a tool that is not visible to the tenant (no audit row)", async () => {
    // Only visible to globex; acme cannot see or run it.
    const scopedStore = createInMemoryToolRegistryStore([
      {
        toolDefinitionId: "tdf_scoped",
        tenantId: TENANT_GLOBEX,
        name: "order_lookup",
        sideEffectClass: "read_only",
        status: "active",
      },
    ]);
    const executor = makeExecutor({ store: scopedStore, tools });

    const result = await executor.execute(context({ tenantId: TENANT_ACME }), {
      tool_name: "order_lookup",
      arguments: { order_id: "ord_1001" },
    });

    expect(result.status).toBe("blocked");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("not_visible");
    expect(result.tool_call_id).toBe("");
    expect(scopedStore.listCalls()).toHaveLength(0);
  });

  it("blocks a disabled tool definition", async () => {
    const disabledStore = createInMemoryToolRegistryStore([
      {
        toolDefinitionId: "tdf_disabled",
        tenantId: null,
        name: "order_lookup",
        sideEffectClass: "read_only",
        status: "disabled",
      },
    ]);
    const executor = makeExecutor({ store: disabledStore, tools });

    const result = await executor.execute(context(), {
      tool_name: "order_lookup",
      arguments: { order_id: "ord_1001" },
    });

    expect(result.status).toBe("blocked");
  });

  it("rejects an out-of-contract tool result", async () => {
    const badTool = defineTool({
      definition: defineReadOnlyTool({
        name: "bad_output",
        description: "returns wrong shape",
        permission: "order_read",
        timeoutMs: 1000,
      }),
      argsSchema: z.object({}).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      // Cast around the type so we can simulate a misbehaving handler.
      handler: () => ({ unexpected: true }) as unknown as { ok: boolean },
    });
    const store2 = createInMemoryToolRegistryStore(globalDefs(["bad_output"]));
    const executor = makeExecutor({ store: store2, tools: [badTool] });

    const result = await executor.execute(context(), {
      tool_name: "bad_output",
      arguments: {},
    });

    expect(result.status).toBe("failed");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("output_invalid");
  });

  it("bounds oversized tool results", async () => {
    const bigTool = defineTool({
      definition: defineReadOnlyTool({
        name: "big_output",
        description: "returns a large blob",
        permission: "order_read",
        timeoutMs: 1000,
      }),
      argsSchema: z.object({}).strict(),
      resultSchema: z.object({ blob: z.string() }).strict(),
      handler: () => ({ blob: "x".repeat(5000) }),
    });
    const store2 = createInMemoryToolRegistryStore(globalDefs(["big_output"]));
    const executor = makeExecutor({
      store: store2,
      tools: [bigTool],
      maxOutputBytes: 1024,
    });

    const result = await executor.execute(context(), {
      tool_name: "big_output",
      arguments: {},
    });

    expect(result.status).toBe("failed");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("result_too_large");
    expect(store2.listCalls()[0]?.status).toBe("failed");
  });

  it("fails a tool that exceeds its timeout", async () => {
    const slowTool = defineTool({
      definition: defineReadOnlyTool({
        name: "slow_tool",
        description: "never resolves in time",
        permission: "order_read",
        timeoutMs: 10,
      }),
      argsSchema: z.object({}).strict(),
      resultSchema: z.object({ ok: z.boolean() }).strict(),
      handler: () =>
        new Promise<{ ok: boolean }>((resolve) =>
          setTimeout(() => resolve({ ok: true }), 1000),
        ),
    });
    const store2 = createInMemoryToolRegistryStore(globalDefs(["slow_tool"]));
    const executor = makeExecutor({ store: store2, tools: [slowTool] });

    const result = await executor.execute(context(), {
      tool_name: "slow_tool",
      arguments: {},
    });

    expect(result.status).toBe("failed");
    if (result.status === "succeeded") return;
    expect(result.error.code).toBe("timeout");
  });
});

describe("tool executor idempotency", () => {
  it("replays a side-effect call on a repeated idempotency key", async () => {
    let runs = 0;
    const writeTool = defineTool({
      definition: defineSideEffectTool({
        name: "reversible_write_tool",
        description: "a reversible side effect",
        permission: "action_execute",
        sideEffectClass: "reversible_write",
        requiresHumanApproval: false,
        timeoutMs: 5000,
      }),
      argsSchema: z.object({ value: z.string() }).strict(),
      resultSchema: z.object({ applied: z.string(), run: z.number() }).strict(),
      handler: (args: { value: string }) => {
        runs += 1;
        return { applied: args.value, run: runs };
      },
    });
    const store = createInMemoryToolRegistryStore(
      globalDefs(["reversible_write_tool"], "reversible_write"),
    );
    const executor = createToolExecutor({ store, tools: [writeTool] });

    const first = await executor.execute(context(), {
      tool_name: "reversible_write_tool",
      arguments: { value: "apply-once" },
      idempotency_key: "key-123",
    });
    const second = await executor.execute(context(), {
      tool_name: "reversible_write_tool",
      arguments: { value: "apply-once" },
      idempotency_key: "key-123",
    });

    expect(runs).toBe(1); // executed exactly once
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(
      (first as Extract<ToolCallResult, { status: "succeeded" }>)
        .idempotent_replay,
    ).toBe(false);
    const replay = second as Extract<ToolCallResult, { status: "succeeded" }>;
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.tool_call_id).toBe(first.tool_call_id);
    // Only one audit row: the second call did not create a new one.
    expect(store.listCalls()).toHaveLength(1);
  });

  it("does not de-duplicate read-only tools by idempotency key", async () => {
    let runs = 0;
    const readTool = defineTool({
      definition: defineReadOnlyTool({
        name: "read_tool",
        description: "a read",
        permission: "order_read",
        timeoutMs: 1000,
      }),
      argsSchema: z.object({}).strict(),
      resultSchema: z.object({ run: z.number() }).strict(),
      handler: () => {
        runs += 1;
        return { run: runs };
      },
    });
    const store = createInMemoryToolRegistryStore(globalDefs(["read_tool"]));
    const executor = createToolExecutor({ store, tools: [readTool] });

    await executor.execute(context(), {
      tool_name: "read_tool",
      arguments: {},
      idempotency_key: "key-abc",
    });
    await executor.execute(context(), {
      tool_name: "read_tool",
      arguments: {},
      idempotency_key: "key-abc",
    });

    expect(runs).toBe(2); // reads are naturally idempotent; both execute
    expect(store.listCalls()).toHaveLength(2);
  });
});

describe("first-party tools", () => {
  const now = () => new Date("2026-07-03T00:00:00.000Z");

  function harness() {
    const store = createInMemoryToolRegistryStore(
      globalDefs(FIRST_PARTY_NAMES),
    );
    const executor = createToolExecutor({
      store,
      tools: createFirstPartyTools({
        dataset: createSampleCommerceDataset(),
        kbRetrieval: stubKbRetrieval([
          kbHit(),
          kbHit({ kb_chunk_id: "kbc_2", content: "Exchanges within 45 days." }),
        ]),
        now,
      }),
    });
    return { store, executor };
  }

  async function run(
    name: string,
    args: Record<string, unknown>,
    tenantId = TENANT_ACME,
  ) {
    const { executor } = harness();
    return executor.execute(context({ tenantId }), {
      tool_name: name,
      arguments: args,
    });
  }

  function output(result: ToolCallResult): Record<string, unknown> {
    if (result.status !== "succeeded") {
      throw new Error(`expected success, got ${result.status}`);
    }
    return result.output;
  }

  it("order_lookup returns a not-found result for a missing order", async () => {
    const result = await run("order_lookup", { order_id: "ord_missing" });
    expect(output(result)).toEqual({ found: false, order_id: "ord_missing" });
  });

  it("order_lookup enforces tenant isolation", async () => {
    // ord_1001 belongs to acme; globex must not be able to read it.
    const result = await run(
      "order_lookup",
      { order_id: "ord_1001" },
      TENANT_GLOBEX,
    );
    expect(output(result)).toMatchObject({ found: false });
  });

  it("shipment_tracking_lookup resolves by tracking number", async () => {
    const result = await run("shipment_tracking_lookup", {
      tracking_number: "1Z999AA10123456784",
    });
    expect(output(result)).toMatchObject({
      found: true,
      order_id: "ord_1001",
      carrier: "UPS",
      status: "delivered",
    });
  });

  it("shipment_tracking_lookup requires at least one identifier", async () => {
    const result = await run("shipment_tracking_lookup", {});
    expect(result.status).toBe("failed");
    if (result.status !== "succeeded") {
      expect(result.error.code).toBe("invalid_arguments");
    }
  });

  it("refund_eligibility approves a delivery within the return window", async () => {
    // ord_1001 delivered 2026-06-04, evaluated 2026-07-03 (29 days) → eligible.
    const result = await run("refund_eligibility", { order_id: "ord_1001" });
    expect(output(result)).toMatchObject({
      found: true,
      eligible: true,
      reason: "within_return_window",
      refundable_amount_cents: 8900,
    });
  });

  it("refund_eligibility rejects a delivery past the return window", async () => {
    const store = createInMemoryToolRegistryStore(
      globalDefs(FIRST_PARTY_NAMES),
    );
    const executor = createToolExecutor({
      store,
      tools: createFirstPartyTools({
        dataset: createSampleCommerceDataset(),
        kbRetrieval: stubKbRetrieval([]),
        now: () => new Date("2026-08-01T00:00:00.000Z"), // ~58 days after delivery
      }),
    });
    const result = await executor.execute(context(), {
      tool_name: "refund_eligibility",
      arguments: { order_id: "ord_1001" },
    });
    expect(output(result)).toMatchObject({
      eligible: false,
      reason: "return_window_expired",
      refundable_amount_cents: 0,
    });
  });

  it("cancellation_eligibility allows a paid, unshipped order", async () => {
    const result = await run("cancellation_eligibility", {
      order_id: "ord_1002",
    });
    expect(output(result)).toMatchObject({
      eligible: true,
      reason: "before_fulfillment",
    });
  });

  it("cancellation_eligibility rejects a shipped order", async () => {
    const result = await run(
      "cancellation_eligibility",
      { order_id: "ord_2001" },
      TENANT_GLOBEX,
    );
    expect(output(result)).toMatchObject({
      eligible: false,
      reason: "already_shipped",
    });
  });

  it("customer_profile_lookup returns a bounded profile", async () => {
    const result = await run("customer_profile_lookup", {
      customer_id: "cus_ada",
    });
    expect(output(result)).toEqual({
      found: true,
      customer_id: "cus_ada",
      display_name: "Ada Lovelace",
      email: "ada@example.com",
      tier: "vip",
      lifetime_orders: 12,
      member_since: "2025-01-15T00:00:00.000Z",
    });
  });

  it("kb_search reuses retrieval and returns cited, bounded results", async () => {
    const result = await run("kb_search", { query: "refund policy" });
    const out = output(result);
    expect(out).toMatchObject({ query: "refund policy", result_count: 2 });
    const results = out.results as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({
      kb_chunk_id: "kbc_1",
      document_title: "Return Policy",
    });
    // The AI-facing projection omits the raw metadata / tenant fields.
    expect(results[0]).not.toHaveProperty("metadata");
    expect(results[0]).not.toHaveProperty("tenant_id");
  });

  it("kb_search validates its arguments", async () => {
    const result = await run("kb_search", { query: "" });
    expect(result.status).toBe("failed");
  });

  it("exposes all six first-party tool definitions", () => {
    const { executor } = harness();
    const names = executor.listTools().map((tool) => tool.name);
    expect(names.sort()).toEqual([...FIRST_PARTY_NAMES].sort());
  });
});
