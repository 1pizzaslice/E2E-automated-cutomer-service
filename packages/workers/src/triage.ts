import type { TicketPriority } from "@support/shared-schemas";

/**
 * Deterministic initial-triage classification (Milestone 13). Runs before the
 * AI graph to persist first-pass ticket metadata (topic, priority, language)
 * and to route hard-sensitive conversations straight to manual escalation.
 * The keyword rules deliberately mirror the deterministic support model in
 * `ai/runtime/providers.py` so triage and the AI graph agree on topics and on
 * what counts as human-only; the real classifier replaces both behind the
 * same seams in Milestone 15.
 */
export interface InitialTriageClassification {
  readonly topic: string;
  readonly subtopic: string | null;
  readonly priority: TicketPriority;
  readonly language: string | null;
  readonly route: "human_approval" | "manual_escalation";
  readonly reasonCode: string | null;
  readonly sensitiveFlags: readonly string[];
}

const LEGAL_TERMS = [
  "legal action",
  "lawyer",
  "attorney",
  "lawsuit",
  "sue you",
  "my legal",
  "small claims",
] as const;

const CHARGEBACK_TERMS = [
  "chargeback",
  "dispute the charge",
  "disputing the charge",
] as const;

const FRAUD_TERMS = [
  "fraud",
  "fraudulent",
  "unauthorized charge",
  "identity theft",
  "scam",
] as const;

const SAFETY_TERMS = [
  "caught fire",
  "fire hazard",
  "injured",
  "injury",
  "unsafe",
  "electric shock",
] as const;

const REFUND_TERMS = [
  "refund",
  "money back",
  "reimburse",
  "return my money",
] as const;

const CANCEL_TERMS = ["cancel", "cancellation"] as const;

const SHIPPING_DELAY_TERMS = [
  "late",
  "delayed",
  "hasn't arrived",
  "has not arrived",
  "still waiting",
] as const;

const ORDER_STATUS_TERMS = [
  "tracking",
  "order status",
  "shipping status",
  "track my order",
  "where is my order",
  "where's my order",
] as const;

const URGENT_TERMS = [
  "urgent",
  "asap",
  "immediately",
  "right now",
  "need it today",
  "emergency",
  "time-sensitive",
] as const;

export function classifyInitialTriage(
  bodyText: string | null,
): InitialTriageClassification {
  const text = (bodyText ?? "").toLowerCase();
  const sensitiveFlags: string[] = [];

  if (containsAny(text, LEGAL_TERMS)) {
    sensitiveFlags.push("legal_threat");
  }
  if (containsAny(text, CHARGEBACK_TERMS)) {
    sensitiveFlags.push("chargeback");
  }
  if (containsAny(text, FRAUD_TERMS)) {
    sensitiveFlags.push("fraud_suspicion");
  }
  if (containsAny(text, SAFETY_TERMS)) {
    sensitiveFlags.push("safety_issue");
  }

  const urgent = containsAny(text, URGENT_TERMS);
  const language = detectLanguage(bodyText);

  if (sensitiveFlags.length > 0) {
    const topic =
      sensitiveFlags.includes("fraud_suspicion") &&
      !sensitiveFlags.includes("legal_threat") &&
      !sensitiveFlags.includes("chargeback")
        ? "fraud_or_abuse"
        : sensitiveFlags.includes("safety_issue") && sensitiveFlags.length === 1
          ? "safety"
          : "legal_or_chargeback";

    return {
      topic,
      subtopic: sensitiveFlags[0] ?? null,
      priority: "p1",
      language,
      route: "manual_escalation",
      reasonCode: `sensitive_topic:${sensitiveFlags[0]}`,
      sensitiveFlags,
    };
  }

  let topic = "general";
  let subtopic: string | null = null;

  if (containsAny(text, REFUND_TERMS)) {
    topic = "refund";
    subtopic = "eligibility";
  } else if (containsAny(text, CANCEL_TERMS)) {
    topic = "cancellation";
    subtopic = "eligibility";
  } else if (containsAny(text, SHIPPING_DELAY_TERMS)) {
    topic = "shipping_delay";
    subtopic = "late";
  } else if (containsAny(text, ORDER_STATUS_TERMS)) {
    topic = "order_status";
    subtopic = "tracking";
  }

  return {
    topic,
    subtopic,
    priority: urgent ? "p1" : "p2",
    language,
    route: "human_approval",
    reasonCode: `triage_${topic}`,
    sensitiveFlags,
  };
}

/**
 * Pick the more urgent of two priorities (p0 is highest). Triage may raise a
 * ticket's priority above the SLA-policy default but never lowers it.
 */
export function escalatePriority(
  current: TicketPriority,
  candidate: TicketPriority,
): TicketPriority {
  const order: readonly TicketPriority[] = ["p0", "p1", "p2", "p3"];
  return order.indexOf(candidate) < order.indexOf(current)
    ? candidate
    : current;
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

/**
 * Minimal language heuristic for v1 metadata: ASCII-dominant text is tagged
 * "en", anything else is left null (unknown) rather than guessed. The real
 * model provides language detection in Milestone 15.
 */
function detectLanguage(bodyText: string | null): string | null {
  if (!bodyText || bodyText.trim().length === 0) {
    return null;
  }

  const letters = [...bodyText].filter((char) => /\p{L}/u.test(char));

  if (letters.length === 0) {
    return null;
  }

  const asciiLetters = letters.filter((char) => /[A-Za-z]/.test(char));

  return asciiLetters.length / letters.length >= 0.9 ? "en" : null;
}
