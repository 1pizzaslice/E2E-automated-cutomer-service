import { describe, expect, it } from "vitest";
import { classifyInitialTriage, escalatePriority } from "./triage.js";

describe("classifyInitialTriage", () => {
  it("routes refund requests to human approval with the refund topic", () => {
    const result = classifyInitialTriage(
      "Hi, I would like a refund for order #1042 — the size is wrong.",
    );

    expect(result).toMatchObject({
      topic: "refund",
      subtopic: "eligibility",
      priority: "p2",
      language: "en",
      route: "human_approval",
      reasonCode: "triage_refund",
      sensitiveFlags: [],
    });
  });

  it("classifies cancellations, shipping delays, order status, and general", () => {
    expect(classifyInitialTriage("Please cancel my order").topic).toBe(
      "cancellation",
    );
    expect(
      classifyInitialTriage("My package is late and hasn't arrived").topic,
    ).toBe("shipping_delay");
    expect(
      classifyInitialTriage("Can you share the tracking for my order?").topic,
    ).toBe("order_status");
    expect(
      classifyInitialTriage("What material are your products made of?").topic,
    ).toBe("general");
  });

  it("raises priority for urgent language", () => {
    const result = classifyInitialTriage(
      "I need this fixed immediately, it's urgent!",
    );

    expect(result.priority).toBe("p1");
    expect(result.route).toBe("human_approval");
  });

  it("escalates legal threats to manual handling", () => {
    const result = classifyInitialTriage(
      "If this is not resolved I will take legal action and call my lawyer.",
    );

    expect(result.route).toBe("manual_escalation");
    expect(result.topic).toBe("legal_or_chargeback");
    expect(result.priority).toBe("p1");
    expect(result.sensitiveFlags).toContain("legal_threat");
    expect(result.reasonCode).toBe("sensitive_topic:legal_threat");
  });

  it("escalates chargebacks, fraud, and safety issues", () => {
    expect(
      classifyInitialTriage("I already filed a chargeback with my bank").route,
    ).toBe("manual_escalation");
    expect(
      classifyInitialTriage("There is an unauthorized charge on my card").topic,
    ).toBe("fraud_or_abuse");

    const safety = classifyInitialTriage(
      "The charger caught fire while plugged in!",
    );
    expect(safety.route).toBe("manual_escalation");
    expect(safety.topic).toBe("safety");
    expect(safety.sensitiveFlags).toEqual(["safety_issue"]);
  });

  it("does not escalate a refund request that merely mentions a dispute topic keyword safely", () => {
    const result = classifyInitialTriage("I want my money back please");

    expect(result.route).toBe("human_approval");
    expect(result.topic).toBe("refund");
  });

  it("tags ASCII-dominant text as English and leaves other text unknown", () => {
    // Known v1 limitation: any Latin-script text passes the ASCII heuristic,
    // so e.g. Spanish is also tagged "en" until the real language detector
    // lands in Milestone 15. Non-Latin scripts stay null rather than guessed.
    expect(classifyInitialTriage("Where is my order?").language).toBe("en");
    expect(classifyInitialTriage("Где мой заказ? Помогите").language).toBe(
      null,
    );
    expect(classifyInitialTriage("").language).toBe(null);
    expect(classifyInitialTriage(null).language).toBe(null);
  });

  it("is deterministic for identical input", () => {
    const text = "Please cancel my order asap";
    expect(classifyInitialTriage(text)).toEqual(classifyInitialTriage(text));
  });
});

describe("escalatePriority", () => {
  it("raises but never lowers priority", () => {
    expect(escalatePriority("p2", "p1")).toBe("p1");
    expect(escalatePriority("p1", "p2")).toBe("p1");
    expect(escalatePriority("p3", "p0")).toBe("p0");
    expect(escalatePriority("p2", "p2")).toBe("p2");
  });
});
