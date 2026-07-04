import { describe, expect, it } from "vitest";
import {
  DISABLED_AUTOMATION_POLICY,
  createInMemoryAutomationPolicyStore,
  evaluateAutoSendEligibility,
  type ResolvedAutomationPolicy,
} from "./automation-policy.js";
import type {
  RunAiGraphActivityResult,
  RunAiGraphSucceededActivityResult,
} from "./workflows/ticket-lifecycle-types.js";

const enabledPolicy: ResolvedAutomationPolicy = {
  configured: true,
  policyVersionId: "polv_automation_1",
  autoSendEnabled: true,
  autoSendAllowedTopics: ["faq"],
};

function succeededResult(
  overrides: Partial<RunAiGraphSucceededActivityResult> = {},
): RunAiGraphSucceededActivityResult {
  return {
    status: "succeeded",
    ai_run_id: "air_test",
    trace_id: "trace_test",
    classification: {},
    routing_decision: {
      topic: "faq",
      subtopic: null,
      language: "en",
      sentiment: "neutral",
      urgency: null,
      priority: "p3",
      risk_level: "low",
      confidence: 0.95,
      automation_mode: "auto_send",
      assigned_queue: null,
      reason_codes: ["auto_send_allowlisted"],
      required_tools: [],
      required_evidence: ["kb_faq"],
    },
    tool_calls: [],
    draft: {
      draft_text: "Our support hours are 9am to 5pm UTC, Monday to Friday.",
      customer_language: "en",
      tone: "friendly",
      evidence: [{ type: "kb", ref_id: "kb_faq", summary: "Support hours" }],
      actions: [],
      risk_level: "low",
      confidence: 0.95,
      needs_human: false,
      human_review_reasons: [],
    },
    guardrails: { passed: true, issues: [] },
    final_recommendation: {
      automation_mode: "auto_send",
      risk_level: "low",
      confidence: 0.95,
      reason_codes: ["auto_send_allowlisted"],
    },
    eval_signals: {},
    ...overrides,
  };
}

const failedResult: RunAiGraphActivityResult = {
  status: "failed",
  ai_run_id: null,
  trace_id: null,
  error_code: "AI_RUNTIME_ERROR",
  error_message: "model unavailable",
  retryable: false,
  reason_codes: ["ai_runtime_error"],
  eval_signals: {},
};

describe("auto-send eligibility gate", () => {
  it("is eligible only when every control passes", () => {
    const eligibility = evaluateAutoSendEligibility(
      enabledPolicy,
      succeededResult(),
    );

    expect(eligibility).toEqual({
      eligible: true,
      topic: "faq",
      policyVersionId: "polv_automation_1",
    });
  });

  it("fails closed when no automation policy is configured (default)", () => {
    const eligibility = evaluateAutoSendEligibility(
      DISABLED_AUTOMATION_POLICY,
      succeededResult(),
    );

    expect(eligibility).toEqual({
      eligible: false,
      reasonCode: "auto_send_disabled",
    });
  });

  it("honors the tenant kill switch over any AI recommendation", () => {
    const eligibility = evaluateAutoSendEligibility(
      { ...enabledPolicy, autoSendEnabled: false },
      succeededResult(),
    );

    expect(eligibility).toEqual({
      eligible: false,
      reasonCode: "auto_send_disabled",
    });
  });

  it("requires the topic to be on the tenant allowlist", () => {
    const offTopic = succeededResult();
    const eligibility = evaluateAutoSendEligibility(
      { ...enabledPolicy, autoSendAllowedTopics: ["order_status"] },
      offTopic,
    );

    expect(eligibility).toEqual({
      eligible: false,
      reasonCode: "topic_not_allowlisted",
    });
  });

  it("never auto-sends a failed AI run", () => {
    expect(evaluateAutoSendEligibility(enabledPolicy, failedResult)).toEqual({
      eligible: false,
      reasonCode: "ai_run_not_succeeded",
    });
  });

  it("requires an explicit auto_send recommendation", () => {
    const humanApprove = succeededResult({
      final_recommendation: {
        automation_mode: "human_approve",
        risk_level: "low",
        confidence: 0.9,
        reason_codes: ["v1_default_human_approval"],
      },
    });

    expect(evaluateAutoSendEligibility(enabledPolicy, humanApprove)).toEqual({
      eligible: false,
      reasonCode: "ai_did_not_recommend_auto_send",
    });
  });

  it("blocks non-low risk, failed guardrails, missing drafts, and missing topics", () => {
    expect(
      evaluateAutoSendEligibility(
        enabledPolicy,
        succeededResult({
          final_recommendation: {
            automation_mode: "auto_send",
            risk_level: "medium",
            confidence: 0.9,
            reason_codes: [],
          },
        }),
      ),
    ).toEqual({ eligible: false, reasonCode: "risk_not_low" });

    expect(
      evaluateAutoSendEligibility(
        enabledPolicy,
        succeededResult({ guardrails: { passed: false } }),
      ),
    ).toEqual({ eligible: false, reasonCode: "guardrails_not_passed" });

    expect(
      evaluateAutoSendEligibility(
        enabledPolicy,
        succeededResult({ guardrails: {} }),
      ),
    ).toEqual({ eligible: false, reasonCode: "guardrails_not_passed" });

    expect(
      evaluateAutoSendEligibility(
        enabledPolicy,
        succeededResult({ draft: null }),
      ),
    ).toEqual({ eligible: false, reasonCode: "no_draft" });

    const noTopic = succeededResult();
    expect(
      evaluateAutoSendEligibility(enabledPolicy, {
        ...noTopic,
        routing_decision: { ...noTopic.routing_decision, topic: null },
      }),
    ).toEqual({ eligible: false, reasonCode: "no_topic" });
  });
});

describe("automation policy store", () => {
  it("defaults unknown tenants to the disabled policy", async () => {
    const store = createInMemoryAutomationPolicyStore({
      ten_configured: enabledPolicy,
    });

    await expect(
      store.getActiveAutomationPolicy("ten_configured"),
    ).resolves.toEqual(enabledPolicy);
    await expect(
      store.getActiveAutomationPolicy("ten_unknown"),
    ).resolves.toEqual(DISABLED_AUTOMATION_POLICY);
  });
});
