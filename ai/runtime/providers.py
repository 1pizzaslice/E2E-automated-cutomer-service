"""Model-provider abstraction (harness section 9).

The graph's model reasoning (classification and response drafting) goes through a
:class:`ModelProvider` port so that no business logic depends on provider-specific
raw response shapes. Two implementations are relevant:

* :class:`DeterministicSupportModel` — the offline, rule-based reference model
  used by unit tests and the eval runner. It is deterministic (same input →
  same output) so evals are reproducible, and it is written to be *safe by
  construction* (e.g. it never promises a refund without eligibility evidence).
* A real LLM adapter (deferred, ADR-0016) would implement the same
  ``invoke`` contract: build a prompt from ``ModelRequest.input``, call the
  provider SDK, and parse the JSON response into ``ModelResponse.output``. A
  minimal :class:`UnconfiguredLlmModel` marks that seam.

Prompt IDs and versions follow harness section 8.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .tracing import deterministic_id

PROMPT_CLASSIFIER = "support_classifier.v1"
PROMPT_COMPOSER = "support_response_composer.v1"


@dataclass(frozen=True)
class ModelMetadata:
    """Provider-agnostic call metadata (harness section 9)."""

    provider: str
    model_id: str
    request_id: str
    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_estimate: float = 0.0
    error_code: str | None = None


@dataclass(frozen=True)
class ModelRequest:
    prompt_id: str
    prompt_version: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ModelResponse:
    output: dict[str, Any]
    metadata: ModelMetadata


class ModelProvider(Protocol):
    def invoke(self, request: ModelRequest) -> ModelResponse: ...


class UnconfiguredLlmModel:
    """Placeholder real-provider adapter. The v1 graph runs on the deterministic
    model; a production deployment swaps a real SDK-backed provider in here."""

    def invoke(self, request: ModelRequest) -> ModelResponse:  # pragma: no cover
        raise NotImplementedError(
            "No LLM provider configured. Provide a ModelProvider backed by a real "
            "model SDK, or use DeterministicSupportModel for offline runs."
        )


# --- Keyword vocabularies for the deterministic classifier -------------------

_SAFETY_TERMS = ("kill myself", "suicide", "end my life", "harm myself", "self-harm", "hurt myself")
_LEGAL_TERMS = (
    "lawyer",
    "attorney",
    "sue you",
    "legal action",
    "take you to court",
    "small claims",
    "my legal",
)
_CHARGEBACK_TERMS = (
    "chargeback",
    "charge back",
    "dispute the charge",
    "dispute this charge",
    "reverse the charge",
    "disputing the charge",
)
_FRAUD_TERMS = (
    "fraud",
    "fraudulent",
    "unauthorized charge",
    "unauthorised charge",
    "someone hacked",
    "account was hacked",
    "stolen card",
    "did not authorize",
    "didn't make this purchase",
    "didn't authorize",
)
_REFUND_TERMS = ("refund", "money back", "reimburse", "return my money")
_CANCEL_TERMS = ("cancel", "cancellation")
_MISSING_TERMS = (
    "never arrived",
    "not received",
    "didn't arrive",
    "did not arrive",
    "missing package",
    "lost package",
    "package is missing",
    "hasn't arrived",
    "stolen package",
    "wasn't delivered",
)
_DELAY_TERMS = (
    "delayed",
    "delay",
    "still not shipped",
    "hasn't shipped",
    "taking too long",
    "when will it ship",
    "stuck in transit",
    "running late",
)
_ORDER_STATUS_TERMS = (
    "where is my order",
    "where's my order",
    "order status",
    "status of my order",
    "tracking",
    "track my",
    "order number",
    "when will it arrive",
    "has my order shipped",
)
_BILLING_TERMS = ("charged twice", "double charged", "billing", "invoice", "overcharged", "wrong amount")
_TECH_TERMS = (
    "not working",
    "doesn't work",
    "broken",
    "defective",
    "error message",
    "won't turn on",
    "stopped working",
    "damaged",
)
_FAQ_TERMS = (
    "return policy",
    "how do i",
    "how long",
    "do you offer",
    "what is your",
    "what's your",
    "your hours",
    "warranty",
    "shipping cost",
)
_PRODUCT_TERMS = ("is this compatible", "does this", "what size", "what color", "in stock", "material")

_INJECTION_PATTERNS = (
    "ignore previous instructions",
    "ignore all previous",
    "disregard previous",
    "disregard all",
    "system prompt",
    "reveal your prompt",
    "reveal your instructions",
    "you are now",
    "developer mode",
    "override policy",
    "forget your instructions",
    "act as",
    "print your system",
)

_ANGRY_TERMS = ("furious", "outraged", "disgusting", "worst", "unacceptable", "ridiculous", "!!!", "never buying", "scam")
_FRUSTRATED_TERMS = ("frustrated", "annoyed", "disappointed", "still waiting", "not happy", "poor service", "bad experience", "again and again")
_POSITIVE_TERMS = ("thank you", "thanks", "appreciate", "love ")
_URGENT_TERMS = ("urgent", "asap", "immediately", "right now", "need it today", "emergency", "time-sensitive")
_ABUSE_TERMS = ("idiot", "stupid", "hate you", "shut up")
_PRIVACY_TERMS = ("delete my data", "delete my account", "gdpr", "ccpa", "right to be forgotten", "my personal data")


def _match_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


class DeterministicSupportModel:
    """Rule-based, reproducible reference model for offline runs and evals."""

    provider_name = "deterministic"
    model_id = "deterministic-support-v1"

    def invoke(self, request: ModelRequest) -> ModelResponse:
        if request.prompt_id == PROMPT_CLASSIFIER:
            output = self._classify(request.input)
        elif request.prompt_id == PROMPT_COMPOSER:
            output = self._compose(request.input)
        else:
            raise ValueError(f"unknown prompt_id {request.prompt_id!r}")
        metadata = ModelMetadata(
            provider=self.provider_name,
            model_id=self.model_id,
            request_id=deterministic_id("req", request.prompt_id, repr(sorted(request.input.items()))),
            prompt_tokens=len(repr(request.input)) // 4,
            completion_tokens=len(repr(output)) // 4,
        )
        return ModelResponse(output=output, metadata=metadata)

    # -- classification -------------------------------------------------------

    def _classify(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = str(payload.get("text", "")).lower()
        customer_tier = str(payload.get("customer_tier", "standard"))

        sensitive: list[str] = []
        if _match_any(text, _INJECTION_PATTERNS):
            sensitive.append("prompt_injection")
        if _match_any(text, _SAFETY_TERMS):
            sensitive.append("safety_issue")
        if _match_any(text, _ABUSE_TERMS):
            sensitive.append("abusive_content")
        if _match_any(text, _PRIVACY_TERMS):
            sensitive.append("privacy_request")
        if customer_tier == "vip":
            sensitive.append("vip_customer")

        topic, subtopic = self._topic(text)
        if topic == "legal_or_chargeback":
            if _match_any(text, _CHARGEBACK_TERMS):
                sensitive.append("chargeback")
            if _match_any(text, _LEGAL_TERMS):
                sensitive.append("legal_threat")
        if topic == "fraud_or_abuse":
            sensitive.append("fraud_suspicion")

        sentiment = self._sentiment(text)
        urgency = "high" if _match_any(text, _URGENT_TERMS) else "normal"
        priority = self._priority(topic, sentiment, urgency, customer_tier, sensitive)
        confidence = 0.9 if topic != "unknown" else 0.55

        # De-duplicate while preserving order.
        seen: list[str] = []
        for flag in sensitive:
            if flag not in seen:
                seen.append(flag)

        return {
            "topic": topic,
            "subtopic": subtopic,
            "language": "en",
            "sentiment": sentiment,
            "urgency": urgency,
            "priority": priority,
            "sensitive_flags": seen,
            "confidence": confidence,
            "reasoning_summary": f"Detected topic {topic} from customer message.",
        }

    def _topic(self, text: str) -> tuple[str, str | None]:
        if _match_any(text, _LEGAL_TERMS) or _match_any(text, _CHARGEBACK_TERMS):
            return "legal_or_chargeback", "dispute"
        if _match_any(text, _FRAUD_TERMS):
            return "fraud_or_abuse", "unauthorized"
        if _match_any(text, _REFUND_TERMS):
            return "refund", "eligibility"
        if _match_any(text, _CANCEL_TERMS):
            return "cancellation", "eligibility"
        if _match_any(text, _MISSING_TERMS):
            return "missing_package", "not_delivered"
        if _match_any(text, _DELAY_TERMS):
            return "shipping_delay", "late"
        if _match_any(text, _ORDER_STATUS_TERMS):
            return "order_status", "tracking"
        if _match_any(text, _BILLING_TERMS):
            return "billing", None
        if _match_any(text, _TECH_TERMS):
            return "technical_issue", None
        if _match_any(text, _PRODUCT_TERMS):
            return "product_question", None
        if _match_any(text, _FAQ_TERMS):
            return "faq", None
        return "unknown", None

    def _sentiment(self, text: str) -> str:
        if _match_any(text, _ANGRY_TERMS):
            return "angry"
        if _match_any(text, _FRUSTRATED_TERMS):
            return "frustrated"
        if _match_any(text, _POSITIVE_TERMS):
            return "positive"
        return "neutral"

    def _priority(
        self, topic: str, sentiment: str, urgency: str, tier: str, sensitive: list[str]
    ) -> str:
        if topic in ("legal_or_chargeback", "fraud_or_abuse") or "safety_issue" in sensitive:
            return "p1"
        if sentiment in ("angry", "frustrated") or urgency == "high" or tier == "vip":
            return "p2"
        if topic in ("refund", "cancellation", "missing_package", "billing"):
            return "p2"
        return "p3"

    # -- drafting -------------------------------------------------------------

    def _compose(self, payload: dict[str, Any]) -> dict[str, Any]:
        topic = str(payload.get("topic", "unknown"))
        brand = str(payload.get("brand_name", "our store"))
        evidence = list(payload.get("evidence", []))
        tools = {t.get("tool_name"): t.get("output", {}) for t in payload.get("tool_results", [])}

        body, confidence = self._compose_body(topic, tools, evidence)
        greeting = "Hi there,"
        closing = f"Thanks,\n{brand} Support"
        draft_text = f"{greeting}\n\n{body}\n\n{closing}"

        draft_evidence = [
            {"type": e.get("type", "kb_chunk"), "ref_id": e.get("ref_id", ""), "summary": e.get("document_title", "")}
            for e in evidence[:2]
        ]
        return {
            "draft_text": draft_text,
            "customer_language": "en",
            "tone": str(payload.get("tone", "helpful_professional")),
            "evidence": draft_evidence,
            "risk_level": "low",
            "confidence": confidence,
            "needs_human": True,
            "human_review_reasons": [],
        }

    def _compose_body(
        self, topic: str, tools: dict[str, Any], evidence: list[dict[str, Any]]
    ) -> tuple[str, float]:
        if topic == "order_status":
            order = tools.get("order_lookup")
            shipment = tools.get("shipment_tracking_lookup")
            if order:
                text = f"Your order {order.get('order_number', '')} is currently '{order.get('status', 'processing')}'."
                if shipment and shipment.get("tracking_number"):
                    text += f" The latest tracking update is '{shipment.get('status', 'in transit')}' (tracking {shipment.get('tracking_number')})."
                return text + " Let us know if you have any other questions.", 0.85
            return "I can check your order status right away — could you share your order number?", 0.6
        if topic == "refund":
            elig = tools.get("refund_eligibility")
            has_policy = any(e.get("document_type") == "policy" for e in evidence)
            if elig and elig.get("eligible") is True and has_policy:
                return (
                    "Based on our refund policy, your order looks eligible for a refund. "
                    "I've flagged this for review, and our team will confirm and process it shortly.",
                    0.8,
                )
            if elig and elig.get("eligible") is False:
                reason = elig.get("reason", "the order falls outside the refund window")
                return f"Our refund policy indicates this order isn't eligible for a refund because {reason}.", 0.75
            return (
                "I'll review our refund policy and your order details and a teammate will follow up "
                "shortly to confirm the next steps.",
                0.55,
            )
        if topic == "cancellation":
            elig = tools.get("cancellation_eligibility")
            if elig and elig.get("cancellable") is True:
                return (
                    "Your order hasn't shipped yet, so it can still be canceled. I've flagged it for "
                    "our team to action and confirm.",
                    0.8,
                )
            if elig and elig.get("cancellable") is False:
                return (
                    "Your order has already progressed in fulfillment, so it may not be cancelable. "
                    "A teammate will review the options with you.",
                    0.7,
                )
            return "Let me check whether this order can still be canceled and a teammate will follow up.", 0.55
        if topic in ("faq", "product_question"):
            if evidence:
                excerpt = evidence[0].get("content_excerpt", "").strip()
                return f"Here's what our help center says: {excerpt}", 0.8
            return "Great question — let me confirm the details and get back to you shortly.", 0.5
        if topic in ("shipping_delay", "missing_package"):
            shipment = tools.get("shipment_tracking_lookup")
            if shipment:
                return (
                    f"Thanks for your patience. The latest tracking status is '{shipment.get('status', 'in transit')}'. "
                    "If it doesn't update soon, we'll open an investigation with the carrier.",
                    0.75,
                )
            return (
                "I'm sorry your package is delayed. I'm looking into it with the carrier and a teammate "
                "will follow up with an update.",
                0.55,
            )
        return "Thanks for reaching out — a teammate will look into this and follow up shortly.", 0.5
