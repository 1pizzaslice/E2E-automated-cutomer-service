import { getActiveTraceContext } from "@support/observability";
import { deterministicAiRunId } from "./ticket-lifecycle-persistence.js";
import type {
  RunAiGraphActivityInput,
  RunAiGraphActivityResult,
  TicketLifecycleAiRiskLevel,
} from "../workflows/ticket-lifecycle-types.js";

/**
 * Deterministic in-process `runAiGraph` implementation (Milestone 13). It
 * stands in for the Python AI runtime so the production worker runs the
 * entire lifecycle end to end before the Milestone 14 HTTP sidecar bridge
 * lands: given the same ticket and triage it always produces the same
 * templated, human-approval-only draft. It never recommends auto-send, never
 * promises refunds or account actions, and executes no tools.
 */
export function createDeterministicRunAiGraph(): (
  input: RunAiGraphActivityInput,
) => Promise<RunAiGraphActivityResult> {
  return async (input) => {
    const topic = readTriageString(input, "topic") ?? "general";
    const language = readTriageString(input, "language") ?? "en";
    const riskLevel: TicketLifecycleAiRiskLevel =
      topic === "refund" || topic === "cancellation" ? "medium" : "low";
    const draftText = draftForTopic(topic);

    return {
      status: "succeeded",
      ai_run_id: deterministicAiRunId(
        input.tenant_id,
        input.ticket_id,
        input.correlation_id,
      ),
      trace_id: getActiveTraceContext()?.trace_id ?? null,
      classification: {
        topic,
        subtopic: readTriageString(input, "subtopic"),
        language,
        source: "initial_triage",
      },
      routing_decision: {
        topic,
        subtopic: readTriageString(input, "subtopic"),
        language,
        sentiment: null,
        urgency: null,
        priority: input.ticket.priority,
        risk_level: riskLevel,
        confidence: DETERMINISTIC_CONFIDENCE,
        automation_mode: "human_approve",
        assigned_queue: input.ticket.assigned_queue,
        reason_codes: ["deterministic_stand_in_model"],
        required_tools: [],
        required_evidence: [],
      },
      tool_calls: [],
      draft: {
        draft_text: draftText,
        customer_language: language,
        tone: "friendly",
        evidence: [],
        actions: [],
        risk_level: riskLevel,
        confidence: DETERMINISTIC_CONFIDENCE,
        needs_human: true,
        human_review_reasons: ["deterministic_stand_in_model"],
      },
      guardrails: {
        passed: true,
        checks: ["deterministic_template"],
        issues: [],
      },
      final_recommendation: {
        automation_mode: "human_approve",
        risk_level: riskLevel,
        confidence: DETERMINISTIC_CONFIDENCE,
        reason_codes: ["deterministic_stand_in_model"],
      },
      eval_signals: {
        model_id: "deterministic-support-model.v1",
        topic,
      },
    };
  };
}

const DETERMINISTIC_CONFIDENCE = 0.6;

function readTriageString(
  input: RunAiGraphActivityInput,
  key: string,
): string | null {
  const value = input.triage.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Templated acknowledgements per triage topic. Deliberately commitment-free:
 * they acknowledge, state the next step, and leave any account or money
 * action to the human reviewer who approves (or rewrites) the draft.
 */
function draftForTopic(topic: string): string {
  switch (topic) {
    case "refund":
      return "Thanks for reaching out about your refund request. We've received it and a member of our support team is reviewing your order details now. We'll follow up shortly with the outcome and next steps.";
    case "cancellation":
      return "Thanks for contacting us about cancelling your order. We've logged your request and our team is checking its current status. We'll confirm what's possible and follow up with you shortly.";
    case "shipping_delay":
      return "Thanks for letting us know your order hasn't arrived yet — sorry about the wait. We're checking the shipment status with our carrier now and will update you as soon as we know more.";
    case "order_status":
      return "Thanks for your message about your order. We're looking up its latest status and tracking details now and will get back to you shortly with an update.";
    default:
      return "Thanks for reaching out to our support team. We've received your message and someone is looking into it now. We'll get back to you shortly with more details.";
  }
}
