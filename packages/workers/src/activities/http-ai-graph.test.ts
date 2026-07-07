import { describe, expect, it } from "vitest";
import {
  createInMemoryAutomationPolicyStore,
  type ResolvedAutomationPolicy,
} from "../automation-policy.js";
import type { RunAiGraphActivityInput } from "../workflows/ticket-lifecycle-types.js";
import {
  createInMemoryAiGraphContextStore,
  type AiGraphConversationContext,
} from "./ai-graph-context.js";
import {
  AI_SIDECAR_ERROR_CODES,
  createHttpRunAiGraph,
  type HttpRunAiGraphOptions,
} from "./http-ai-graph.js";

const TENANT = "ten_http_ai_graph";
const CONVERSATION = "cnv_http_ai_graph";

const input: RunAiGraphActivityInput = {
  tenant_id: TENANT,
  ticket_id: "tkt_http_ai_graph",
  initial_message_id: "msg_initial",
  correlation_id: "corr_http_ai_graph",
  ticket: {
    ticket_id: "tkt_http_ai_graph",
    conversation_id: CONVERSATION,
    customer_id: "cus_1",
    status: "waiting_ai",
    priority: "p2",
    automation_mode: "human_approve",
    assigned_queue: "default_queue",
    assigned_user_id: null,
    sla_policy_id: null,
    opened_at: "2026-07-05T00:00:00.000Z",
    first_response_due_at: null,
    next_response_due_at: null,
    resolution_due_at: null,
  },
  triage: {
    status: "triaged",
    route: "human_approval",
    reason_code: null,
    metadata: { topic: "refund", language: "en" },
  },
};

const conversationContext: AiGraphConversationContext = {
  messages: [
    {
      role: "customer",
      content: "I would like a refund for order 1234.",
      is_internal: false,
    },
  ],
  customer: {
    customer_id: "cus_1",
    email: "customer@example.com",
    display_name: "Casey Customer",
    tier: "standard",
    locale: null,
  },
  tenant: { brand_name: "Acme Outfitters", timezone: "UTC" },
};

const enabledPolicy: ResolvedAutomationPolicy = {
  configured: true,
  policyVersionId: "polv_automation_1",
  autoSendEnabled: true,
  autoSendAllowedTopics: ["faq", "order_status"],
};

function sidecarSuccessPayload(): Record<string, unknown> {
  return {
    status: "succeeded",
    ai_run_id: "air_sidecar_1",
    trace_id: "trace_sidecar_1",
    classification: { topic: "refund", priority: "p2", language: "en" },
    routing_decision: {
      topic: "refund",
      subtopic: "eligibility",
      language: "en",
      sentiment: "frustrated",
      urgency: "normal",
      priority: "p3",
      risk_level: "medium",
      confidence: 0.82,
      automation_mode: "human_approve",
      assigned_queue: null,
      reason_codes: ["refund_topic"],
      required_tools: ["refund_eligibility"],
      required_evidence: ["kb_chunk_1"],
    },
    tool_calls: [{ tool_name: "refund_eligibility", status: "succeeded" }],
    draft: {
      draft_text: "Thanks for reaching out about your refund.",
      customer_language: "en",
      tone: "helpful_professional",
      evidence: [{ type: "kb_chunk", ref_id: "kb_chunk_1", summary: "Policy" }],
      actions: [],
      risk_level: "medium",
      confidence: 0.82,
      needs_human: true,
      human_review_reasons: ["refund_topic"],
    },
    guardrails: { passed: true, risk_level: "medium", issues: [] },
    final_recommendation: {
      automation_mode: "human_approve",
      risk_level: "medium",
      confidence: 0.82,
      reason_codes: ["refund_topic"],
    },
    approval_package: { suggested_action: "human_approve" },
    eval_signals: { topic: "refund", escalated: true },
    model: {
      provider: "anthropic",
      model_id: "claude-opus-4-8",
      prompt_versions: {
        "support_classifier.v1": "v1",
        "support_response_composer.v1": "v1",
      },
      calls: 2,
      input_tokens: 1500,
      output_tokens: 420,
      latency_ms: 1800,
      cost_estimate: 0.018,
    },
  };
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function makeFetch(responses: Array<Response | Error>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];

  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();

    if (!next) {
      throw new Error("fake fetch exhausted");
    }

    if (next instanceof Error) {
      throw next;
    }

    return next;
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeActivity(
  fetchSetup: { fetchImpl: typeof fetch },
  overrides: Partial<HttpRunAiGraphOptions> = {},
) {
  return createHttpRunAiGraph({
    baseUrl: "http://sidecar.local:8090/",
    serviceToken: "test-service-token",
    policyStore: createInMemoryAutomationPolicyStore({
      [TENANT]: enabledPolicy,
    }),
    contextStore: createInMemoryAiGraphContextStore({
      [`${TENANT}:${CONVERSATION}`]: conversationContext,
    }),
    fetchImpl: fetchSetup.fetchImpl,
    sleep: async () => {},
    ...overrides,
  });
}

describe("createHttpRunAiGraph", () => {
  it("maps a succeeded sidecar run onto the activity contract", async () => {
    const fetchSetup = makeFetch([jsonResponse(sidecarSuccessPayload())]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("succeeded");

    if (result.status !== "succeeded") {
      throw new Error("expected success");
    }

    expect(result.ai_run_id).toBe("air_sidecar_1");
    expect(result.trace_id).toBe("trace_sidecar_1");
    // The platform ticket priority stays authoritative; the runtime's
    // classification priority (platform p0-p3 since Milestone 15) remains
    // visible in `classification`.
    expect(result.routing_decision.priority).toBe("p2");
    expect(result.classification["priority"]).toBe("p2");
    expect(result.routing_decision.risk_level).toBe("medium");
    // Null sidecar queue falls back to the ticket's assigned queue.
    expect(result.routing_decision.assigned_queue).toBe("default_queue");
    expect(result.draft?.draft_text).toContain("refund");
    expect(result.final_recommendation.automation_mode).toBe("human_approve");
    expect(result.eval_signals["topic"]).toBe("refund");
    // approval_package is not part of the activity contract.
    expect("approval_package" in result).toBe(false);
    // The runtime-reported model usage passes through for ai_runs persistence.
    expect(result.model).toMatchObject({
      provider: "anthropic",
      model_id: "claude-opus-4-8",
      input_tokens: 1500,
      output_tokens: 420,
      cost_estimate: 0.018,
    });
  });

  it("sends the sidecar request with auth, correlation, and policy context", async () => {
    const fetchSetup = makeFetch([jsonResponse(sidecarSuccessPayload())]);
    const activity = makeActivity(fetchSetup);

    await activity(input);

    expect(fetchSetup.calls).toHaveLength(1);
    const call = fetchSetup.calls[0]!;
    expect(call.url).toBe("http://sidecar.local:8090/internal/ai/run");

    const headers = call.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-service-token");
    expect(headers["x-correlation-id"]).toBe(input.correlation_id);

    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body["tenant_id"]).toBe(TENANT);
    expect(body["conversation_id"]).toBe(CONVERSATION);
    expect(body["messages"]).toEqual([...conversationContext.messages]);
    expect(body["policy"]).toEqual({
      auto_send_allowed_topics: ["faq", "order_status"],
      active_policy_version_ids: ["polv_automation_1"],
    });
    expect(body["options"]).toEqual({
      allow_auto_send: true,
      max_tool_calls: 4,
      max_retrieved_chunks: 8,
    });
    expect(body["tenant"]).toEqual({
      brand_name: "Acme Outfitters",
      tone: "helpful_professional",
      timezone: "UTC",
    });
    expect(body["ai_run_type"]).toBe("full_graph");
  });

  it("fails closed on policy when the tenant has none configured", async () => {
    const fetchSetup = makeFetch([jsonResponse(sidecarSuccessPayload())]);
    const activity = makeActivity(fetchSetup, {
      policyStore: createInMemoryAutomationPolicyStore(),
    });

    await activity(input);

    const body = JSON.parse(String(fetchSetup.calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(body["policy"]).toEqual({
      auto_send_allowed_topics: [],
      active_policy_version_ids: [],
    });
    expect(
      (body["options"] as Record<string, unknown>)["allow_auto_send"],
    ).toBe(false);
  });

  it("omits the authorization header when no service token is configured", async () => {
    const fetchSetup = makeFetch([jsonResponse(sidecarSuccessPayload())]);
    const activity = makeActivity(fetchSetup, { serviceToken: null });

    await activity(input);

    const headers = fetchSetup.calls[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });

  it("retries transient transport failures and succeeds", async () => {
    const sleeps: number[] = [];
    const fetchSetup = makeFetch([
      new Error("connect ECONNREFUSED"),
      new Error("connect ECONNREFUSED"),
      jsonResponse(sidecarSuccessPayload()),
    ]);
    const activity = makeActivity(fetchSetup, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      retryDelayMs: 100,
    });

    const result = await activity(input);

    expect(result.status).toBe("succeeded");
    expect(fetchSetup.calls).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("returns a structured retryable failure when the sidecar is unreachable", async () => {
    const fetchSetup = makeFetch([
      new Error("connect ECONNREFUSED"),
      new Error("connect ECONNREFUSED"),
      new Error("connect ECONNREFUSED"),
    ]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.unavailable);
    expect(result.retryable).toBe(true);
    expect(result.reason_codes).toContain("route_to_human");
    expect(result.eval_signals["attempts"]).toBe(3);
    expect(fetchSetup.calls).toHaveLength(3);
  });

  it("treats sidecar 5xx as transient and reports it after exhausting retries", async () => {
    const fetchSetup = makeFetch([
      jsonResponse({ error: "boom" }, 503),
      jsonResponse({ error: "boom" }, 503),
      jsonResponse({ error: "boom" }, 503),
    ]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.serverError);
    expect(result.retryable).toBe(true);
  });

  it("fails permanently on an auth rejection without retrying", async () => {
    const fetchSetup = makeFetch([jsonResponse({ error: "no" }, 401)]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.unauthorized);
    expect(result.retryable).toBe(false);
    expect(fetchSetup.calls).toHaveLength(1);
  });

  it("fails permanently when the sidecar rejects the request as invalid", async () => {
    const fetchSetup = makeFetch([jsonResponse({ error: "bad" }, 400)]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.rejected);
    expect(result.retryable).toBe(false);
  });

  it("fails permanently when a 200 body does not match the contract", async () => {
    const fetchSetup = makeFetch([jsonResponse({ status: "succeeded" })]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.contract);
    expect(result.retryable).toBe(false);
  });

  it("passes a structured runtime failure through unchanged", async () => {
    const fetchSetup = makeFetch([
      jsonResponse({
        status: "failed",
        ai_run_id: null,
        trace_id: "trace_failed_run",
        error_code: "INPUT_VALIDATION_FAILED",
        error_message:
          "request must contain at least one customer-visible message",
        retryable: false,
        reason_codes: ["input_invalid", "route_to_human"],
        eval_signals: { stage: "input_validation" },
      }),
    ]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe("INPUT_VALIDATION_FAILED");
    expect(result.trace_id).toBe("trace_failed_run");
    expect(result.reason_codes).toEqual(["input_invalid", "route_to_human"]);
  });

  it("fails without calling the sidecar when conversation context is missing", async () => {
    const fetchSetup = makeFetch([]);
    const activity = makeActivity(fetchSetup, {
      contextStore: createInMemoryAiGraphContextStore(),
    });

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.contextUnavailable);
    expect(result.retryable).toBe(false);
    expect(fetchSetup.calls).toHaveLength(0);
  });

  it("fails without calling the sidecar when no customer-visible message exists", async () => {
    const fetchSetup = makeFetch([]);
    const activity = makeActivity(fetchSetup, {
      contextStore: createInMemoryAiGraphContextStore({
        [`${TENANT}:${CONVERSATION}`]: {
          ...conversationContext,
          messages: [
            { role: "agent", content: "internal note", is_internal: true },
          ],
        },
      }),
    });

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_code).toBe(AI_SIDECAR_ERROR_CODES.contextUnavailable);
    expect(fetchSetup.calls).toHaveLength(0);
  });

  it("describes timeouts distinctly in the failure message", async () => {
    const timeoutError = new Error("The operation was aborted");
    timeoutError.name = "TimeoutError";
    const fetchSetup = makeFetch([timeoutError, timeoutError, timeoutError]);
    const activity = makeActivity(fetchSetup);

    const result = await activity(input);

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      throw new Error("expected failure");
    }

    expect(result.error_message).toContain("request timed out");
  });
});
