import { describe, expect, it } from "vitest";
import { createDeterministicRunAiGraph } from "./deterministic-ai-graph.js";
import { deterministicAiRunId } from "./ticket-lifecycle-persistence.js";
import type {
  RunAiGraphActivityInput,
  RunAiGraphSucceededActivityResult,
} from "../workflows/ticket-lifecycle-types.js";

function makeInput(
  overrides: {
    readonly topic?: string;
    readonly language?: string;
  } = {},
): RunAiGraphActivityInput {
  return {
    tenant_id: "ten_test",
    ticket_id: "tkt_cnv_test",
    initial_message_id: "msg_test",
    correlation_id: "corr-test",
    ticket: {
      ticket_id: "tkt_cnv_test",
      conversation_id: "cnv_test",
      customer_id: "cus_test",
      status: "triaged",
      priority: "p2",
      automation_mode: "human_approve",
      assigned_queue: null,
      assigned_user_id: null,
      sla_policy_id: "sla_test",
      opened_at: "2026-07-04T00:00:00.000Z",
      first_response_due_at: "2026-07-04T01:00:00.000Z",
      next_response_due_at: null,
      resolution_due_at: null,
    },
    triage: {
      status: "triaged",
      route: "human_approval",
      reason_code: "triage_refund",
      metadata: {
        topic: overrides.topic ?? "refund",
        language: overrides.language ?? "en",
      },
    },
  };
}

describe("createDeterministicRunAiGraph", () => {
  it("produces a deterministic human-approval draft with the persisted run id", async () => {
    const runAiGraph = createDeterministicRunAiGraph();

    const first = await runAiGraph(makeInput());
    const second = await runAiGraph(makeInput());

    expect(first).toEqual(second);
    expect(first.status).toBe("succeeded");

    const succeeded = first as RunAiGraphSucceededActivityResult;
    expect(succeeded.ai_run_id).toBe(
      deterministicAiRunId("ten_test", "tkt_cnv_test", "corr-test"),
    );
    expect(succeeded.final_recommendation.automation_mode).toBe(
      "human_approve",
    );
    expect(succeeded.draft?.needs_human).toBe(true);
    expect(succeeded.tool_calls).toEqual([]);
  });

  it("never recommends auto-send for any triage topic", async () => {
    const runAiGraph = createDeterministicRunAiGraph();

    for (const topic of [
      "refund",
      "cancellation",
      "shipping_delay",
      "order_status",
      "general",
    ]) {
      const result = await runAiGraph(makeInput({ topic }));
      expect(result.status).toBe("succeeded");

      const succeeded = result as RunAiGraphSucceededActivityResult;
      expect(succeeded.final_recommendation.automation_mode).toBe(
        "human_approve",
      );
      expect(succeeded.draft?.draft_text.length).toBeGreaterThan(20);
      // The templated drafts acknowledge without promising money or account
      // actions — commitments stay with the human reviewer.
      expect(succeeded.draft?.draft_text.toLowerCase()).not.toContain(
        "we have refunded",
      );
    }
  });

  it("marks refunds and cancellations as medium risk", async () => {
    const runAiGraph = createDeterministicRunAiGraph();

    const refund = (await runAiGraph(
      makeInput({ topic: "refund" }),
    )) as RunAiGraphSucceededActivityResult;
    const general = (await runAiGraph(
      makeInput({ topic: "general" }),
    )) as RunAiGraphSucceededActivityResult;

    expect(refund.final_recommendation.risk_level).toBe("medium");
    expect(general.final_recommendation.risk_level).toBe("low");
  });
});
