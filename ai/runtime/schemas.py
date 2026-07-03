"""Structured input/output contracts for the v1 support agent graph.

These dataclasses are the Python mirror of the runtime request/response shapes in
``docs/AI_RUNTIME_HARNESS.md`` (sections 3-6) and of the Temporal activity
boundary ``RunAiGraphActivity*`` in
``packages/workers/src/workflows/ticket-lifecycle-types.ts``. They also mirror
the Milestone 8 tool-call envelope (``ToolCallRequestSchema`` /
``ToolCallResultSchema`` in ``@support/shared-schemas``) so the AI runtime and the
TypeScript tool registry speak the same wire shape.

Validation is done with the standard library (dataclasses + explicit checks)
because Pydantic is not available in the local harness (see ADR-0016). Every
value that crosses the runtime boundary is validated; a validation failure raises
:class:`RuntimeValidationError`, which the runner converts into a structured
``failed`` result that routes the ticket to a human (harness section 16).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

# --- Controlled vocabularies -------------------------------------------------

TOPICS: tuple[str, ...] = (
    "order_status",
    "refund",
    "cancellation",
    "shipping_delay",
    "missing_package",
    "faq",
    "product_question",
    "technical_issue",
    "billing",
    "legal_or_chargeback",
    "fraud_or_abuse",
    "unknown",
)

# Sensitive categories from harness section 6.2. A "hard" sensitive flag forces
# human_only and suppresses auto-drafting (a human writes these replies).
HARD_SENSITIVE_FLAGS: tuple[str, ...] = (
    "legal_threat",
    "chargeback",
    "fraud_suspicion",
    "safety_issue",
    "prompt_injection",
)
SOFT_SENSITIVE_FLAGS: tuple[str, ...] = ("abusive_content", "privacy_request", "vip_customer")
SENSITIVE_FLAGS: tuple[str, ...] = HARD_SENSITIVE_FLAGS + SOFT_SENSITIVE_FLAGS

SENTIMENTS: tuple[str, ...] = ("positive", "neutral", "frustrated", "angry")
URGENCIES: tuple[str, ...] = ("low", "normal", "high")
PRIORITIES: tuple[str, ...] = ("p1", "p2", "p3", "p4")
AUTOMATION_MODES: tuple[str, ...] = ("auto_send", "human_approve", "human_only")
RISK_LEVELS: tuple[str, ...] = ("low", "medium", "high")

# The six first-party V1 tools (harness section 6.6 / Milestone 8).
TOOL_NAMES: tuple[str, ...] = (
    "order_lookup",
    "shipment_tracking_lookup",
    "refund_eligibility",
    "cancellation_eligibility",
    "customer_profile_lookup",
    "kb_search",
)
PERMISSION_CLASSES: tuple[str, ...] = (
    "customer_read",
    "order_read",
    "kb_read",
    "eligibility_evaluate",
    "reply_draft",
    "action_execute",
)
SIDE_EFFECT_CLASSES: tuple[str, ...] = (
    "read_only",
    "draft_side_effect",
    "reversible_write",
    "irreversible_write",
)
TOOL_ERROR_CODES: tuple[str, ...] = (
    "invalid_arguments",
    "unauthorized",
    "not_visible",
    "not_found",
    "timeout",
    "result_too_large",
    "output_invalid",
    "tool_error",
)

AutomationMode = Literal["auto_send", "human_approve", "human_only"]
RiskLevel = Literal["low", "medium", "high"]

# Ordering used to pick the most restrictive automation mode. A node may only
# move automation toward the restrictive end (harness sections 6.9 / 7).
_AUTOMATION_SEVERITY = {"auto_send": 0, "human_approve": 1, "human_only": 2}
_RISK_SEVERITY = {"low": 0, "medium": 1, "high": 2}


class RuntimeValidationError(ValueError):
    """Raised when a runtime input or output fails validation."""


def most_restrictive_mode(*modes: str) -> str:
    """Return the most restrictive automation mode among ``modes``."""

    return max(modes, key=lambda mode: _AUTOMATION_SEVERITY[mode])


def highest_risk(*levels: str) -> str:
    """Return the highest risk level among ``levels``."""

    return max(levels, key=lambda level: _RISK_SEVERITY[level])


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeValidationError(message)


def _one_of(value: Any, allowed: tuple[str, ...], field_name: str) -> None:
    _require(value in allowed, f"{field_name} must be one of {allowed}, got {value!r}")


# --- Runtime input -----------------------------------------------------------


@dataclass(frozen=True)
class Message:
    """One conversation message. ``is_internal`` notes are never copied into
    customer-visible text (harness section 3)."""

    role: str  # "customer" | "agent" | "system"
    content: str
    is_internal: bool = False

    def validate(self) -> None:
        _one_of(self.role, ("customer", "agent", "system"), "message.role")
        _require(isinstance(self.content, str), "message.content must be a string")


@dataclass(frozen=True)
class CustomerContext:
    customer_id: Optional[str] = None
    email: Optional[str] = None
    display_name: Optional[str] = None
    tier: str = "standard"  # "standard" | "vip"
    locale: Optional[str] = None


@dataclass(frozen=True)
class TenantContext:
    brand_name: str = "the store"
    tone: str = "helpful_professional"
    timezone: str = "UTC"


@dataclass(frozen=True)
class PolicyContext:
    # Topics the tenant has explicitly allowlisted for auto-send. Empty by
    # default: V1 default is human approval (ADR-0008).
    auto_send_allowed_topics: tuple[str, ...] = ()
    active_policy_version_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RuntimeOptions:
    allow_auto_send: bool = False
    max_tool_calls: int = 4
    max_retrieved_chunks: int = 8


@dataclass(frozen=True)
class RuntimeRequest:
    """Validated request to run the support graph for one AI run."""

    tenant_id: str
    ticket_id: str
    conversation_id: str
    correlation_id: str
    messages: tuple[Message, ...]
    customer: CustomerContext = field(default_factory=CustomerContext)
    tenant: TenantContext = field(default_factory=TenantContext)
    policy: PolicyContext = field(default_factory=PolicyContext)
    options: RuntimeOptions = field(default_factory=RuntimeOptions)
    ai_run_type: str = "full_graph"

    def validate(self) -> None:
        _require(bool(self.tenant_id), "tenant_id is required")
        _require(bool(self.ticket_id), "ticket_id is required")
        _require(bool(self.conversation_id), "conversation_id is required")
        _require(bool(self.correlation_id), "correlation_id is required")
        _require(len(self.messages) > 0, "at least one message is required")
        for message in self.messages:
            message.validate()
        _require(
            any(m.role == "customer" and not m.is_internal for m in self.messages),
            "request must contain at least one customer-visible message",
        )
        _require(self.options.max_tool_calls >= 0, "max_tool_calls must be >= 0")

    def latest_customer_message(self) -> Optional[Message]:
        for message in reversed(self.messages):
            if message.role == "customer" and not message.is_internal:
                return message
        return None


# --- Classification ----------------------------------------------------------


@dataclass(frozen=True)
class Classification:
    topic: str
    subtopic: Optional[str]
    language: str
    sentiment: str
    urgency: str
    priority: str
    sensitive_flags: tuple[str, ...]
    confidence: float
    reasoning_summary: str

    def validate(self) -> None:
        _one_of(self.topic, TOPICS, "classification.topic")
        _one_of(self.sentiment, SENTIMENTS, "classification.sentiment")
        _one_of(self.urgency, URGENCIES, "classification.urgency")
        _one_of(self.priority, PRIORITIES, "classification.priority")
        for flag in self.sensitive_flags:
            _one_of(flag, SENSITIVE_FLAGS, "classification.sensitive_flags[]")
        _require(0.0 <= self.confidence <= 1.0, "classification.confidence must be in [0, 1]")

    def has_hard_sensitive_flag(self) -> bool:
        return any(flag in HARD_SENSITIVE_FLAGS for flag in self.sensitive_flags)

    def to_dict(self) -> dict[str, Any]:
        return {
            "topic": self.topic,
            "subtopic": self.subtopic,
            "language": self.language,
            "sentiment": self.sentiment,
            "urgency": self.urgency,
            "priority": self.priority,
            "sensitive_flags": list(self.sensitive_flags),
            "confidence": self.confidence,
            "reasoning_summary": self.reasoning_summary,
        }


# --- Retrieval ---------------------------------------------------------------


@dataclass(frozen=True)
class RetrievalQuery:
    query: str
    document_type: Optional[str] = None
    reason: str = ""


@dataclass(frozen=True)
class Evidence:
    """A retrieved, citable piece of evidence. Content is untrusted data and is
    never treated as instructions (ADR-0015)."""

    evidence_id: str
    type: str  # "kb_chunk" | "policy"
    ref_id: str
    document_title: str
    document_type: str
    content_excerpt: str
    relevance_score: float
    policy_version_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "type": self.type,
            "ref_id": self.ref_id,
            "document_title": self.document_title,
            "document_type": self.document_type,
            "content_excerpt": self.content_excerpt,
            "relevance_score": self.relevance_score,
            "policy_version_id": self.policy_version_id,
        }


# --- Tool-call envelope (mirror of @support/shared-schemas) -------------------


@dataclass(frozen=True)
class ToolCallRequest:
    tool_name: str
    arguments: dict[str, Any]
    idempotency_key: Optional[str] = None

    def validate(self) -> None:
        _require(bool(self.tool_name), "tool_call.tool_name is required")
        _require(isinstance(self.arguments, dict), "tool_call.arguments must be an object")


@dataclass(frozen=True)
class ToolCallError:
    code: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class ToolCallResult:
    status: str  # "succeeded" | "failed" | "blocked"
    tool_call_id: str
    tool_name: str
    side_effect_class: str
    idempotent_replay: bool = False
    output: Optional[dict[str, Any]] = None
    error: Optional[ToolCallError] = None

    def validate(self) -> None:
        _one_of(self.status, ("succeeded", "failed", "blocked"), "tool_result.status")
        _one_of(self.side_effect_class, SIDE_EFFECT_CLASSES, "tool_result.side_effect_class")
        if self.status == "succeeded":
            _require(bool(self.tool_call_id), "succeeded tool result needs a tool_call_id")
            _require(isinstance(self.output, dict), "succeeded tool result needs an output object")
        else:
            _require(self.error is not None, "non-succeeded tool result needs an error")
            _one_of(self.error.code, TOOL_ERROR_CODES, "tool_result.error.code")

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status,
            "tool_call_id": self.tool_call_id,
            "tool_name": self.tool_name,
            "side_effect_class": self.side_effect_class,
            "idempotent_replay": self.idempotent_replay,
        }
        if self.output is not None:
            payload["output"] = self.output
        if self.error is not None:
            payload["error"] = self.error.to_dict()
        return payload


# --- Policy decision ---------------------------------------------------------


@dataclass(frozen=True)
class PolicyDecision:
    automation_mode: str
    allowed_tool_names: tuple[str, ...]
    blocked_tool_names: tuple[str, ...]
    requires_human_approval: bool
    risk_level: str
    reason_codes: tuple[str, ...]

    def validate(self) -> None:
        _one_of(self.automation_mode, AUTOMATION_MODES, "policy.automation_mode")
        _one_of(self.risk_level, RISK_LEVELS, "policy.risk_level")
        for name in self.allowed_tool_names:
            _one_of(name, TOOL_NAMES, "policy.allowed_tool_names[]")

    def to_dict(self) -> dict[str, Any]:
        return {
            "automation_mode": self.automation_mode,
            "allowed_tool_names": list(self.allowed_tool_names),
            "blocked_tool_names": list(self.blocked_tool_names),
            "requires_human_approval": self.requires_human_approval,
            "risk_level": self.risk_level,
            "reason_codes": list(self.reason_codes),
        }


# --- Draft -------------------------------------------------------------------


@dataclass(frozen=True)
class DraftEvidence:
    type: str
    ref_id: str
    summary: str

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "ref_id": self.ref_id, "summary": self.summary}


@dataclass(frozen=True)
class Draft:
    draft_text: str
    customer_language: str
    tone: str
    evidence: tuple[DraftEvidence, ...]
    risk_level: str
    confidence: float
    needs_human: bool
    human_review_reasons: tuple[str, ...]

    def validate(self) -> None:
        _require(bool(self.draft_text.strip()), "draft.draft_text must not be empty")
        _one_of(self.risk_level, RISK_LEVELS, "draft.risk_level")
        _require(0.0 <= self.confidence <= 1.0, "draft.confidence must be in [0, 1]")

    def to_dict(self) -> dict[str, Any]:
        return {
            "draft_text": self.draft_text,
            "customer_language": self.customer_language,
            "tone": self.tone,
            "evidence": [item.to_dict() for item in self.evidence],
            "actions": [],
            "risk_level": self.risk_level,
            "confidence": self.confidence,
            "needs_human": self.needs_human,
            "human_review_reasons": list(self.human_review_reasons),
        }


# --- Guardrails --------------------------------------------------------------


@dataclass(frozen=True)
class GuardrailIssue:
    code: str
    severity: str  # "low" | "medium" | "high"
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "severity": self.severity, "message": self.message}


@dataclass(frozen=True)
class GuardrailResult:
    passed: bool
    risk_level: str
    issues: tuple[GuardrailIssue, ...]
    recommended_action: str  # an AutomationMode

    def validate(self) -> None:
        _one_of(self.risk_level, RISK_LEVELS, "guardrails.risk_level")
        _one_of(self.recommended_action, AUTOMATION_MODES, "guardrails.recommended_action")

    def has_high_severity(self) -> bool:
        return any(issue.severity == "high" for issue in self.issues)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "risk_level": self.risk_level,
            "issues": [issue.to_dict() for issue in self.issues],
            "recommended_action": self.recommended_action,
        }


# --- Final recommendation + result ------------------------------------------


@dataclass(frozen=True)
class FinalRecommendation:
    automation_mode: str
    risk_level: str
    confidence: float
    reason_codes: tuple[str, ...]

    def validate(self) -> None:
        _one_of(self.automation_mode, AUTOMATION_MODES, "final.automation_mode")
        _one_of(self.risk_level, RISK_LEVELS, "final.risk_level")
        _require(0.0 <= self.confidence <= 1.0, "final.confidence must be in [0, 1]")

    def to_dict(self) -> dict[str, Any]:
        return {
            "automation_mode": self.automation_mode,
            "risk_level": self.risk_level,
            "confidence": self.confidence,
            "reason_codes": list(self.reason_codes),
        }


@dataclass(frozen=True)
class HumanApprovalPackage:
    """The reviewer-facing package assembled when a human must approve or handle
    the ticket (harness section 13). Never carries secrets or hidden prompts."""

    customer_message: str
    ticket_summary: str
    classification: dict[str, Any]
    draft_text: Optional[str]
    evidence: list[dict[str, Any]]
    tool_results: list[dict[str, Any]]
    risk_reasons: list[str]
    suggested_action: str
    missing_info_questions: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "customer_message": self.customer_message,
            "ticket_summary": self.ticket_summary,
            "classification": self.classification,
            "draft_text": self.draft_text,
            "evidence": self.evidence,
            "tool_results": self.tool_results,
            "risk_reasons": self.risk_reasons,
            "suggested_action": self.suggested_action,
            "missing_info_questions": self.missing_info_questions,
        }


@dataclass(frozen=True)
class RuntimeResult:
    """Top-level structured output, mirroring ``RunAiGraphActivityResult``.

    A ``succeeded`` result carries the full graph output; a ``failed`` result
    carries a structured error and routes the ticket to a human.
    """

    status: str  # "succeeded" | "failed"
    ai_run_id: Optional[str]
    trace_id: Optional[str]
    # succeeded fields
    classification: Optional[dict[str, Any]] = None
    routing_decision: Optional[dict[str, Any]] = None
    tool_calls: tuple[dict[str, Any], ...] = ()
    draft: Optional[dict[str, Any]] = None
    guardrails: Optional[dict[str, Any]] = None
    final_recommendation: Optional[dict[str, Any]] = None
    approval_package: Optional[dict[str, Any]] = None
    eval_signals: dict[str, Any] = field(default_factory=dict)
    # failed fields
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    retryable: bool = False
    reason_codes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        if self.status == "succeeded":
            return {
                "status": "succeeded",
                "ai_run_id": self.ai_run_id,
                "trace_id": self.trace_id,
                "classification": self.classification,
                "routing_decision": self.routing_decision,
                "tool_calls": list(self.tool_calls),
                "draft": self.draft,
                "guardrails": self.guardrails,
                "final_recommendation": self.final_recommendation,
                "approval_package": self.approval_package,
                "eval_signals": self.eval_signals,
            }
        return {
            "status": "failed",
            "ai_run_id": self.ai_run_id,
            "trace_id": self.trace_id,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "retryable": self.retryable,
            "reason_codes": list(self.reason_codes),
            "eval_signals": self.eval_signals,
        }
